// Math-based hit testing: given a screen point, find which item (if any) is under it.
// Replaces DOM-based `closest("[data-item-id]")`.

import { DEG_TO_RAD } from '../constants.js';

// Grab radius in screen pixels — constant regardless of zoom.
const GRAB_PX = 16;

// Test if a screen-space point hits any item. Returns { id, action } or null.
// Items should be sorted back-to-front (we test front-to-back for topmost hit).
export function hitTest(screenX, screenY, items, panX, panY, zoom) {
  // Convert screen → world
  const worldX = (screenX - panX) / zoom;
  const worldY = (screenY - panY) / zoom;
  // Grab threshold in world coords (constant screen size)
  const grab = GRAB_PX / zoom;

  // Test front-to-back (highest z first)
  const sorted = [...items].sort((a, b) => b.z - a.z);

  for (const item of sorted) {
    if (item.type === 'connector') {
      if (hitConnector(worldX, worldY, item, grab)) {
        return { id: item.id, action: null };
      }
    } else {
      if (hitRect(worldX, worldY, item, grab)) {
        return { id: item.id, action: null };
      }
    }
  }

  return null;
}

// Test if world point is inside a rotated rectangle item (with grab margin)
function hitRect(wx, wy, item, grab) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const rad = -(item.rotation || 0) * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Rotate point into item's local space
  const dx = wx - cx;
  const dy = wy - cy;
  const localX = dx * cos - dy * sin + item.w / 2;
  const localY = dx * sin + dy * cos + item.h / 2;

  return localX >= -grab && localX <= item.w + grab &&
         localY >= -grab && localY <= item.h + grab;
}

// Test if world point is near the connector path
function hitConnector(wx, wy, item, grab) {
  const { x1, y1, x2, y2 } = item;
  const elbowX = item.elbowX ?? (x1 + x2) / 2;
  const elbowY = item.elbowY ?? (y1 + y2) / 2;
  const orient = item.orientation || 'h';

  // Generate path segments based on orientation
  let segments;
  if (orient === 'h') {
    segments = [
      [x1, y1, elbowX, y1],
      [elbowX, y1, elbowX, y2],
      [elbowX, y2, x2, y2],
    ];
  } else {
    segments = [
      [x1, y1, x1, elbowY],
      [x1, elbowY, x2, elbowY],
      [x2, elbowY, x2, y2],
    ];
  }

  const grabSq = grab * grab;
  for (const [sx, sy, ex, ey] of segments) {
    if (distToSegmentSq(wx, wy, sx, sy, ex, ey) < grabSq) return true;
  }

  // Endpoint dots (squared-distance compare avoids sqrt).
  const d1x = wx - x1, d1y = wy - y1;
  if (d1x * d1x + d1y * d1y < grabSq) return true;
  const d2x = wx - x2, d2y = wy - y2;
  if (d2x * d2x + d2y * d2y < grabSq) return true;

  return false;
}

// Squared distance from point (px, py) to line segment (ax, ay)-(bx, by).
function distToSegmentSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let cx, cy;
  if (lenSq === 0) {
    cx = ax; cy = ay;
  } else {
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    cx = ax + t * dx; cy = ay + t * dy;
  }
  const ex = px - cx, ey = py - cy;
  return ex * ex + ey * ey;
}
