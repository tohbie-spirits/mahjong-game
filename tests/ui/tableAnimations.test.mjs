/**
 * tableAnimations.test.mjs — Tasks 104–105: src/ui/TableAnimations.js (the
 * discard / draw tile movements) with a fake engine and a minimal fake DOM.
 * The real GameScreen wiring is exercised in the browser (tests/browser/smoke.py).
 *
 * Sections:
 *   1. Measuring — rectOf, lastTileRect, findTileByInstance
 *   2. Discards (Task 104) — the pile tile flies from the hand rect; skips
 *   3. Draws (Task 105) — the hand tile flies from the wall rect; skips
 *   4. Ghosts (Task 105) — a face-down stand-in, created, flown, removed
 *   5. New flowers (Task 105) — popNew
 *   6. AnimationEngine.fly's new `fill` option
 *
 * Run: node tests/ui/tableAnimations.test.mjs
 */
import { section, sectionAsync, assert, summary } from '../_helpers/harness.mjs';

// ── A minimal DOM, enough for TileRenderer's face-down tile ────────────────
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.attrs = {}; this.dataset = {}; this._classes = new Set(); this.parent = null; this.rect = null; }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const c = this._classes; return { add: (...x) => x.forEach((y) => c.add(y)), remove: (...x) => x.forEach((y) => c.delete(y)), contains: (x) => c.has(x) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  setAttributeNS(ns, k, v) { this.attrs[k] = String(v); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, '');
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c._classes?.has(cls)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  getBoundingClientRect() { return this.rect ?? { left: 0, top: 0, width: 0, height: 0 }; }
  set textContent(v) { this._text = v; }
}
globalThis.document = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), body: new El('body') };

const { rectOf, lastTileRect, findTileByInstance, animateDiscard, animateDraw, animateGhost, popNew, DISCARD_FLY_MS, DRAW_FLY_MS } = await import('../../src/ui/TableAnimations.js');
const { AnimationEngine } = await import('../../src/ui/AnimationEngine.js');

const tile = (instanceId, rect) => { const t = new El('div'); t.className = 'tile'; t.dataset.instanceId = instanceId; t.rect = rect; return t; };
const box = (...kids) => { const c = new El('div'); kids.forEach((k) => c.appendChild(k)); c.rect = { left: 5, top: 6, width: 300, height: 50 }; return c; };
function fakeEngine(active = true) {
  const calls = [];
  return {
    calls,
    isActive: () => active,
    fly: (el, from, opts) => { calls.push({ kind: 'fly', el, from, opts }); return Promise.resolve({ finished: true }); },
    play: (el, name, opts) => { calls.push({ kind: 'play', el, name, opts }); return Promise.resolve({ finished: true }); },
  };
}
const R = (left, top) => ({ left, top, width: 30, height: 40 });

// ---------------------------------------------------------------------------
section('1. Measuring', () => {
  assert(rectOf(null) === null && rectOf({}) === null, 'no element → null');
  assert(rectOf(tile('a', { left: 1, top: 2, width: 0, height: 9 })) === null, 'zero size (not laid out) → null');
  const r = rectOf(tile('a', { left: 1, top: 2, width: 3, height: 4, x: 99 }));
  assert(JSON.stringify(r) === '{"left":1,"top":2,"width":3,"height":4}', 'a plain rect');
  const c = box(tile('a', R(10, 0)), tile('b', R(40, 0)));
  assert(lastTileRect(c).left === 40, 'lastTileRect: the last tile');
  assert(lastTileRect(box()).width === 300 && lastTileRect(null) === null, '…the container when empty; null for nothing');
  assert(findTileByInstance(c, 'b') === c.children[1] && findTileByInstance(c, 'zz') === null && findTileByInstance(null, 'a') === null, 'findTileByInstance');
});

// ---------------------------------------------------------------------------
await sectionAsync('2. Discards (Task 104)', async () => {
  const e = fakeEngine();
  const pile = box(tile('x1', R(0, 0)), tile('dots-5#2', R(200, 300)));
  const r = await animateDiscard(e, { from: R(50, 600), pileContainer: pile, tile: { instanceId: 'dots-5#2' }, delay: 200 });
  const c = e.calls[0];
  assert(r.finished && c.el === pile.children[1] && c.from.top === 600, 'the discarded tile in the pile flies from the hand rect');
  assert(c.opts.duration === DISCARD_FLY_MS && c.opts.delay === 200 && c.opts.fill === 'backwards', `timing ${JSON.stringify(c.opts)} — held at the start during the delay`);
  assert((await animateDiscard(fakeEngine(false), { from: R(0, 0), pileContainer: pile, tile: { instanceId: 'x1' } })).reason === 'inactive', 'engine off → skipped');
  assert((await animateDiscard(null, {})).reason === 'inactive', 'no engine → skipped');
  assert((await animateDiscard(e, { from: null, pileContainer: pile, tile: { instanceId: 'x1' } })).reason === 'no-source', 'unmeasured origin → skipped');
  assert((await animateDiscard(e, { from: R(0, 0), pileContainer: pile, tile: { instanceId: 'gone' } })).reason === 'not-found', 'tile not in the pile (re-rendered away) → skipped');
});

// ---------------------------------------------------------------------------
await sectionAsync('3. Draws (Task 105)', async () => {
  const e = fakeEngine();
  const hand = box(tile('h1', R(0, 700)), tile('bamboo-3#1', R(400, 700)));
  await animateDraw(e, { from: R(600, 380), handContainer: hand, tile: { instanceId: 'bamboo-3#1' } });
  const c = e.calls[0];
  assert(c.el === hand.children[1] && c.from.left === 600 && c.opts.duration === DRAW_FLY_MS, 'the drawn tile flies from the wall rect into the hand');
  assert((await animateDraw(e, { from: R(0, 0), handContainer: hand, tile: null })).reason === 'no-source', 'no tile → skipped');
});

// ---------------------------------------------------------------------------
await sectionAsync('4. Ghosts (Task 105)', async () => {
  const e = fakeEngine();
  let seenDuring = null;
  e.fly = (el, from, opts) => { seenDuring = { inBody: document.body.children.includes(el), el, from, opts }; return Promise.resolve({ finished: true }); };
  const r = await animateGhost(e, { from: R(600, 380), to: R(1100, 400) });
  const g = seenDuring.el;
  assert(seenDuring.inBody && g._classes.has('tile-ghost') && g._classes.has('tile--back'), 'a face-down stand-in is added to the page');
  assert(g.style.position === 'fixed' && g.style.left === '1100px' && g.style.top === '400px' && g.style.pointerEvents === 'none', 'placed over the opponent\'s hand, click-through');
  assert(seenDuring.from.left === 600 && seenDuring.opts.scale === false, 'flies from the wall, without resizing');
  assert(r.finished && !document.body.children.includes(g), 'removed once it lands');
  const before = document.body.children.length;
  assert((await animateGhost(fakeEngine(false), { from: R(0, 0), to: R(1, 1) })).reason === 'inactive' && document.body.children.length === before, 'engine off → nothing created');
  assert((await animateGhost(e, { from: R(0, 0), to: null })).reason === 'no-source', 'no target → skipped');
});

// ---------------------------------------------------------------------------
await sectionAsync('5. New flowers (Task 105)', async () => {
  const e = fakeEngine();
  const a = tile('flower-1#1', R(0, 0)); const b = tile('season-2#1', R(0, 0));
  await popNew(e, [a, null, b]);
  assert(e.calls.length === 2 && e.calls.every((c) => c.kind === 'play' && c.name === 'pop-in'), 'each new element pops in');
  assert((await popNew(fakeEngine(false), [a])).reason === 'inactive', 'engine off → skipped');
});

// ---------------------------------------------------------------------------
await sectionAsync('6. fly(…, { fill })', async () => {
  const engine = new AnimationEngine({ win: null });
  const el = tile('t', R(100, 100));
  el.animate = (kf, timing) => { el.timing = timing; return { finished: Promise.resolve(), cancel() {} }; };
  await engine.fly(el, R(0, 0), { delay: 50, fill: 'backwards' });
  assert(el.timing.fill === 'backwards' && el.timing.delay === 50, 'fill passed through');
  await engine.fly(el, R(10, 0));
  assert(el.timing.fill === 'none', 'default fill none');
});

summary();
