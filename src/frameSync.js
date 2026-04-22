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
//      The throttle is rAF-skip based: on a display faster than MAX, we let
//      rAFs pass through until enough wall time has elapsed. Using rAF (not
//      setTimeout) keeps every paint aligned to a vsync boundary, which
//      matters because setTimeout-scheduled paints that land between vsyncs
//      get flagged as dropped frames by Chrome's rendering stats overlay.
//
//   2. acquire(token) / release(token) lets any subsystem block the next
//      frame until it is ready (texture upload pending, async asset still
//      decoding, …). While any blocker is held, scheduled draws are
//      deferred, which naturally drops the effective frame rate to match
//      whatever the slowest pipeline can produce.

import { MAX_FRAME_RATE } from './constants.js';

class FrameSync {
  constructor() {
    // A half-frame slop accounts for jitter in rAF timestamps — without it a
    // 60 Hz target on a 60 Hz display would drop every other frame because
    // the "now - last" measurement is occasionally 16.1 ms instead of 16.7.
    this.minFrameMs = (1000 / Math.max(1, MAX_FRAME_RATE)) - (1000 / 120);
    this.lastFrameTime = 0;
    // channel key -> callback. Each channel fires at most once per frame.
    // Re-scheduling the same channel before the frame fires replaces the
    // callback (latest data wins).
    this.queued = new Map();
    this.rafId = 0;
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

  // Run a single draw immediately, outside the queue. Used by code paths
  // that need a synchronous return value (WebGPU renderSync returns its
  // overlay list to the caller in the same tick). Does NOT update the
  // throttle timestamp — otherwise every synchronous draw would delay the
  // next queued frame and the cap would degrade far below MAX_FRAME_RATE.
  flushSync(callback) {
    try { callback(); }
    catch (e) { console.error('[frameSync] sync draw failed:', e); }
  }

  _arm() {
    if (this.rafId) return;
    if (this.queued.size === 0) return;
    this.rafId = requestAnimationFrame((now) => this._tick(now));
  }

  _tick(now) {
    this.rafId = 0;

    // If a subsystem is still busy, hold the frame. release() will re-arm.
    if (this.blockers.size > 0) return;

    // rAF-skip throttle: if MAX_FRAME_RATE hasn't elapsed since the last
    // paint we fired, wait for the NEXT rAF instead of firing now. No
    // setTimeout — that goes off-vsync and Chromium marks the resulting
    // paint as janky.
    if (this.lastFrameTime > 0 && (now - this.lastFrameTime) < this.minFrameMs) {
      if (this.queued.size > 0) {
        this.rafId = requestAnimationFrame((t) => this._tick(t));
      }
      return;
    }

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
    // budget therefore pushes the next frame a full budget past its end —
    // the rate automatically degrades to what the slowest path can sustain.
    this.lastDrawDuration = t1 - t0;
    this.lastFrameTime = t1;

    if (this.queued.size > 0) {
      this.rafId = requestAnimationFrame((t) => this._tick(t));
    }
  }
}

export const frameSync = new FrameSync();

// Channel keys — exported so subsystems share a single namespace and don't
// accidentally collide (or pretend to be the same channel by closure).
export const FRAME_CHANNELS = {
  WEBGPU: 'webgpu',
  WEBGPU_NEEDS_REDRAW: 'webgpu-needs-redraw',
  VIEWPORT: 'viewport',
  VIEWPORT_ANIM: 'viewport-anim',
  BLUR: 'blur',
  APP_STATE: 'app-state',
  APP_FLASH: 'app-flash',
  APP_RESIZE: 'app-resize',
};

// Expose globally for ad-hoc debugging from the devtools console.
if (typeof window !== 'undefined') {
  window.frameSync = frameSync;
}
