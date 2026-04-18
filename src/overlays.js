// Pure overlay computation — derives DOM overlay data from items + viewport.
// Runs on the main thread so video/GIF/blur DOM elements can be positioned
// without waiting for the render worker.

import { isGifSrc, isItemVisibleAtTime } from './utils.js';

/**
 * Compute DOM overlay descriptors for the current frame.
 * @returns {Array<{id, type, src?, x, y, w, h, rotation, radius, z, opacity?, blurRadius?}>}
 *   type is one of 'video' | 'gif' | 'blur-video'.
 */
export function computeOverlays(items, { panX, panY, zoom, cssW, cssH, editingTextId }) {
  const overlays = [];
  if (!items || items.length === 0) return overlays;

  const sorted = [...items].sort((a, b) => a.z - b.z);

  const marginX = cssW * 0.25 / zoom;
  const marginY = cssH * 0.25 / zoom;
  const vpLeft = -panX / zoom - marginX;
  const vpTop = -panY / zoom - marginY;
  const vpRight = (cssW - panX) / zoom + marginX;
  const vpBottom = (cssH - panY) / zoom + marginY;

  const now = Date.now();

  for (const item of sorted) {
    if (item.type === 'connector') continue;
    if (item.x + item.w < vpLeft || item.x > vpRight || item.y + item.h < vpTop || item.y > vpBottom) continue;
    if (!isItemVisibleAtTime(item, now)) continue;
    if (editingTextId === item.id && item.type !== 'text' && item.type !== 'link') continue;

    // Blur element — emit blur-video overlay if it has media behind it
    if (item.bgBlur) {
      if (item.w <= 0 || item.h <= 0) continue;
      if (hasMediaBehind(sorted, item)) {
        overlays.push({
          id: item.id,
          type: 'blur-video',
          x: item.x, y: item.y,
          w: item.w, h: item.h,
          rotation: item.rotation || 0,
          radius: item.radius ?? 2,
          z: item.z,
          opacity: 1,
          blurRadius: 12,
        });
      }
      continue;
    }

    // Media items — emit media overlay
    if (item.type === 'image' || item.type === 'video') {
      const isGif = item.type === 'image' && (item.isGif || isGifSrc(item.src));
      const isMedia = item.type === 'video' || isGif;
      if (!isMedia) continue;
      overlays.push({
        id: item.id,
        type: item.type === 'video' ? 'video' : 'gif',
        src: item.src,
        x: item.x, y: item.y,
        w: item.w, h: item.h,
        rotation: item.rotation || 0,
        radius: item.radius ?? 2,
        z: item.z,
      });
    }
  }

  return overlays;
}

function hasMediaBehind(sorted, blurItem) {
  for (const item of sorted) {
    if (item.z >= blurItem.z) break;
    if (item.type === 'connector') continue;
    const isGif = item.type === 'image' && (item.isGif || isGifSrc(item.src));
    const isMedia = item.type === 'video' || isGif;
    if (!isMedia) continue;
    if (item.x + item.w < blurItem.x || item.x > blurItem.x + blurItem.w) continue;
    if (item.y + item.h < blurItem.y || item.y > blurItem.y + blurItem.h) continue;
    return true;
  }
  return false;
}
