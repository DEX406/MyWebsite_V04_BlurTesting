import { GetObjectCommand } from '@aws-sdk/client-s3';
import { verifyAuth } from './_auth.js';
import { r2, BUCKET } from './_r2.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { key } = req.query;
  if (!key || typeof key !== 'string' || !key.startsWith('canvas/')) {
    return res.status(400).json({ error: 'key must start with canvas/' });
  }

  try {
    const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    if (obj.ContentLength) res.setHeader('Content-Length', String(obj.ContentLength));

    const chunks = [];
    for await (const chunk of obj.Body) chunks.push(chunk);
    return res.status(200).send(Buffer.concat(chunks));
  } catch (err) {
    if (err.name === 'NoSuchKey') return res.status(404).json({ error: 'Not found' });
    console.error('Download image error:', err);
    return res.status(500).json({ error: 'Failed to download image' });
  }
}
