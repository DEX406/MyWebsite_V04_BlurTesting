import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FONT } from '../constants.js';
import { readLocal, writeLocal } from '../utils.js';
import { dropdownSurface, togBtn } from '../styles.js';
import { ResizePresetSelect, presetToScale } from './ResizePresetSelect.jsx';
import {
  loadAsBitmap, fitOntoCanvas, clampLongEdge,
  applyPaletteChoice, encodeAnimatedWebp, decodeGifFrames,
} from '../animatedWebp.js';

const SETTINGS_KEY = 'lutz-animated-maker-settings';
const DEFAULT_SETTINGS = {
  resize: 'orig',
  msPerFrame: 100,
  lossless: true,
  quality: 90,
  palette: 'full',
  dither: true,
  loopForever: true,
};

const labelStyle = { color: 'rgba(194,192,182,0.45)', fontSize: 11 };
const sectionLabel = { color: 'rgba(194,192,182,0.3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, marginTop: 10 };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 };
const inputStyle = {
  background: 'rgba(194,192,182,0.06)',
  border: '1px solid rgba(194,192,182,0.07)',
  borderRadius: 6,
  color: 'rgba(194,192,182,0.82)',
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: FONT,
  outline: 'none',
  width: 70,
  height: 26,
  boxSizing: 'border-box',
  textAlign: 'right',
};

export function AnimatedMakerPanel({ open, onClose, onEncoded, setUploadStatus }) {
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(readLocal(SETTINGS_KEY, {}) || {}) }));
  const [picked, setPicked] = useState([]);       // [{ file, preview, width, height }]
  const [encoding, setEncoding] = useState(false);
  const [progress, setProgress] = useState(null);  // { done, total }
  const fileInputRef = useRef(null);

  // Persist settings whenever they change.
  useEffect(() => { writeLocal(SETTINGS_KEY, settings); }, [settings]);

  // Clean up object URLs used for preview thumbnails when the panel closes
  // or the selection changes.
  useEffect(() => () => {
    for (const p of picked) URL.revokeObjectURL(p.preview);
  }, [picked]);

  // Reset state when the panel closes so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setPicked((prev) => { for (const p of prev) URL.revokeObjectURL(p.preview); return []; });
      setEncoding(false);
      setProgress(null);
    }
  }, [open]);

  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  const largestLongEdge = useMemo(() => {
    let le = 0;
    for (const p of picked) le = Math.max(le, p.width, p.height);
    return le;
  }, [picked]);

  const canvasDims = useMemo(() => {
    if (!picked.length) return null;
    // Canvas starts as "largest selected image's dimensions".
    let w = 0, h = 0;
    for (const p of picked) {
      if (p.width * p.height > w * h) { w = p.width; h = p.height; }
    }
    // Apply the resize preset: percentages scale the canvas; pixel targets
    // clamp the long edge (never upscale).
    const scale = presetToScale(settings.resize, Math.max(w, h));
    if (scale !== null && scale > 0 && scale < 1) {
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    return { w, h };
  }, [picked, settings.resize]);

  const onPickFiles = useCallback(async (files) => {
    const arr = Array.from(files || []).filter(f => f.type.startsWith('image/'));
    if (!arr.length) return;
    // Decode dimensions up front so the UI can show grey-out state and thumbs.
    const next = [];
    for (const file of arr) {
      try {
        const url = URL.createObjectURL(file);
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = url;
        });
        next.push({ file, preview: url, width: img.naturalWidth, height: img.naturalHeight });
      } catch {}
    }
    setPicked((prev) => { for (const p of prev) URL.revokeObjectURL(p.preview); return next; });
  }, []);

  const handleEncode = useCallback(async () => {
    if (!picked.length || !canvasDims) return;
    setEncoding(true);
    setProgress({ done: 0, total: picked.length * 2 });
    setUploadStatus?.('Preparing frames...');
    try {
      // 1. Decode each file into a bitmap, fit into the shared canvas, apply
      //    palette choice. This is the memory-heavy phase — we process files
      //    one at a time and release bitmaps as we go.
      const frames = [];
      for (let i = 0; i < picked.length; i++) {
        const p = picked[i];
        const { bitmap, width, height } = await loadAsBitmap(p.file);
        let c = fitOntoCanvas(bitmap, width, height, canvasDims.w, canvasDims.h);
        bitmap.close?.();
        // Safety clamp: never hand the encoder a frame larger than ~4k long
        // edge. Prevents tab crashes on mobile when the user picks huge
        // images with "Original" selected.
        c = clampLongEdge(c, 4096);
        applyPaletteChoice(c, settings.palette, settings.dither);
        frames.push({ canvas: c, durationMs: settings.msPerFrame });
        setProgress({ done: i + 1, total: picked.length * 2 });
        setUploadStatus?.(`Preparing frame ${i + 1}/${picked.length}...`);
      }

      // 2. Encode each frame as WebP, mux into animated WebP.
      setUploadStatus?.('Encoding animation...');
      const blob = await encodeAnimatedWebp(frames, {
        lossless: settings.lossless,
        quality: (settings.quality || 90) / 100,
        loopCount: settings.loopForever ? 0 : 1,
        onProgress: (done, total) => {
          setProgress({ done: picked.length + done, total: picked.length + total });
          setUploadStatus?.(`Encoding frame ${done}/${total}...`);
        },
      });

      // 3. Hand the encoded Blob back for upload. Caller handles R2 + canvas
      //    placement.
      await onEncoded?.(blob);
      onClose?.();
    } catch (err) {
      console.error('Animated encode failed:', err);
      setUploadStatus?.(err.message || 'Encode failed');
      setTimeout(() => setUploadStatus?.(''), 3000);
    } finally {
      setEncoding(false);
      setProgress(null);
    }
  }, [picked, canvasDims, settings, onEncoded, onClose, setUploadStatus]);

  if (!open) return null;

  return (
    <div
      data-ui
      style={{
        position: 'absolute', top: 'calc(100% + 6px)', right: -3,
        ...dropdownSurface, padding: 12, width: 260, maxHeight: '70vh',
        overflowY: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ ...sectionLabel, marginTop: 0 }}>Animated WebP</div>

      {/* Resize */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ ...labelStyle, marginBottom: 4 }}>Output size</div>
        <ResizePresetSelect
          value={settings.resize === 'orig' ? 'orig' : settings.resize}
          sourceLongEdge={largestLongEdge}
          onChange={(v) => set('resize', v || 'orig')}
          placeholder="Original"
        />
      </div>

      {/* Frame duration */}
      <div style={rowStyle}>
        <span style={labelStyle}>ms / frame</span>
        <span style={{ flex: 1 }} />
        <input
          type="number" min={1} max={10000} step={10}
          value={settings.msPerFrame}
          onChange={(e) => set('msPerFrame', Math.max(1, parseInt(e.target.value) || 100))}
          style={inputStyle}
        />
      </div>

      {/* Mode */}
      <div style={rowStyle}>
        <span style={labelStyle}>Mode</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => set('lossless', true)}
          style={{ ...togBtn, width: 72, height: 26, fontSize: 11, background: settings.lossless ? 'rgba(44,132,219,0.15)' : 'rgba(194,192,182,0.05)' }}
        >Lossless</button>
        <button
          onClick={() => set('lossless', false)}
          style={{ ...togBtn, width: 56, height: 26, fontSize: 11, background: !settings.lossless ? 'rgba(44,132,219,0.15)' : 'rgba(194,192,182,0.05)' }}
        >Lossy</button>
      </div>

      {!settings.lossless && (
        <div style={rowStyle}>
          <span style={labelStyle}>Quality</span>
          <input type="range" min="1" max="100" step="1" value={settings.quality}
            onChange={(e) => set('quality', +e.target.value)}
            style={{ flex: 1, accentColor: '#2C84DB' }} />
          <span style={{ ...labelStyle, width: 28, textAlign: 'right' }}>{settings.quality}</span>
        </div>
      )}

      {/* Palette */}
      <div style={{ ...labelStyle, marginTop: 10, marginBottom: 4 }}>Palette</div>
      <select
        value={settings.palette}
        onChange={(e) => set('palette', e.target.value)}
        style={{
          background: 'rgba(194,192,182,0.06)',
          border: '1px solid rgba(194,192,182,0.07)',
          borderRadius: 6,
          color: 'rgba(194,192,182,0.82)',
          padding: '4px 8px', fontSize: 12, fontFamily: FONT,
          outline: 'none', width: '100%', height: 28, boxSizing: 'border-box',
          cursor: 'pointer',
        }}
      >
        <option value="full" style={{ background: '#1F1E1D' }}>Full color</option>
        <option value="256" style={{ background: '#1F1E1D' }}>256 colors</option>
        <option value="64" style={{ background: '#1F1E1D' }}>64 colors</option>
        <option value="16" style={{ background: '#1F1E1D' }}>16 colors</option>
        <option value="gray" style={{ background: '#1F1E1D' }}>Grayscale</option>
      </select>

      {settings.palette !== 'full' && settings.palette !== 'gray' && (
        <div style={{ ...rowStyle, marginTop: 6 }}>
          <span style={labelStyle}>Dither</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => set('dither', !settings.dither)}
            style={{ ...togBtn, width: 56, height: 26, fontSize: 11, background: settings.dither ? 'rgba(44,132,219,0.15)' : 'rgba(194,192,182,0.05)' }}
          >{settings.dither ? 'On' : 'Off'}</button>
        </div>
      )}

      {/* Loop */}
      <div style={{ ...rowStyle, marginTop: 10 }}>
        <span style={labelStyle}>Loop</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => set('loopForever', !settings.loopForever)}
          style={{ ...togBtn, width: 72, height: 26, fontSize: 11, background: settings.loopForever ? 'rgba(44,132,219,0.15)' : 'rgba(194,192,182,0.05)' }}
        >{settings.loopForever ? 'Forever' : 'Once'}</button>
      </div>

      {/* Selected frames preview */}
      {picked.length > 0 && (
        <>
          <div style={{ ...sectionLabel, marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Selected · {picked.length}</span>
            {canvasDims && <span style={{ color: 'rgba(194,192,182,0.28)', textTransform: 'none', letterSpacing: 0 }}>{canvasDims.w}×{canvasDims.h}</span>}
          </div>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
            {picked.map((p, i) => (
              <div key={i} style={{
                position: 'relative', width: 40, height: 40, flexShrink: 0,
                borderRadius: 4, overflow: 'hidden', background: 'rgba(194,192,182,0.05)',
              }}>
                <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)',
                  color: 'rgba(194,192,182,0.85)', fontSize: 9,
                  padding: '6px 3px 2px', textAlign: 'center',
                }}>{i + 1}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Bottom: pick or encode */}
      <input
        ref={fileInputRef} type="file" accept="image/*" multiple
        onChange={(e) => { onPickFiles(e.target.files); e.target.value = ''; }}
        style={{ display: 'none' }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={encoding}
          style={{
            ...togBtn, flex: 1, height: 32,
            background: picked.length ? 'rgba(194,192,182,0.05)' : 'rgba(44,132,219,0.15)',
            color: 'rgba(194,192,182,0.82)',
            cursor: encoding ? 'not-allowed' : 'pointer',
            opacity: encoding ? 0.5 : 1,
          }}
        >{picked.length ? 'Re-pick' : 'Select images'}</button>
        {picked.length > 0 && (
          <button
            onClick={handleEncode}
            disabled={encoding}
            style={{
              ...togBtn, flex: 1, height: 32,
              background: 'rgba(44,132,219,0.22)', color: 'rgba(194,192,182,0.85)',
              cursor: encoding ? 'not-allowed' : 'pointer',
              opacity: encoding ? 0.5 : 1, fontWeight: 600,
            }}
          >{encoding ? (progress ? `${progress.done}/${progress.total}` : '...') : 'Encode'}</button>
        )}
      </div>
    </div>
  );
}
