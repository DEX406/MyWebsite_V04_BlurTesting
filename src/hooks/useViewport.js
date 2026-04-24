import { useRef, useCallback } from 'react';

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 4;

export function useViewport() {
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const homeViewRef = useRef(null);

  const canvasRef = useRef(null);
  const canvasHandlesRef = useRef(null);
  const drawBgRef = useRef(null);  // triggers WebGL render

  // Cached canvas CSS size, written by a ResizeObserver in App.
  // Avoids getBoundingClientRect() reads in the pan/zoom hot path.
  const canvasSizeRef = useRef({ width: 0, height: 0 });

  const posDisplayRef = useRef(null);
  const zoomDisplayRef = useRef(null);

  // Settled callback — fires when zoom/pan animation ends or user stops interacting
  const settledTimerRef = useRef(null);
  const onSettledRef = useRef(null);

  const scheduleSettled = useCallback((delay = 150) => {
    if (settledTimerRef.current) clearTimeout(settledTimerRef.current);
    settledTimerRef.current = setTimeout(() => {
      interactingRef.current = false;
      if (zoomRef.current > 1) {
        if (canvasHandlesRef.current) canvasHandlesRef.current.style.willChange = '';
      }
      if (onSettledRef.current) onSettledRef.current();
    }, delay);
  }, []);

  // rAF coalescing — multiple applyTransform calls per frame collapse into one paint
  const rafIdRef = useRef(0);
  const displaysDirtyRef = useRef(false);
  const interactingRef = useRef(false);

  const applyTransformNow = useCallback(() => {
    rafIdRef.current = 0;
    const { x, y } = panRef.current;
    const z = zoomRef.current;
    if (!interactingRef.current) {
      interactingRef.current = true;
      if (canvasHandlesRef.current) canvasHandlesRef.current.style.willChange = 'transform';
    }
    if (canvasHandlesRef.current) {
      canvasHandlesRef.current.style.transform = `translate(${x}px,${y}px) scale(${z})`;
      canvasHandlesRef.current.style.setProperty('--inv-zoom', `${1 / z}`);
    }
    if (drawBgRef.current) drawBgRef.current();
    if (displaysDirtyRef.current) {
      displaysDirtyRef.current = false;
      updateDisplaysNow();
    }
    scheduleSettled();
  }, [scheduleSettled]);

  const applyTransform = useCallback(() => {
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(applyTransformNow);
    }
  }, [applyTransformNow]);

  // Flush pending rAF immediately — used by animateTo which already runs inside rAF
  const applyTransformSync = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    applyTransformNow();
  }, [applyTransformNow]);

  // Read cached canvas size, falling back to a one-time layout read if the
  // ResizeObserver has not populated it yet (initial mount).
  const getCanvasSize = useCallback(() => {
    const s = canvasSizeRef.current;
    if (s.width > 0 && s.height > 0) return s;
    if (!canvasRef.current) return s;
    const r = canvasRef.current.getBoundingClientRect();
    canvasSizeRef.current = { width: r.width, height: r.height };
    return canvasSizeRef.current;
  }, []);

  const updateDisplaysNow = useCallback(() => {
    if (!canvasRef.current) return;
    const { width, height } = getCanvasSize();
    const z = zoomRef.current;
    const cx = Math.round((-panRef.current.x + width / 2) / z);
    const cy = Math.round((-panRef.current.y + height / 2) / z);
    if (posDisplayRef.current) posDisplayRef.current.textContent = `X ${cx}\nY ${cy}`;
    if (zoomDisplayRef.current) zoomDisplayRef.current.textContent = `${Math.round(z * 100)}%`;
  }, [getCanvasSize]);

  const updateDisplays = useCallback(() => {
    displaysDirtyRef.current = true;
    // Will be flushed by the next applyTransform rAF, or schedule our own if needed
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(applyTransformNow);
    }
  }, [applyTransformNow]);

  const viewCenter = useCallback(() => {
    if (!canvasRef.current) return { x: 300, y: 300 };
    const { width, height } = getCanvasSize();
    return { x: (-panRef.current.x + width / 2) / zoomRef.current, y: (-panRef.current.y + height / 2) / zoomRef.current };
  }, [getCanvasSize]);

  const zoomTo = useCallback((nz) => {
    nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nz));
    if (!canvasRef.current) return;
    const { width, height } = getCanvasSize();
    const cx = width / 2, cy = height / 2;
    const r = nz / zoomRef.current;
    const { x: px, y: py } = panRef.current;
    panRef.current = { x: cx - r * (cx - px), y: cy - r * (cy - py) };
    zoomRef.current = nz;
    applyTransform();
    updateDisplays();
  }, [applyTransform, updateDisplays, getCanvasSize]);

  const animateTo = useCallback((targetPan, targetZoom, duration = 700) => {
    const startPan = { ...panRef.current };
    const startZoom = zoomRef.current;
    const startTime = performance.now();
    const ease = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const frame = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const e = ease(t);
      panRef.current = { x: startPan.x + (targetPan.x - startPan.x) * e, y: startPan.y + (targetPan.y - startPan.y) * e };
      zoomRef.current = startZoom + (targetZoom - startZoom) * e;
      applyTransformSync();
      updateDisplaysNow();
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, [applyTransformSync, updateDisplaysNow]);

  const goHome = useCallback(() => {
    if (!canvasRef.current) return;
    const { width, height } = getCanvasSize();
    const home = homeViewRef.current;
    if (!home) {
      // Default: center on origin at 100%
      animateTo({ x: width / 2, y: height / 2 }, 1);
      return;
    }
    const targetPan = { x: width / 2 - home.x * home.zoom, y: height / 2 - home.y * home.zoom };
    animateTo(targetPan, home.zoom);
  }, [animateTo, getCanvasSize]);

  const setHome = useCallback(() => {
    const center = viewCenter();
    homeViewRef.current = { x: center.x, y: center.y, zoom: zoomRef.current };
    return homeViewRef.current;
  }, [viewCenter]);

  // Returns the visible rectangle in world (canvas) coordinates
  const getViewportBounds = useCallback(() => {
    if (!canvasRef.current) return { left: 0, top: 0, right: 1920, bottom: 1080 };
    const { width, height } = getCanvasSize();
    const z = zoomRef.current;
    const { x: px, y: py } = panRef.current;
    return {
      left: -px / z,
      top: -py / z,
      right: (-px + width) / z,
      bottom: (-py + height) / z,
    };
  }, [getCanvasSize]);

  return {
    panRef, zoomRef, isPanningRef, panStartRef, homeViewRef,
    canvasRef, canvasHandlesRef, drawBgRef,
    canvasSizeRef,
    posDisplayRef, zoomDisplayRef,
    applyTransform, updateDisplays, viewCenter, zoomTo, animateTo, goHome, setHome,
    getViewportBounds, onSettledRef,
  };
}
