// Shared style constants used across all UI surfaces

// ── Z-index layer tokens ──
// Canvas wrapper creates its own stacking context (z: 0 + isolation: isolate),
// so canvas-internal layers never compete with UI layers.
export const Z = {
  // Root-level layers
  CANVAS: 0,         // Canvas wrapper — stacking-context boundary
  UI: 1,             // Toolbars, panels, controls
  TELEPORT: 2,       // "Pan to destination" widget
  MODAL: 3,          // Login modal overlay
  POPUP: 4,          // Color picker popup (topmost)
  // Canvas-internal (relative to canvas stacking context)
  CONTENT: 1,        // All user items (images, text, shapes)
  HANDLES: 2,        // Selection / resize / rotate handles
  // Handle-internal (relative to handles stacking context)
  HANDLE_INFO: 1,    // Image info pill
  HANDLE_GRIP: 2,    // Resize / rotate grips
};

// ── Global surface colors ──
export const UI_BG = "#141413";
export const UI_BLUR = "blur(20px)";  // retained for user canvas objects only
export const UI_BORDER = "1px solid rgba(194,192,182,0.06)";
export const UI_RADIUS = 8;

// Uniform 32×32 icon button — used in toolbar and zoom bar
export const tbBtn = { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: "#6e6e6e", cursor: "pointer", borderRadius: 5, flexShrink: 0 };

// Shared surface for toolbar / zoom / info containers
export const tbSurface = { display: "flex", alignItems: "center", gap: 1, background: UI_BG, border: UI_BORDER, borderRadius: UI_RADIUS, padding: 2 };

// Vertical separator between button groups
export const tbSep = { width: 1, height: 16, background: "rgba(194,192,182,0.07)", alignSelf: "center", margin: "0 3px", flexShrink: 0 };

// Small toggle button used inside panels and dropdowns
export const togBtn = { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(194,192,182,0.08)", borderRadius: 5, color: "rgba(194,192,182,0.6)", cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans', sans-serif", background: "rgba(194,192,182,0.04)" };

// Checkerboard pattern shown behind transparent color swatches
export const CHECKER_BG = "repeating-conic-gradient(#30302E 0% 25%, #1F1E1D 0% 50%) 0 0 / 8px 8px";

// Shared info text style for zoom %, XY coords, selection count
export const infoText = { color: "rgba(194,192,182,0.28)", fontSize: 11, fontWeight: 500, letterSpacing: "0.03em", userSelect: "none", whiteSpace: "nowrap" };

// Dropdown / popup surface (inherits same bg/blur/border)
export const dropdownSurface = { background: UI_BG, border: UI_BORDER, borderRadius: UI_RADIUS, zIndex: 1 };

// Panel surface for PropertiesPanel, ColorPicker, LoginModal
export const panelSurface = { background: UI_BG, border: UI_BORDER, borderRadius: UI_RADIUS };
