// Render worker — owns the WebGPU device, the OffscreenCanvas, and every
// texture upload. Main thread posts render commands; worker draws.
// Eliminates main-thread stalls from image decode/upload and large GPU command
// submission.

import { GPURenderer } from './GPURenderer.js';
import { loadWorkerFonts } from './workerFonts.js';

let renderer = null;
let canvas = null;
let device = null;
let format = null;

// lastData persists so async texture-ready callbacks can re-render with it.
let lastData = null;
let rafId = 0;

function scheduleRender() {
  if (rafId || !renderer || !lastData) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (renderer && lastData) renderer.render(lastData);
  });
}

async function init({ canvas: offscreen, dpr, cssW, cssH }) {
  if (!navigator.gpu) {
    postMessage({ type: 'error', message: 'WebGPU not supported in worker' });
    return;
  }
  canvas = offscreen;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    postMessage({ type: 'error', message: 'No WebGPU adapter' });
    return;
  }
  device = await adapter.requestDevice();
  format = navigator.gpu.getPreferredCanvasFormat();
  const context = canvas.getContext('webgpu');
  context.configure({ device, format, alphaMode: 'premultiplied' });

  renderer = new GPURenderer(canvas, device, context, format);
  renderer._onNeedsRedraw = () => scheduleRender();
  renderer.setSize(cssW, cssH, dpr);

  // Fonts load asynchronously; invalidate text cache once they arrive so
  // glyph textures get re-rasterized with the correct faces.
  loadWorkerFonts().then(() => {
    if (renderer) {
      renderer.textRenderer.invalidateAll();
      scheduleRender();
    }
  });

  postMessage({ type: 'ready' });
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'init':
      await init(msg);
      break;

    case 'setSize':
      if (renderer) {
        renderer.setSize(msg.cssW, msg.cssH, msg.dpr);
        scheduleRender();
      }
      break;

    case 'render':
      lastData = msg.data;
      if (renderer) {
        // Render immediately — main already rAF-throttles; extra rAF here would add latency.
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        renderer.render(lastData);
      }
      break;

    case 'invalidateText':
      if (renderer) renderer.textRenderer.invalidate(msg.itemId);
      break;

    case 'invalidateAllText':
      if (renderer) renderer.textRenderer.invalidateAll();
      break;

    case 'destroy':
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      lastData = null;
      if (renderer) renderer.destroy();
      renderer = null;
      device = null;
      canvas = null;
      break;
  }
};
