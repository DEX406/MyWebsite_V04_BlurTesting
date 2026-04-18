// Build an elbow-connector SVG path (H- or V-routed) with optional rounded corners.
// H-route: across → down → across (elbow X splits the run)
// V-route: down  → across → down  (elbow Y splits the run)
export function buildConnectorPath(x1, y1, x2, y2, elbowX, elbowY, orientation, roundness) {
  const isH = orientation !== "v";
  // a = axis along the outer runs, b = axis along the middle run.
  const a1 = isH ? x1 : y1;
  const a2 = isH ? x2 : y2;
  const b1 = isH ? y1 : x1;
  const b2 = isH ? y2 : x2;
  const elbowA = isH ? elbowX : elbowY;

  const bSpan = Math.abs(b2 - b1);
  if (isH && bSpan < 1) return `M ${x1},${y1} L ${x2},${y2}`;
  const halfB = bSpan / 2;

  const sa1 = Math.sign(elbowA - a1) || 1;
  const sa2 = Math.sign(a2 - elbowA) || 1;
  const sb = Math.sign(b2 - b1) || 1;
  const r1 = Math.max(0, Math.min(Math.abs(elbowA - a1), halfB, roundness));
  const r2 = Math.max(0, Math.min(Math.abs(a2 - elbowA), halfB, roundness));

  // Emit a point (a, b) in the original coordinate space.
  const P = isH
    ? (a, b) => `${a},${b}`
    : (a, b) => `${b},${a}`;

  const seg1 = r1 >= 0.5
    ? `L ${P(elbowA - sa1 * r1, b1)} Q ${P(elbowA, b1)} ${P(elbowA, b1 + sb * r1)}`
    : `L ${P(elbowA, b1)}`;
  const seg2 = r2 >= 0.5
    ? `L ${P(elbowA, b2 - sb * r2)} Q ${P(elbowA, b2)} ${P(elbowA + sa2 * r2, b2)}`
    : `L ${P(elbowA, b2)}`;

  return `M ${x1},${y1} ${seg1} ${seg2} L ${x2},${y2}`;
}
