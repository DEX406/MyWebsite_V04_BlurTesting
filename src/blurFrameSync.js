// Drives a single repaint callback whenever the videos/GIFs underneath any
// visible blur overlay actually produce a new frame. Replaces a continuous
// rAF nudge that was running at 60fps regardless of underlying media activity.
//
// - Videos use requestVideoFrameCallback (fires only when the decoder commits
//   a frame; auto-pauses when the video is paused or off-screen).
// - GIFs use ImageDecoder to read per-frame durations and schedule timeouts.
// - When no animated media is under any blur, nothing ticks.
// - Multiple sources firing in the same animation frame coalesce into one
//   repaint via requestAnimationFrame.

const GIF_FALLBACK_INTERVAL_MS = 80; // ~12.5fps if ImageDecoder unavailable
const GIF_MIN_FRAME_MS = 20;         // clamp pathological short frames

export class BlurFrameSync {
  constructor(onRepaint) {
    this.onRepaint = onRepaint;
    this.subs = new Map();   // src -> { cancel }
    this.scheduled = false;
  }

  // sources: Array<{ src, type: 'video'|'gif', el?: HTMLElement }>
  setSources(sources) {
    const seen = new Set();
    for (const s of sources) {
      if (!s || !s.src) continue;
      seen.add(s.src);
      const existing = this.subs.get(s.src);
      // For videos, re-subscribe if the element changed (re-mount).
      if (existing && (s.type !== 'video' || existing.el === s.el)) continue;
      if (existing) existing.cancel?.();
      this._subscribe(s);
    }
    for (const [src, sub] of this.subs) {
      if (!seen.has(src)) {
        sub.cancel?.();
        this.subs.delete(src);
      }
    }
    if (sources.length > 0) this._schedule(); // ensure a paint reflects new state
  }

  destroy() {
    for (const sub of this.subs.values()) sub.cancel?.();
    this.subs.clear();
  }

  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.onRepaint();
    });
  }

  _subscribe({ src, type, el }) {
    if (type === 'video' && el && typeof el.requestVideoFrameCallback === 'function') {
      let active = true;
      const tick = () => {
        if (!active) return;
        this._schedule();
        el.requestVideoFrameCallback(tick);
      };
      el.requestVideoFrameCallback(tick);
      this.subs.set(src, { el, cancel: () => { active = false; } });
      return;
    }

    if (type === 'gif' && typeof ImageDecoder !== 'undefined') {
      const sub = { el, cancelled: false, timer: null };
      sub.cancel = () => {
        sub.cancelled = true;
        if (sub.timer) clearTimeout(sub.timer);
      };
      this.subs.set(src, sub);
      this._driveGifWithDecoder(src, sub).catch(() => this._fallbackInterval(src, sub));
      return;
    }

    // Fallback for unsupported envs
    this._fallbackInterval(src, { cancel: () => {} });
  }

  _fallbackInterval(src, prev) {
    prev.cancel?.();
    const id = setInterval(() => this._schedule(), GIF_FALLBACK_INTERVAL_MS);
    this.subs.set(src, { cancel: () => clearInterval(id) });
  }

  async _driveGifWithDecoder(src, sub) {
    const resp = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!resp.ok) throw new Error('gif fetch failed');
    if (sub.cancelled) return;
    const data = await resp.arrayBuffer();
    if (sub.cancelled) return;

    const decoder = new ImageDecoder({ data, type: 'image/gif' });
    await decoder.tracks.ready;
    if (sub.cancelled) { decoder.close?.(); return; }

    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.frameCount ?? 1;
    const durations = new Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      if (sub.cancelled) { decoder.close?.(); return; }
      const { image } = await decoder.decode({ frameIndex: i });
      const us = image.duration ?? 100000;
      durations[i] = Math.max(GIF_MIN_FRAME_MS, us / 1000);
      image.close();
    }
    decoder.close?.();

    // If GIF is a single static frame, no need to tick at all.
    if (frameCount <= 1) return;

    let i = 0;
    const next = () => {
      if (sub.cancelled) return;
      this._schedule();
      i = (i + 1) % frameCount;
      sub.timer = setTimeout(next, durations[i]);
    };
    sub.timer = setTimeout(next, durations[0]);
  }
}
