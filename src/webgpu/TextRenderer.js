// Renders text items to offscreen Canvas2D alpha-mask textures (GPUTexture).
// Only the glyph shape is baked in; color and background are shader uniforms.
// Caches based on properties that affect glyph shape only.

import { TEXT_PAD_X, TEXT_PAD_Y, TEXT_LINE_HEIGHT, TEXT_DEFAULT_SIZE, FONT } from '../constants.js';

export class TextRenderer {
  constructor(device) {
    this.device = device;
    this.cache = new Map();    // key → { tex, view, width, height, lastUsed }
    this.itemKeys = new Map(); // itemId → current cache key
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  _key(item) {
    return `${item.id}|${item.type}|${item.text}|${item.fontSize}|${item.fontFamily}|${item.bold}|${item.italic}|${item.align}|${item.w}|${item.h}`;
  }

  get(item) {
    const key = this._key(item);

    const prevKey = this.itemKeys.get(item.id);
    if (prevKey && prevKey !== key) {
      const old = this.cache.get(prevKey);
      if (old) {
        old.tex.destroy();
        this.cache.delete(prevKey);
      }
    }

    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsed = performance.now();
      this.itemKeys.set(item.id, key);
      return cached;
    }

    const entry = this._render(item);
    entry.lastUsed = performance.now();
    this.cache.set(key, entry);
    this.itemKeys.set(item.id, key);

    if (this.cache.size > 200) this._evict();
    return entry;
  }

  _render(item) { // Scale is set here
    const device = this.device;
    const scale = 0.5 + (window.devicePixelRatio || 1);
    const w = Math.ceil(item.w * scale);
    const h = Math.ceil(item.h * scale);

    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);
    ctx.scale(scale, scale);

    if (item.text) {
      const fontSize = item.fontSize || TEXT_DEFAULT_SIZE;
      const fontFamily = item.fontFamily || FONT;

      ctx.font = `${item.italic ? 'italic' : 'normal'} ${item.bold ? 'bold' : 'normal'} ${fontSize}px ${fontFamily}`;
      ctx.fillStyle = 'white';
      ctx.textBaseline = 'top';
      ctx.textAlign = item.align || 'left';

      const maxWidth = item.w - TEXT_PAD_X * 2;
      const lines = this._wrapText(ctx, item.text, maxWidth);
      const lineHeight = fontSize * TEXT_LINE_HEIGHT;
      const halfLeading = (lineHeight - fontSize) / 2;

      let x;
      if (item.align === 'center') x = item.w / 2;
      else if (item.align === 'right') x = item.w - TEXT_PAD_X;
      else x = TEXT_PAD_X;

      let startY = TEXT_PAD_Y + halfLeading;
      if (item.type === 'link') {
        startY = (item.h - lines.length * lineHeight) / 2 + halfLeading;
      }

      for (let i = 0; i < lines.length; i++) {
        const y = startY + i * lineHeight;
        if (y + lineHeight > item.h) break;
        ctx.fillText(lines[i], x, y);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Upload canvas to GPUTexture
    const tex = device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: this.canvas, flipY: false },
      { texture: tex },
      [w, h],
    );

    return { tex, view: tex.createView(), width: w, height: h };
  }

  _wrapText(ctx, text, maxWidth) {
    const lines = [];
    for (const para of text.split('\n')) {
      if (!para) { lines.push(''); continue; }
      let lineStart = 0;
      let lastBreakAfter = -1;
      for (let i = 0; i < para.length; i++) {
        const ch = para[i];
        if (ch === ' ' || ch === '\t') lastBreakAfter = i + 1;
        const segment = para.slice(lineStart, i + 1);
        const trimmedWidth = ctx.measureText(segment.trimEnd()).width;
        if (trimmedWidth > maxWidth && i > lineStart) {
          if (lastBreakAfter > lineStart) {
            lines.push(para.slice(lineStart, lastBreakAfter).trimEnd());
            lineStart = lastBreakAfter;
          } else {
            lines.push(para.slice(lineStart, i));
            lineStart = i;
          }
          lastBreakAfter = -1;
          i = lineStart - 1;
        }
      }
      const remaining = para.slice(lineStart);
      lines.push(remaining.trimEnd() || remaining);
    }
    return lines.length ? lines : [''];
  }

  _evict() {
    const entries = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const toRemove = entries.slice(0, 50);
    for (const [key, entry] of toRemove) {
      entry.tex.destroy();
      this.cache.delete(key);
    }
  }

  invalidate(itemId) {
    const key = this.itemKeys.get(itemId);
    if (key) {
      const entry = this.cache.get(key);
      if (entry) {
        entry.tex.destroy();
        this.cache.delete(key);
      }
      this.itemKeys.delete(itemId);
    }
  }

  invalidateAll() {
    for (const entry of this.cache.values()) entry.tex.destroy();
    this.cache.clear();
    this.itemKeys.clear();
  }

  destroy() {
    for (const entry of this.cache.values()) entry.tex.destroy();
    this.cache.clear();
    this.itemKeys.clear();
  }
}
