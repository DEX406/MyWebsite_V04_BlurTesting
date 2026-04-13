import { verifyAuth } from './_auth.js';
import { getPresignedUploadUrl, R2_PUBLIC_URL } from './_r2.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { key, contentType } = req.body;

    if (!key || typeof key !== 'string' || !key.startsWith('canvas/')) {
      return res.status(400).json({ error: 'key must start with canvas/' });
    }
    if (!contentType) {
      return res.status(400).json({ error: 'contentType required' });
    }

    const uploadUrl = await getPresignedUploadUrl(key, contentType);
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;

    return res.status(200).json({ uploadUrl, publicUrl });
  } catch (err) {
    console.error('Restore image error:', err);
    return res.status(500).json({ error: 'Failed to generate restore URL', detail: err.message });
  }
}
