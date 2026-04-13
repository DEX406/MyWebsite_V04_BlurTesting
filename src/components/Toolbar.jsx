import { useState, useEffect, useRef, useCallback } from 'react';
import { FONT, SHAPE_PRESETS, GRID_SPACINGS } from '../constants.js';
import { tbBtn, tbSurface, togBtn, dropdownSurface, Z } from '../styles.js';
import {
  PlusIcon, LockIcon, TrashIcon, SunIcon, PaletteIcon,
  SaveIcon, LoadIcon, TextIcon, GlobeIcon, ShapeIcon,
  ConnectorIcon, LinkIcon, TileIcon, SetHomeIcon, CleanupIcon
} from '../icons.jsx';

const labelStyle = { color: "rgba(194,192,182,0.45)", fontSize: 11 };
const sectionLabel = { color: "rgba(194,192,182,0.3)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, marginTop: 10 };
const sliderStyle = { width: "100%", accentColor: "#2C84DB" };
const colorInput = { width: 22, height: 22, border: "1px solid rgba(194,192,182,0.15)", borderRadius: 4, cursor: "pointer", padding: 0, background: "none", display: "block" };

function DotControls({ dot, onChange }) {
  const set = (k, v) => onChange({ ...dot, [k]: v });
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={labelStyle}>Color</span>
        <input type="color" value={dot.color} onChange={e => set("color", e.target.value)} style={colorInput} />
        <span style={{ flex: 1 }} />
        <span style={{ ...labelStyle, fontSize: 10 }}>Opacity</span>
        <input type="range" min="0.01" max="0.5" step="0.01" value={dot.opacity} onChange={e => set("opacity", +e.target.value)} style={{ width: 60, accentColor: "#2C84DB" }} />
      </div>
      <div style={{ marginBottom: 4 }}>
        <span style={{ ...labelStyle, display: "block", marginBottom: 2 }}>Size</span>
        <input type="range" min="0.5" max="4" step="0.25" value={dot.size} onChange={e => set("size", +e.target.value)} style={sliderStyle} />
      </div>
      <div style={{ marginBottom: 4 }}>
        <span style={{ ...labelStyle, display: "block", marginBottom: 2 }}>Softness</span>
        <input type="range" min="0" max="1" step="0.05" value={dot.softness} onChange={e => set("softness", +e.target.value)} style={sliderStyle} />
      </div>
      <div>
        <span style={{ ...labelStyle, display: "block", marginBottom: 3 }}>Spacing</span>
        <div style={{ display: "flex", gap: 2 }}>
          {GRID_SPACINGS.map(s => (
            <button key={s} onClick={() => set("spacing", s)}
              style={{ ...togBtn, width: 28, height: 22, fontSize: 10,
                background: dot.spacing === s ? "rgba(44,132,219,0.15)" : "rgba(194,192,182,0.05)" }}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function Toolbar({
  isAdmin,
  onAddText, onAddLink, onAddShape, onAddConnector,
  onFileUpload, onAddImageUrl,
  onExportBoard, onImportBoard, onCleanup,
  onLock, onShowLogin,
  snapOn, setSnapOn,
  globalShadow, setGlobalShadow,
  palette, setPalette, updatePaletteColor,
  bgGrid, setBgGrid,
  onSetHome,
  fileInputRef, boardFileRef,
}) {
  const [showShadowSettings, setShowShadowSettings] = useState(false);
  const [showPaletteEditor, setShowPaletteEditor] = useState(false);
  const [showGridSettings, setShowGridSettings] = useState(false);
  const [addType, setAddType] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [r2Flash, setR2Flash] = useState(false);
  const r2FlashRef = useRef({ queue: 0, timer: null });

  useEffect(() => {
    if (!cleaning) { setFlashOn(false); return; }
    const t = setInterval(() => setFlashOn(f => !f), 175);
    return () => clearInterval(t);
  }, [cleaning]);

  // Flash green for R2 downloads (duration >= 25ms), skip cache hits (<= 24ms)
  // Each download queues a distinct flash: snap on, 150ms fade off, 50ms gap, repeat
  useEffect(() => {
    const ref = r2FlashRef.current;
    const pulse = () => {
      if (ref.queue <= 0) { ref.queue = 0; return; }
      ref.queue--;
      setR2Flash(true);
      // After one frame, turn off to trigger the 150ms fade
      ref.timer = requestAnimationFrame(() => {
        setR2Flash(false);
        // Wait for fade (150ms) + gap before next pulse
        if (ref.queue > 0) ref.timer = setTimeout(pulse, 50);
      });
    };
    const observer = new PerformanceObserver((list) => {
      let count = 0;
      for (const entry of list.getEntries()) {
        if (entry.name.includes('r2.dev') && entry.duration >= 25) count++;
      }
      if (count > 0) {
        const wasIdle = ref.queue === 0;
        ref.queue += count;
        if (wasIdle) pulse();
      }
    });
    observer.observe({ type: 'resource', buffered: false });
    return () => {
      observer.disconnect();
      clearTimeout(ref.timer);
      cancelAnimationFrame(ref.timer);
    };
  }, []);

  const handleCleanupClick = useCallback(async () => {
    setCleaning(true);
    try { await onCleanup(); } finally { setCleaning(false); }
  }, [onCleanup]);

  // Close dropdowns on outside click
  const anyOpen = showShadowSettings || showPaletteEditor || showGridSettings || addType === "shape";
  useEffect(() => {
    if (!anyOpen) return;
    const close = (ev) => {
      if (ev?.target?.closest("[data-ui]")) return;
      setShowShadowSettings(false);
      setShowPaletteEditor(false);
      setShowGridSettings(false);
      setAddType(null);
    };
    const t = setTimeout(() => window.addEventListener("pointerdown", close), 0);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", close); };
  }, [anyOpen]);

  return (
    <div data-ui style={{ position: "absolute", top: "calc(16px + env(safe-area-inset-top, 0px))", right: "calc(16px + env(safe-area-inset-right, 0px))", zIndex: Z.UI, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      {/* Row 1: settings + utilities + lock */}
      {isAdmin && (
        <div style={{ ...tbSurface, zIndex: 2 }}>
          <button onClick={handleCleanupClick} title="Cleanup Files" style={{ ...tbBtn, color: cleaning ? (flashOn ? "#FE8181" : "#3a1a1a") : r2Flash ? "#66BB6A" : "#6e6e6e", transition: r2Flash ? "color 0ms" : "color 150ms ease" }}><CleanupIcon /></button>
          {/* Shadow settings */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowShadowSettings(!showShadowSettings)} title="Shadow Settings" style={showShadowSettings ? { ...tbBtn, background: "rgba(44,132,219,0.12)", color: "#2C84DB" } : tbBtn}><SunIcon /></button>
            {showShadowSettings && (
              <div data-ui style={{ position: "absolute", top: "calc(100% + 6px)", right: -3, ...dropdownSurface, padding: 12, width: 185 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ color: "rgba(194,192,182,0.45)", fontSize: 11 }}>Enable</span>
                  <button onClick={() => setGlobalShadow(s => ({ ...s, enabled: !s.enabled }))} style={{ ...togBtn, background: globalShadow.enabled ? "rgba(44,132,219,0.15)" : "rgba(194,192,182,0.05)" }}>{globalShadow.enabled ? "On" : "Off"}</button>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <span style={{ color: "rgba(194,192,182,0.45)", fontSize: 11, display: "block", marginBottom: 4 }}>Size</span>
                  <input type="range" min="0" max="10" step="0.5" value={globalShadow.size} onChange={e => setGlobalShadow(s => ({ ...s, size: +e.target.value }))} style={{ width: "100%", accentColor: "#2C84DB" }} />
                </div>
                <div>
                  <span style={{ color: "rgba(194,192,182,0.45)", fontSize: 11, display: "block", marginBottom: 4 }}>Opacity</span>
                  <input type="range" min="0" max="0.5" step="0.05" value={globalShadow.opacity} onChange={e => setGlobalShadow(s => ({ ...s, opacity: +e.target.value }))} style={{ width: "100%", accentColor: "#2C84DB" }} />
                </div>
              </div>
            )}
          </div>
          {/* Palette editor */}
          <div style={{ position: "relative" }}>
            <button onClick={(e) => { e.stopPropagation(); setShowPaletteEditor(!showPaletteEditor); }} title="Edit Palette" style={showPaletteEditor ? { ...tbBtn, background: "rgba(44,132,219,0.12)", color: "#2C84DB" } : tbBtn}><PaletteIcon /></button>
            {showPaletteEditor && (
              <div data-ui style={{ position: "absolute", top: "calc(100% + 6px)", right: -3, ...dropdownSurface, padding: 10, width: 200 }}>
                <div style={{ color: "rgba(194,192,182,0.3)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Color Palette</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {palette.map((c, i) => (
                    <label key={i} style={{ position: "relative", cursor: "pointer", display: "block" }}>
                      <input type="color" value={c} onChange={e => updatePaletteColor(i, e.target.value)}
                        style={{ width: 32, height: 32, border: "1px solid rgba(194,192,182,0.15)", borderRadius: 5, cursor: "pointer", padding: 0, background: "none", display: "block" }} />
                      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPalette(p => p.filter((_, j) => j !== i)); }}
                        style={{ position: "absolute", top: -4, right: -4, width: 13, height: 13, background: "rgba(254,129,129,0.88)", border: "none", borderRadius: "50%", color: "#C2C0B6", cursor: "pointer", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>×</button>
                    </label>
                  ))}
                  <button onClick={() => setPalette(p => [...p, "#010101"])}
                    style={{ width: 32, height: 32, background: "rgba(194,192,182,0.06)", border: "1px dashed rgba(194,192,182,0.2)", borderRadius: 5, color: "rgba(194,192,182,0.4)", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                </div>
              </div>
            )}
          </div>
          {/* Grid background settings */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowGridSettings(!showGridSettings)} title="Grid Settings" style={showGridSettings ? { ...tbBtn, background: "rgba(44,132,219,0.12)", color: "#2C84DB" } : tbBtn}><TileIcon /></button>
            {showGridSettings && (
              <div data-ui style={{ position: "absolute", top: "calc(100% + 6px)", right: -3, ...dropdownSurface, padding: 12, width: 220 }}>
                {/* Enable + BG color */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={labelStyle}>Grid</span>
                  <button onClick={() => setBgGrid(g => ({ ...g, enabled: !g.enabled }))}
                    style={{ ...togBtn, background: bgGrid.enabled ? "rgba(44,132,219,0.15)" : "rgba(194,192,182,0.05)" }}>
                    {bgGrid.enabled ? "On" : "Off"}
                  </button>
                  <span style={{ flex: 1 }} />
                  <span style={labelStyle}>BG</span>
                  <input type="color" value={bgGrid.bgColor}
                    onChange={e => setBgGrid(g => ({ ...g, bgColor: e.target.value }))}
                    style={colorInput} />
                </div>

                {/* Dot 1 */}
                <div style={sectionLabel}>Primary Dot</div>
                <DotControls dot={bgGrid.dot1} onChange={d => setBgGrid(g => ({ ...g, dot1: d }))} />

                {/* Dot 2 */}
                <div style={{ ...sectionLabel, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Secondary Dot</span>
                  <button onClick={() => setBgGrid(g => ({ ...g, dot2: { ...g.dot2, enabled: !g.dot2.enabled } }))}
                    style={{ ...togBtn, width: 28, height: 18, fontSize: 9,
                      background: bgGrid.dot2.enabled ? "rgba(44,132,219,0.15)" : "rgba(194,192,182,0.05)" }}>
                    {bgGrid.dot2.enabled ? "On" : "Off"}
                  </button>
                </div>
                {bgGrid.dot2.enabled && (
                  <DotControls dot={bgGrid.dot2} onChange={d => setBgGrid(g => ({ ...g, dot2: d }))} />
                )}
              </div>
            )}
          </div>
          <button onClick={onSetHome} title="Set Home View" style={tbBtn}><SetHomeIcon /></button>
          <button onClick={onExportBoard} title="Backup" style={tbBtn}><SaveIcon /></button>
          <button onClick={() => boardFileRef.current?.click()} title="Restore" style={tbBtn}><LoadIcon /></button>
          <input ref={boardFileRef} type="file" accept=".json,.zip,application/json,application/zip" onChange={onImportBoard} style={{ display: "none" }} />
          <button onClick={onLock} title="Lock" style={{ ...tbBtn, color: "#FBAD60" }}><LockIcon /></button>
        </div>
      )}
      {/* Non-admin: just the lock button */}
      {!isAdmin && (
        <div style={tbSurface}>
          <button onClick={onShowLogin} title="Edit" style={{ ...tbBtn, color: "#30302E" }}><LockIcon /></button>
        </div>
      )}

      {/* Row 2: creation tools */}
      {isAdmin && (
        <div style={tbSurface}>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Upload image or video"
            style={{ ...tbBtn, color: "#2C84DB" }}
          ><PlusIcon /></button>
          <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple onChange={onFileUpload} style={{ display: "none" }} />
          <button onClick={onAddImageUrl} title="Add image from URL" style={tbBtn}><LinkIcon /></button>
          <button onClick={onAddText} title="Add Text" style={tbBtn}><TextIcon /></button>
          <button onClick={onAddLink} title="Add Link element" style={tbBtn}><GlobeIcon /></button>
          <div style={{ position: "relative" }}>
            <button onClick={() => setAddType(addType === "shape" ? null : "shape")} title="Add Shape" style={addType === "shape" ? { ...tbBtn, background: "rgba(44,132,219,0.12)", color: "#2C84DB" } : tbBtn}><ShapeIcon /></button>
            {addType === "shape" && (
              <div data-ui style={{ position: "absolute", top: "calc(100% + 6px)", right: -3, ...dropdownSurface, padding: 4, width: 150 }}>
                {SHAPE_PRESETS.map(p => (
                  <button key={p.label} onClick={() => { onAddShape(p); setAddType(null); }} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", color: "rgba(194,192,182,0.58)", padding: "5px 9px", fontSize: 12, cursor: "pointer", borderRadius: 5, fontFamily: FONT }}
                    onMouseEnter={e => e.target.style.background = "rgba(194,192,182,0.07)"} onMouseLeave={e => e.target.style.background = "transparent"}>{p.label}</button>
                ))}
              </div>
            )}
          </div>
          <button onClick={onAddConnector} title="Add Connector" style={tbBtn}><ConnectorIcon /></button>
        </div>
      )}
    </div>
  );
}
