// Drives a single repaint callback whenever the videos/GIFs underneath any
// visible blur overlay actually produce a new frame. Replaces a continuous
// rAF nudge that was running at 60fps regardless of underlying media activity.
//
// - Videos use requestVideoFrameCallback, which fires during the rendering
//   steps of the frame that will display the new video frame. We invoke the
//   repaint callback SYNCHRONOUSLY from rVFC so the blur nudge (opacity
//   toggle, etc.) applies in the same paint as the new video pixels — if we
//   went through rAF first we'd be one paint late and the blurred half of a
//   video would always lag its uncovered half by one frame.
// - GIFs use ImageDecoder to read per-frame durations and schedule timeouts,
//   then route through the global frameSync since they have no equivalent
//   of rVFC's "before paint" hook.
// - When no animated media is under any blur, nothing ticks.
// - Multiple videos firing rVFC in the same paint coalesce to one repaint
//   via _rvfcCoalesced (otherwise two toggles in one paint would cancel out).

import { frameSync, FRAME_CHANNELS } from './frameSync.js';

const GIF_FALLBACK_INTERVAL_MS = 80; // ~12.5fps if ImageDecoder unavailable
const GIF_MIN_FRAME_MS = 20;         // clamp pathological short frames

export class BlurFrameSync {
  constructor(onRepaint) {
    this.onRepaint = onRepaint;
    this.subs = new Map();   // src -> { cancel }
    this.scheduled = false;
    this._rvfcCoalesced = false; // true = already nudged this paint
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

  // GIF / fallback path: route through the global frame sync so blur
  // recomposites coalesce with other draws and obey MAX_FRAME_RATE.
  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    frameSync.scheduleDraw(FRAME_CHANNELS.BLUR, () => {
      this.scheduled = false;
      this.onRepaint();
    });
  }

  // Video path: nudge synchronously in the rendering steps of the same
  // paint that will show the new video frame. Coalesce across multiple
  // videos so two rVFCs in one paint don't toggle the opacity twice (which
  // would leave the compositor with no net change and skip the re-sample).
  _nudgeSync() {
    if (this._rvfcCoalesced) return;
    this._rvfcCoalesced = true;
    this.onRepaint();
    // Reset after the paint we just nudged has flushed, so the FIRST rVFC
    // in the next paint is the one that toggles.
    requestAnimationFrame(() => { this._rvfcCoalesced = false; });
  }

  _subscribe({ src, type, el }) {
    if (type === 'video' && el && typeof el.requestVideoFrameCallback === 'function') {
      let active = true;
      const tick = () => {
        if (!active) return;
        this._nudgeSync();
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
