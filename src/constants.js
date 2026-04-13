import { CUSTOM_FONTS } from './fontLibrary.js';

export const FONT = CUSTOM_FONTS[0]?.value || "sans-serif";
export const GRID_SIZE = 16;
export const DEFAULT_BG_GRID = {
  enabled: true,
  bgColor: "#141413",
  dot1: { color: "#C2C0B6", opacity: 0.07, size: 1.5, softness: 0, spacing: 32 },
  dot2: { enabled: false, color: "#C2C0B6", opacity: 0.04, size: 1, softness: 0, spacing: 64 },
};
export const GRID_SPACINGS = [2, 4, 8, 16, 32, 64];
export const SNAP_ANGLE = 15; // degrees for angle snapping

// ── Text layout constants (shared between CSS textarea and Canvas2D rasterizer) ──
export const TEXT_PAD_X = 12;    // horizontal padding (px)
export const TEXT_PAD_Y = 8;     // vertical padding (px)
export const TEXT_LINE_HEIGHT = 1.3; // line-height multiplier
export const TEXT_DEFAULT_SIZE = 24; // default fontSize (px)

export const FONTS = CUSTOM_FONTS;

export const SHAPE_PRESETS = [
  { label: "Rectangle", w: 208, h: 128 },
  { label: "Square", w: 160, h: 160 },
  { label: "Wide bar", w: 400, h: 64 },
  { label: "Tall bar", w: 64, h: 304 },
  { label: "Circle", w: 160, h: 160, radius: 80 },
  { label: "Large circle", w: 320, h: 320, radius: 160 },
];
