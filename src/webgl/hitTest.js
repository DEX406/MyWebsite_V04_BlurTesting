// Math-based hit testing: given a screen point, find which item (if any) is under it.
// Replaces DOM-based `closest("[data-item-id]")`.

import { buildConnectorPath } from '../connectorPath.js';

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
  const rad = -(item.rotation || 0) * Math.PI / 180;
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

  for (const [sx, sy, ex, ey] of segments) {
    if (distToSegment(wx, wy, sx, sy, ex, ey) < grab) return true;
  }

  // Also check endpoint dots
  if (Math.hypot(wx - x1, wy - y1) < grab) return true;
  if (Math.hypot(wx - x2, wy - y2) < grab) return true;

  return false;
}

// Distance from point (px, py) to line segment (ax, ay)-(bx, by)
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
