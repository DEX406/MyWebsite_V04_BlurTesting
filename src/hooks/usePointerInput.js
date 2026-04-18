import { useCallback, useEffect, useRef } from 'react';
import { snap, snapAngle, computeResize, applyDragDelta, computeElbowOrientation } from '../utils.js';
import { MIN_ZOOM, MAX_ZOOM } from './useViewport.js';

export function usePointerInput({
  vp, items, setItems, selectedIds, setSelectedIds,
  isAdmin,
  draggingRef, setDragging,
  resizingRef, setResizing,
  rotatingRef, setRotating,
  editingConnectorRef, setEditingConnector,
  setEditingTextId,
  effectiveSnapRef,
  scheduleSave, animateTo, pushUndo,
  doHitTest,
  setBoxSelect,
  dragDeltaRef, itemOverrideRef,
}) {
  const { panRef, zoomRef, isPanningRef, panStartRef, canvasRef, drawBgRef, applyTransform, updateDisplays } = vp;
  const lastClickRef = useRef({ time: 0, itemId: null });
  const boxSelectRef = useRef(null);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; });

  const handlePointerDown = (e) => {
    if (e.pointerType === "touch") return;
    if (e.button === 1) { e.preventDefault(); isPanningRef.current = true; panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }; if (canvasRef.current) canvasRef.current.style.cursor = "grabbing"; return; }
    if (e.button !== 0) return;

    // Alt+drag → box select
    if (e.altKey && isAdmin && !e.target.closest("[data-ui]")) {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      boxSelectRef.current = { startX: sx, startY: sy, currentX: sx, currentY: sy };
      setBoxSelect({ startX: sx, startY: sy, currentX: sx, currentY: sy });
      if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
      return;
    }

    // Try DOM-based hit test first (for handle overlays)
    const target = e.target.closest("[data-item-id]");
    let action = target?.dataset?.action;
    let id = target?.dataset?.itemId;

    // If no DOM hit, try WebGL hit test on the canvas
    if (!id && !e.target.closest("[data-ui]") && doHitTest) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const hit = doHitTest(e.clientX - rect.left, e.clientY - rect.top, items, panRef.current.x, panRef.current.y, zoomRef.current);
        if (hit) { id = hit.id; action = hit.action; }
      }
    }

    if (id) {
      const item = items.find(i => i.id === id);
      if (!item) return;

      if (!action && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
        return;
      }

      if (!isAdmin) {
        if (item.type === "link" && !action) {
          if (item.teleportPan) { animateTo(item.teleportPan, item.teleportZoom ?? 1); }
          else if (item.url && item.url !== "https://") { window.open(item.url, "_blank", "noopener"); }
          return;
        }
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
        if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
        return;
      }

      if (action === "move-ep1" || action === "move-ep2" || action === "move-elbow") {
        e.stopPropagation();
        if (!selectedIds.includes(id)) setSelectedIds([id]);
        pushUndo(items);
        const ecInfo = { id, handle: action.replace("move-", ""), startX: e.clientX, startY: e.clientY, startItem: { ...item } };
        setEditingConnector(ecInfo);
        editingConnectorRef.current = ecInfo;
      }

      if (!action && item.type === "text") {
        const now = Date.now();
        const last = lastClickRef.current;
        if (last.itemId === id && now - last.time < 400) {
          lastClickRef.current = { time: 0, itemId: null };
          setEditingTextId(id);
          e.preventDefault();
          return;
        }
        lastClickRef.current = { time: now, itemId: id };
      }

      if (!action) {
        const alreadySelected = selectedIds.includes(id);
        const dragIds = alreadySelected
          ? selectedIds
          : (item.groupId ? items.filter(i => i.groupId === item.groupId).map(i => i.id) : [id]);
        if (!alreadySelected) setSelectedIds(dragIds);
        pushUndo(items);
        const dragInfo = {
          ids: dragIds,
          startX: e.clientX, startY: e.clientY,
          itemsStartMap: new Map(items.filter(i => dragIds.includes(i.id)).map(i => [i.id, {
            id: i.id, x: i.x, y: i.y,
            x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2,
            elbowX: i.elbowX ?? (i.x1 + i.x2) / 2,
            elbowY: i.elbowY ?? (i.y1 + i.y2) / 2
          }])),
        };
        setDragging(dragInfo);
        draggingRef.current = dragInfo;
      }

      if (action === "resize") {
        e.stopPropagation();
        pushUndo(items);
        const handle = target.dataset.handle || "br";
        setResizing({ id, handle, startX: e.clientX, startY: e.clientY, item: { ...item } });
      }

      if (action === "rotate") {
        e.stopPropagation();
        pushUndo(items);
        const rect = canvasRef.current.getBoundingClientRect();
        const centerX = rect.left + (item.x + item.w / 2) * zoomRef.current + panRef.current.x;
        const centerY = rect.top + (item.y + item.h / 2) * zoomRef.current + panRef.current.y;
        setRotating({ id, centerX, centerY, startAngle: item.rotation || 0, startMouseAngle: Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI });
      }

      e.preventDefault();
    } else {
      if (!e.target.closest("[data-ui]")) {
        setSelectedIds([]);
        setEditingTextId(null);
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
        if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
      }
    }
  };

  const handlePointerMove = useCallback((e) => {
    if (e.pointerType === "touch") return;
    const bs = boxSelectRef.current;
    if (bs) {
      const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const updated = { ...bs, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top };
      boxSelectRef.current = updated;
      setBoxSelect({ ...updated });
      return;
    }
    const drag = draggingRef.current;
    const ec = editingConnectorRef.current;
    const rsz = resizingRef.current;
    const rot = rotatingRef.current;
    const es = effectiveSnapRef.current;
    if (drag) {
      const dx = (e.clientX - drag.startX) / zoomRef.current;
      const dy = (e.clientY - drag.startY) / zoomRef.current;
      dragDeltaRef.current = { dx, dy };
      if (drawBgRef.current) drawBgRef.current();
    } else if (ec) {
      const dx = (e.clientX - ec.startX) / zoomRef.current;
      const dy = (e.clientY - ec.startY) / zoomRef.current;
      const si = ec.startItem;
      let props;
      if (ec.handle === "ep1") {
        props = { x1: snap(si.x1 + dx, es), y1: snap(si.y1 + dy, es) };
      } else if (ec.handle === "ep2") {
        props = { x2: snap(si.x2 + dx, es), y2: snap(si.y2 + dy, es) };
      } else if (ec.handle === "elbow") {
        const newElbowX = snap((si.elbowX ?? (si.x1 + si.x2) / 2) + dx, es);
        const newElbowY = snap((si.elbowY ?? (si.y1 + si.y2) / 2) + dy, es);
        props = { elbowX: newElbowX, elbowY: newElbowY, orientation: computeElbowOrientation(si, newElbowX, newElbowY) };
      }
      if (props) {
        itemOverrideRef.current = { id: ec.id, props };
        if (drawBgRef.current) drawBgRef.current();
      }
    } else if (rsz) {
      const dx = (e.clientX - rsz.startX) / zoomRef.current;
      const dy = (e.clientY - rsz.startY) / zoomRef.current;
      const r = computeResize(rsz.item, rsz.handle, dx, dy, es);
      itemOverrideRef.current = { id: rsz.id, props: { x: r.x, y: r.y, w: r.w, h: r.h } };
      if (drawBgRef.current) drawBgRef.current();
    } else if (rot) {
      const mouseAngle = Math.atan2(e.clientY - rot.centerY, e.clientX - rot.centerX) * 180 / Math.PI;
      const deltaAngle = mouseAngle - rot.startMouseAngle;
      const newAngle = snapAngle(rot.startAngle + deltaAngle, es);
      itemOverrideRef.current = { id: rot.id, props: { rotation: newAngle } };
      if (drawBgRef.current) drawBgRef.current();
    } else if (isPanningRef.current) {
      panRef.current = { x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y };
      applyTransform();
      updateDisplays();
    }
  }, [applyTransform, updateDisplays]);

  const handlePointerUp = useCallback((e) => {
    if (e?.pointerType === "touch") return;
    const bs = boxSelectRef.current;
    if (bs) {
      boxSelectRef.current = null;
      setBoxSelect(null);
      if (canvasRef.current) canvasRef.current.style.cursor = "";
      const z = zoomRef.current;
      const { x: panX, y: panY } = panRef.current;
      const sx1 = Math.min(bs.startX, bs.currentX);
      const sy1 = Math.min(bs.startY, bs.currentY);
      const sx2 = Math.max(bs.startX, bs.currentX);
      const sy2 = Math.max(bs.startY, bs.currentY);
      const wx1 = (sx1 - panX) / z, wy1 = (sy1 - panY) / z;
      const wx2 = (sx2 - panX) / z, wy2 = (sy2 - panY) / z;
      const hitIds = itemsRef.current
        .filter(item => {
          if (item.type === "connector") {
            const bx1 = Math.min(item.x1, item.x2, item.elbowX ?? (item.x1 + item.x2) / 2);
            const by1 = Math.min(item.y1, item.y2);
            const bx2 = Math.max(item.x1, item.x2, item.elbowX ?? (item.x1 + item.x2) / 2);
            const by2 = Math.max(item.y1, item.y2);
            return bx1 < wx2 && bx2 > wx1 && by1 < wy2 && by2 > wy1;
          }
          return item.x < wx2 && item.x + item.w > wx1 && item.y < wy2 && item.y + item.h > wy1;
        })
        .map(i => i.id);
      if (hitIds.length > 0) setSelectedIds(hitIds);
      return;
    }
    // Commit in-flight GPU overrides to React state
    if (draggingRef.current && dragDeltaRef.current) {
      const { dx, dy } = dragDeltaRef.current;
      setItems(p => applyDragDelta(p, draggingRef.current.itemsStartMap, dx, dy, effectiveSnapRef.current));
      dragDeltaRef.current = null;
    }
    if ((resizingRef.current || rotatingRef.current || editingConnectorRef.current) && itemOverrideRef.current) {
      const ov = itemOverrideRef.current;
      setItems(p => p.map(i => i.id === ov.id ? { ...i, ...ov.props } : i));
      itemOverrideRef.current = null;
    }
    if (draggingRef.current || resizingRef.current || rotatingRef.current || editingConnectorRef.current) scheduleSave();
    setDragging(null);
    setResizing(null);
    setRotating(null);
    setEditingConnector(null);
    isPanningRef.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = "";
  }, [scheduleSave, setBoxSelect, setSelectedIds]);

  const handleWheel = useCallback((e) => {
    const isOnCanvas = canvasRef.current?.contains(e.target);
    const drag = draggingRef.current;
    if (!isOnCanvas && !drag) return;

    e.preventDefault();

    if (drag) {
      const delta = e.deltaY < 0 ? -1 : 1;
      setItems(p => {
        const maxZ = Math.max(...p.map(i => i.z));
        const minZ = Math.min(...p.map(i => i.z));
        return p.map(i => {
          if (!drag.ids.includes(i.id)) return i;
          const newZ = Math.max(minZ, Math.min(maxZ + 1, i.z + delta));
          return { ...i, z: newZ };
        });
      });
      scheduleSave();
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const z = zoomRef.current;
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)), r = nz / z;
    const { x: px, y: py } = panRef.current;
    panRef.current = { x: mx - r * (mx - px), y: my - r * (my - py) };
    zoomRef.current = nz;
    applyTransform();
    updateDisplays();
  }, [scheduleSave, applyTransform, updateDisplays]);

  // Register window-level pointer/wheel listeners
  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("wheel", handleWheel);
    };
  }, [handlePointerMove, handlePointerUp, handleWheel]);

  return { handlePointerDown };
}
