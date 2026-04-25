// WebGPU texture cache: loads static images from URLs into GPUTextures.
// LRU eviction with placeholder protection — low-res placeholders are evicted last.
// Videos and GIFs are rendered via DOM overlay (not GPU textures) for iOS compatibility.

const MAX_TEXTURES = 512;

export class TextureCache {
  constructor(device, onTextureReady) {
    this.device = device;
    this.cache = new Map(); // url → { tex, view, width, height, ready, isPlaceholder, lastUsed }
    this.loading = new Set();
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
    // How many entries we're over the soft cap.
    let toEvict = this.cache.size - MAX_TEXTURES;
    if (toEvict <= 0) return;
  
    // Anything touched within this window is considered "in use this frame".
    // Evicting such entries causes a reload → onTextureReady → render → reload
    // thrash loop at zoom levels where the working set exceeds MAX_TEXTURES.
    const now = performance.now();
    const FRAME_WINDOW_MS = 100;
  
    // Sort: non-placeholders before placeholders (placeholders evicted last),
    // then by lastUsed ascending (oldest first).
    const entries = [...this.cache.entries()];
    entries.sort((a, b) => {
      if (a[1].isPlaceholder !== b[1].isPlaceholder) return a[1].isPlaceholder ? 1 : -1;
      return (a[1].lastUsed || 0) - (b[1].lastUsed || 0);
    });
  
    for (let i = 0; i < entries.length && toEvict > 0; i++) {
      const [url, entry] = entries[i];
      // Skip entries referenced in the current render cycle — evicting them
      // would trigger an immediate reload and restart the thrash loop.
      // If every entry is fresh, we soft-overflow past MAX_TEXTURES until
      // some textures genuinely fall out of use.
      if ((entry.lastUsed || 0) > now - FRAME_WINDOW_MS) continue;
      entry.tex.destroy();
      this.cache.delete(url);
      toEvict--;
    }
  }

  get(url, isPlaceholder = false) {
    if (!url) return this.transparent;
    const cached = this.cache.get(url);
    if (cached) {
      cached.lastUsed = performance.now();
      // Once promoted to placeholder, keep the flag — protects the lowest tier
      // regardless of which call path requested it next.
      if (isPlaceholder) cached.isPlaceholder = true;
      return cached;
    }

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
          lastUsed: performance.now(),
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

  getBestReady(candidates, placeholderUrl) {
    let bestEntry = null;
    let bestUrl = null;
    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      if (!url) continue;
      const isFirst = i === 0;
      const isPlaceholder = url === placeholderUrl;
      if (isFirst || isPlaceholder) {
        const entry = this.get(url, isPlaceholder);
        if (!bestEntry && entry.ready && entry !== this.fallback && entry !== this.transparent) {
          bestEntry = entry;
          bestUrl = url;
        }
      } else {
        const cached = this.cache.get(url);
        if (cached) cached.lastUsed = performance.now();
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
