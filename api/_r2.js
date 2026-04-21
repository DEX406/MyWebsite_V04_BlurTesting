import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://assets.lutz.work').replace(/\/+$/, '');

// Legacy pub-*.r2.dev origin kept for backward compatibility so URLs saved
// before the custom domain switch still map back to object keys.
const LEGACY_R2_PUBLIC_URL = 'https://pub-354e0f6627594f598c56d9570efa8a3b.r2.dev';

// Extract the R2 object key from either the current or legacy public URL.
// Returns null if the URL doesn't match any of our known R2 origins.
export function extractR2Key(url) {
  if (typeof url !== 'string') return null;
  for (const prefix of [R2_PUBLIC_URL + '/', LEGACY_R2_PUBLIC_URL + '/']) {
    if (url.startsWith(prefix)) return url.slice(prefix.length);
  }
  return null;
}

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export const BUCKET = process.env.R2_BUCKET_NAME;

export async function getPresignedUploadUrl(key, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn: 300 }); // expires in 5 minutes
}
