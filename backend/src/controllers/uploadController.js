const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const s3 = require('../config/s3');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const URL_EXPIRY_SECONDS = 120; // presigned URL valid for 2 min

// Folder per upload type so the bucket stays organized
const FOLDERS = {
  menu_item: 'menu-items',
  logo: 'logos',
  cover: 'covers',
};

/**
 * POST /api/uploads/presign
 * Body: { contentType, size, uploadType }
 * uploadType: 'menu_item' | 'logo' | 'cover'
 *
 * Returns: { uploadUrl, objectUrl, key }
 */
exports.getPresignedUrl = asyncHandler(async (req, res) => {
  const { contentType, size, uploadType = 'menu_item' } = req.body;

  if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
    return fail(res, `Unsupported file type. Allowed: ${ALLOWED_TYPES.join(', ')}`);
  }

  if (!size || size > MAX_SIZE_BYTES) {
    return fail(res, `File too large. Maximum size is ${MAX_SIZE_BYTES / 1024 / 1024} MB`);
  }

  const VALID_UPLOAD_TYPES = ['menu_item', 'logo', 'cover'];
  if (!VALID_UPLOAD_TYPES.includes(uploadType)) {
    return fail(res, `Invalid upload type. Allowed: ${VALID_UPLOAD_TYPES.join(', ')}`);
  }

  const folder = FOLDERS[uploadType];
  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
  // Namespace by cafeId to keep tenants' files separate
  const key = `${folder}/${req.cafeId}/${uuidv4()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: URL_EXPIRY_SECONDS });

  const baseUrl = process.env.S3_PUBLIC_URL
    || `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com`;

  ok(res, { uploadUrl, objectUrl: `${baseUrl}/${key}`, key });
});
