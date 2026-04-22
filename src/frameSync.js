// Global frame-pacing coordinator.
//
// Why this exists: the site has multiple render pipelines that each used to
// schedule their own requestAnimationFrame callback (WebGPU canvas, viewport
// transform, CSS backdrop-filter blur recomposite, media frame nudges, …).
// When they fire on different rAFs they tear against each other — the GPU
// canvas updates one frame, the DOM overlay catches up the next. This module
// funnels every "please draw" request into ONE rAF, so all subsystems that
// asked for a frame get serviced together in the same paint.
//
// Two extra knobs on top of the coalescing:
//
//   1. MAX_FRAME_RATE (constants.js) puts a hard ceiling on the cadence.
//      A frame is never fired sooner than 1000 / MAX_FRAME_RATE ms after
//      the previous one finished. Setting this lower throttles the whole
//      site, which is useful on battery / low-end devices.
//
//   2. acquire(token) / release(token) lets any subsystem block the next
//      frame until it is ready (texture upload pending, async asset still
//      decoding, …). While any blocker is held, scheduled draws are
//      deferred, which naturally drops the effective frame rate to match
//      whatever the slowest pipeline can produce.

import { MAX_FRAME_RATE } from './constants.js';

class FrameSync {
  constructor() {
    this.minFrameMs = 1000 / Math.max(1, MAX_FRAME_RATE);
    this.lastFrameTime = 0;
    // channel key -> callback. Each channel fires at most once per frame.
    // Re-scheduling the same channel before the frame fires replaces the
    // callback (latest data wins).
    this.queued = new Map();
    this.rafId = 0;
    this.timerId = 0;
    this.blockers = new Set();
    this.lastDrawDuration = 0;
  }

  // Request a draw on the next allowed frame.
  //
  // `key` is a stable identifier for the subsystem (string / Symbol / fn).
  // Multiple calls with the same key before the frame fires collapse into
  // one — the latest callback wins. Calls with DIFFERENT keys all fire in
  // the same paint, which is the whole point of the coalescing.
  scheduleDraw(key, callback) {
    // Backwards-friendly: scheduleDraw(fn) treats fn as both key and value.
    if (typeof key === 'function' && callback === undefined) {
      callback = key;
      key = callback;
    }
    if (typeof callback !== 'function') return;
    this.queued.set(key, callback);
    this._arm();
  }

  // Mark `token` as not-yet-ready. While any blocker is held, scheduled
  // draws sit in the queue instead of firing. Use a stable string/Symbol
  // per subsystem so release() can match it.
  acquire(token) {
    this.blockers.add(token);
  }

  // Clear a blocker. If a draw was queued while we were blocked it fires
  // on the next available frame.
  release(token) {
    if (!this.blockers.delete(token)) return;
    if (this.queued.size > 0) this._arm();
  }

  isReady() {
    return this.blockers.size === 0;
  }

  // Bypass the queue and run a single draw right now. Used by code paths
  // that need a synchronous return value (WebGPU renderSync returns its
  // overlay list to the caller). The frame timestamp still advances so
  // the throttle stays accurate.
  flushSync(callback) {
    const t0 = performance.now();
    try { callback(); }
    catch (e) { console.error('[frameSync] sync draw failed:', e); }
    const t1 = performance.now();
    this.lastDrawDuration = t1 - t0;
    this.lastFrameTime = t1;
  }

  _arm() {
    if (this.rafId || this.timerId) return;
    if (this.queued.size === 0) return;
    const wait = this.minFrameMs - (performance.now() - this.lastFrameTime);
    if (wait > 1) {
      this.timerId = setTimeout(() => {
        this.timerId = 0;
        this._arm();
      }, wait);
      return;
    }
    this.rafId = requestAnimationFrame(() => this._fire());
  }

  _fire() {
    this.rafId = 0;

    // If a subsystem is still busy, hold the frame. _arm() will be called
    // again from release().
    if (this.blockers.size > 0) return;

    // Snapshot and clear before running so callbacks that reschedule
    // themselves (e.g. animation loops) queue cleanly for the next frame.
    const callbacks = Array.from(this.queued.values());
    this.queued.clear();

    const t0 = performance.now();
    for (const cb of callbacks) {
      try { cb(); }
      catch (e) { console.error('[frameSync] draw failed:', e); }
    }
    const t1 = performance.now();

    // Anchor the throttle on draw END, not start. A 50 ms draw on a 60 fps
    // budget therefore pushes the next frame 16 ms past its end — the rate
    // automatically degrades to whatever the slowest path can sustain.
    this.lastDrawDuration = t1 - t0;
    this.lastFrameTime = t1;

    if (this.queued.size > 0) this._arm();
  }
}

export const frameSync = new FrameSync();

// Channel keys — exported so subsystems share a single namespace and don't
// accidentally collide (or pretend to be the same channel by closure).
export const FRAME_CHANNELS = {
  WEBGPU: 'webgpu',
  WEBGPU_NEEDS_REDRAW: 'webgpu-needs-redraw',
  VIEWPORT: 'viewport',
  BLUR: 'blur',
};

// Expose globally for ad-hoc debugging from the devtools console.
if (typeof window !== 'undefined') {
  window.frameSync = frameSync;
}
