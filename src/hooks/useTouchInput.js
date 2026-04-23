import { useRef, useCallback, useEffect } from 'react';
import { snap, snapAngle, computeResize, applyDragDelta, computeElbowOrientation } from '../utils.js';
import { RAD_TO_DEG } from '../constants.js';
import { MIN_ZOOM, MAX_ZOOM } from './useViewport.js';

const TAP_THRESHOLD = 10;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 400;

export function useTouchInput({
  vp, loading,
  itemsRef, isAdminRef, selectedIdsRef,
  setItems, setSelectedIds, setEditingTextId,
  setDragging, draggingRef,
  effectiveSnapRef,
  scheduleSave, animateTo, pushUndo,
  multiSelectModeRef, setMultiSelectMode,
  doHitTest, dragDeltaRef, itemOverrideRef,
}) {
  const { panRef, zoomRef, isPanningRef, panStartRef, canvasRef, drawBgRef, applyTransform, updateDisplays } = vp;
  const touchRef = useRef(null);
  const lastTapRef = useRef({ time: 0, itemId: null });
  const longPressTimerRef = useRef(null);

  const redraw = () => { drawBgRef.current?.(); };
  const cancelLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  };
  const groupOrSelf = (itemId) => {
    const it = itemsRef.current.find(i => i.id === itemId);
    return it?.groupId
      ? itemsRef.current.filter(i => i.groupId === it.groupId).map(i => i.id)
      : [itemId];
  };

  const handleTouchStart = useCallback((e) => {
    if (e.target.closest("[data-ui]")) return;
    e.preventDefault();

    if (e.touches.length === 2) {
      // Promote to pinch — clear any in-flight single-finger gesture state
      if (touchRef.current?.type === "single") {
        dragDeltaRef.current = null;
        itemOverrideRef.current = null;
        setDragging(null);
        isPanningRef.current = false;
        cancelLongPress();
      }
      const t0 = e.touches[0], t1 = e.touches[1];
      touchRef.current = {
        type: "pinch",
        startMidX: (t0.clientX + t1.clientX) / 2,
        startMidY: (t0.clientY + t1.clientY) / 2,
        panStartX: panRef.current.x, panStartY: panRef.current.y,
        startDist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
        startZoom: zoomRef.current,
      };
      return;
    }

    if (e.touches.length !== 1 || touchRef.current?.type) return;

    const t = e.touches[0];
    // DOM hit (handles) first, fall back to WebGL hit test
    const dom = document.elementFromPoint(t.clientX, t.clientY)?.closest("[data-item-id]");
    let itemId = dom?.dataset?.itemId || null;
    let action = dom?.dataset?.action || null;
    const domHandle = dom?.dataset?.handle || null;
    if (!itemId && doHitTest) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const hit = doHitTest(t.clientX - rect.left, t.clientY - rect.top, itemsRef.current, panRef.current.x, panRef.current.y, zoomRef.current);
        if (hit) { itemId = hit.id; action = hit.action; }
      }
    }
    touchRef.current = {
      type: "single",
      startX: t.clientX, startY: t.clientY,
      moved: false, itemId, action, domHandle,
    };

    // Long-press → enter multi-select and add item (and group) to selection
    if (isAdminRef.current && itemId && !action) {
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        if (touchRef.current) touchRef.current.longPressFired = true;
        setMultiSelectMode(true);
        const ids = groupOrSelf(itemId);
        setSelectedIds(prev => [...new Set([...prev, ...ids])]);
        navigator.vibrate?.(30);
      }, LONG_PRESS_MS);
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    const tr = touchRef.current;
    if (!tr) return;
    e.preventDefault();

    if (tr.type === "pinch" && e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, tr.startZoom * (dist / tr.startDist)));
      const r = nz / tr.startZoom;
      panRef.current = {
        x: midX - r * (tr.startMidX - tr.panStartX),
        y: midY - r * (tr.startMidY - tr.panStartY),
      };
      zoomRef.current = nz;
      applyTransform();
      updateDisplays();
      return;
    }

    if (tr.type !== "single" || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - tr.startX;
    const dy = t.clientY - tr.startY;

    // First crossing of tap threshold → decide which gesture this is
    if (!tr.moved) {
      if (Math.hypot(dx, dy) < TAP_THRESHOLD) return;
      tr.moved = true;
      cancelLongPress();

      const item = tr.itemId ? itemsRef.current.find(i => i.id === tr.itemId) : null;
      if (item && isAdminRef.current && tr.action === "resize") {
        setSelectedIds([tr.itemId]);
        pushUndo(itemsRef.current);
        tr.gesture = "resize";
        tr.startItem = { ...item };
        tr.resizeHandle = tr.domHandle || "br";
      } else if (item && isAdminRef.current && tr.action === "rotate") {
        setSelectedIds([tr.itemId]);
        pushUndo(itemsRef.current);
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = rect.left + (item.x + item.w / 2) * zoomRef.current + panRef.current.x;
        const cy = rect.top + (item.y + item.h / 2) * zoomRef.current + panRef.current.y;
        tr.gesture = "rotate";
        tr.rotateCenter = { x: cx, y: cy };
        tr.startAngle = item.rotation || 0;
        tr.startMouseAngle = Math.atan2(tr.startY - cy, tr.startX - cx) * RAD_TO_DEG;
      } else if (item && isAdminRef.current && (tr.action === "move-ep1" || tr.action === "move-ep2" || tr.action === "move-elbow")) {
        setSelectedIds([tr.itemId]);
        pushUndo(itemsRef.current);
        tr.gesture = "connector";
        tr.connectorHandle = tr.action.slice(5);
        tr.startItem = { ...item };
      } else if (item && isAdminRef.current && !tr.action) {
        // Drag — if already selected, drag whole selection; else drag group (or just self)
        const alreadySelected = selectedIdsRef.current.includes(tr.itemId);
        const dragIds = alreadySelected ? selectedIdsRef.current : groupOrSelf(tr.itemId);
        if (!alreadySelected) setSelectedIds(dragIds);
        pushUndo(itemsRef.current);
        const dragInfo = {
          ids: dragIds,
          startX: tr.startX, startY: tr.startY,
          itemsStartMap: new Map(itemsRef.current.filter(i => dragIds.includes(i.id)).map(i => [i.id, {
            id: i.id, x: i.x, y: i.y,
            x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2,
            elbowX: i.elbowX ?? (i.x1 + i.x2) / 2,
            elbowY: i.elbowY ?? (i.y1 + i.y2) / 2,
          }])),
        };
        setDragging(dragInfo);
        draggingRef.current = dragInfo;  // sync ref so GPU render path sees it before React commits
        tr.gesture = "drag";
      } else {
        // Pan: viewer mode, empty canvas, or unknown action on an item
        tr.gesture = "pan";
        isPanningRef.current = true;
        panStartRef.current = { x: tr.startX - panRef.current.x, y: tr.startY - panRef.current.y };
      }
    }

    // Continue gesture
    const es = effectiveSnapRef.current;
    const wdx = dx / zoomRef.current;
    const wdy = dy / zoomRef.current;

    if (tr.gesture === "pan") {
      panRef.current = { x: t.clientX - panStartRef.current.x, y: t.clientY - panStartRef.current.y };
      applyTransform();
      updateDisplays();
    } else if (tr.gesture === "drag") {
      // Bypass React state — update ref and render WebGPU directly for zero-latency touch
      dragDeltaRef.current = { dx: wdx, dy: wdy };
      redraw();
    } else if (tr.gesture === "resize") {
      const r = computeResize(tr.startItem, tr.resizeHandle, wdx, wdy, es);
      itemOverrideRef.current = { id: tr.startItem.id, props: { x: r.x, y: r.y, w: r.w, h: r.h } };
      redraw();
    } else if (tr.gesture === "rotate") {
      const { x: cx, y: cy } = tr.rotateCenter;
      const mouseAngle = Math.atan2(t.clientY - cy, t.clientX - cx) * RAD_TO_DEG;
      const newAngle = snapAngle(tr.startAngle + (mouseAngle - tr.startMouseAngle), es);
      itemOverrideRef.current = { id: tr.itemId, props: { rotation: newAngle } };
      redraw();
    } else if (tr.gesture === "connector") {
      const si = tr.startItem;
      let props;
      if (tr.connectorHandle === "ep1") {
        props = { x1: snap(si.x1 + wdx, es), y1: snap(si.y1 + wdy, es) };
      } else if (tr.connectorHandle === "ep2") {
        props = { x2: snap(si.x2 + wdx, es), y2: snap(si.y2 + wdy, es) };
      } else {
        const ex = snap((si.elbowX ?? (si.x1 + si.x2) / 2) + wdx, es);
        const ey = snap((si.elbowY ?? (si.y1 + si.y2) / 2) + wdy, es);
        props = { elbowX: ex, elbowY: ey, orientation: computeElbowOrientation(si, ex, ey) };
      }
      itemOverrideRef.current = { id: si.id, props };
      redraw();
    }
  }, [applyTransform, updateDisplays]);

  const handleTouchEnd = useCallback((e) => {
    const tr = touchRef.current;
    if (!tr) return;
    cancelLongPress();

    if (tr.type === "pinch") {
      if (e.touches.length < 2) {
        updateDisplays();
        touchRef.current = null;
      }
      return;
    }

    if (tr.type !== "single" || e.touches.length !== 0) return;
    touchRef.current = null;

    if (tr.gesture === "drag") {
      const delta = dragDeltaRef.current;
      const drag = draggingRef.current;
      if (delta && drag) setItems(p => applyDragDelta(p, drag.itemsStartMap, delta.dx, delta.dy, effectiveSnapRef.current));
      dragDeltaRef.current = null;
      setDragging(null);
      scheduleSave();
      return;
    }
    if (tr.gesture === "pan") {
      isPanningRef.current = false;
      return;
    }
    if (tr.gesture === "resize" || tr.gesture === "rotate" || tr.gesture === "connector") {
      const ov = itemOverrideRef.current;
      if (ov) {
        setItems(p => p.map(i => i.id === ov.id ? { ...i, ...ov.props } : i));
        itemOverrideRef.current = null;
      }
      scheduleSave();
      return;
    }

    // Tap (long-press, if it fired, already updated state)
    if (tr.moved || tr.longPressFired) return;
    const item = tr.itemId ? itemsRef.current.find(i => i.id === tr.itemId) : null;

    if (!item) {
      setSelectedIds([]);
      setEditingTextId(null);
      if (multiSelectModeRef.current) setMultiSelectMode(false);
      return;
    }
    if (!isAdminRef.current) {
      if (item.type === "link") {
        if (item.teleportPan) animateTo(item.teleportPan, item.teleportZoom ?? 1);
        else if (item.url && item.url !== "https://") window.open(item.url, "_blank", "noopener");
      }
      return;
    }
    if (multiSelectModeRef.current) {
      setSelectedIds(prev => prev.includes(tr.itemId) ? prev.filter(x => x !== tr.itemId) : [...prev, tr.itemId]);
      return;
    }
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.itemId === tr.itemId && now - last.time < DOUBLE_TAP_MS && item.type === "text") {
      setEditingTextId(tr.itemId);
    } else {
      setSelectedIds(groupOrSelf(tr.itemId));
    }
    lastTapRef.current = { time: now, itemId: tr.itemId };
  }, [scheduleSave]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const opts = { passive: false };
    canvas.addEventListener("touchstart", handleTouchStart, opts);
    canvas.addEventListener("touchmove", handleTouchMove, opts);
    canvas.addEventListener("touchend", handleTouchEnd, opts);
    return () => {
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
    };
  }, [loading, handleTouchStart, handleTouchMove, handleTouchEnd]);
}