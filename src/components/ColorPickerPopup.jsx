import { panelSurface, Z } from '../styles.js';

export function ColorPickerPopup({ colorPicker, setColorPicker, palette }) {
  if (!colorPicker) return null;

  return (
    <div data-ui style={{ position: "fixed", left: colorPicker.x, bottom: colorPicker.bottomY, zIndex: Z.POPUP, ...panelSurface, padding: 10, minWidth: 170 }}
      onPointerDown={e => e.stopPropagation()}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {palette.map((c, i) => (
          <button key={i} data-ui onClick={() => { colorPicker.onChange(c); setColorPicker(null); }}
            style={{ width: 32, height: 32, background: c, border: colorPicker.value === c ? "2px solid #C2C0B6" : "1px solid rgba(194,192,182,0.15)", borderRadius: 5, cursor: "pointer", padding: 0 }} />
        ))}
        <label data-ui style={{ display: "block", cursor: "pointer" }}>
          <input type="color" value={colorPicker.value} onChange={e => { const v = e.target.value; colorPicker.onChange(v); setColorPicker(cp => ({ ...cp, value: v })); }}
            style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }} />
          <div style={{ width: 32, height: 32, background: "conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)", border: "1px solid rgba(194,192,182,0.15)", borderRadius: 5, cursor: "pointer" }} />
        </label>
      </div>
    </div>
  );
}
