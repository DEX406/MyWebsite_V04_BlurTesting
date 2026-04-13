import { GRID_SIZE, SNAP_ANGLE } from './constants.js';

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

  const rad = (item.rotation || 0) * Math.PI / 180;
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

export function hexToRgba(hex, alpha = 1) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function applyBg(item) {
  if (!item.bgColor || item.bgColor === "transparent") return "transparent";
  const op = item.bgOpacity ?? 1;
  if (op <= 0) return "transparent";
  return op >= 1 ? item.bgColor : hexToRgba(item.bgColor, op);
}

/* ── DOM helpers ── */
export function isTyping() {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || !!document.activeElement?.isContentEditable;
}

/* ── Item helpers ── */

// Compute centroid, remap group IDs, offset items for paste
export function pasteItems(clipboard, center, currentMaxZ) {
  const centers = clipboard.map(item => item.type === "connector"
    ? { x: ((item.x1 ?? 0) + (item.x2 ?? 0)) / 2, y: ((item.y1 ?? 0) + (item.y2 ?? 0)) / 2 }
    : { x: (item.x ?? 0) + (item.w ?? 0) / 2, y: (item.y ?? 0) + (item.h ?? 0) / 2 });
  const clipCX = centers.reduce((s, p) => s + p.x, 0) / centers.length;
  const clipCY = centers.reduce((s, p) => s + p.y, 0) / centers.length;
  const dx = center.x - clipCX;
  const dy = center.y - clipCY;
  const groupIdMap = {};
  return clipboard.map((item, idx) => {
    let newGroupId = item.groupId;
    if (newGroupId) {
      if (!groupIdMap[newGroupId]) groupIdMap[newGroupId] = uid();
      newGroupId = groupIdMap[newGroupId];
    }
    if (item.type === "connector") {
      return {
        ...item, id: uid(), groupId: newGroupId,
        x1: (item.x1 ?? 0) + dx, y1: (item.y1 ?? 0) + dy,
        x2: (item.x2 ?? 0) + dx, y2: (item.y2 ?? 0) + dy,
        elbowX: (item.elbowX ?? ((item.x1 + item.x2) / 2)) + dx,
        elbowY: (item.elbowY ?? ((item.y1 + item.y2) / 2)) + dy,
        z: currentMaxZ + 1 + idx,
      };
    }
    return { ...item, id: uid(), groupId: newGroupId, x: (item.x ?? 0) + dx, y: (item.y ?? 0) + dy, z: currentMaxZ + 1 + idx };
  });
}

// Apply rotation default + connector elbow migration
export function migrateItems(items) {
  return items.map(item => {
    let out = { ...item, rotation: item.rotation || 0 };
    if (item.type === "connector" && item.elbow !== undefined) {
      const midY = ((item.y1 ?? 0) + (item.y2 ?? 0)) / 2;
      out = { ...out, elbowX: item.elbow, elbowY: midY, orientation: "h" };
      delete out.elbow;
    }
    if (item.type === "connector" && out.orientation === undefined) {
      out = { ...out, elbowX: out.elbowX ?? ((out.x1 + out.x2) / 2), elbowY: out.elbowY ?? ((out.y1 + out.y2) / 2), orientation: "h" };
    }
    // Sanitize NaN elbow coords (can happen from previous bugs)
    if (item.type === "connector") {
      if (!Number.isFinite(out.elbowX)) out = { ...out, elbowX: ((out.x1 ?? 0) + (out.x2 ?? 0)) / 2 };
      if (!Number.isFinite(out.elbowY)) out = { ...out, elbowY: ((out.y1 ?? 0) + (out.y2 ?? 0)) / 2 };
    }
    return out;
  });
}

export function exportBoard(items, palette) {
  const blob = new Blob([JSON.stringify({ items, palette }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); 
  a.href = url;
  a.download = `lutz-board-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
