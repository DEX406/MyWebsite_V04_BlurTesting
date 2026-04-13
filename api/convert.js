import sharp from 'sharp';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { verifyAuth } from './_auth.js';
import { r2, BUCKET, R2_PUBLIC_URL } from './_r2.js';

// Formats that should be converted to WebP lossless
const CONVERT_EXTS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'avif', 'tiff', 'tif']);
// Formats that are left untouched
const SKIP_EXTS = new Set(['gif', 'webp', 'svg']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });

    const ext = key.split('.').pop().toLowerCase();

    // Skip formats that shouldn't be converted
    if (SKIP_EXTS.has(ext) || !CONVERT_EXTS.has(ext)) {
      return res.status(200).json({ url: `${R2_PUBLIC_URL}/${key}` });
    }

    // Fetch original from R2
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const buffer = Buffer.from(await obj.Body.transformToByteArray());

    // Convert to WebP lossless
    const webpBuffer = await sharp(buffer).webp({ lossless: true }).toBuffer();

    // Upload WebP version with .webp extension
    const webpKey = key.replace(/\.[^.]+$/, '.webp');
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: webpKey,
      Body: webpBuffer,
      ContentType: 'image/webp',
    }));

    // Delete original to save storage (only if key changed)
    if (webpKey !== key) {
      await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    }

    return res.status(200).json({ url: `${R2_PUBLIC_URL}/${webpKey}` });
  } catch (err) {
    console.error('Convert error:', err);
    return res.status(500).json({ error: 'Conversion failed' });
  }
}
