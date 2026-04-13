// Renders info-pill labels (e.g. "PNG · stored · 1920 × 1080") to GPU textures.
// Each unique text string is cached as a small Canvas2D → GPUTexture.

import { FONT } from '../constants.js';

export class PillRenderer {
  constructor(device) {
    this.device = device;
    this.cache = new Map(); // text → { tex, view, cssWidth, cssHeight }
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  get(text) {
    let entry = this.cache.get(text);
    if (entry) return entry;
    entry = this._render(text);
    this.cache.set(text, entry);
    if (this.cache.size > 100) this._evict();
    return entry;
  }

  _render(text) {
    const scale = 2; // 2× for sharp text
    const ctx = this.ctx;
    const fontSize = 10;
    const padX = 10;
    const padY = 3;
    const font = `${fontSize}px ${FONT}, sans-serif`;

    // Measure text width at 1× to get CSS dimensions
    ctx.font = font;
    const textW = ctx.measureText(text).width;
    const cssW = Math.ceil(textW + padX * 2);
    const cssH = Math.ceil(fontSize + padY * 2 + 2);
    const w = Math.ceil(cssW * scale);
    const h = Math.ceil(cssH * scale);

    this.canvas.width = w;
    this.canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.scale(scale, scale);

    // Pill background
    const radius = cssH / 2;
    ctx.fillStyle = 'rgba(20,20,19,0.85)';
    ctx.beginPath();
    ctx.roundRect(0, 0, cssW, cssH, radius);
    ctx.fill();

    // Subtle border
    ctx.strokeStyle = 'rgba(194,192,182,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, cssW - 1, cssH - 1, Math.max(0, radius - 0.5));
    ctx.stroke();

    // Text
    ctx.font = font;
    ctx.fillStyle = 'rgba(194,192,182,0.55)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, cssW / 2, cssH / 2 + 0.5);

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Upload to GPU
    const tex = this.device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: this.canvas, flipY: false },
      { texture: tex },
      [w, h],
    );

    return { tex, view: tex.createView(), cssWidth: cssW, cssHeight: cssH };
  }

  _evict() {
    const entries = [...this.cache.entries()];
    const toRemove = entries.slice(0, Math.floor(entries.length / 2));
    for (const [key, entry] of toRemove) {
      entry.tex.destroy();
      this.cache.delete(key);
    }
  }

  destroy() {
    for (const entry of this.cache.values()) entry.tex.destroy();
    this.cache.clear();
  }
}
