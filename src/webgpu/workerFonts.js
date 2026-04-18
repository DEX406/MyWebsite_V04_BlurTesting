// Worker-side font loader. Fetches Google Fonts CSS, parses @font-face rules,
// and registers FontFace objects with self.fonts so OffscreenCanvas text
// rasterization matches the main-thread CSS rendering.

import { GOOGLE_FONT_STYLESHEETS } from '../fontLibrary.js';

const FONTFACE_RE = /@font-face\s*\{([^}]+)\}/g;
const FAMILY_RE = /font-family:\s*['"]?([^;'"]+)['"]?/;
const WEIGHT_RE = /font-weight:\s*([^;]+)/;
const STYLE_RE = /font-style:\s*([^;]+)/;
const SRC_RE = /url\(([^)]+)\)\s*format\(['"]?(\w+)['"]?\)/;
const RANGE_RE = /unicode-range:\s*([^;}]+)/;

function parseFontFaces(css) {
  const faces = [];
  let m;
  while ((m = FONTFACE_RE.exec(css)) !== null) {
    const body = m[1];
    const fam = body.match(FAMILY_RE)?.[1]?.trim();
    const srcMatch = body.match(SRC_RE);
    if (!fam || !srcMatch) continue;
    faces.push({
      family: fam,
      weight: body.match(WEIGHT_RE)?.[1]?.trim() || '400',
      style: body.match(STYLE_RE)?.[1]?.trim() || 'normal',
      src: srcMatch[1].replace(/['"]/g, ''),
      unicodeRange: body.match(RANGE_RE)?.[1]?.trim(),
    });
  }
  return faces;
}

export async function loadWorkerFonts() {
  if (typeof FontFace === 'undefined' || !self.fonts) return;
  const cssTexts = await Promise.all(
    GOOGLE_FONT_STYLESHEETS.map(u => fetch(u).then(r => r.ok ? r.text() : '').catch(() => ''))
  );
  const faces = [];
  for (const css of cssTexts) faces.push(...parseFontFaces(css));
  await Promise.all(faces.map(async f => {
    const descriptors = { weight: f.weight, style: f.style };
    if (f.unicodeRange) descriptors.unicodeRange = f.unicodeRange;
    try {
      const ff = new FontFace(f.family, `url(${f.src})`, descriptors);
      await ff.load();
      self.fonts.add(ff);
    } catch {
      // ignore individual failures — best-effort parity
    }
  }));
}
