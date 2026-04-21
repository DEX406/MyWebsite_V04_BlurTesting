import sharp from 'sharp';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { verifyAuth } from './_auth.js';
import { r2, BUCKET, R2_PUBLIC_URL, CACHE_CONTROL } from './_r2.js';

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

    // Detect animation — covers both GIF and animated WebP. Using pages>1 is the
    // umbrella check; it keeps the existing GIF path working while also
    // preserving frames for animated WebPs produced by the client-side maker
    // and the GIF→WebP upload conversion.
    const probeMeta = await sharp(buffer, { animated: true }).metadata();
    const isAnimated = (probeMeta.pages || 1) > 1;
    const isGif = contentType === 'image/gif';

    if (scale < 1) {
      const srcW = probeMeta.pageWidth || probeMeta.width;
      const targetW = Math.max(1, Math.round(srcW * scale));
      let pipeline = sharp(buffer, isAnimated ? { animated: true } : {}).resize(targetW);
      if (isGif) {
        buffer = await pipeline.gif().toBuffer();
      } else if (isAnimated) {
        buffer = await pipeline.webp({ lossless: true }).toBuffer();
        contentType = 'image/webp';
      } else {
        buffer = await pipeline.webp({ lossless: true }).toBuffer();
        contentType = 'image/webp';
      }
    } else if (!isGif) {
      // scale >= 1 — re-encode as WebP lossless to store in R2.
      // CRITICAL: preserve animation for animated sources; without {animated:true}
      // Sharp flattens the input to the first frame.
      if (isAnimated) {
        buffer = await sharp(buffer, { animated: true }).webp({ lossless: true }).toBuffer();
      } else {
        buffer = await sharp(buffer).webp({ lossless: true }).toBuffer();
      }
      contentType = 'image/webp';
    }

    const outExt = isGif ? 'gif' : 'webp';
    const outKey = `canvas/${Date.now()}-resized.${outExt}`;

    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: outKey,
      Body: buffer,
      ContentType: contentType,
      CacheControl: CACHE_CONTROL,
    }));

    return res.status(200).json({ url: `${R2_PUBLIC_URL}/${outKey}` });
  } catch (err) {
    console.error('Resize error:', err);
    return res.status(500).json({ error: 'Resize failed' });
  }
}
