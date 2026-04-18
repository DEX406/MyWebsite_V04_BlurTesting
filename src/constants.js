import { CUSTOM_FONTS } from './fontLibrary.js';

export const FONT = CUSTOM_FONTS[0]?.value || "sans-serif";
export const GRID_SIZE = 16;

// Precomputed radian/degree conversion factors (avoid re-evaluating Math.PI/180 in hot paths).
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;


export const DEFAULT_BG_GRID = {
  enabled: true,
  bgColor: "#141413",
  dot1: { color: "#C2C0B6", opacity: 0.07, size: 1.5, softness: 0, spacing: 32 },
  dot2: { enabled: false, color: "#C2C0B6", opacity: 0.04, size: 1, softness: 0, spacing: 64 },
};
export const GRID_SPACINGS = [2, 4, 8, 16, 32, 64];
export const SNAP_ANGLE = 15; // degrees for angle snapping
// Shared glass/blur downsample factor (1 = full world-res, 0.5 = half-res).
export const GLASS_DOWNSAMPLE = 1;

// ── Text layout constants (shared between CSS textarea and Canvas2D rasterizer) ──
export const TEXT_PAD_X = 12;    // horizontal padding (px)
export const TEXT_PAD_Y = 8;     // vertical padding (px)
export const TEXT_LINE_HEIGHT = 1.3; // line-height multiplier
export const TEXT_DEFAULT_SIZE = 24; // default fontSize (px)

export const FONTS = CUSTOM_FONTS;

// ── Touch motion smoothing ──
// Exponential-smoothing time constants (ms) applied to pan and item-drag gestures.
// Higher value = smoother motion but more perceived input lag; lower value = crisper
// response but more visible frame-pacing jitter under load. Set to 0 to disable.
// Typical useful range: 20–80 ms. Drag usually wants a smaller tau than pan so items
// feel "stuck to the finger" while the camera still benefits from heavier smoothing.
export const TOUCH_PAN_SMOOTH_TAU_MS = 45;
export const TOUCH_DRAG_SMOOTH_TAU_MS = 25;

export const SHAPE_PRESETS = [
  { label: "Rectangle", w: 208, h: 128 },
  { label: "Square", w: 160, h: 160 },
  { label: "Wide bar", w: 400, h: 64 },
  { label: "Tall bar", w: 64, h: 304 },
  { label: "Circle", w: 160, h: 160, radius: 80 },
  { label: "Large circle", w: 320, h: 320, radius: 160 },
];
