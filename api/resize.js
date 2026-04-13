import sharp from 'sharp';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { verifyAuth } from './_auth.js';
import { r2, BUCKET, R2_PUBLIC_URL } from './_r2.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { sourceUrl, scale } = req.body;
    if (!sourceUrl || !scale) {
      return res.status(400).json({ error: 'sourceUrl and scale required' });
    }

    // Fetch image — from R2 bucket directly or external URL
    let buffer, contentType;
    const r2Prefix = R2_PUBLIC_URL + '/';
    if (sourceUrl.startsWith(r2Prefix)) {
      const key = sourceUrl.slice(r2Prefix.length);
      const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      buffer = Buffer.from(await obj.Body.transformToByteArray());
      contentType = obj.ContentType || 'image/png';
    } else {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error('Failed to fetch source image');
      buffer = Buffer.from(await response.arrayBuffer());
      contentType = response.headers.get('content-type') || 'image/png';
    }

    const isGif = contentType === 'image/gif';

    // Resize
    if (scale < 1) {
      const meta = await sharp(buffer, isGif ? { animated: true } : {}).metadata();
      let pipeline = sharp(buffer, isGif ? { animated: true } : {})
        .resize(Math.round(meta.width * scale));

      if (isGif) {
        // GIF stays GIF — preserve animation
        buffer = await pipeline.gif().toBuffer();
      } else {
        // Everything else becomes WebP lossless
        buffer = await pipeline.webp({ lossless: true }).toBuffer();
        contentType = 'image/webp';
      }
    } else if (!isGif) {
      // scale >= 1 but not GIF — still convert to WebP lossless (e.g. Store in R2)
      buffer = await sharp(buffer).webp({ lossless: true }).toBuffer();
      contentType = 'image/webp';
    }

    // Determine output extension
    const outExt = isGif ? 'gif' : 'webp';
    const outKey = `canvas/${Date.now()}-resized.${outExt}`;

    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: outKey,
      Body: buffer,
      ContentType: contentType,
    }));

    return res.status(200).json({ url: `${R2_PUBLIC_URL}/${outKey}` });
  } catch (err) {
    console.error('Resize error:', err);
    return res.status(500).json({ error: 'Resize failed' });
  }
}
