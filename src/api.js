const TOKEN_KEY = 'lutz-admin-token';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 1 day

const stripDisplaySrc = (items) => items.map(({ displaySrc, placeholderSrc, targetSrc, _mipmapPending, ...rest }) => rest);

function getToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) { localStorage.removeItem(TOKEN_KEY); return null; }
    return token;
  } catch { localStorage.removeItem(TOKEN_KEY); return null; }
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

export async function login(password) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.status === 429) {
    const { retryAfter } = await res.json();
    return { rateLimited: true, retryAfter: retryAfter || 900 };
  }
  if (!res.ok) return false;
  const { token } = await res.json();
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiry: Date.now() + TOKEN_EXPIRY_MS }));
  return true;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasToken() {
  return !!getToken();
}

export async function loadBoard() {
  try {
    const res = await fetch("/api/board");
    if (res.ok) {
      const d = await res.json();
      if (d.items || d.bgGrid || d.bgTile || d.homeView) return { items: stripDisplaySrc(d.items || []), bgGrid: d.bgGrid || null, homeView: d.homeView || null, palette: d.palette || null };
    }
  } catch (e) {}
  try {
    const raw = localStorage.getItem("lutz-board");
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d) && d.length) return { items: stripDisplaySrc(d), bgGrid: null, homeView: null, palette: null };
      if (d?.items || d?.bgGrid || d?.bgTile || d?.homeView) return { items: stripDisplaySrc(d.items || []), bgGrid: d.bgGrid || null, homeView: d.homeView || null, palette: d.palette || null };
    }
  } catch (e) {}
  return { items: [], bgGrid: null, homeView: null, palette: null };
}

export async function saveBoard(items, bgGrid, homeView, palette) {
  const payload = { items: stripDisplaySrc(items), bgGrid: bgGrid || null, homeView: homeView || null, palette: palette || null };
  try {
    localStorage.setItem("lutz-board", JSON.stringify(payload));
  } catch (e) {}
  try {
    const res = await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

export async function cleanupFiles(items) {
  const usedUrls = new Set();
  for (const i of items) {
    if (i.type !== "image" && i.type !== "video") continue;
    if (i.src) usedUrls.add(i.src);
    if (i.srcQ50) usedUrls.add(i.srcQ50);
    if (i.srcQ25) usedUrls.add(i.srcQ25);
    if (i.srcQ12) usedUrls.add(i.srcQ12);
    if (i.srcQ6) usedUrls.add(i.srcQ6);
  }
  const res = await fetch("/api/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ usedUrls: Array.from(usedUrls) }),
  });
  if (!res.ok) throw new Error("Cleanup failed");
  return await res.json();
}

export async function downloadImageViaProxy(key) {
  const res = await fetch(`/api/download-image?key=${encodeURIComponent(key)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.blob();
}

export async function getBackupManifest() {
  const res = await fetch('/api/backup', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch backup manifest');
  return await res.json(); // { board, images }
}

export async function restoreImageKey(key, contentType) {
  const res = await fetch('/api/restore-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ key, contentType }),
  });
  if (!res.ok) throw new Error('Failed to get presigned restore URL');
  return await res.json(); // { uploadUrl, publicUrl }
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export async function uploadImage(file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum upload size is 15 MB.`);
  }

  // Step 1: get a presigned URL from the server (no file data sent here)
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }

  const { uploadUrl, publicUrl, key } = await res.json();

  // Step 2: upload the file directly to R2 (bypasses Vercel size limits)
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });

  if (!upload.ok) {
    throw new Error('Failed to upload file to storage');
  }

  // Step 3: convert to WebP lossless (server-side, skips GIF/SVG/WebP)
  const convertRes = await fetch('/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ key }),
  });

  if (!convertRes.ok) {
    // Conversion failed but original is still in R2 — return original URL
    console.warn('WebP conversion failed, using original');
    return { url: publicUrl };
  }

  const { url } = await convertRes.json();
  return { url };
}

export async function uploadVideo(blob, filename) {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ filename, contentType: 'video/webm' }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }

  const { uploadUrl, publicUrl } = await res.json();

  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/webm' },
    body: blob,
  });

  if (!upload.ok) {
    throw new Error('Failed to upload video to storage');
  }

  return { url: publicUrl };
}

// Generate mipmap variants (50%, 25%, 12.5%, 6.25%) for an image
export async function generateMipmaps(src) {
  const res = await fetch('/api/mipmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ src }),
  });
  if (!res.ok) return null;
  return await res.json(); // { src, srcQ50, srcQ25, srcQ12, srcQ6 }
}

// Server-side resize — returns new R2 URL
export async function serverResize(sourceUrl, scale) {
  const res = await fetch('/api/resize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sourceUrl, scale }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Resize failed');
  }
  return await res.json();
}
