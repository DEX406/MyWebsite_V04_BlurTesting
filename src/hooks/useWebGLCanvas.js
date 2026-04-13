// React hook that creates and manages the WebGPU renderer.
// Replaces the DOM-based content layer with a single GPU-accelerated canvas.

import { useRef, useCallback, useEffect } from 'react';
import { GPURenderer } from '../webgpu/GPURenderer.js';
import { hitTest } from '../webgl/hitTest.js';

export function useWebGLCanvas() {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const rafRef = useRef(0);
  const renderDataRef = useRef(null);
  const initPromiseRef = useRef(null);

  // Async WebGPU initialization
  const initRenderer = useCallback((canvas) => {
    if (!canvas || rendererRef.current || initPromiseRef.current) return;

    initPromiseRef.current = (async () => {
      try {
        if (!navigator.gpu) {
          console.error('WebGPU is not supported in this browser.');
          return;
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          console.error('Failed to get WebGPU adapter.');
          return;
        }
        const device = await adapter.requestDevice();
        const context = canvas.getContext('webgpu');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'premultiplied' });

        const renderer = new GPURenderer(canvas, device, context);
        renderer._onNeedsRedraw = () => {
          const d = renderDataRef.current;
          if (!d) return;
          if (!rafRef.current) {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = 0;
              if (rendererRef.current && renderDataRef.current) {
                rendererRef.current.render(renderDataRef.current);
              }
            });
          }
        };
        rendererRef.current = renderer;

        // If render data arrived while we were initializing, draw now
        if (renderDataRef.current) {
          renderer.render(renderDataRef.current);
        }
      } catch (e) {
        console.error('Failed to create WebGPU renderer:', e);
      }
    })();
  }, []);

  const setCanvasRef = useCallback((el) => {
    canvasRef.current = el;
    if (el) initRenderer(el);
  }, [initRenderer]);

  const requestRender = useCallback((data) => {
    renderDataRef.current = data;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const renderer = rendererRef.current;
        const d = renderDataRef.current;
        if (renderer && d) {
          renderer.render(d);
        }
      });
    }
  }, []);

  const renderSync = useCallback((data) => {
    renderDataRef.current = data;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const renderer = rendererRef.current;
    if (renderer && data) {
      renderer.render(data);
    }
    return renderer?._overlays || [];
  }, []);

  const doHitTest = useCallback((screenX, screenY, items, panX, panY, zoom) => {
    return hitTest(screenX, screenY, items, panX, panY, zoom);
  }, []);

  const invalidateText = useCallback((itemId) => {
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.textRenderer.invalidate(itemId);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, []);

  return {
    setCanvasRef,
    canvasRef,
    rendererRef,
    requestRender,
    renderSync,
    doHitTest,
    invalidateText,
  };
}
