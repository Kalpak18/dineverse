const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_DECODED_BYTES = 5 * 1024 * 1024; // 5 MB

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.Gemini_API_Key) throw new Error('Gemini_API_Key is not configured');
    _client = new GoogleGenerativeAI(process.env.Gemini_API_Key);
  }
  return _client;
}

const PROMPT = `You are a menu digitisation assistant for Indian restaurants and cafés.
Extract every food and beverage item from this photographed physical menu card.

Rules:
1. Group items under their category headings exactly as printed (e.g. "Starters", "Main Course", "Beverages").
   If no heading is visible for an item, put it under "Uncategorized".
2. For each item identify:
   - name: the item name as printed
   - price: numeric value in INR. Omit currency symbols. Use null if price is unclear or missing.
   - description: any sub-text, ingredients, or serving note printed under the item name. Use null if none.
   - is_veg: true if a green square/dot symbol appears next to the item or if it is clearly a vegetarian dish.
             false if a brown/red square/dot appears, or if the dish contains meat, seafood, or eggs.
             When genuinely ambiguous, default to true.
3. Return ONLY a valid JSON object — no markdown fences, no explanation, no trailing text.
4. The JSON must exactly match this schema:
{
  "categories": [
    {
      "name": "string",
      "items": [
        {
          "name": "string",
          "price": number | null,
          "description": "string | null",
          "is_veg": boolean
        }
      ]
    }
  ]
}`;

exports.aiMenuImport = asyncHandler(async (req, res) => {
  const { image, mimeType } = req.body;

  if (!image || typeof image !== 'string') {
    return fail(res, 'image (base64 string) is required', 400);
  }
  if (!mimeType || !ALLOWED_MIME.includes(mimeType)) {
    return fail(res, `mimeType must be one of: ${ALLOWED_MIME.join(', ')}`, 400);
  }
  if (image.length * 0.75 > MAX_DECODED_BYTES) {
    return fail(res, 'Image too large. Maximum size is 5 MB.', 400);
  }

  let raw;
  try {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent([
      PROMPT,
      {
        inlineData: {
          mimeType,
          data: image,
        },
      },
    ]);

    raw = result.response.text();
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      return fail(res, 'AI quota exceeded — please try again later.', 503);
    }
    if (msg.includes('API_KEY') || msg.includes('401') || msg.includes('403')) {
      logger.error('Gemini API key error: %s', msg);
      return fail(res, 'AI service configuration error. Contact support.', 500);
    }
    logger.error('Gemini API error: %s', msg);
    return fail(res, 'AI processing failed. Please try again.', 502);
  }

  let parsed;
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    logger.error('Gemini returned non-JSON: %s', raw?.slice(0, 300));
    return fail(res, 'AI returned an unreadable response. Please try again or enter items manually.', 422);
  }

  if (!Array.isArray(parsed?.categories) || parsed.categories.length === 0) {
    return fail(res, 'No menu items could be detected in this photo. Try a clearer image.', 422);
  }

  const categories = parsed.categories
    .map((cat) => ({
      name: String(cat.name || 'Uncategorized').trim(),
      items: (Array.isArray(cat.items) ? cat.items : [])
        .map((item) => ({
          name:        String(item.name || '').trim(),
          price:       item.price != null ? parseFloat(item.price) : null,
          description: item.description ? String(item.description).trim() : null,
          is_veg:      item.is_veg === false ? false : true,
        }))
        .filter((item) => item.name.length > 0),
    }))
    .filter((cat) => cat.items.length > 0);

  if (categories.length === 0) {
    return fail(res, 'No valid menu items found in the photo.', 422);
  }

  ok(res, { categories });
});
