import jwt from 'jsonwebtoken';
import { kv } from '@vercel/kv';

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 900; // 15 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!JWT_SECRET || !ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const ip = (req.headers['x-forwarded-for'] || '127.0.0.1').split(',')[0].trim();
  const key = `login-attempts:${ip}`;

  const attempts = (await kv.get(key)) || 0;
  if (attempts >= MAX_ATTEMPTS) {
    const ttl = await kv.ttl(key);
    return res.status(429).json({ error: 'Too many attempts', retryAfter: ttl > 0 ? ttl : WINDOW_SECONDS });
  }

  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    const newAttempts = await kv.incr(key);
    if (newAttempts === 1) await kv.expire(key, WINDOW_SECONDS);
    return res.status(401).json({ error: 'Wrong password' });
  }

  await kv.del(key);
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '30d' });
  return res.status(200).json({ token });
}
