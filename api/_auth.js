import jwt from 'jsonwebtoken';

export function verifyAuth(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  try {
    jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}
