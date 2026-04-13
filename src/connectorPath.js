export function buildConnectorPath(x1, y1, x2, y2, elbowX, elbowY, orientation, roundness) {
  if (orientation === "v") {
    // V-route: down → across → down
    const hRun = Math.abs(x2 - x1);
    const halfH = hRun / 2;
    const sv1 = Math.sign(elbowY - y1) || 1;
    const sv2 = Math.sign(y2 - elbowY) || 1;
    const sh = Math.sign(x2 - x1) || 1;
    const r1 = Math.max(0, Math.min(Math.abs(elbowY - y1), halfH, roundness));
    const r2 = Math.max(0, Math.min(Math.abs(y2 - elbowY), halfH, roundness));
    const seg1 = r1 >= 0.5
      ? `L ${x1},${elbowY - sv1*r1} Q ${x1},${elbowY} ${x1 + sh*r1},${elbowY}`
      : `L ${x1},${elbowY}`;
    const seg2 = r2 >= 0.5
      ? `L ${x2 - sh*r2},${elbowY} Q ${x2},${elbowY} ${x2},${elbowY + sv2*r2}`
      : `L ${x2},${elbowY}`;
    return `M ${x1},${y1} ${seg1} ${seg2} L ${x2},${y2}`;
  } else {
    // H-route: across → down → across
    const vertDist = Math.abs(y2 - y1);
    const halfVert = vertDist / 2;
    const s1 = Math.sign(elbowX - x1) || 1;
    const s2 = Math.sign(x2 - elbowX) || 1;
    const sv = Math.sign(y2 - y1) || 1;
    const r1 = Math.max(0, Math.min(Math.abs(elbowX - x1), halfVert, roundness));
    const r2 = Math.max(0, Math.min(Math.abs(x2 - elbowX), halfVert, roundness));
    if (vertDist < 1) return `M ${x1},${y1} L ${x2},${y2}`;
    const seg1 = r1 >= 0.5
      ? `L ${elbowX - s1*r1},${y1} Q ${elbowX},${y1} ${elbowX},${y1 + sv*r1}`
      : `L ${elbowX},${y1}`;
    const seg2 = r2 >= 0.5
      ? `L ${elbowX},${y2 - sv*r2} Q ${elbowX},${y2} ${elbowX + s2*r2},${y2}`
      : `L ${elbowX},${y2}`;
    return `M ${x1},${y1} ${seg1} ${seg2} L ${x2},${y2}`;
  }
}
