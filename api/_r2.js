import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://assets.lutz.work').replace(/\/+$/, '');

// Legacy public URL used before the custom domain was set up — needed to
// recognise existing board images that were uploaded under the old hostname.
export const R2_LEGACY_URL = 'https://pub-354e0f6627594f598c56d9570efa8a3b.r2.dev';

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
