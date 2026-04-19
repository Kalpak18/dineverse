const Anthropic = require('@anthropic-ai/sdk');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_DECODED_BYTES = 5 * 1024 * 1024; // 5 MB

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

const SYSTEM_PROMPT = `You are a menu digitisation assistant for Indian restaurants and cafés.
Your job is to extract every food and beverage item from a photographed physical menu card.

Rules:
1. Group items under their category headings exactly as printed (e.g. "Starters", "Main Course", "Beverages").
   If no heading is visible for an item, put it under "Uncategorized".
2. For each item identify:
   - name: the item name as printed
   - price: numeric value in INR. Omit currency symbols. Use null if price is unclear or missing.
   - description: any sub-text, ingredients, or serving note printed under the item name. Use null if none.
   - is_veg: true if a green square/dot symbol (🟢) appears next to the item or if it is clearly a
             vegetarian dish. false if a brown/red square/dot (🔴) appears, or if the dish contains
             meat, seafood, or eggs. When genuinely ambiguous, default to true.
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
  // Approximate decoded size: base64 length × 0.75
  if (image.length * 0.75 > MAX_DECODED_BYTES) {
    return fail(res, 'Image too large. Maximum size is 5 MB.', 400);
  }

  let raw;
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: image },
            },
            {
              type: 'text',
              text: 'Extract all menu items from this photo. Return only the JSON.',
            },
          ],
        },
      ],
    });
    raw = response.content[0]?.text;
  } catch (err) {
    if (err.status === 529 || err.message?.includes('overloaded')) {
      return fail(res, 'AI service is busy — please try again in a moment.', 503);
    }
    if (err.status === 401) {
      logger.error('Anthropic API key invalid: %s', err.message);
      return fail(res, 'AI service configuration error. Contact support.', 500);
    }
    logger.error('Anthropic API error: %s', err.message);
    return fail(res, 'AI processing failed. Please try again.', 502);
  }

  let parsed;
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    logger.error('Claude returned non-JSON: %s', raw?.slice(0, 300));
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
