import { GRID_SIZE, SNAP_ANGLE, DEG_TO_RAD } from './constants.js';

export function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ── Media type helpers ── */
const GIF_URL_RE = /\.gif(\?|#|$)/i;
const SVG_URL_RE = /\.svg(\?|#|$)/i;
export function isGifSrc(url) { return !!url && GIF_URL_RE.test(url); }
export function isSvgSrc(url) { return !!url && SVG_URL_RE.test(url); }

export function snap(v, on) { 
  return on ? Math.round(v / GRID_SIZE) * GRID_SIZE : v; 
}

export function snapAngle(angle, on) {
  if (!on) return angle;
  return Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;
}

/* ── Drag delta: apply a {dx,dy} offset to all dragged items ── */
export function applyDragDelta(items, startMap, dx, dy, snapOn) {
  return items.map(i => {
    const start = startMap.get(i.id);
    if (!start) return i;
    if (i.type === 'connector') {
      const sx1 = start.x1 ?? i.x1, sy1 = start.y1 ?? i.y1;
      const sx2 = start.x2 ?? i.x2, sy2 = start.y2 ?? i.y2;
      return { ...i,
        x1: snap(sx1 + dx, snapOn), y1: snap(sy1 + dy, snapOn),
        x2: snap(sx2 + dx, snapOn), y2: snap(sy2 + dy, snapOn),
        elbowX: snap((start.elbowX ?? (sx1 + sx2) / 2) + dx, snapOn),
        elbowY: snap((start.elbowY ?? (sy1 + sy2) / 2) + dy, snapOn),
      };
    }
    return { ...i, x: snap(start.x + dx, snapOn), y: snap(start.y + dy, snapOn) };
  });
}

/* ── Elbow orientation: decide if connector bends H or V ── */
export function computeElbowOrientation(item, newElbowX, newElbowY) {
  const midX = (item.x1 + item.x2) / 2;
  const midY = (item.y1 + item.y2) / 2;
  const hSpan = Math.abs(item.x2 - item.x1);
  const vSpan = Math.abs(item.y2 - item.y1);
  let orientation = item.orientation || "h";
  if (orientation === "h") {
    const distFromMidY = Math.abs(newElbowY - midY);
    const distFromMidX = Math.abs(newElbowX - midX);
    if (distFromMidY > vSpan * 0.35 + 20 && distFromMidY > distFromMidX) orientation = "v";
  } else {
    const distFromMidX = Math.abs(newElbowX - midX);
    const distFromMidY = Math.abs(newElbowY - midY);
    if (distFromMidX > hSpan * 0.35 + 20 && distFromMidX > distFromMidY) orientation = "h";
  }
  return orientation;
}

export function itemShadowEnabled(item) {
  return item.shadow ?? (item.type !== "shape" && item.type !== "text");
}

const FLASHABLE_TYPES = new Set(["text", "image", "shape"]);

export function itemSupportsFlash(item) {
  return !!item && FLASHABLE_TYPES.has(item.type);
}

export function isItemFlashEnabled(item) {
  return itemSupportsFlash(item) && !!item.flashEnabled;
}

export function isItemVisibleAtTime(item, now = Date.now()) {
  if (!isItemFlashEnabled(item)) return true;
  const onMs = Math.max(0, Number(item.flashOnMs ?? 500));
  const offMs = Math.max(0, Number(item.flashOffMs ?? 500));
  if (onMs <= 0 && offMs <= 0) return true;
  if (onMs <= 0) return false;
  if (offMs <= 0) return true;
  const cycle = onMs + offMs;
  return (now % cycle) < onMs;
}

// Time in ms until the next flash visibility flip across all items, or Infinity
// if no item will ever transition. Lets the render loop schedule redraws only
// at real transitions instead of polling on a fixed interval.
export function nextFlashTransitionMs(items, now = Date.now()) {
  let minDelay = Infinity;
  for (const item of items) {
    if (!isItemFlashEnabled(item)) continue;
    const onMs = Math.max(0, Number(item.flashOnMs ?? 500));
    const offMs = Math.max(0, Number(item.flashOffMs ?? 500));
    if (onMs <= 0 || offMs <= 0) continue;
    const cycle = onMs + offMs;
    const pos = now % cycle;
    const delay = pos < onMs ? (onMs - pos) : (cycle - pos);
    if (delay < minDelay) minDelay = delay;
  }
  return minDelay;
}

/* ── Rotation-aware 8-point resize ── */
const HANDLE_CFG = {
  tl: { dx: -1, dy: -1, ax:  1, ay:  1 },
  t:  { dx:  0, dy: -1, ax:  0, ay:  1 },
  tr: { dx:  1, dy: -1, ax: -1, ay:  1 },
  r:  { dx:  1, dy:  0, ax: -1, ay:  0 },
  br: { dx:  1, dy:  1, ax: -1, ay: -1 },
  b:  { dx:  0, dy:  1, ax:  0, ay: -1 },
  bl: { dx: -1, dy:  1, ax:  1, ay: -1 },
  l:  { dx: -1, dy:  0, ax:  1, ay:  0 },
};

export function computeResize(item, handle, screenDx, screenDy, snapVal) {
  const cfg = HANDLE_CFG[handle];
  if (!cfg) return { x: item.x, y: item.y, w: item.w, h: item.h };

  const rad = (item.rotation || 0) * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Project screen-space delta into object-local space
  const localDx =  screenDx * cos + screenDy * sin;
  const localDy = -screenDx * sin + screenDy * cos;

  // New dimensions
  let newW = snap(Math.max(30, item.w + cfg.dx * localDx), snapVal);
  let newH = snap(Math.max(20, item.h + cfg.dy * localDy), snapVal);

  // Anchor point in local space (relative to center, before resize)
  const aLx = cfg.ax * item.w / 2;
  const aLy = cfg.ay * item.h / 2;

  // Anchor in world space (must stay fixed)
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const awx = cx + aLx * cos - aLy * sin;
  const awy = cy + aLx * sin + aLy * cos;

  // New anchor in local space (relative to new center)
  const naLx = cfg.ax * newW / 2;
  const naLy = cfg.ay * newH / 2;

  // Solve for new center so anchor stays put
  const ncx = awx - naLx * cos + naLy * sin;
  const ncy = awy - naLx * sin - naLy * cos;

  return { x: ncx - newW / 2, y: ncy - newH / 2, w: newW, h: newH };
}

/* ── Color helpers (shared across WebGL + DOM) ── */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/* ── DOM helpers ── */
export function isTyping() {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || !!document.activeElement?.isContentEditable;
}

/* ── localStorage helpers (wrap try/catch once) ── */
export function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

export function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/* ── Z-order helpers (single-pass min/max avoids Math.max(...arr) spread) ── */
export function maxZ(items) {
  let m = 0;
  for (let i = 0; i < items.length; i++) { const z = items[i].z; if (z > m) m = z; }
  return m;
}

export function minZ(items) {
  if (!items.length) return 0;
  let m = items[0].z;
  for (let i = 1; i < items.length; i++) { const z = items[i].z; if (z < m) m = z; }
  return m;
}

/* ── Item helpers ── */

// Compute centroid, remap group IDs, offset items for paste
export function pasteItems(clipboard, center, currentMaxZ) {
  if (!clipboard.length) return [];
  // Single-pass centroid accumulation.
  let sumX = 0, sumY = 0;
  for (const item of clipboard) {
    if (item.type === "connector") {
      sumX += ((item.x1 ?? 0) + (item.x2 ?? 0)) / 2;
      sumY += ((item.y1 ?? 0) + (item.y2 ?? 0)) / 2;
    } else {
      sumX += (item.x ?? 0) + (item.w ?? 0) / 2;
      sumY += (item.y ?? 0) + (item.h ?? 0) / 2;
    }
  }
  const n = clipboard.length;
  const dx = center.x - sumX / n;
  const dy = center.y - sumY / n;
  const groupIdMap = {};
  return clipboard.map((item, idx) => {
    let newGroupId = item.groupId;
    if (newGroupId) {
      if (!groupIdMap[newGroupId]) groupIdMap[newGroupId] = uid();
      newGroupId = groupIdMap[newGroupId];
    }
    const z = currentMaxZ + 1 + idx;
    if (item.type === "connector") {
      return {
        ...item, id: uid(), groupId: newGroupId,
        x1: (item.x1 ?? 0) + dx, y1: (item.y1 ?? 0) + dy,
        x2: (item.x2 ?? 0) + dx, y2: (item.y2 ?? 0) + dy,
        elbowX: (item.elbowX ?? ((item.x1 + item.x2) / 2)) + dx,
        elbowY: (item.elbowY ?? ((item.y1 + item.y2) / 2)) + dy,
        z,
      };
    }
    return { ...item, id: uid(), groupId: newGroupId, x: (item.x ?? 0) + dx, y: (item.y ?? 0) + dy, z };
  });
}

// Apply rotation default + connector elbow migration
export function migrateItems(items) {
  return items.map(item => {
    const out = { ...item, rotation: item.rotation || 0 };
    if (item.type === "connector") {
      if (item.elbow !== undefined) {
        out.elbowX = item.elbow;
        out.elbowY = ((item.y1 ?? 0) + (item.y2 ?? 0)) / 2;
        out.orientation = "h";
        delete out.elbow;
      }
      if (out.orientation === undefined) {
        out.elbowX = out.elbowX ?? ((out.x1 + out.x2) / 2);
        out.elbowY = out.elbowY ?? ((out.y1 + out.y2) / 2);
        out.orientation = "h";
      }
      // Sanitize NaN elbow coords (can happen from previous bugs)
      if (!Number.isFinite(out.elbowX)) out.elbowX = ((out.x1 ?? 0) + (out.x2 ?? 0)) / 2;
      if (!Number.isFinite(out.elbowY)) out.elbowY = ((out.y1 ?? 0) + (out.y2 ?? 0)) / 2;
    } else if (item.type === "shape" || item.type === "text" || item.type === "link") {
      if (out.noiseEnabled === undefined) {
        out.noiseEnabled = false;
        out.noiseOpacity = out.noiseOpacity ?? 0.2;
      }
    }
    return out;
  });
}

