import { FONT } from '../constants.js';

// Presets in display order. `kind`: "orig" = leave master untouched,
// "pct" = percentage of current long edge, "px" = absolute long edge target.
export const RESIZE_PRESETS = [
  { kind: 'orig', label: 'Original',  value: 'orig' },
  { kind: 'pct',  label: '75%',       value: '0.75' },
  { kind: 'pct',  label: '50%',       value: '0.5'  },
  { kind: 'pct',  label: '25%',       value: '0.25' },
  { kind: 'px',   label: '2048px',    value: '2048' },
  { kind: 'px',   label: '1024px',    value: '1024' },
  { kind: 'px',   label: '512px',     value: '512'  },
];

// Map a preset selection to a multiplicative scale (0..∞) against a source long
// edge. Returns null for "Original" (no-op). Pixel presets that would upscale
// the source are clamped to 1 so callers can rely on "never upscale" behaviour
// — grey-out still happens in the UI but this keeps the math safe.
export function presetToScale(value, sourceLongEdge) {
  if (!value || value === 'orig') return null;
  if (value.includes('.') || value === '1') return parseFloat(value);
  const px = parseInt(value, 10);
  if (!Number.isFinite(px) || px <= 0) return null;
  if (!sourceLongEdge) return null;
  const s = px / sourceLongEdge;
  return Math.min(1, s);
}

// True if picking this preset would enlarge the source (used to grey out px
// options that exceed the current long edge — percentages never upscale so
// they're always enabled).
export function presetUpscales(value, sourceLongEdge) {
  if (!value || value === 'orig') return false;
  if (value.includes('.') || value === '1') return false;
  const px = parseInt(value, 10);
  if (!Number.isFinite(px) || !sourceLongEdge) return false;
  return px > sourceLongEdge;
}

// Dropdown used on both the Properties panel (existing asset) and the upload
// button (incoming files). `sourceLongEdge` drives the upscale grey-out for the
// existing-asset case; pass 0/undefined to leave all options enabled (upload
// flow before any file is picked, or animated-maker flow where the source is
// built up client-side).
export function ResizePresetSelect({
  value,
  onChange,
  sourceLongEdge = 0,
  placeholder = 'Resize...',
  style,
  ariaLabel = 'Resize',
}) {
  const baseStyle = {
    background: 'rgba(194,192,182,0.06)',
    border: '1px solid rgba(194,192,182,0.07)',
    borderRadius: 7,
    color: 'rgba(194,192,182,0.82)',
    padding: '4px 10px',
    fontSize: 12,
    outline: 'none',
    width: '100%',
    fontFamily: FONT,
    height: 30,
    boxSizing: 'border-box',
    appearance: 'auto',
    cursor: 'pointer',
  };
  return (
    <select
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...baseStyle, ...style }}
    >
      <option value="" style={{ background: '#1F1E1D' }}>{placeholder}</option>
      {RESIZE_PRESETS.map((p) => {
        const disabled = presetUpscales(p.value, sourceLongEdge);
        return (
          <option
            key={p.value}
            value={p.value}
            disabled={disabled}
            style={{ background: '#1F1E1D', color: disabled ? 'rgba(194,192,182,0.28)' : undefined }}
          >
            {p.label}{disabled ? '  —  upscale' : ''}
          </option>
        );
      })}
    </select>
  );
}
