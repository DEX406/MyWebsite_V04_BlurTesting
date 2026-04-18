import { useRef, useCallback, useEffect } from 'react';
import { snap, snapAngle, computeResize, applyDragDelta, computeElbowOrientation } from '../utils.js';
import { RAD_TO_DEG, TOUCH_PAN_SMOOTH_TAU_MS, TOUCH_DRAG_SMOOTH_TAU_MS } from '../constants.js';
import { MIN_ZOOM, MAX_ZOOM } from './useViewport.js';

const TOUCH_TAP_THRESHOLD = 10;
// Clamp smoothing dt so a paused tab / long GC pause doesn't snap the view
// in a single enormous step when rAF resumes.
const SMOOTH_MAX_DT_MS = 50;
// Stop the smoothing loop once we're within this distance of target (sub-pixel)
// to avoid burning rAFs on imperceptible residuals.
const SMOOTH_EPSILON = 0.05;

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

  // rAF-coalesced input: touchmove handlers capture the latest touch snapshot
  // then a single rAF callback applies the gesture once per frame. This prevents
  // iOS touch-event coalescing from producing uneven per-frame position updates.
  const rafIdRef = useRef(0);
  const pendingTouchesRef = useRef(null);

  // Delta-time smoothing for pan/drag: touchmove writes a target position, a
  // continuous rAF loop integrates toward it with exp(-dt/tau). This decouples
  // rendered displacement from irregular frame pacing under heavy load.
  const smoothRafRef = useRef(0);
  const smoothLastTimeRef = useRef(0);
  const targetPanRef = useRef({ x: 0, y: 0 });
  const targetDragRef = useRef({ dx: 0, dy: 0 });

  const handleTouchStart = useCallback((e) => {
    if (e.target.closest("[data-ui]")) return;
    e.preventDefault();

    if (e.touches.length === 2) {
      if (touchRef.current?.type === "single") {
        // Clear any in-flight GPU overrides before cancelling gesture
        dragDeltaRef.current = null;
        itemOverrideRef.current = null;
        setDragging(null);
        isPanningRef.current = false;
      }
      const t0 = e.touches[0], t1 = e.touches[1];
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      touchRef.current = {
        type: "pinch",
        startMidX: midX, startMidY: midY,
        panStartX: panRef.current.x, panStartY: panRef.current.y,
        startDist: dist, startZoom: zoomRef.current,
      };
      return;
    }

    if (e.touches.length === 1 && !touchRef.current?.type) {
      const t = e.touches[0];
      // Try DOM hit first (for handles), then WebGL hit test
      const target = document.elementFromPoint(t.clientX, t.clientY)?.closest("[data-item-id]");
      let itemId = target?.dataset?.itemId || null;
      let action = target?.dataset?.action || null;
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
        moved: false,
        itemId,
        action,
      };

      // Start long-press timer to enter multi-select mode
      if (isAdminRef.current && itemId && !target?.dataset?.action) {
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          if (touchRef.current) touchRef.current.longPressFired = true;
          setMultiSelectMode(true);
          // Add the item and all its group members to selection
          const pressedItem = itemsRef.current.find(i => i.id === itemId);
          const groupIds = pressedItem?.groupId
            ? itemsRef.current.filter(i => i.groupId === pressedItem.groupId).map(i => i.id)
            : [itemId];
          setSelectedIds(prev => {
            const set = new Set(prev);
            groupIds.forEach(id => set.add(id));
            return [...set];
          });
          if (navigator.vibrate) navigator.vibrate(30);
        }, 500);
      }
    }
  }, []);

  // Exponential-smoothing loop for pan/drag. Runs every rAF during those gestures
  // and integrates rendered position toward the touch target with exp(-dt/tau).
  // Decouples rendered displacement from irregular frame pacing under heavy load,
  // which is what produces the same-axis "fast shake" during fast motion.
  const smoothStep = useCallback((now) => {
    smoothRafRef.current = 0;
    if (!touchRef.current) return;
    const gesture = touchRef.current.gesture;
    if (gesture !== "pan" && gesture !== "drag") return;

    const prev = smoothLastTimeRef.current;
    smoothLastTimeRef.current = now;
    const dt = prev === 0 ? 0 : Math.min(now - prev, SMOOTH_MAX_DT_MS);

    if (gesture === "pan") {
      const tau = TOUCH_PAN_SMOOTH_TAU_MS;
      const alpha = dt === 0 ? 0 : (tau > 0 ? 1 - Math.exp(-dt / tau) : 1);
      const tgt = targetPanRef.current;
      const cur = panRef.current;
      const nx = cur.x + (tgt.x - cur.x) * alpha;
      const ny = cur.y + (tgt.y - cur.y) * alpha;
      panRef.current = { x: nx, y: ny };
      applyTransform();
      updateDisplays();
      const err = Math.hypot(tgt.x - nx, tgt.y - ny);
      if (err > SMOOTH_EPSILON || dt === 0) {
        smoothRafRef.current = requestAnimationFrame(smoothStep);
      }
    } else {
      const tau = TOUCH_DRAG_SMOOTH_TAU_MS;
      const alpha = dt === 0 ? 0 : (tau > 0 ? 1 - Math.exp(-dt / tau) : 1);
      const tgt = targetDragRef.current;
      const cur = dragDeltaRef.current || { dx: 0, dy: 0 };
      const ndx = cur.dx + (tgt.dx - cur.dx) * alpha;
      const ndy = cur.dy + (tgt.dy - cur.dy) * alpha;
      dragDeltaRef.current = { dx: ndx, dy: ndy };
      if (drawBgRef.current) drawBgRef.current();
      const err = Math.hypot(tgt.dx - ndx, tgt.dy - ndy);
      if (err > SMOOTH_EPSILON || dt === 0) {
        smoothRafRef.current = requestAnimationFrame(smoothStep);
      }
    }
  }, [applyTransform, updateDisplays]);

  const scheduleSmooth = useCallback(() => {
    if (smoothRafRef.current) return;
    smoothLastTimeRef.current = 0; // first step establishes baseline (dt=0, no position change)
    smoothRafRef.current = requestAnimationFrame(smoothStep);
  }, [smoothStep]);

  const stopSmooth = useCallback(() => {
    if (smoothRafRef.current) {
      cancelAnimationFrame(smoothRafRef.current);
      smoothRafRef.current = 0;
    }
    smoothLastTimeRef.current = 0;
  }, []);

  // Applies the latest snapshotted touch positions to the active gesture.
  // Runs inside rAF so multiple touchmove events per frame collapse into one render.
  // For pan/drag this only writes the smoothing target; the smoothing loop renders.
  // For pinch/resize/rotate/connector it applies directly (those gestures need
  // precise, unlagged response).
  const flushTouchFrame = useCallback(() => {
    rafIdRef.current = 0;
    const snap = pendingTouchesRef.current;
    pendingTouchesRef.current = null;
    if (!snap || !touchRef.current) return;

    if (touchRef.current.type === "pinch" && snap.length === 2) {
      const t0 = snap[0], t1 = snap[1];
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const { startMidX, startMidY, panStartX, panStartY, startDist, startZoom } = touchRef.current;

      const factor = dist / startDist;
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * factor));
      const r = nz / startZoom;

      const newPanX = midX - startMidX + startMidX - r * (startMidX - panStartX);
      const newPanY = midY - startMidY + startMidY - r * (startMidY - panStartY);
      panRef.current = { x: newPanX, y: newPanY };
      zoomRef.current = nz;
      applyTransform();
      updateDisplays();
      return;
    }

    if (touchRef.current.type === "single" && snap.length === 1 && touchRef.current.moved) {
      const t = snap[0];
      const gesture = touchRef.current.gesture;
      const es = effectiveSnapRef.current;
      if (gesture === "pan") {
        targetPanRef.current = { x: t.clientX - panStartRef.current.x, y: t.clientY - panStartRef.current.y };
        scheduleSmooth();
      } else if (gesture === "drag") {
        const ddx = (t.clientX - touchRef.current.startX) / zoomRef.current;
        const ddy = (t.clientY - touchRef.current.startY) / zoomRef.current;
        targetDragRef.current = { dx: ddx, dy: ddy };
        scheduleSmooth();
      } else if (gesture === "resize") {
        const ddx = (t.clientX - touchRef.current.startX) / zoomRef.current;
        const ddy = (t.clientY - touchRef.current.startY) / zoomRef.current;
        const si = touchRef.current.startItem;
        const handle = touchRef.current.resizeHandle || "br";
        const r = computeResize(si, handle, ddx, ddy, es);
        itemOverrideRef.current = { id: si.id, props: { x: r.x, y: r.y, w: r.w, h: r.h } };
        if (drawBgRef.current) drawBgRef.current();
      } else if (gesture === "rotate") {
        const { x: cx, y: cy } = touchRef.current.rotateCenter;
        const mouseAngle = Math.atan2(t.clientY - cy, t.clientX - cx) * RAD_TO_DEG;
        const deltaAngle = mouseAngle - touchRef.current.startMouseAngle;
        const newAngle = snapAngle(touchRef.current.startAngle + deltaAngle, es);
        const itemId = touchRef.current.itemId;
        itemOverrideRef.current = { id: itemId, props: { rotation: newAngle } };
        if (drawBgRef.current) drawBgRef.current();
      } else if (gesture === "connector") {
        const ddx = (t.clientX - touchRef.current.startX) / zoomRef.current;
        const ddy = (t.clientY - touchRef.current.startY) / zoomRef.current;
        const si = touchRef.current.startItem;
        const handle = touchRef.current.connectorHandle;
        let props;
        if (handle === "ep1") {
          props = { x1: snap(si.x1 + ddx, es), y1: snap(si.y1 + ddy, es) };
        } else if (handle === "ep2") {
          props = { x2: snap(si.x2 + ddx, es), y2: snap(si.y2 + ddy, es) };
        } else if (handle === "elbow") {
          const newElbowX = snap((si.elbowX ?? (si.x1 + si.x2) / 2) + ddx, es);
          const newElbowY = snap((si.elbowY ?? (si.y1 + si.y2) / 2) + ddy, es);
          props = { elbowX: newElbowX, elbowY: newElbowY, orientation: computeElbowOrientation(si, newElbowX, newElbowY) };
        }
        if (props) {
          itemOverrideRef.current = { id: si.id, props };
          if (drawBgRef.current) drawBgRef.current();
        }
      }
    }
  }, [applyTransform, updateDisplays, scheduleSmooth]);

  const snapshotTouches = (e) => {
    const out = [];
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      out.push({ clientX: t.clientX, clientY: t.clientY });
    }
    return out;
  };

  const scheduleTouchFrame = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(flushTouchFrame);
  }, [flushTouchFrame]);

  const handleTouchMove = useCallback((e) => {
    if (!touchRef.current) return;
    e.preventDefault();

    if (touchRef.current.type === "pinch" && e.touches.length === 2) {
      pendingTouchesRef.current = snapshotTouches(e);
      scheduleTouchFrame();
      return;
    }

    if (touchRef.current.type === "single" && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - touchRef.current.startX;
      const dy = t.clientY - touchRef.current.startY;

      if (!touchRef.current.moved) {
        if (Math.hypot(dx, dy) < TOUCH_TAP_THRESHOLD) return;
        touchRef.current.moved = true;
        // Cancel long-press since we're moving
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        // Crossed threshold — start the appropriate gesture
        const itemId = touchRef.current.itemId;
        const action = touchRef.current.action;
        const item = itemId ? itemsRef.current.find(i => i.id === itemId) : null;

        if (item && isAdminRef.current) {
          if (action === "resize") {
            setSelectedIds([itemId]);
            pushUndo(itemsRef.current);
            touchRef.current.gesture = "resize";
            touchRef.current.resizeHandle = document.elementFromPoint(touchRef.current.startX, touchRef.current.startY)?.closest("[data-handle]")?.dataset?.handle || "br";
            touchRef.current.startItem = { ...item };
          } else if (action === "rotate") {
            setSelectedIds([itemId]);
            pushUndo(itemsRef.current);
            const rect = canvasRef.current.getBoundingClientRect();
            const centerX = rect.left + (item.x + item.w / 2) * zoomRef.current + panRef.current.x;
            const centerY = rect.top + (item.y + item.h / 2) * zoomRef.current + panRef.current.y;
            touchRef.current.gesture = "rotate";
            touchRef.current.rotateCenter = { x: centerX, y: centerY };
            touchRef.current.startAngle = item.rotation || 0;
            touchRef.current.startMouseAngle = Math.atan2(touchRef.current.startY - centerY, touchRef.current.startX - centerX) * RAD_TO_DEG;
          } else if (action === "move-ep1" || action === "move-ep2" || action === "move-elbow") {
            setSelectedIds([itemId]);
            pushUndo(itemsRef.current);
            touchRef.current.gesture = "connector";
            touchRef.current.connectorHandle = action.replace("move-", "");
            touchRef.current.startItem = { ...item };
          } else if (!action) {
            // Drag item(s) — if touched item is already selected, drag all selected items
            const alreadySelected = selectedIdsRef.current.includes(itemId);
            const dragIds = alreadySelected
              ? selectedIdsRef.current
              : (item.groupId ? itemsRef.current.filter(i => i.groupId === item.groupId).map(i => i.id) : [itemId]);
            if (!alreadySelected) setSelectedIds(dragIds);
            pushUndo(itemsRef.current);
            const dragInfo = {
              ids: dragIds,
              startX: touchRef.current.startX, startY: touchRef.current.startY,
              itemsStartMap: new Map(itemsRef.current.filter(i => dragIds.includes(i.id)).map(i => [i.id, {
                id: i.id, x: i.x, y: i.y,
                x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2,
                elbowX: i.elbowX ?? (i.x1 + i.x2) / 2, elbowY: i.elbowY ?? (i.y1 + i.y2) / 2
              }])),
            };
            setDragging(dragInfo);
            draggingRef.current = dragInfo;  // sync ref so GPU render has it immediately
            touchRef.current.gesture = "drag";
            // Seed smoothing state so the loop starts at (0,0) with no initial jump.
            targetDragRef.current = { dx: 0, dy: 0 };
            dragDeltaRef.current = { dx: 0, dy: 0 };
          } else {
            // Unknown action — pan
            isPanningRef.current = true;
            panStartRef.current = { x: touchRef.current.startX - panRef.current.x, y: touchRef.current.startY - panRef.current.y };
            touchRef.current.gesture = "pan";
            targetPanRef.current = { x: panRef.current.x, y: panRef.current.y };
          }
        } else {
          // Not admin or no item — pan canvas
          isPanningRef.current = true;
          panStartRef.current = { x: touchRef.current.startX - panRef.current.x, y: touchRef.current.startY - panRef.current.y };
          touchRef.current.gesture = "pan";
          targetPanRef.current = { x: panRef.current.x, y: panRef.current.y };
        }
      }

      // Snapshot the latest touch positions and defer gesture application to rAF.
      pendingTouchesRef.current = snapshotTouches(e);
      scheduleTouchFrame();
    }
  }, [scheduleTouchFrame]);

  const handleTouchEnd = useCallback((e) => {
    if (!touchRef.current) return;

    // Flush any pending rAF-coalesced frame so the final touch position is applied
    // before we commit gesture results to React state.
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    if (pendingTouchesRef.current) flushTouchFrame();

    // Stop smoothing loop; release commits use the target (finger's last position)
    // so the item/pan lands exactly where the finger was rather than where the
    // smoother had integrated to.
    stopSmooth();

    // Always cancel any pending long-press
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (touchRef.current.type === "pinch") {
      if (e.touches.length < 2) {
        updateDisplays();
        touchRef.current = null;
      }
      return;
    }

    if (touchRef.current.type === "single" && e.touches.length === 0) {
      const ref = touchRef.current;
      touchRef.current = null;

      if (ref.gesture === "drag") {
        // Commit the target delta (where the finger actually ended), not the
        // partially-smoothed one.
        const delta = targetDragRef.current;
        const drag = draggingRef.current;
        if (delta && drag) {
          setItems(p => applyDragDelta(p, drag.itemsStartMap, delta.dx, delta.dy, effectiveSnapRef.current));
        }
        dragDeltaRef.current = null;
        setDragging(null);
        scheduleSave();
        return;
      }
      if (ref.gesture === "pan") {
        // Snap to target so the view doesn't appear "behind" the finger after release.
        panRef.current = { ...targetPanRef.current };
        applyTransform();
        updateDisplays();
        isPanningRef.current = false;
        return;
      }
      if (ref.gesture === "resize" || ref.gesture === "rotate" || ref.gesture === "connector") {
        // Commit final override to React state
        const ov = itemOverrideRef.current;
        if (ov) {
          setItems(p => p.map(i => i.id === ov.id ? { ...i, ...ov.props } : i));
          itemOverrideRef.current = null;
        }
        scheduleSave();
        return;
      }

      // No gesture started — this was a tap (or long-press that already fired)
      if (!ref.moved && !ref.longPressFired) {
        const itemId = ref.itemId;
        const item = itemId ? itemsRef.current.find(i => i.id === itemId) : null;

        if (item) {
          if (!isAdminRef.current) {
            // Viewer: activate links/teleports
            if (item.type === "link") {
              if (item.teleportPan) animateTo(item.teleportPan, item.teleportZoom ?? 1);
              else if (item.url && item.url !== "https://") window.open(item.url, "_blank", "noopener");
            }
          } else {
            if (multiSelectModeRef.current) {
              // Multi-select mode: toggle this item's selection
              setSelectedIds(prev => prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]);
            } else {
              // Normal mode: check for double-tap to edit text
              const now = Date.now();
              const last = lastTapRef.current;
              if (last.itemId === itemId && now - last.time < 400 && (item.type === "text")) {
                setEditingTextId(itemId);
              } else {
                // Select the item and all its group members (consistent with desktop)
                const tapIds = item.groupId
                  ? itemsRef.current.filter(i => i.groupId === item.groupId).map(i => i.id)
                  : [itemId];
                setSelectedIds(tapIds);
              }
              lastTapRef.current = { time: now, itemId };
            }
          }
        } else {
          // Tap on empty canvas — deselect and exit multi-select mode
          setSelectedIds([]);
          setEditingTextId(null);
          if (multiSelectModeRef.current) setMultiSelectMode(false);
        }
      }
    }
  }, [scheduleSave, flushTouchFrame, stopSmooth, applyTransform, updateDisplays]);

  // Register touch listeners on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      if (smoothRafRef.current) {
        cancelAnimationFrame(smoothRafRef.current);
        smoothRafRef.current = 0;
      }
      pendingTouchesRef.current = null;
    };
  }, [loading, handleTouchStart, handleTouchMove, handleTouchEnd]);
}
