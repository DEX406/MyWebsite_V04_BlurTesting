import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
    const { usedUrls } = req.body;
    if (!Array.isArray(usedUrls)) {
      return res.status(400).json({ error: 'usedUrls array required' });
    }

    // List all objects in the canvas folder
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

    // Find objects not in use — no protection, brute-force delete all unused
    const usedSet = new Set(usedUrls);
    const toDelete = objects.filter(obj => {
      const url = `${R2_PUBLIC_URL}/${obj.Key}`;
      return !usedSet.has(url);
    });

    // Delete unused objects
    let deleted = 0;
    for (const obj of toDelete) {
      try {
        await r2.send(new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: obj.Key,
        }));
        deleted++;
      } catch (e) {
        console.error('Failed to delete:', obj.Key, e.message);
      }
    }

    return res.status(200).json({
      deleted,
      total: objects.length,
      unused: toDelete.length
    });
  } catch (err) {
    console.error('Cleanup error:', err);
    return res.status(500).json({ error: 'Cleanup failed' });
  }
}
