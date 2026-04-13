import { kv } from '@vercel/kv';
import { verifyAuth } from './_auth.js';

const BOARD_KEY = 'lutz-board-v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const data = await kv.get(BOARD_KEY);
      // Migrate: old format stored a plain array; bgTile (URL) replaced by bgGrid (object)
      if (Array.isArray(data)) return res.status(200).json({ items: data, bgGrid: null, homeView: null, palette: null });
      return res.status(200).json({ items: data?.items || [], bgGrid: data?.bgGrid || null, homeView: data?.homeView || null, palette: data?.palette || null });
    }

    if (req.method === 'POST') {
      if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

      const { items, bgGrid, homeView, palette } = req.body;
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

      await kv.set(BOARD_KEY, { items, bgGrid: bgGrid || null, homeView: homeView || null, palette: palette || null });
      return res.status(200).json({ ok: true, count: items.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Board API error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
