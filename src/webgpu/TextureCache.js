// WebGPU texture cache: loads static images from URLs into GPUTextures.
// Supports FIFO eviction with placeholder protection — low-res placeholders are evicted last.
// Videos and GIFs are rendered via DOM overlay (not GPU textures) for iOS compatibility.

const MAX_TEXTURES = 200;

export class TextureCache {
  constructor(device, onTextureReady) {
    this.device = device;
    this.cache = new Map(); // url → { tex, view, width, height, ready, isPlaceholder, insertOrder }
    this.loading = new Set();
    this.insertCounter = 0;
    this._onTextureReady = onTextureReady || null;

    // Samplers (shared across all textures)
    this.nearestSampler = device.createSampler({
      minFilter: 'nearest',
      magFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.linearSampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // 1x1 fallback textures
    this.fallback = this._create1x1([0, 0, 0, 0]);
    this.transparent = this._create1x1([0, 0, 0, 0]);
  }

  _create1x1(rgba) {
    const tex = this.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: tex },
      new Uint8Array(rgba),
      { bytesPerRow: 4 },
      [1, 1],
    );
    return { tex, view: tex.createView(), width: 1, height: 1, ready: true };
  }

  _createFromSource(source, w, h) {
    const tex = this.device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: tex },
      [w, h],
    );
    return tex;
  }

  isReady(url) {
    if (!url) return false;
    const entry = this.cache.get(url);
    return !!(entry && entry.ready);
  }

  _evict() {
    if (this.cache.size <= MAX_TEXTURES) return;
    const entries = [...this.cache.entries()]
      .map(([url, entry]) => ({ url, ...entry }))
      .sort((a, b) => a.insertOrder - b.insertOrder);
    const nonPlaceholders = entries.filter(e => !e.isPlaceholder);
    const placeholders = entries.filter(e => e.isPlaceholder);
    const evictOrder = [...nonPlaceholders, ...placeholders];
    const toEvict = this.cache.size - MAX_TEXTURES;
    for (let i = 0; i < toEvict && i < evictOrder.length; i++) {
      const e = evictOrder[i];
      e.tex.destroy();
      this.cache.delete(e.url);
    }
  }

  get(url, pixelated = false, isPlaceholder = false) {
    if (!url) return this.transparent;
    const cached = this.cache.get(url);
    if (cached) return cached;

    if (!this.loading.has(url)) {
      this.loading.add(url);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.loading.delete(url);
        const tex = this._createFromSource(img, img.naturalWidth, img.naturalHeight);
        const entry = {
          tex,
          view: tex.createView(),
          width: img.naturalWidth,
          height: img.naturalHeight,
          ready: true,
          isPlaceholder,
          insertOrder: this.insertCounter++,
        };
        this.cache.set(url, entry);
        this._evict();
        if (this._onTextureReady) this._onTextureReady();
      };
      img.onerror = () => { this.loading.delete(url); };
      img.src = url;
    }

    return this.fallback;
  }

  getBestReady(candidates, pixelated = false) {
    let bestEntry = null;
    let bestUrl = null;
    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      if (!url) continue;
      const isFirst = i === 0;
      const isLast = i === candidates.length - 1;
      if (isFirst || isLast) {
        const entry = this.get(url, pixelated, isLast);
        if (!bestEntry && entry.ready && entry !== this.fallback && entry !== this.transparent) {
          bestEntry = entry;
          bestUrl = url;
        }
      } else {
        const cached = this.cache.get(url);
        if (!bestEntry && cached && cached.ready) {
          bestEntry = cached;
          bestUrl = url;
        }
      }
    }
    return bestEntry ? { entry: bestEntry, url: bestUrl } : { entry: this.fallback, url: null };
  }

  // Compute UV crop rect for object-fit: cover (pure math — no GPU calls)
  coverUV(texW, texH, itemW, itemH) {
    if (!texW || !texH || !itemW || !itemH) return [0, 0, 1, 1];
    const texAspect = texW / texH;
    const itemAspect = itemW / itemH;
    if (texAspect > itemAspect) {
      const scale = itemAspect / texAspect;
      const offset = (1 - scale) / 2;
      return [offset, 0, scale, 1];
    } else {
      const scale = texAspect / itemAspect;
      const offset = (1 - scale) / 2;
      return [0, offset, 1, scale];
    }
  }

  destroy() {
    for (const entry of this.cache.values()) entry.tex.destroy();
    this.fallback.tex.destroy();
    this.transparent.tex.destroy();
    this.cache.clear();
  }
}
