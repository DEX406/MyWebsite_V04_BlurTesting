import { Z } from '../styles.js';

const HIT = 32;
const ROD_LEN = 36;

const hitBase = {
  position: 'absolute', width: HIT, height: HIT,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  pointerEvents: 'auto', background: 'transparent', border: 'none', padding: 0,
  transform: 'scale(var(--inv-zoom, 1))',
};

function Handle({ item, handle, style, cursor }) {
  return (
    <div data-item-id={item.id} data-action="resize" data-handle={handle}
      style={{ ...hitBase, cursor, ...style }} />
  );
}

export function ItemHandles({ item }) {
  const half = HIT / 2;
  return (
    <div style={{
      position: 'absolute', left: item.x, top: item.y, width: item.w, height: item.h,
      zIndex: Z.HANDLE_GRIP, pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        transform: `rotate(${item.rotation || 0}deg)`,
        transformOrigin: 'center center',
      }}>
        {/* Rotate hit zone */}
        <div data-item-id={item.id} data-action="rotate" style={{
          ...hitBase,
          left: '50%', top: -(ROD_LEN + half + 6),
          transform: 'translateX(-50%) scale(var(--inv-zoom, 1))',
          cursor: 'grab',
        }} />

        {/* Corner resize hit zones */}
        <Handle item={item} handle="tl" cursor="nwse-resize"
          style={{ top: -half, left: -half }} />
        <Handle item={item} handle="tr" cursor="nesw-resize"
          style={{ top: -half, right: -half }} />
        <Handle item={item} handle="bl" cursor="nesw-resize"
          style={{ bottom: -half, left: -half }} />
        <Handle item={item} handle="br" cursor="nwse-resize"
          style={{ bottom: -half, right: -half }} />

        {/* Edge resize hit zones */}
        <Handle item={item} handle="t" cursor="ns-resize"
          style={{ top: -half, left: '50%', transform: 'translateX(-50%) scale(var(--inv-zoom, 1))' }} />
        <Handle item={item} handle="b" cursor="ns-resize"
          style={{ bottom: -half, left: '50%', transform: 'translateX(-50%) scale(var(--inv-zoom, 1))' }} />
        <Handle item={item} handle="l" cursor="ew-resize"
          style={{ left: -half, top: '50%', transform: 'translateY(-50%) scale(var(--inv-zoom, 1))' }} />
        <Handle item={item} handle="r" cursor="ew-resize"
          style={{ right: -half, top: '50%', transform: 'translateY(-50%) scale(var(--inv-zoom, 1))' }} />
      </div>
    </div>
  );
}
