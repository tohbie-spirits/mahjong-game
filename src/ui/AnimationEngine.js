/**
 * AnimationEngine.js — Task 103: the animation foundation for the UI layer.
 *
 * A small service over the Web Animations API (element.animate). Game logic
 * never waits on it (the plan's core / decorative-shell separation): every
 * call returns a Promise that ALWAYS resolves — never rejects — so UI code can
 * `await` an animation without being able to break the game loop.
 *
 *   const engine = new AnimationEngine({ enabled, durationScale, win });
 *   await engine.play(el, 'pop-in');                 // a named preset
 *   await engine.play(el, 'fade-out', { duration: 120 });
 *   await engine.fly(el, fromRect);                  // FLIP: from a rect to where el is now
 *   await engine.sequence([() => a(), () => b()]);   // one after another
 *   await engine.parallel([() => a(), () => b()]);   // together
 *   engine.cancelAll(); await engine.whenIdle();
 *   engine.cancelWithin(overlayEl);                  // Task 106: just what's inside one element
 *
 * RESULTS — play / fly resolve to { finished: true } when the animation ran,
 * { skipped: true, reason } when nothing was animated ('disabled', 'reduced-
 * motion', 'unsupported', 'zero-duration', 'no-movement', 'error'), or
 * { cancelled: true } when it was cancelled (cancelAll, or a newer animation
 * on the same element — one animation per element at a time by default;
 * `{ replace: false }` lets them overlap).
 *
 * TURNING IT OFF — `enabled` (the Settings menu's Animations toggle; main.js
 * keeps it in sync via setEnabled) and the OS "reduce motion" preference
 * (prefers-reduced-motion, watched live) both make every call resolve at
 * once without touching the element. `durationScale` multiplies every
 * duration (0 = off; tests and the browser smoke speed things up with it).
 *
 * PRESETS — fade-in, fade-out, pop-in, pop-out, pulse, shake, slide-up,
 * highlight; add more with defineAnimation(name, { keyframes, duration,
 * easing, fill }) where keyframes is an array or (el, options) → array.
 * Tasks 104–107 build the discard / draw / win / hover effects on these.
 *
 * THROTTLING (Task 119) — nothing animates while the page is hidden (another
 * tab, a minimised window): calls resolve { skipped: true, reason: 'hidden' }
 * and whatever was running is finished when the page hides, so a backlog
 * never replays on return and nothing waits on animations nobody can see.
 * At most `maxConcurrent` animations (default 24) run at once; beyond that a
 * call resolves { skipped: true, reason: 'busy' } — a burst (a fast AI
 * sequence, many tiles highlighted) degrades to fewer effects, never to a
 * slower game.
 *
 * Everything browser-specific is injectable (`win` for matchMedia and
 * getComputedStyle) so the engine is unit-tested in Node with fake elements.
 */

const PRESETS = new Map();

/**
 * Registers a named animation.
 * @param {string} name
 * @param {{ keyframes: Object[]|function(Element, Object): Object[], duration?: number, easing?: string, fill?: string }} spec
 */
export function defineAnimation(name, spec) {
  if (typeof name !== 'string' || !name) throw new TypeError('[AnimationEngine] defineAnimation needs a name.');
  if (!spec || (typeof spec.keyframes !== 'function' && !Array.isArray(spec.keyframes))) throw new TypeError(`[AnimationEngine] animation "${name}" needs keyframes (array or function).`);
  if (spec.duration !== undefined && !(Number.isFinite(spec.duration) && spec.duration >= 0)) throw new TypeError(`[AnimationEngine] animation "${name}": duration must be ≥ 0.`);
  PRESETS.set(name, Object.freeze({ duration: 200, easing: 'ease-out', fill: 'none', ...spec }));
}

/** Names of every registered animation. */
export function getAnimationNames() { return [...PRESETS.keys()]; }

// Built-in presets.
defineAnimation('fade-in', { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 180 });
defineAnimation('fade-out', { keyframes: [{ opacity: 1 }, { opacity: 0 }], duration: 160, easing: 'ease-in', fill: 'forwards' });
defineAnimation('pop-in', { keyframes: [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'scale(1.02)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' }], duration: 220 });
defineAnimation('pop-out', { keyframes: [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.94)' }], duration: 150, easing: 'ease-in', fill: 'forwards' });
defineAnimation('slide-up', { keyframes: (el, o) => [{ opacity: 0, transform: `translateY(${o.distance ?? 12}px)` }, { opacity: 1, transform: 'translateY(0)' }], duration: 200 });
defineAnimation('pulse', { keyframes: [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], duration: 320, easing: 'ease-in-out' });
defineAnimation('shake', { keyframes: [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], duration: 260, easing: 'linear' });
defineAnimation('highlight', { keyframes: [{ boxShadow: '0 0 0 0 rgba(224,184,79,0)' }, { boxShadow: '0 0 0 4px rgba(224,184,79,0.65)', offset: 0.4 }, { boxShadow: '0 0 0 0 rgba(224,184,79,0)' }], duration: 600, easing: 'ease-out' });

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export class AnimationEngine {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.enabled=true]          the user's Animations setting
   * @param {number} [options.durationScale=1]       multiplies every duration (0 = off)
   * @param {boolean} [options.respectReducedMotion=true]
   * @param {Object} [options.win]                   window-like (matchMedia); defaults to globalThis.window
   */
  constructor({ enabled = true, durationScale = 1, respectReducedMotion = true, win, maxConcurrent = 24, pauseWhenHidden = true } = {}) {
    if (typeof enabled !== 'boolean') throw new TypeError('[AnimationEngine] enabled must be a boolean.');
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new TypeError('[AnimationEngine] maxConcurrent must be a positive integer.');
    this._maxConcurrent = maxConcurrent;
    this._stats = { started: 0, hidden: 0, busy: 0 };
    this.setDurationScale(durationScale);
    this._enabled = enabled;
    this._win = win ?? (typeof window !== 'undefined' ? window : null);
    this._active = new Set();          // running records
    this._byElement = new WeakMap();   // element → its current record
    this._idleWaiters = [];
    this._reducedMotion = false;
    this._mql = null;
    if (respectReducedMotion && this._win && typeof this._win.matchMedia === 'function') {
      try {
        this._mql = this._win.matchMedia(REDUCED_MOTION_QUERY);
        this._reducedMotion = !!this._mql.matches;
        this._onMotionChange = (e) => { this._reducedMotion = !!e.matches; if (this._reducedMotion) this.cancelAll(); };
        if (typeof this._mql.addEventListener === 'function') this._mql.addEventListener('change', this._onMotionChange);
        else if (typeof this._mql.addListener === 'function') this._mql.addListener(this._onMotionChange);
      } catch { this._mql = null; }
    }
    // Task 119: hidden page → no animations, and the running ones finish now.
    this._doc = pauseWhenHidden ? (this._win?.document ?? null) : null;
    if (this._doc && typeof this._doc.addEventListener === 'function') {
      this._onVisibility = () => { if (this._doc.hidden) this.cancelAll(); };
      this._doc.addEventListener('visibilitychange', this._onVisibility);
    }
  }

  /** Task 119: { started, hidden, busy } — animations run, and skipped because hidden / over the cap. */
  getStats() { return { ...this._stats }; }
  getMaxConcurrent() { return this._maxConcurrent; }

  // ── State ────────────────────────────────────────────────────────────────
  isEnabled() { return this._enabled; }
  prefersReducedMotion() { return this._reducedMotion; }
  /** True when calls will actually animate. */
  isActive() { return this._enabled && !this._reducedMotion && this._scale > 0; }
  getDurationScale() { return this._scale; }
  getActiveCount() { return this._active.size; }

  /** The Settings toggle. Turning animations off finishes anything running. */
  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('[AnimationEngine] setEnabled needs a boolean.');
    this._enabled = enabled;
    if (!enabled) this.cancelAll();
  }

  setDurationScale(scale) {
    if (!Number.isFinite(scale) || scale < 0) throw new RangeError('[AnimationEngine] durationScale must be a number ≥ 0.');
    this._scale = scale;
  }

  /**
   * Keeps `enabled` in sync with a SettingsManager-like object (get(key)).
   * Call again after the setting changes (main.js does it in onSettingChange).
   */
  syncWithSettings(settings, key = 'animationsEnabled') {
    if (!settings || typeof settings.get !== 'function') throw new TypeError('[AnimationEngine] syncWithSettings needs a settings manager.');
    const v = settings.get(key);
    this.setEnabled(v !== false);
  }

  // ── Playing ──────────────────────────────────────────────────────────────
  /**
   * Plays a named animation (or an inline { keyframes, duration, easing }).
   * @param {Element} el
   * @param {string|Object} animation
   * @param {{ duration?: number, delay?: number, easing?: string, fill?: string, replace?: boolean }} [options]
   * @returns {Promise<{finished?: true, skipped?: true, cancelled?: true, reason?: string}>}
   */
  play(el, animation, options = {}) {
    const spec = typeof animation === 'string' ? PRESETS.get(animation) : animation;
    if (!spec) throw new RangeError(`[AnimationEngine] unknown animation "${animation}".`);
    if (!el || typeof el !== 'object') throw new TypeError('[AnimationEngine] play needs an element.');
    let keyframes;
    try {
      keyframes = typeof spec.keyframes === 'function' ? spec.keyframes(el, options) : spec.keyframes;
    } catch {
      return Promise.resolve({ skipped: true, reason: 'error' });
    }
    return this._run(el, keyframes, {
      duration: options.duration ?? spec.duration ?? 200,
      delay: options.delay ?? 0,
      easing: options.easing ?? spec.easing ?? 'ease-out',
      fill: options.fill ?? spec.fill ?? 'none',
    }, options.replace !== false);
  }

  /**
   * FLIP: animates `el` from `fromRect` (where it appeared to be — e.g. a
   * tile's old position) to where it is laid out now.
   * @param {Element} el
   * @param {{left: number, top: number, width: number, height: number}} fromRect
   * @param {{ duration?: number, delay?: number, easing?: string, scale?: boolean, fill?: string }} [options]
   *   fill 'backwards' (Task 104) holds the element at fromRect during the delay,
   *   so a delayed flight never flashes the element at its final place first.
   */
  fly(el, fromRect, options = {}) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return Promise.resolve({ skipped: true, reason: 'unsupported' });
    if (!fromRect || !['left', 'top', 'width', 'height'].every((k) => Number.isFinite(fromRect[k]))) throw new TypeError('[AnimationEngine] fly needs a fromRect { left, top, width, height }.');
    let to;
    try { to = el.getBoundingClientRect(); } catch { return Promise.resolve({ skipped: true, reason: 'error' }); }
    const dx = fromRect.left - to.left;
    const dy = fromRect.top - to.top;
    const sx = options.scale !== false && to.width > 0 ? fromRect.width / to.width : 1;
    const sy = options.scale !== false && to.height > 0 ? fromRect.height / to.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return Promise.resolve({ skipped: true, reason: 'no-movement' });
    const keyframes = [
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: 'top left', transform: 'translate(0, 0) scale(1, 1)' },
    ];
    return this._run(el, keyframes, { duration: options.duration ?? 260, delay: options.delay ?? 0, easing: options.easing ?? 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: options.fill ?? 'none' }, options.replace !== false);
  }

  /** Runs async steps one after another. Each step is a function returning a promise (or anything). */
  sequence(steps) {
    if (!Array.isArray(steps)) throw new TypeError('[AnimationEngine] sequence needs an array of functions.');
    return (async () => {
      const out = [];
      for (const step of steps) out.push(await this._safe(step));
      return out;
    })();
  }

  /** Runs async steps together; resolves when all have settled. */
  parallel(steps) {
    if (!Array.isArray(steps)) throw new TypeError('[AnimationEngine] parallel needs an array of functions.');
    return Promise.all(steps.map((s) => this._safe(s)));
  }

  /** Cancels every running animation (screen changes, pause, setting off). */
  cancelAll() {
    for (const r of [...this._active]) this._cancel(r);
  }

  /** Cancels the animation running on one element, if any. */
  cancel(el) {
    const r = el && this._byElement.get(el);
    if (r) this._cancel(r);
  }

  /**
   * Task 106: cancels every running animation on `root` or inside it (an
   * overlay card being dismissed — its staged reveal must not keep the table
   * waiting in whenIdle()).
   * @returns {number} how many were cancelled
   */
  cancelWithin(root) {
    if (!root) return 0;
    let n = 0;
    for (const r of [...this._active]) {
      const inside = r.el === root || (typeof root.contains === 'function' && root.contains(r.el));
      if (inside) { this._cancel(r); n++; }
    }
    return n;
  }

  /** Resolves once nothing is animating. */
  whenIdle() {
    if (this._active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this._idleWaiters.push(resolve));
  }

  /** Stops watching the reduced-motion preference and cancels everything. */
  destroy() {
    this.cancelAll();
    if (this._mql && this._onMotionChange) {
      if (typeof this._mql.removeEventListener === 'function') this._mql.removeEventListener('change', this._onMotionChange);
      else if (typeof this._mql.removeListener === 'function') this._mql.removeListener(this._onMotionChange);
    }
    this._mql = null;
    if (this._doc && this._onVisibility) this._doc.removeEventListener?.('visibilitychange', this._onVisibility);
    this._doc = null;
  }

  // ── Internals ────────────────────────────────────────────────────────────
  /** @private */
  _run(el, keyframes, timing, replace) {
    if (!this._enabled) return Promise.resolve({ skipped: true, reason: 'disabled' });
    if (this._reducedMotion) return Promise.resolve({ skipped: true, reason: 'reduced-motion' });
    const duration = timing.duration * this._scale;
    if (!(duration > 0)) return Promise.resolve({ skipped: true, reason: 'zero-duration' });
    if (typeof el.animate !== 'function') return Promise.resolve({ skipped: true, reason: 'unsupported' });
    if (this._doc?.hidden === true) { this._stats.hidden++; return Promise.resolve({ skipped: true, reason: 'hidden' }); }
    if (replace) this.cancel(el);
    if (this._active.size >= this._maxConcurrent) { this._stats.busy++; return Promise.resolve({ skipped: true, reason: 'busy' }); }
    this._stats.started++;
    let anim;
    try {
      anim = el.animate(keyframes, { duration, delay: timing.delay * this._scale, easing: timing.easing, fill: timing.fill });
    } catch {
      return Promise.resolve({ skipped: true, reason: 'error' });
    }
    return new Promise((resolve) => {
      const record = { el, anim, resolve, done: false };
      this._active.add(record);
      this._byElement.set(el, record);
      el.classList?.add?.('is-animating');
      const finish = (result) => this._settle(record, result);
      const finished = anim && anim.finished && typeof anim.finished.then === 'function' ? anim.finished : null;
      if (finished) finished.then(() => finish({ finished: true }), () => finish({ cancelled: true }));
      else if (anim && 'onfinish' in anim) { anim.onfinish = () => finish({ finished: true }); anim.oncancel = () => finish({ cancelled: true }); }
      else finish({ finished: true });
    });
  }

  /** @private */
  _cancel(record) {
    try { record.anim?.cancel?.(); } catch { /* ignore */ }
    this._settle(record, { cancelled: true });
  }

  /** @private */
  _settle(record, result) {
    if (record.done) return;
    record.done = true;
    this._active.delete(record);
    if (this._byElement.get(record.el) === record) {
      this._byElement.delete(record.el);
      record.el.classList?.remove?.('is-animating');
    }
    record.resolve(result);
    if (this._active.size === 0) {
      const waiters = this._idleWaiters.splice(0);
      for (const w of waiters) w();
    }
  }

  /** @private — a step that can never reject. */
  async _safe(step) {
    try { return await (typeof step === 'function' ? step() : step); } catch (error) { return { skipped: true, reason: 'error', error }; }
  }
}
