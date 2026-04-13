import { useState, useEffect, useRef, useCallback } from 'react';
import { FONT, FONTS } from '../constants.js';
import { itemShadowEnabled } from '../utils.js';
import { uploadImage, serverResize, downloadImageViaProxy } from '../api.js';
import { ChevronUpIcon, ChevronDownIcon } from '../icons.jsx';
import { togBtn, panelSurface, tbBtn, Z, CHECKER_BG } from '../styles.js';

/* ─────────────────────────────────────────────
   Design tokens (derived from global style)
   ───────────────────────────────────────────── */
const PILL_H    = 30;
const PILL_R    = 7;
const PILL_BG   = "rgba(194,192,182,0.06)";
const PILL_BRD  = "1px solid rgba(194,192,182,0.07)";
const ACTIVE_BG = "rgba(44,132,219,0.22)";
const LABEL_CLR = "rgba(194,192,182,0.38)";
const VALUE_CLR = "rgba(194,192,182,0.6)";
const TRACK_CLR = "rgba(44,132,219,0.28)";
const GAP       = 6;

/* ─────────────────────────────────────────────
   Inline Slider – label + track + value in one pill
   ───────────────────────────────────────────── */
function Slider({ label, value, min, max, onChange, suffix = "" }) {
  const ref = useRef(null);
  const range = max - min;
  const pct = Math.max(0, Math.min(1, (value - min) / range)) * 100;

  const startDrag = useCallback((e) => {
    e.preventDefault();
    const bar = ref.current;
    if (!bar) return;
    const update = (clientX) => {
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onChange(Math.round(min + ratio * range));
    };
    update(e.clientX);
    const onMove = (ev) => update(ev.clientX);
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [min, range, onChange]);

  return (
    <div
      ref={ref}
      onPointerDown={startDrag}
      style={{
        position: "relative", height: PILL_H, borderRadius: PILL_R,
        background: PILL_BG, border: PILL_BRD,
        cursor: "ew-resize", userSelect: "none", overflow: "hidden",
        display: "flex", alignItems: "center", width: "100%",
      }}
    >
      {/* filled track */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: TRACK_CLR, borderRadius: PILL_R, transition: "width 0.05s" }} />
      {/* label */}
      <span style={{ position: "relative", zIndex: 1, paddingLeft: 10, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: LABEL_CLR, pointerEvents: "none", flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1 }} />
      {/* value */}
      <span style={{ position: "relative", zIndex: 1, paddingRight: 10, fontSize: 11, color: VALUE_CLR, pointerEvents: "none", flexShrink: 0 }}>{value}{suffix}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Toggle pill – on/off with label baked in
   ───────────────────────────────────────────── */
function Toggle({ label, active, onClick, flex }) {
  return (
    <button onClick={onClick} style={{
      height: PILL_H, borderRadius: PILL_R, border: PILL_BRD,
      background: active ? ACTIVE_BG : PILL_BG,
      color: active ? "rgba(194,192,182,0.82)" : LABEL_CLR,
      cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: FONT,
      textTransform: "uppercase", letterSpacing: "0.06em",
      padding: "0 12px", whiteSpace: "nowrap",
      display: "flex", alignItems: "center", justifyContent: "center",
      ...(flex ? { flex: 1 } : {}),
    }}>{label}</button>
  );
}

/* ─────────────────────────────────────────────
   Color swatch pill – filled with current color
   ───────────────────────────────────────────── */
function ColorPill({ label, value, onOpen, onChange }) {
  const isTransparent = !value || value === "transparent";
  return (
    <button
      data-ui
      onClick={e => onOpen(e, isTransparent ? "#000000" : value, onChange)}
      style={{
        height: PILL_H, borderRadius: PILL_R, border: PILL_BRD,
        background: isTransparent ? CHECKER_BG : value,
        cursor: "pointer", padding: "0 12px",
        display: "flex", alignItems: "center", justifyContent: "center",
        flex: 1, minWidth: 0, position: "relative", overflow: "hidden",
      }}
    >
      {label && (
        <span style={{
          fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
          color: "rgba(255,255,255,0.7)", textShadow: "0 1px 3px rgba(0,0,0,0.6)",
          position: "relative", zIndex: 1,
        }}>{label}</span>
      )}
    </button>
  );
}

/* ─────────────────────────────────────────────
   Section wrapper with boxed border
   ───────────────────────────────────────────── */
const sectionTitle = {
  color: "rgba(194,192,182,0.28)", fontSize: 9, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.10em",
  userSelect: "none", padding: "0 2px",
};

const Section = ({ title, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: GAP, marginBottom: GAP + 2 }}>
    <div style={sectionTitle}>{title}</div>
    {children}
  </div>
);

/* ─────────────────────────────────────────────
   Number pill – compact number input in pill
   ───────────────────────────────────────────── */
function NumPill({ label, value, onChange, min, max, suffix = "" }) {
  const [localVal, setLocalVal] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setLocalVal(String(value));
  }, [value, focused]);

  const commit = () => {
    const n = Math.max(min, Math.min(max, +localVal || value));
    onChange(n);
    setLocalVal(String(n));
  };

  return (
    <div style={{
      height: PILL_H, borderRadius: PILL_R, border: PILL_BRD,
      background: PILL_BG, display: "flex", alignItems: "center",
      flex: 1, overflow: "hidden", minWidth: 0,
    }}>
      {label && <span style={{ paddingLeft: 10, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: LABEL_CLR, flexShrink: 0 }}>{label}</span>}
      <input type="number" min={min} max={max} value={localVal}
        onChange={e => setLocalVal(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
        style={{
          background: "transparent", border: "none", outline: "none",
          color: "rgba(194,192,182,0.82)", fontSize: 12, fontFamily: FONT,
          width: "100%", textAlign: "right", paddingRight: suffix ? 2 : 8,
          paddingLeft: label ? 0 : 10,
          height: "100%",
        }}
      />
      {suffix && <span style={{ color: LABEL_CLR, fontSize: 10, paddingRight: 8, flexShrink: 0 }}>{suffix}</span>}
    </div>
  );
}

/* ═════════════════════════════════════════════
   Main PropertiesPanel
   ═════════════════════════════════════════════ */
export function PropertiesPanel({ isAdmin, selectedIds, items, openColorPicker, updateItems, updateItem, ungroupSelected, resizeImage, setUploadStatus, setSettingTeleport, collapsed, setCollapsed }) {
  if (!isAdmin || selectedIds.length === 0) return null;

  const selectedItems = items.filter(i => selectedIds.includes(i.id));
  const types = [...new Set(selectedItems.map(i => i.type))];
  const gid = selectedItems[0]?.groupId;
  const isGroup = gid && selectedItems.every(i => i.groupId === gid);

  const panelStyle = {
    padding: 10, width: 260, fontFamily: FONT, fontSize: 12,
  };
  const wrapperStyle = {
    position: "absolute",
    bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
    right: "calc(16px + env(safe-area-inset-right, 0px))",
    zIndex: Z.UI,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
  };
  const collapseButtonStyle = {
    ...tbBtn,
    width: 32,
    height: 32,
    flexShrink: 0,
    color: "rgba(194,192,182,0.58)",
  };
  const collapseBoxStyle = {
    ...panelSurface,
    width: 40,
    height: 40,
    padding: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  const contentBoxStyle = {
    ...panelSurface,
    ...panelStyle,
  };
  const topRightStyle = {
    display: "flex",
    justifyContent: "flex-end",
    width: 260,
  };

  const inp = { background: PILL_BG, border: PILL_BRD, borderRadius: PILL_R, color: "rgba(194,192,182,0.82)", padding: "4px 10px", fontSize: 12, outline: "none", width: "100%", fontFamily: FONT, height: PILL_H, boxSizing: "border-box" };

  /* ── Group selection ── */
  if (types.length !== 1) {
    if (!isGroup) return null;
    return (
      <div data-ui style={wrapperStyle} onPointerDown={e => e.stopPropagation()}>
        <div style={topRightStyle}>
          <div style={collapseBoxStyle}>
            <button data-ui onClick={() => setCollapsed(!collapsed)} style={collapseButtonStyle} title={collapsed ? "Expand properties" : "Collapse properties"}>
              {collapsed ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div style={contentBoxStyle}>
            <div style={sectionTitle}>group · {selectedIds.length} items</div>
            <Toggle label="Ungroup" active={false} onClick={ungroupSelected} flex />
          </div>
        )}
      </div>
    );
  }

  const type = types[0];
  const isMulti = selectedIds.length > 1;
  const sel = selectedItems[0];
  const updateAll = (updates) => updateItems(selectedIds, updates);

  /* ── Connector ── */
  if (type === "connector") {
    return (
      <div data-ui style={wrapperStyle} onPointerDown={e => e.stopPropagation()}>
        <div style={topRightStyle}>
          <div style={collapseBoxStyle}>
            <button data-ui onClick={() => setCollapsed(!collapsed)} style={collapseButtonStyle} title={collapsed ? "Expand properties" : "Collapse properties"}>
              {collapsed ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
            </button>
          </div>
        </div>

        {!collapsed && (
          <div style={contentBoxStyle}>
            <div style={{ ...sectionTitle, marginBottom: 4 }}>connector</div>

            <Section title="Line">
              <div style={{ display: "flex", gap: GAP }}>
                <ColorPill label="Color" value={sel.lineColor || "#C2C0B6"} onOpen={openColorPicker} onChange={v => updateAll({ lineColor: v })} />
                <Slider label="Width" value={sel.lineWidth || 2} min={1} max={20} onChange={v => updateAll({ lineWidth: v })} suffix="px" />
              </div>
              <div style={{ display: "flex", gap: GAP }}>
                <Slider label="Elbow" value={sel.roundness ?? 20} min={0} max={80} onChange={v => updateAll({ roundness: v })} />
                {["h", "v"].map(o => (
                  <Toggle key={o} label={o === "h" ? "H" : "Z"} active={sel.orientation === o} onClick={() => updateAll({ orientation: o })} />
                ))}
              </div>
            </Section>

            <Section title="Endpoints">
              <div style={{ display: "flex", gap: GAP }}>
                <Toggle label="Dot 1" active={sel.dot1 !== false} onClick={() => updateAll({ dot1: !sel.dot1 })} flex />
                <Toggle label="Dot 2" active={sel.dot2 !== false} onClick={() => updateAll({ dot2: !sel.dot2 })} flex />
              </div>
              {(sel.dot1 !== false || sel.dot2 !== false) && (
                <>
                  <div style={{ display: "flex", gap: GAP }}>
                    <ColorPill label="Color" value={sel.dotColor || "#C2C0B6"} onOpen={openColorPicker} onChange={v => updateAll({ dotColor: v })} />
                    <Slider label="Size" value={sel.dotRadius ?? 5} min={2} max={20} onChange={v => updateAll({ dotRadius: v })} suffix="px" />
                  </div>
                </>
              )}
            </Section>
          </div>
        )}
      </div>
    );
  }

  /* ── Item properties ── */
  return (
    <div data-ui style={wrapperStyle} onPointerDown={e => e.stopPropagation()}>
        <div style={topRightStyle}>
        <div style={collapseBoxStyle}>
          <button data-ui onClick={() => setCollapsed(!collapsed)} style={collapseButtonStyle} title={collapsed ? "Expand properties" : "Collapse properties"}>
            {collapsed ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div style={{ ...contentBoxStyle, maxHeight: "70vh", overflowY: "auto" }}>
          {/* ── Size ── */}
          {!isMulti && (
            <Section title="Size">
              <div style={{ display: "flex", gap: GAP }}>
                <NumPill label="W" value={Math.round(sel.w)} onChange={v => updateAll({ w: v || 30 })} min={1} max={9999} />
                <NumPill label="H" value={Math.round(sel.h)} onChange={v => updateAll({ h: v || 20 })} min={1} max={9999} />
              </div>
            </Section>
          )}

          {/* ── Transform ── */}
          <Section title="Transform">
        <div style={{ display: "flex", gap: GAP }}>
          {!isMulti && (
            <Slider label="Rotate" value={Math.round(sel.rotation || 0)} min={-180} max={180} onChange={v => updateAll({ rotation: v })} suffix="°" />
          )}
          <Slider label="Corners" value={sel.radius ?? 2} min={0} max={100} onChange={v => updateAll({ radius: v })} />
        </div>
          </Section>

          {/* ── Appearance ── */}
          <Section title="Appearance">
        <div style={{ display: "flex", gap: GAP }}>
          <Toggle label="Shadow" active={itemShadowEnabled(sel)} onClick={() => updateAll({ shadow: !itemShadowEnabled(sel) })} flex />
          {(type === "image" || type === "video") && (
            <Toggle label={sel.pixelated ? "Pixelated" : "Smooth"} active={!!sel.pixelated} onClick={() => updateAll({ pixelated: !sel.pixelated })} flex />
          )}
        </div>

        {(type === "text" || type === "link" || type === "shape") && (
          <>
            <div style={{ display: "flex", gap: GAP }}>
              {type !== "shape" && (
                <ColorPill label="Text" value={sel.color || "#C2C0B6"} onOpen={openColorPicker} onChange={v => updateAll({ color: v })} />
              )}
              <ColorPill label="Fill" value={sel.bgColor || "transparent"} onOpen={openColorPicker} onChange={v => updateAll({ bgColor: v })} />
            </div>
            <div style={{ display: "flex", gap: GAP }}>
              <Slider label="Opacity" value={Math.round((sel.bgColor === "transparent" ? 0 : (sel.bgOpacity ?? 1)) * 100)} min={0} max={100} suffix="%" onChange={v => {
                const val = v / 100;
                updateAll({ bgOpacity: val, bgColor: val > 0 && sel.bgColor === "transparent" ? "#333333" : sel.bgColor });
              }} />
              <Toggle label="Blur" active={!!sel.bgBlur} onClick={() => updateAll({ bgBlur: !sel.bgBlur })} />
            </div>
          </>
        )}

        {(type === "shape" || type === "link") && (
          <div style={{ display: "flex", gap: GAP }}>
            <ColorPill label="Border" value={sel.borderColor || "#C2C0B6"} onOpen={openColorPicker} onChange={v => updateAll({ borderColor: v })} />
            <Slider label="W" value={sel.borderWidth || 0} min={0} max={20} onChange={v => updateAll({ borderWidth: v })} suffix="px" />
          </div>
        )}
          </Section>

          {/* ── Text ── */}
          {(type === "text" || type === "link") && (
            <Section title="Text">
          <select value={sel.fontFamily} onChange={e => updateAll({ fontFamily: e.target.value })} style={{ ...inp, appearance: "auto", cursor: "pointer" }}>
            {FONTS.map(f => <option key={f.value} value={f.value} style={{ background: "#1F1E1D" }}>{f.label}</option>)}
          </select>
          <div style={{ display: "flex", gap: GAP }}>
            <NumPill label="" value={sel.fontSize || 12} onChange={v => updateAll({ fontSize: v })} min={8} max={200} suffix="px" />
            <Toggle label="B" active={!!sel.bold} onClick={() => updateAll({ bold: !sel.bold })} />
            <Toggle label="I" active={!!sel.italic} onClick={() => updateAll({ italic: !sel.italic })} />
            {["left", "center", "right"].map(a => (
              <Toggle key={a} label={a[0].toUpperCase()} active={sel.align === a} onClick={() => updateAll({ align: a })} />
            ))}
          </div>
          {!isMulti && type === "text" && (
            <input value={sel.text} onChange={e => updateItem(sel.id, { text: e.target.value })} style={inp} placeholder="Text content..." />
          )}
          {!isMulti && type === "link" && (
            <>
              <input value={sel.text} onChange={e => updateItem(sel.id, { text: e.target.value })} style={inp} placeholder="Label..." />
              <input value={sel.url} onChange={e => updateItem(sel.id, { url: e.target.value })} style={inp} placeholder="https://..." />
            </>
          )}
            </Section>
          )}

          {/* ── Teleport ── */}
          {!isMulti && type === "link" && (
            <Section title="Teleport">
          <div style={{ display: "flex", gap: GAP }}>
            {sel.teleportPan
              ? <>
                  <Toggle label="Reset" active={false} onClick={() => setSettingTeleport(sel.id)} flex />
                  <Toggle label="Clear" active={false} onClick={() => updateItem(sel.id, { teleportPan: undefined, teleportZoom: undefined })} flex />
                </>
              : <Toggle label="Set destination" active={false} onClick={() => setSettingTeleport(sel.id)} flex />
            }
          </div>
            </Section>
          )}

          {/* ── Export (image/video) ── */}
          {(type === "image" || type === "video") && (
            <Section title="Export">
          {type === "image" && (
            <div style={{ display: "flex", gap: GAP }}>
              {!isMulti && sel.src.startsWith("http") && !sel.src.includes("r2.dev") ? (
                <Toggle label="Store in R2" active onClick={async () => {
                  setUploadStatus("Storing...");
                  try {
                    const result = await serverResize(sel.src, 1);
                    updateItem(sel.id, { src: result.url });
                    setUploadStatus("Stored in R2");
                  } catch (err) { setUploadStatus(err.message || "Failed to store"); }
                  setTimeout(() => setUploadStatus(""), 3000);
                }} flex />
              ) : (
                <>
                  <select
                    value=""
                    onChange={async (e) => {
                      if (!e.target.value) return;
                      const scale = parseInt(e.target.value) / 100;
                      const r2Images = selectedItems.filter(i => i.type === "image" && !(i.src.startsWith("http") && !i.src.includes("r2.dev")));
                      if (r2Images.length > 0) await resizeImage(r2Images, scale);
                      e.target.value = "";
                    }}
                    style={{ ...inp, appearance: "auto", cursor: "pointer", flex: 1, width: "auto" }}
                  >
                    <option value="" style={{ background: "#1F1E1D" }}>Resize...</option>
                    <option value="75" style={{ background: "#1F1E1D" }}>75%</option>
                    <option value="50" style={{ background: "#1F1E1D" }}>50%</option>
                    <option value="25" style={{ background: "#1F1E1D" }}>25%</option>
                  </select>
                </>
              )}
            </div>
          )}

          {!isMulti && (
            <div style={{ display: "flex", gap: GAP }}>
              {[["1:1", 1], ["1:2", 0.5], ["1:4", 0.25]].map(([label, s]) => (
                <Toggle key={label} label={label} active={false} flex onClick={() => {
                  if (type === "video") {
                    const nw = sel.naturalWidth, nh = sel.naturalHeight;
                    if (nw && nh) updateItem(sel.id, { w: Math.round(nw * s), h: Math.round(nh * s) });
                  } else {
                    const img = new Image();
                    img.onload = () => updateItem(sel.id, { w: Math.round(img.width * s), h: Math.round(img.height * s) });
                    img.src = sel.src;
                  }
                }} />
              ))}
            </div>
          )}

          <button
            onClick={async () => {
              const imageItems = selectedItems.filter(i => i.type === "image" || i.type === "video");
              setUploadStatus("Downloading...");
              let failed = 0;
              const blobs = [];
              for (const item of imageItems) {
                try {
                  const src = item.src;
                  let blob;
                  if (src.includes('r2.dev')) {
                    const key = src.replace(/^https?:\/\/[^/]+\//, '');
                    blob = await downloadImageViaProxy(key);
                  } else {
                    const res = await fetch(src);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    blob = await res.blob();
                  }
                  const filename = src.split('/').pop().split('?')[0] || 'file';
                  blobs.push({ blob, filename });
                } catch { failed++; }
              }
              const triggerDownload = ({ blob, filename }) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename;
                document.body.appendChild(a); a.click();
                document.body.removeChild(a); URL.revokeObjectURL(url);
              };
              if (blobs.length > 0) {
                const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                if (isMobile) {
                  const shareBlobs = blobs.filter(({ blob }) => blob.type.startsWith('image/'));
                  const downloadBlobs = blobs.filter(({ blob }) => !blob.type.startsWith('image/'));
                  if (shareBlobs.length > 0) {
                    const files = shareBlobs.map(({ blob, filename }) => new File([blob], filename, { type: blob.type }));
                    if (navigator.canShare && navigator.canShare({ files })) {
                      try { await navigator.share({ files, title: files.length === 1 ? files[0].name : `${files.length} images` }); }
                      catch (err) { if (err.name !== 'AbortError') failed += files.length; }
                    } else { shareBlobs.forEach(triggerDownload); }
                  }
                  downloadBlobs.forEach(triggerDownload);
                } else {
                  blobs.forEach(triggerDownload);
                }
              }
              setUploadStatus(failed > 0 ? `${failed} failed` : imageItems.length > 1 ? `${imageItems.length} files saved` : "Saved to device");
              setTimeout(() => setUploadStatus(""), 3000);
            }}
            style={{
              height: PILL_H, borderRadius: PILL_R, border: PILL_BRD,
              background: ACTIVE_BG, color: "rgba(194,192,182,0.82)",
              cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: FONT,
              letterSpacing: "0.04em", width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {isMulti ? `Save ${selectedItems.length} to device` : "Save to device"}
          </button>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
