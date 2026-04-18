// React hook that owns the render Worker + OffscreenCanvas.
// Main thread keeps: hit-testing, React state, DOM overlay sync, text-edit UI.
// Worker owns: WebGPU device, image decode/upload, text rasterization, draw submission.

import { useRef, useCallback, useEffect } from 'react';
import { hitTest } from '../webgl/hitTest.js';
import { computeOverlays } from '../overlays.js';

/**
 * @param {{ syncOverlays?: (overlays, panX, panY, zoom) => void }} opts
 */
export function useWebGLCanvas({ syncOverlays } = {}) {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const canvasElRef = useRef(null);
  const readyRef = useRef(false);
  const resizeObsRef = useRef(null);

  // Coalesce: every renderSync call updates pendingRef; a single rAF drains it,
  // so DOM overlay updates and the worker post happen in the same task and
  // commit together on iOS where main/worker compositing desyncs otherwise.
  const pendingRef = useRef(null);
  const rafRef = useRef(0);
  const syncRef = useRef(syncOverlays || null);
  syncRef.current = syncOverlays || null;

  const _getDpr = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

  const _flush = useCallback(() => {
    rafRef.current = 0;
    const data = pendingRef.current;
    pendingRef.current = null;
    if (!data) return;

    const overlays = computeOverlays(data.items, {
      panX: data.panX, panY: data.panY, zoom: data.zoom,
      cssW: canvasElRef.current?.clientWidth || 0,
      cssH: canvasElRef.current?.clientHeight || 0,
      editingTextId: data.editingTextId,
    });
    if (syncRef.current) syncRef.current(overlays, data.panX, data.panY, data.zoom);

    if (readyRef.current && workerRef.current) {
      workerRef.current.postMessage({ type: 'render', data });
    }
  }, []);

  const initWorker = useCallback((canvas) => {
    if (!canvas || workerRef.current) return;
    canvasElRef.current = canvas;

    if (typeof canvas.transferControlToOffscreen !== 'function') {
      console.error('OffscreenCanvas not supported.');
      return;
    }

    const offscreen = canvas.transferControlToOffscreen();
    const worker = new Worker(new URL('../webgpu/renderWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'ready') {
        readyRef.current = true;
        // Kick a render if one is pending.
        if (pendingRef.current && !rafRef.current) {
          rafRef.current = requestAnimationFrame(_flush);
        }
      } else if (msg.type === 'error') {
        console.error('[renderWorker]', msg.message);
      }
    };

    const parent = canvas.parentElement;
    const cssW = parent?.clientWidth || canvas.clientWidth || 0;
    const cssH = parent?.clientHeight || canvas.clientHeight || 0;
    const dpr = _getDpr();
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    worker.postMessage({ type: 'init', canvas: offscreen, dpr, cssW, cssH }, [offscreen]);

    if (parent && typeof ResizeObserver !== 'undefined') {
      const obs = new ResizeObserver(() => {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        worker.postMessage({ type: 'setSize', cssW: w, cssH: h, dpr: _getDpr() });
      });
      obs.observe(parent);
      resizeObsRef.current = obs;
    }
  }, [_flush]);

  const setCanvasRef = useCallback((el) => {
    canvasRef.current = el;
    if (el) initWorker(el);
  }, [initWorker]);

  // renderSync now coalesces to the next rAF so DOM overlay sync + worker post
  // commit in the same browser frame.
  const renderSync = useCallback((data) => {
    pendingRef.current = data;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(_flush);
    }
  }, [_flush]);

  const requestRender = renderSync;

  const doHitTest = useCallback((screenX, screenY, items, panX, panY, zoom) => {
    return hitTest(screenX, screenY, items, panX, panY, zoom);
  }, []);

  const invalidateText = useCallback((itemId) => {
    workerRef.current?.postMessage({ type: 'invalidateText', itemId });
  }, []);

  const invalidateAllText = useCallback(() => {
    workerRef.current?.postMessage({ type: 'invalidateAllText' });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (resizeObsRef.current) resizeObsRef.current.disconnect();
      const worker = workerRef.current;
      if (worker) {
        worker.postMessage({ type: 'destroy' });
        worker.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  return {
    setCanvasRef,
    canvasRef,
    requestRender,
    renderSync,
    doHitTest,
    invalidateText,
    invalidateAllText,
  };
}
