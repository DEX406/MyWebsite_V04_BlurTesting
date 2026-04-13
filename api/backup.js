import { kv } from '@vercel/kv';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { verifyAuth } from './_auth.js';
import { r2, BUCKET, R2_PUBLIC_URL } from './_r2.js';

const BOARD_KEY = 'lutz-board-v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const data = await kv.get(BOARD_KEY);
    const board = Array.isArray(data)
      ? { items: data, bgGrid: null, homeView: null, palette: null }
      : { items: data?.items || [], bgGrid: data?.bgGrid || null, homeView: data?.homeView || null, palette: data?.palette || null };

    // List all objects in R2 canvas/ folder
    const objects = [];
    let continuationToken;
    do {
      const listRes = await r2.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: 'canvas/',
        ContinuationToken: continuationToken,
      }));
      if (listRes.Contents) objects.push(...listRes.Contents);
      continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
    } while (continuationToken);

    const images = objects.map(obj => ({
      key: obj.Key,
      url: `${R2_PUBLIC_URL}/${obj.Key}`,
      size: obj.Size,
    }));

    return res.status(200).json({ board, images });
  } catch (err) {
    console.error('Backup error:', err);
    return res.status(500).json({ error: 'Backup failed', detail: err.message });
  }
}
