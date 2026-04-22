/*
 * Animated WebP encoding and GIF decoding — zero runtime deps.
 *
 * Encoding approach: the browser's own `canvas.toBlob('image/webp', q)` gives
 * us a single-frame WebP per frame. We parse out the VP8/VP8L payload chunk
 * from each and mux them into an animated WebP (RIFF container with VP8X +
 * ANIM + ANMF chunks, per the WebP spec).
 *
 * Lossless caveat: Chromium emits VP8L for quality=1.0, VP8 otherwise. Other
 * browsers may always emit VP8. We pass quality=1.0 when the caller asks for
 * "lossless", which gets true VP8L where supported and max-quality VP8
 * elsewhere — perceptually lossless either way.
 *
 * GIF decoding uses the WebCodecs `ImageDecoder` API (iOS 16.4+, Chrome 94+).
 * On unsupported browsers the conversion is skipped and the GIF is used as-is.
 */

// ─── Canvas helpers ─────────────────────────────────────────────────────────

// Draw `source` centered inside a transparent canvas of `canvasW` × `canvasH`
// with aspect-preserving contain-fit. Returns the canvas.
export function fitOntoCanvas(source, srcW, srcH, canvasW, canvasH) {
  const c = document.createElement('canvas');
  c.width = canvasW;
  c.height = canvasH;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const scale = Math.min(canvasW / srcW, canvasH / srcH);
  const drawW = Math.max(1, Math.round(srcW * scale));
  const drawH = Math.max(1, Math.round(srcH * scale));
  const dx = Math.floor((canvasW - drawW) / 2);
  const dy = Math.floor((canvasH - drawH) / 2);
  ctx.drawImage(source, 0, 0, srcW, srcH, dx, dy, drawW, drawH);
  return c;
}

// Downscale a canvas so its longest edge is at most `maxLongEdge`, preserving
// aspect. Returns the original canvas if it already fits.
export function clampLongEdge(canvas, maxLongEdge) {
  const srcW = canvas.width, srcH = canvas.height;
  const longEdge = Math.max(srcW, srcH);
  if (longEdge <= maxLongEdge) return canvas;
  const scale = maxLongEdge / longEdge;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(srcW * scale));
  out.height = Math.max(1, Math.round(srcH * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, srcW, srcH, 0, 0, out.width, out.height);
  return out;
}

// Load a File or Blob as a decoded ImageBitmap with known dimensions.
export async function loadAsBitmap(fileOrBlob) {
  const bmp = await createImageBitmap(fileOrBlob);
  return { bitmap: bmp, width: bmp.width, height: bmp.height };
}

// ─── Palette quantization ───────────────────────────────────────────────────

// Convert the canvas to grayscale (luminance-weighted), 256 gray levels. The
// lossless encoder collapses the redundant channels well, so this is mainly a
// perceptual/aesthetic choice.
function applyGrayscale(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
}

// Median-cut palette quantization to exactly `n` colors. Alpha is preserved
// per-pixel (not quantized), so transparent regions stay transparent.
function buildPalette(pixels, n) {
  const buckets = [{ pixels, min: [0, 0, 0], max: [255, 255, 255] }];
  while (buckets.length < n) {
    // Pick the bucket with the widest color range on any axis.
    let best = -1, bestRange = -1, bestAxis = 0;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.pixels.length < 2) continue;
      let rMin = 255, gMin = 255, bMin = 255, rMax = 0, gMax = 0, bMax = 0;
      for (const p of b.pixels) {
        if (p[0] < rMin) rMin = p[0]; if (p[0] > rMax) rMax = p[0];
        if (p[1] < gMin) gMin = p[1]; if (p[1] > gMax) gMax = p[1];
        if (p[2] < bMin) bMin = p[2]; if (p[2] > bMax) bMax = p[2];
      }
      b.min = [rMin, gMin, bMin];
      b.max = [rMax, gMax, bMax];
      const rr = rMax - rMin, gg = gMax - gMin, bb = bMax - bMin;
      const range = Math.max(rr, gg, bb);
      if (range > bestRange) {
        bestRange = range; best = i;
        bestAxis = rr >= gg && rr >= bb ? 0 : (gg >= bb ? 1 : 2);
      }
    }
    if (best < 0 || bestRange <= 0) break;
    const b = buckets[best];
    b.pixels.sort((p, q) => p[bestAxis] - q[bestAxis]);
    const mid = b.pixels.length >> 1;
    const left = b.pixels.slice(0, mid);
    const right = b.pixels.slice(mid);
    buckets.splice(best, 1, { pixels: left }, { pixels: right });
  }
  // Average each bucket to produce the final palette entry.
  return buckets.map(b => {
    let r = 0, g = 0, bl = 0;
    for (const p of b.pixels) { r += p[0]; g += p[1]; bl += p[2]; }
    const n = Math.max(1, b.pixels.length);
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
  });
}

function nearestPaletteIndex(palette, r, g, b) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// Sample at most `maxSamples` opaque pixels for palette construction.
function samplePixels(data, w, h, maxSamples = 8000) {
  const total = w * h;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const out = [];
  for (let i = 0; i < total; i += step) {
    const k = i * 4;
    if (data[k + 3] < 16) continue;
    out.push([data[k], data[k + 1], data[k + 2]]);
  }
  return out;
}

// Apply N-color palette to a canvas in place, optional Floyd–Steinberg dither.
function applyPalette(ctx, w, h, n, dither) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const sampled = samplePixels(d, w, h);
  if (!sampled.length) return;
  const palette = buildPalette(sampled, n);

  if (!dither) {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 16) continue;
      const idx = nearestPaletteIndex(palette, d[i], d[i + 1], d[i + 2]);
      const p = palette[idx];
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
    }
    ctx.putImageData(img, 0, 0);
    return;
  }

  // Floyd–Steinberg: diffuse quantization error to unprocessed neighbors.
  const buf = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) buf[i] = d[i];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      if (buf[k + 3] < 16) continue;
      const oldR = buf[k], oldG = buf[k + 1], oldB = buf[k + 2];
      const idx = nearestPaletteIndex(palette, oldR, oldG, oldB);
      const p = palette[idx];
      const eR = oldR - p[0], eG = oldG - p[1], eB = oldB - p[2];
      buf[k] = p[0]; buf[k + 1] = p[1]; buf[k + 2] = p[2];
      const spread = (dx, dy, f) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
        const nk = (ny * w + nx) * 4;
        buf[nk]     += eR * f;
        buf[nk + 1] += eG * f;
        buf[nk + 2] += eB * f;
      };
      spread(1, 0, 7 / 16);
      spread(-1, 1, 3 / 16);
      spread(0, 1, 5 / 16);
      spread(1, 1, 1 / 16);
    }
  }
  for (let i = 0; i < d.length; i++) {
    d[i] = Math.max(0, Math.min(255, buf[i] | 0));
  }
  ctx.putImageData(img, 0, 0);
}

// Apply the user's palette choice to a canvas in place.
// palette: "full" | "gray" | 256 | 64 | 16 (number of colors)
export function applyPaletteChoice(canvas, palette, dither) {
  if (!palette || palette === 'full') return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  if (palette === 'gray') { applyGrayscale(ctx, w, h); return; }
  const n = parseInt(palette, 10);
  if (!Number.isFinite(n) || n < 2 || n >= 256) return;
  applyPalette(ctx, w, h, n, dither);
}

// ─── Per-frame WebP encoding ────────────────────────────────────────────────

async function encodeFrameWebp(canvas, lossless, quality) {
  // Quality range 0..1; quality=1 triggers VP8L on Chromium.
  const q = lossless ? 1 : Math.max(0, Math.min(1, quality));
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/webp', q);
  });
  const buf = new Uint8Array(await blob.arrayBuffer());
  return extractPayload(buf);
}

// Pull the VP8/VP8L payload (the encoded frame bitstream) out of a single-frame
// WebP. Returns { chunk, hasAlpha } where `chunk` is the 8-byte-header +
// padded payload ready to embed inside an ANMF.
function extractPayload(webpBytes) {
  // WebP: 'RIFF' + size(4) + 'WEBP' then chunks of FourCC+size+data.
  if (webpBytes.length < 20) throw new Error('WebP too short');
  if (String.fromCharCode(...webpBytes.slice(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...webpBytes.slice(8, 12)) !== 'WEBP') {
    throw new Error('Not a WebP');
  }
  const dv = new DataView(webpBytes.buffer, webpBytes.byteOffset, webpBytes.byteLength);
  let off = 12;
  let hasAlpha = false;
  let alphaChunk = null;
  while (off + 8 <= webpBytes.length) {
    const fourcc = String.fromCharCode(webpBytes[off], webpBytes[off + 1], webpBytes[off + 2], webpBytes[off + 3]);
    const size = dv.getUint32(off + 4, true);
    const padded = size + (size & 1);
    if (fourcc === 'ALPH') {
      hasAlpha = true;
      alphaChunk = webpBytes.slice(off, off + 8 + padded);
    } else if (fourcc === 'VP8 ' || fourcc === 'VP8L') {
      if (fourcc === 'VP8L') hasAlpha = true;  // VP8L carries alpha in-band
      const payload = webpBytes.slice(off, off + 8 + padded);
      // VP8 + ALPH needs both chunks adjacent inside the ANMF; VP8L is standalone.
      if (alphaChunk && fourcc === 'VP8 ') {
        const combined = new Uint8Array(alphaChunk.length + payload.length);
        combined.set(alphaChunk, 0);
        combined.set(payload, alphaChunk.length);
        return { chunk: combined, hasAlpha };
      }
      return { chunk: payload, hasAlpha };
    }
    off += 8 + padded;
  }
  throw new Error('No VP8/VP8L chunk found');
}

// ─── Muxer ──────────────────────────────────────────────────────────────────

function u24le(arr, off, v) {
  arr[off] = v & 0xff;
  arr[off + 1] = (v >> 8) & 0xff;
  arr[off + 2] = (v >> 16) & 0xff;
}

function u32le(arr, off, v) {
  arr[off] = v & 0xff;
  arr[off + 1] = (v >> 8) & 0xff;
  arr[off + 2] = (v >> 16) & 0xff;
  arr[off + 3] = (v >>> 24) & 0xff;
}

// Build the final animated WebP Blob from a list of encoded frame payloads.
// `frames`: [{ chunk: Uint8Array, width, height, durationMs, hasAlpha }]
function muxAnimatedWebp(frames, canvasW, canvasH, loopCount = 0) {
  const anyAlpha = frames.some(f => f.hasAlpha);

  // VP8X (fixed 10-byte payload, 8-byte chunk header → 18 bytes total)
  const vp8x = new Uint8Array(18);
  vp8x.set([0x56, 0x50, 0x38, 0x58], 0); // 'VP8X'
  u32le(vp8x, 4, 10);
  vp8x[8] = 0x02 | (anyAlpha ? 0x10 : 0); // animation flag + alpha flag
  u24le(vp8x, 12, canvasW - 1);
  u24le(vp8x, 15, canvasH - 1);

  // ANIM (6-byte payload → 14 bytes total)
  const anim = new Uint8Array(14);
  anim.set([0x41, 0x4e, 0x49, 0x4d], 0); // 'ANIM'
  u32le(anim, 4, 6);
  // Background color BGRA (4 bytes) defaults to 0 = fully transparent.
  anim[12] = loopCount & 0xff;
  anim[13] = (loopCount >> 8) & 0xff;

  const anmfs = frames.map((f) => {
    const payloadLen = 16 + f.chunk.length;
    const padded = payloadLen + (payloadLen & 1);
    const a = new Uint8Array(8 + padded);
    a.set([0x41, 0x4e, 0x4d, 0x46], 0); // 'ANMF'
    u32le(a, 4, payloadLen);
    u24le(a, 8, 0);            // frame X offset
    u24le(a, 11, 0);           // frame Y offset
    u24le(a, 14, f.width - 1);
    u24le(a, 17, f.height - 1);
    u24le(a, 20, Math.max(1, Math.min(0xffffff, f.durationMs | 0)));
    a[23] = 0;                 // dispose=0 (none), blend=0 (alpha blend)
    a.set(f.chunk, 24);
    return a;
  });

  const parts = [vp8x, anim, ...anmfs];
  const chunksTotal = parts.reduce((s, c) => s + c.length, 0);
  const fileSize = 4 + chunksTotal;  // 'WEBP' + chunks
  const out = new Uint8Array(8 + fileSize);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
  u32le(out, 4, fileSize);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // 'WEBP'
  let off = 12;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return new Blob([out], { type: 'image/webp' });
}

// ─── High-level encode entry point ──────────────────────────────────────────

/**
 * @param frames Array<{ canvas: HTMLCanvasElement, durationMs: number }>
 *               All canvases must share the same dimensions (caller's job).
 * @param opts  { lossless: boolean, quality: 0..1, loopCount?: number,
 *                 onProgress?: (done, total) => void }
 */
export async function encodeAnimatedWebp(frames, opts) {
  if (!frames || !frames.length) throw new Error('no frames');
  const { lossless = true, quality = 0.9, loopCount = 0, onProgress } = opts || {};
  const canvasW = frames[0].canvas.width;
  const canvasH = frames[0].canvas.height;
  const encoded = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.canvas.width !== canvasW || f.canvas.height !== canvasH) {
      throw new Error('all frames must share canvas dimensions');
    }
    const { chunk, hasAlpha } = await encodeFrameWebp(f.canvas, lossless, quality);
    encoded.push({
      chunk,
      width: canvasW,
      height: canvasH,
      durationMs: Math.max(1, f.durationMs | 0),
      hasAlpha,
    });
    if (onProgress) onProgress(i + 1, frames.length);
  }
  return muxAnimatedWebp(encoded, canvasW, canvasH, loopCount);
}

// ─── GIF decoding via WebCodecs ─────────────────────────────────────────────

// Decode a GIF Blob/File into frames with original per-frame durations.
// Returns null if the browser's ImageDecoder doesn't support GIF (caller should
// fall back to uploading the GIF as-is).
export async function decodeGifFrames(fileOrBlob) {
  if (typeof window === 'undefined' || typeof window.ImageDecoder === 'undefined') return null;
  try {
    const supported = await window.ImageDecoder.isTypeSupported('image/gif');
    if (!supported) return null;
  } catch { return null; }

  const decoder = new window.ImageDecoder({ data: fileOrBlob.stream(), type: 'image/gif' });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.frameCount || 0;
    if (!frameCount) return null;
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      const c = document.createElement('canvas');
      c.width = image.displayWidth;
      c.height = image.displayHeight;
      c.getContext('2d').drawImage(image, 0, 0);
      // `image.duration` is microseconds per the WebCodecs spec.
      const durationMs = Math.max(1, Math.round((image.duration || 100000) / 1000));
      image.close?.();
      frames.push({ canvas: c, durationMs });
    }
    return { frames, width: frames[0].canvas.width, height: frames[0].canvas.height };
  } finally {
    decoder.close?.();
  }
}
