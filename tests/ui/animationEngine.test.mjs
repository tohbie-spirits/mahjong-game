/**
 * animationEngine.test.mjs — Task 103: src/ui/AnimationEngine.js.
 *
 * Fake elements stand in for the DOM: el.animate() returns a controllable
 * fake Animation (finished promise, cancel()), and a fake matchMedia drives
 * prefers-reduced-motion.
 *
 * Sections:
 *   1. Presets — built-ins, defineAnimation validation, keyframe functions
 *   2. Playing — timing passed through, results, is-animating class
 *   3. Turning it off — the setting, reduced motion (live), durationScale,
 *      no Web Animations support, errors never escape
 *   4. Cancelling — one animation per element, cancelAll, whenIdle
 *   5. FLIP — fly() deltas, no-movement, bad input
 *   6. Sequencing — sequence / parallel order, failures contained
 *   7. Settings — syncWithSettings, destroy
 *
 * Run: node tests/ui/animationEngine.test.mjs
 */
import { section, sectionAsync, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { AnimationEngine, defineAnimation, getAnimationNames } from '../../src/ui/AnimationEngine.js';

class FakeAnimation {
  constructor(keyframes, timing) {
    this.keyframes = keyframes; this.timing = timing; this.cancelled = false;
    this.finished = new Promise((res, rej) => { this._res = res; this._rej = rej; });
    this.finished.catch(() => {});
  }
  finish() { this._res(this); }
  cancel() { this.cancelled = true; this._rej(new Error('AbortError')); }
}
function fakeEl({ rect = { left: 100, top: 200, width: 40, height: 60 }, animate = true } = {}) {
  const classes = new Set();
  const el = {
    calls: [],
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    getBoundingClientRect: () => rect,
  };
  if (animate) el.animate = (kf, timing) => { const a = new FakeAnimation(kf, timing); el.calls.push(a); return a; };
  return el;
}
function fakeWin(reduced = false) {
  const listeners = new Set();
  const mql = { matches: reduced, addEventListener: (t, f) => listeners.add(f), removeEventListener: (t, f) => listeners.delete(f) };
  return { mql, listeners, matchMedia: (q) => { mql.query = q; return mql; }, set(v) { mql.matches = v; for (const f of listeners) f({ matches: v }); } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
section('1. Presets', () => {
  const names = getAnimationNames();
  assert(['fade-in', 'fade-out', 'pop-in', 'pop-out', 'slide-up', 'pulse', 'shake', 'highlight'].every((n) => names.includes(n)), `built-in presets (${names.join(', ')})`);
  assertThrows(() => defineAnimation('', { keyframes: [] }), TypeError, 'a name is required');
  assertThrows(() => defineAnimation('x', {}), TypeError, 'keyframes are required');
  assertThrows(() => defineAnimation('x', { keyframes: [], duration: -1 }), TypeError, 'duration ≥ 0');
  defineAnimation('test-grow', { keyframes: (el, o) => [{ width: '0px' }, { width: `${o.to}px` }], duration: 100 });
  assert(getAnimationNames().includes('test-grow'), 'custom animations register');
});

// ---------------------------------------------------------------------------
await sectionAsync('2. Playing', async () => {
  const e = new AnimationEngine({ win: fakeWin() });
  const el = fakeEl();
  const p = e.play(el, 'pop-in', { delay: 10 });
  const a = el.calls[0];
  assert(a && a.timing.duration === 220 && a.timing.delay === 10 && a.timing.easing === 'ease-out' && a.timing.fill === 'none', `preset timing passed to el.animate (${JSON.stringify(a?.timing)})`);
  assert(el.classList.contains('is-animating') && e.getActiveCount() === 1, 'running: is-animating class, counted');
  a.finish();
  const r = await p;
  assert(r.finished === true && !el.classList.contains('is-animating') && e.getActiveCount() === 0, 'resolves { finished } and cleans up');
  const el2 = fakeEl();
  const p2 = e.play(el2, 'test-grow', { to: 50, duration: 40 });
  assert(el2.calls[0].keyframes[1].width === '50px' && el2.calls[0].timing.duration === 40, 'keyframe functions get the options; duration override');
  el2.calls[0].finish(); await p2;
  const inline = e.play(fakeEl(), { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 50 });
  assert(inline instanceof Promise, 'inline specs work too');
  assertThrows(() => e.play(fakeEl(), 'no-such-animation'), RangeError, 'unknown preset');
  assertThrows(() => e.play(null, 'pop-in'), TypeError, 'element required');
  e.cancelAll();
});

// ---------------------------------------------------------------------------
await sectionAsync('3. Turning it off', async () => {
  const off = new AnimationEngine({ enabled: false, win: fakeWin() });
  const el = fakeEl();
  const r = await off.play(el, 'pop-in');
  assert(r.skipped && r.reason === 'disabled' && el.calls.length === 0 && !off.isActive(), 'the Animations setting off → resolves at once, element untouched');

  const w = fakeWin(true);
  const rm = new AnimationEngine({ win: w });
  assert(w.mql.query === '(prefers-reduced-motion: reduce)' && rm.prefersReducedMotion(), 'reads prefers-reduced-motion');
  assert((await rm.play(fakeEl(), 'pulse')).reason === 'reduced-motion', 'reduced motion → skipped');
  w.set(false);
  const el2 = fakeEl(); const p = rm.play(el2, 'pulse');
  assert(el2.calls.length === 1, 'the preference is watched live (turned off → animates)');
  w.set(true);
  assert((await p).cancelled === true, '…and turning it on cancels what is running');
  assert(new AnimationEngine({ win: fakeWin(true), respectReducedMotion: false }).isActive(), 'respectReducedMotion:false ignores it');

  const fast = new AnimationEngine({ win: fakeWin(), durationScale: 0.25 });
  const el3 = fakeEl(); const p3 = fast.play(el3, 'pop-in', { delay: 40 });
  assert(el3.calls[0].timing.duration === 55 && el3.calls[0].timing.delay === 10, 'durationScale scales duration and delay');
  el3.calls[0].finish(); await p3;
  fast.setDurationScale(0);
  assert((await fast.play(fakeEl(), 'pop-in')).reason === 'zero-duration', 'durationScale 0 → skipped');
  assertThrows(() => fast.setDurationScale(-1), RangeError, 'scale ≥ 0');

  const e = new AnimationEngine({ win: fakeWin() });
  assert((await e.play(fakeEl({ animate: false }), 'pop-in')).reason === 'unsupported', 'no Web Animations support → skipped');
  const broken = fakeEl(); broken.animate = () => { throw new Error('boom'); };
  assert((await e.play(broken, 'pop-in')).reason === 'error', 'a throwing el.animate never escapes');
  defineAnimation('test-throws', { keyframes: () => { throw new Error('bad'); } });
  assert((await e.play(fakeEl(), 'test-throws')).reason === 'error', 'a throwing keyframe function never escapes');
  const noWin = new AnimationEngine({ win: null });
  assert(noWin.isActive() && !noWin.prefersReducedMotion(), 'works without a window (Node)');
  assertThrows(() => new AnimationEngine({ enabled: 'yes' }), TypeError, 'enabled must be boolean');
});

// ---------------------------------------------------------------------------
await sectionAsync('4. Cancelling', async () => {
  const e = new AnimationEngine({ win: fakeWin() });
  const el = fakeEl();
  const first = e.play(el, 'pulse');
  const second = e.play(el, 'shake');
  assert(el.calls[0].cancelled && (await first).cancelled === true, 'a new animation on the same element cancels the old one');
  const overlap = e.play(el, 'highlight', { replace: false });
  assert(!el.calls[1].cancelled && e.getActiveCount() === 2, 'replace:false lets them overlap');
  let idle = false;
  const waiting = e.whenIdle().then(() => { idle = true; });
  await tick();
  assert(!idle, 'whenIdle waits while anything runs');
  e.cancelAll();
  await waiting;
  assert(idle && (await second).cancelled && (await overlap).cancelled && e.getActiveCount() === 0, 'cancelAll settles everything; whenIdle resolves');
  assert(!el.classList.contains('is-animating'), 'class removed');
  await e.whenIdle();
  const el2 = fakeEl(); const p = e.play(el2, 'pulse');
  e.cancel(el2);
  assert((await p).cancelled === true, 'cancel(el)');
  const el3 = fakeEl(); const p3 = e.play(el3, 'pulse');
  e.setEnabled(false);
  assert((await p3).cancelled === true && !e.isEnabled(), 'turning the setting off cancels running animations');
});

// ---------------------------------------------------------------------------
await sectionAsync('5. FLIP', async () => {
  const e = new AnimationEngine({ win: fakeWin() });
  const el = fakeEl({ rect: { left: 100, top: 200, width: 40, height: 60 } });
  const p = e.fly(el, { left: 300, top: 50, width: 20, height: 30 });
  const kf = el.calls[0]?.keyframes;
  assert(kf && kf[0].transform === 'translate(200px, -150px) scale(0.5, 0.5)' && kf[1].transform === 'translate(0, 0) scale(1, 1)', `starts at the old rect, ends in place (${kf?.[0].transform})`);
  el.calls[0].finish();
  assert((await p).finished, 'resolves when done');
  const el2 = fakeEl();
  assert((await e.fly(el2, { left: 100, top: 200, width: 40, height: 60 })).reason === 'no-movement' && el2.calls.length === 0, 'no movement → nothing animated');
  const el3 = fakeEl();
  e.fly(el3, { left: 0, top: 0, width: 10, height: 10 }, { scale: false });
  assert(el3.calls[0].keyframes[0].transform.endsWith('scale(1, 1)'), 'scale:false keeps the size');
  e.cancelAll();
  assertThrows(() => e.fly(fakeEl(), { left: 1 }), TypeError, 'fromRect validated');
  assert((await e.fly({}, { left: 0, top: 0, width: 1, height: 1 })).reason === 'unsupported', 'an element without layout → skipped');
});

// ---------------------------------------------------------------------------
await sectionAsync('6. Sequencing', async () => {
  const e = new AnimationEngine({ win: fakeWin() });
  const order = [];
  const step = (name, ms) => () => new Promise((r) => setTimeout(() => { order.push(name); r(name); }, ms));
  const seq = await e.sequence([step('a', 15), step('b', 1), () => 'c']);
  assert(order.join() === 'a,b' && seq.join() === 'a,b,c', 'sequence runs one after another, in order');
  order.length = 0;
  const par = await e.parallel([step('slow', 15), step('fast', 1)]);
  assert(order.join() === 'fast,slow' && par.join() === 'slow,fast', 'parallel runs together, results in step order');
  const failed = await e.sequence([() => { throw new Error('x'); }, () => 'after']);
  assert(failed[0].reason === 'error' && failed[1] === 'after', 'a failing step never rejects the sequence');
  assertThrows(() => e.sequence('nope'), TypeError, 'sequence validated') ;
});

// ---------------------------------------------------------------------------
await sectionAsync('7. Settings', async () => {
  const store = { animationsEnabled: false };
  const settings = { get: (k) => store[k] };
  const e = new AnimationEngine({ win: fakeWin() });
  e.syncWithSettings(settings);
  assert(!e.isEnabled(), 'syncWithSettings reads animationsEnabled');
  store.animationsEnabled = true; e.syncWithSettings(settings);
  assert(e.isEnabled(), '…and follows changes');
  assertThrows(() => e.syncWithSettings(null), TypeError, 'needs a settings manager');
  const w = fakeWin();
  const d = new AnimationEngine({ win: w });
  const p = d.play(fakeEl(), 'pulse');
  d.destroy();
  assert((await p).cancelled && w.listeners.size === 0, 'destroy cancels and stops watching reduced motion');
});

summary();
