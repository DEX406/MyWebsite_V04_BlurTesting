import { verifyAuth } from './_auth.js';
import { R2_PUBLIC_URL, BUCKET, getPresignedUploadUrl } from './_r2.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { filename, contentType } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType required' });
    }

    const key = `canvas/${Date.now()}-${filename}`;
    const uploadUrl = await getPresignedUploadUrl(key, contentType);
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;

    return res.status(200).json({ uploadUrl, publicUrl, key });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'failed to generate upload URL' });
  }
}
