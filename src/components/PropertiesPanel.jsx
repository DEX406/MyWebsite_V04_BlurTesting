import { useState, useEffect, useRef, useCallback } from 'react';
import { FONT, FONTS, isR2Url } from '../constants.js';
import { itemShadowEnabled } from '../utils.js';
import { serverResize, downloadImageViaProxy } from '../api.js';
import { ChevronUpIcon, ChevronDownIcon } from '../icons.jsx';
import { panelSurface, tbBtn, Z, CHECKER_BG } from '../styles.js';
import { ResizePresetSelect, presetToScale } from './ResizePresetSelect.jsx';

/* ─────────────────────────────────────────────
   Design tokens
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
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: TRACK_CLR, borderRadius: PILL_R, transition: "width 0.05s" }} />
      <span style={{ position: "relative", zIndex: 1, paddingLeft: 10, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: LABEL_CLR, pointerEvents: "none", flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1 }} />
      <span style={{ position: "relative", zIndex: 1, paddingRight: 10, fontSize: 11, color: VALUE_CLR, pointerEvents: "none", flexShrink: 0 }}>{value}{suffix}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Toggle pill
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
   Color swatch pill
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
   Section + number pill
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

/* ─────────────────────────────────────────────
   Tiny one-file procedural renderer
   ───────────────────────────────────────────── */
const Row = ({ children }) => <div style={{ display: "flex", gap: GAP }}>{children}</div>;
const S = (label, key, o = {}) => ({ type: "slider", label, key, ...o });
const N = (label, key, o = {}) => ({ type: "num", label, key, ...o });
const T = (label, key, o = {}) => ({ type: "toggle", label, key, ...o });
const C = (label, key, o = {}) => ({ type: "color", label, key, ...o });
const X = (render, key = "custom") => ({ type: "custom", key, render });

function Field({ f, ctx }) {
  if (!f) return null;
  if (f.type === "custom") return f.render(ctx);

  const { sel, updateAll, updateItem, openColorPicker } = ctx;
  const val = typeof f.value === "function" ? f.value(sel, ctx) : sel[f.key] ?? f.fallback;
  const set = v => f.set ? f.set(v, ctx) : updateAll({ [f.key]: v });

  if (f.type === "slider") return <Slider label={f.label} value={val} min={f.min ?? 0} max={f.max ?? 100} suffix={f.suffix ?? ""} onChange={set} />;
  if (f.type === "num") return <NumPill label={f.label} value={val} min={f.min ?? 0} max={f.max ?? 9999} suffix={f.suffix ?? ""} onChange={set} />;
  if (f.type === "color") return <ColorPill label={f.label} value={val} onOpen={openColorPicker} onChange={set} />;
  if (f.type === "toggle") {
    return (
      <Toggle
        label={typeof f.label === "function" ? f.label(sel, ctx) : f.label}
        flex={f.flex}
        active={f.active ? f.active(sel, ctx) : !!sel[f.key]}
        onClick={() => f.click ? f.click(ctx) : updateAll({ [f.key]: !sel[f.key] })}
      />
    );
  }
  return null;
}

function AutoSections({ sections, ctx }) {
  return (
    <>
      {sections.filter(Boolean).map(sec => (
        <Section key={sec.title} title={sec.title}>
          {sec.rows.filter(Boolean).map((row, i) => (
            <Row key={i}>
              {row.filter(Boolean).map((f, j) => <Field key={`${f.key || f.label || "field"}-${j}`} f={f} ctx={ctx} />)}
            </Row>
          ))}
        </Section>
      ))}
    </>
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

  const panelStyle = { padding: 10, width: 260, fontFamily: FONT, fontSize: 12 };
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
  const collapseButtonStyle = { ...tbBtn, width: 32, height: 32, flexShrink: 0, color: "rgba(194,192,182,0.58)" };
  const collapseBoxStyle = { ...panelSurface, width: 40, height: 40, padding: 2, display: "flex", alignItems: "center", justifyContent: "center" };
  const contentBoxStyle = { ...panelSurface, ...panelStyle };
  const topRightStyle = { display: "flex", justifyContent: "flex-end", width: 260 };
  const inp = { background: PILL_BG, border: PILL_BRD, borderRadius: PILL_R, color: "rgba(194,192,182,0.82)", padding: "4px 10px", fontSize: 12, outline: "none", width: "100%", fontFamily: FONT, height: PILL_H, boxSizing: "border-box" };

  const Shell = ({ children, scroll = false }) => (
    <div data-ui style={wrapperStyle} onPointerDown={e => e.stopPropagation()}>
      <div style={topRightStyle}>
        <div style={collapseBoxStyle}>
          <button data-ui onClick={() => setCollapsed(!collapsed)} style={collapseButtonStyle} title={collapsed ? "Expand properties" : "Collapse properties"}>
            {collapsed ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
          </button>
        </div>
      </div>
      {!collapsed && <div style={scroll ? { ...contentBoxStyle, maxHeight: "70vh", overflowY: "auto" } : contentBoxStyle}>{children}</div>}
    </div>
  );

  if (types.length !== 1) {
    if (!isGroup) return null;
    return (
      <Shell>
        <div style={sectionTitle}>group · {selectedIds.length} items</div>
        <Toggle label="Ungroup" active={false} onClick={ungroupSelected} flex />
      </Shell>
    );
  }

  const type = types[0];
  const isMulti = selectedIds.length > 1;
  const sel = selectedItems[0];
  const updateAll = updates => updateItems(selectedIds, updates);
  const isTextLike = type === "text" || type === "link";
  const hasFill = isTextLike || type === "shape";
  const hasFlash = type === "text" || type === "image" || type === "shape";
  const ctx = { sel, type, isMulti, selectedItems, updateAll, updateItem, openColorPicker, resizeImage, setUploadStatus, setSettingTeleport, inp };

  const saveSelectedToDevice = async () => {
    const imageItems = selectedItems.filter(i => i.type === "image" || i.type === "video");
    setUploadStatus("Downloading...");
    let failed = 0;
    const blobs = [];

    for (const item of imageItems) {
      try {
        const src = item.src;
        let blob;
        if (isR2Url(src)) {
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
  };

  const connectorSections = [
    {
      title: "Line",
      rows: [
        [C("Color", "lineColor", { fallback: "#C2C0B6" }), S("Width", "lineWidth", { min: 1, max: 20, fallback: 2, suffix: "px" })],
        [S("Elbow", "roundness", { min: 0, max: 80, fallback: 20 }), ...["h", "v"].map(o => T(o === "h" ? "H" : "Z", "orientation", { active: i => i.orientation === o, click: () => updateAll({ orientation: o }) }))],
      ],
    },
    {
      title: "Endpoints",
      rows: [
        [T("Dot 1", "dot1", { flex: true, active: i => i.dot1 !== false, click: ({ sel }) => updateAll({ dot1: !sel.dot1 }) }), T("Dot 2", "dot2", { flex: true, active: i => i.dot2 !== false, click: ({ sel }) => updateAll({ dot2: !sel.dot2 }) })],
        (sel.dot1 !== false || sel.dot2 !== false) && [C("Color", "dotColor", { fallback: "#C2C0B6" }), S("Size", "dotRadius", { min: 2, max: 20, fallback: 5, suffix: "px" })],
      ],
    },
  ];

  if (type === "connector") {
    return (
      <Shell>
        <div style={{ ...sectionTitle, marginBottom: 4 }}>connector</div>
        <AutoSections sections={connectorSections} ctx={ctx} />
      </Shell>
    );
  }

  const sections = [
    !isMulti && {
      title: "Size",
      rows: [[
        N("W", "w", { min: 1, max: 9999, value: i => Math.round(i.w), set: v => updateAll({ w: v || 30 }) }),
        N("H", "h", { min: 1, max: 9999, value: i => Math.round(i.h), set: v => updateAll({ h: v || 20 }) }),
      ]],
    },
    {
      title: "Transform",
      rows: [[
        !isMulti && S("Rotate", "rotation", { min: -180, max: 180, suffix: "°", value: i => Math.round(i.rotation || 0) }),
        S("Corners", "radius", { min: 0, max: 100, fallback: 2 }),
      ]],
    },
    {
      title: "Appearance",
      rows: [
        [T("Shadow", "shadow", { flex: true, active: i => itemShadowEnabled(i), click: ({ sel }) => updateAll({ shadow: !itemShadowEnabled(sel) }) })],
        hasFill && [type !== "shape" && C("Text", "color", { fallback: "#C2C0B6" }), C("Fill", "bgColor", { fallback: "transparent" })],
        hasFill && [
          S("Opacity", "bgOpacity", {
            min: 0, max: 100, suffix: "%",
            value: i => Math.round((i.bgColor === "transparent" ? 0 : i.bgOpacity ?? 1) * 100),
            set: (v, { sel }) => {
              const val = v / 100;
              updateAll({ bgOpacity: val, bgColor: val > 0 && sel.bgColor === "transparent" ? "#333333" : sel.bgColor });
            },
          }),
          T("Blur", "bgBlur"),
        ],
        hasFill && [
          T("Noise", "noiseEnabled"),
          S("Noise α", "noiseOpacity", {
            min: 0, max: 100, suffix: "%",
            value: i => Math.round((i.noiseOpacity ?? 0.2) * 100),
            set: (v, { sel }) => updateAll({ noiseOpacity: v / 100, noiseEnabled: v > 0 ? true : !!sel.noiseEnabled }),
          }),
        ],
        (type === "shape" || type === "link") && [C("Border", "borderColor", { fallback: "#C2C0B6" }), S("W", "borderWidth", { min: 0, max: 20, fallback: 0, suffix: "px" })],
      ],
    },
    hasFlash && {
      title: "Flash",
      rows: [
        [T(i => i.flashEnabled ? "Flash On" : "Flash Off", "flashEnabled", {
          flex: true,
          click: ({ sel }) => updateAll(sel.flashEnabled ? { flashEnabled: false } : {
            flashEnabled: true,
            flashOnMs: Math.max(0, Number(sel.flashOnMs ?? 500)),
            flashOffMs: Math.max(0, Number(sel.flashOffMs ?? 500)),
          }),
        })],
        [
          N("On", "flashOnMs", { min: 0, max: 60000, suffix: "ms", value: i => Math.max(0, Math.round(i.flashOnMs ?? 500)), set: v => updateAll({ flashOnMs: Math.max(0, v) }) }),
          N("Off", "flashOffMs", { min: 0, max: 60000, suffix: "ms", value: i => Math.max(0, Math.round(i.flashOffMs ?? 500)), set: v => updateAll({ flashOffMs: Math.max(0, v) }) }),
        ],
      ],
    },
    isTextLike && {
      title: "Text",
      rows: [
        [X(() => (
          <select value={sel.fontFamily} onChange={e => updateAll({ fontFamily: e.target.value })} style={{ ...inp, appearance: "auto", cursor: "pointer" }}>
            {FONTS.map(f => <option key={f.value} value={f.value} style={{ background: "#1F1E1D" }}>{f.label}</option>)}
          </select>
        ), "fontFamily")],
        [
          N("", "fontSize", { min: 8, max: 200, suffix: "px", fallback: 12 }),
          T("B", "bold"),
          T("I", "italic"),
          ...["left", "center", "right"].map(a => T(a[0].toUpperCase(), "align", { active: i => i.align === a, click: () => updateAll({ align: a }) })),
        ],
        !isMulti && type === "text" && [X(() => <input value={sel.text} onChange={e => updateItem(sel.id, { text: e.target.value })} style={inp} placeholder="Text content..." />, "textInput")],
        !isMulti && type === "link" && [
          X(() => <input value={sel.text} onChange={e => updateItem(sel.id, { text: e.target.value })} style={inp} placeholder="Label..." />, "linkLabel"),
          X(() => <input value={sel.url} onChange={e => updateItem(sel.id, { url: e.target.value })} style={inp} placeholder="https://..." />, "linkUrl"),
        ],
      ],
    },
    !isMulti && type === "link" && {
      title: "Teleport",
      rows: [[sel.teleportPan
        ? X(() => <><Toggle label="Reset" active={false} onClick={() => setSettingTeleport(sel.id)} flex /><Toggle label="Clear" active={false} onClick={() => updateItem(sel.id, { teleportPan: undefined, teleportZoom: undefined })} flex /></>, "teleportSet")
        : T("Set destination", "teleport", { flex: true, click: () => setSettingTeleport(sel.id) })]],
    },
    (type === "image" || type === "video") && {
      title: "Export",
      rows: [
        type === "image" && [X(() => (
          !isMulti && sel.src.startsWith("http") && !isR2Url(sel.src) ? (
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
            <ResizePresetSelect
              value=""
              sourceLongEdge={Math.max(sel.naturalWidth || sel.w || 0, sel.naturalHeight || sel.h || 0)}
              onChange={async (val) => {
                const r2Images = selectedItems.filter(i => i.type === "image" && !(i.src.startsWith("http") && !isR2Url(i.src)));
                if (!r2Images.length) return;
                for (const item of r2Images) {
                  const longEdge = Math.max(item.naturalWidth || item.w || 0, item.naturalHeight || item.h || 0);
                  const scale = presetToScale(val, longEdge);
                  if (scale === null || scale >= 1) continue;
                  await resizeImage([item], scale);
                }
              }}
              style={{ flex: 1, width: "auto" }}
            />
          )
        ), "resizeStore")],
        !isMulti && [["1:1", 1], ["1:2", 0.5], ["1:4", 0.25]].map(([label, s]) => T(label, `scale-${label}`, { flex: true, click: () => {
          if (type === "video") {
            const nw = sel.naturalWidth, nh = sel.naturalHeight;
            if (nw && nh) updateItem(sel.id, { w: Math.round(nw * s), h: Math.round(nh * s) });
          } else {
            const img = new Image();
            img.onload = () => updateItem(sel.id, { w: Math.round(img.width * s), h: Math.round(img.height * s) });
            img.src = sel.src;
          }
        } })),
        [X(() => (
          <button
            onClick={saveSelectedToDevice}
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
        ), "save")],
      ],
    },
  ];

  return (
    <Shell scroll>
      <AutoSections sections={sections} ctx={ctx} />
    </Shell>
  );
}
