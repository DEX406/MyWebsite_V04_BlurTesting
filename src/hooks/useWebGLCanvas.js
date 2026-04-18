// React hook that owns the render Worker + OffscreenCanvas.
// Main thread keeps: hit-testing, overlay computation, React state.
// Worker owns: WebGPU device, image decode/upload, text rasterization, draw submission.

import { useRef, useCallback, useEffect } from 'react';
import { hitTest } from '../webgl/hitTest.js';
import { computeOverlays } from '../overlays.js';

export function useWebGLCanvas() {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const canvasElRef = useRef(null);
  const readyRef = useRef(false);
  const pendingRenderRef = useRef(null);
  const resizeObsRef = useRef(null);

  const _getDpr = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

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
        if (pendingRenderRef.current) {
          worker.postMessage({ type: 'render', data: pendingRenderRef.current });
          pendingRenderRef.current = null;
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

    // Observe size changes — worker owns canvas.width/height but needs CSS dims from us.
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
  }, []);

  const setCanvasRef = useCallback((el) => {
    canvasRef.current = el;
    if (el) initWorker(el);
  }, [initWorker]);

  const renderSync = useCallback((data) => {
    const worker = workerRef.current;
    const overlays = computeOverlays(data.items, {
      panX: data.panX, panY: data.panY, zoom: data.zoom,
      cssW: canvasElRef.current?.clientWidth || 0,
      cssH: canvasElRef.current?.clientHeight || 0,
      editingTextId: data.editingTextId,
    });
    if (!worker) return overlays;
    if (!readyRef.current) {
      pendingRenderRef.current = data;
      return overlays;
    }
    worker.postMessage({ type: 'render', data });
    return overlays;
  }, []);

  // Alias — main-thread-facing API unchanged.
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
