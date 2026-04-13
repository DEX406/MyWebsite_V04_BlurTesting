import { Z } from '../styles.js';

export function ConnectorHandles({ item }) {
  const { x1, y1, x2, y2, elbowX: elbowXRaw, elbowY: elbowYRaw, orientation } = item;
  const elbowX = elbowXRaw ?? (x1 + x2) / 2;
  const elbowY = elbowYRaw ?? (y1 + y2) / 2;
  const orient = orientation || "h";

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const handleX = orient === "h" ? elbowX : midX;
  const handleY = orient === "h" ? midY : elbowY;

  const hS = { position: "absolute", width: 32, height: 32, background: "transparent", border: "none", borderRadius: "50%", transform: "translate(-50%, -50%) scale(var(--inv-zoom, 1))", cursor: "move", pointerEvents: "auto" };

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, zIndex: Z.HANDLE_GRIP, pointerEvents: "none" }}>
      <div data-item-id={item.id} data-action="move-ep1" style={{ ...hS, left: x1, top: y1 }} />
      <div data-item-id={item.id} data-action="move-ep2" style={{ ...hS, left: x2, top: y2 }} />
      <div data-item-id={item.id} data-action="move-elbow" style={{ ...hS, left: handleX, top: handleY }} />
    </div>
  );
}
