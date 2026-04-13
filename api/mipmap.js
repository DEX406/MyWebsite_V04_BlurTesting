import sharp from 'sharp';
import { GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { verifyAuth } from './_auth.js';
import { r2, BUCKET, R2_PUBLIC_URL } from './_r2.js';

// Suffixes appended before the file extension
const VARIANTS = [
  { suffix: '_q50', scale: 0.50 },
  { suffix: '_q25', scale: 0.25 },
  { suffix: '_q12', scale: 0.125 },
  { suffix: '_q6', scale: 0.0625 },
];

// Formats we skip (GIF = animated, SVG = vector)
const SKIP_EXTS = new Set(['gif', 'svg']);

function variantKey(originalKey, suffix) {
  return originalKey.replace(/(\.[^.]+)$/, `${suffix}$1`);
}

async function objectExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { src } = req.body;
    if (!src) return res.status(400).json({ error: 'src required' });

    // Only process R2-hosted images
    const r2Prefix = R2_PUBLIC_URL + '/';
    if (!src.startsWith(r2Prefix)) {
      return res.status(200).json({ src, srcQ50: null, srcQ25: null, srcQ12: null, srcQ6: null });
    }

    const key = src.slice(r2Prefix.length);
    const ext = key.split('.').pop().toLowerCase();

    // Skip GIF and SVG
    if (SKIP_EXTS.has(ext)) {
      return res.status(200).json({ src, srcQ50: null, srcQ25: null, srcQ12: null, srcQ6: null });
    }

    // Check which variants already exist
    const results = {};
    const toGenerate = [];
    for (const v of VARIANTS) {
      const vKey = variantKey(key, v.suffix);
      if (await objectExists(vKey)) {
        results[v.suffix] = `${R2_PUBLIC_URL}/${vKey}`;
      } else {
        toGenerate.push(v);
      }
    }

    // If all variants exist, return early
    if (toGenerate.length === 0) {
      return res.status(200).json({
        src,
        srcQ50: results['_q50'] || null,
        srcQ25: results['_q25'] || null,
        srcQ12: results['_q12'] || null,
        srcQ6: results['_q6'] || null,
      });
    }

    // Fetch the original image
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const buffer = Buffer.from(await obj.Body.transformToByteArray());
    const meta = await sharp(buffer).metadata();

    // Generate missing variants
    for (const v of toGenerate) {
      const targetWidth = Math.max(1, Math.round(meta.width * v.scale));
      const variantBuffer = await sharp(buffer)
        .resize(targetWidth)
        .webp({ lossless: true })
        .toBuffer();

      const vKey = variantKey(key, v.suffix);
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: vKey,
        Body: variantBuffer,
        ContentType: 'image/webp',
      }));
      results[v.suffix] = `${R2_PUBLIC_URL}/${vKey}`;
    }

    return res.status(200).json({
      src,
      srcQ50: results['_q50'] || null,
      srcQ25: results['_q25'] || null,
      srcQ12: results['_q12'] || null,
      srcQ6: results['_q6'] || null,
    });
  } catch (err) {
    console.error('Mipmap error:', err);
    return res.status(500).json({ error: 'Mipmap generation failed' });
  }
}
