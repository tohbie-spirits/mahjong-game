/**
 * winReveal.test.mjs — Task 106: src/ui/WinReveal.js (the staged winning-hand
 * reveal) and AnimationEngine#cancelWithin, with a minimal fake DOM. The real
 * GameScreen wiring is exercised in the browser (tests/browser/smoke.py).
 *
 * Sections:
 *   1. revealPlan — order and timing of the staging (one winner)
 *   2. revealPlan — two winners in sequence; a draw card stages nothing
 *   3. revealWin — plays the plan; confetti only when celebrating, removed after
 *   4. Off means untouched — inactive engine, no card, real engine disabled
 *   5. The real AnimationEngine — fill 'backwards' + delays reach el.animate
 *   6. cancelWithin — only what is inside the root; whenIdle then resolves
 *   7. Presets — registered; confetti keyframes follow dx / dy
 *
 * Run: node tests/ui/winReveal.test.mjs
 */
import { section, sectionAsync, assert, summary } from '../_helpers/harness.mjs';

// ── A minimal DOM: class selectors, descendant combinator, comma lists ──────
class El {
  constructor(tag, cls = '') { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.attrs = {}; this.style = {}; this.dataset = {}; this._c = new Set(cls.split(/\s+/).filter(Boolean)); this.anims = []; }
  get className() { return [...this._c].join(' '); }
  set className(v) { this._c = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const c = this._c; return { add: (...x) => x.forEach((y) => c.add(y)), remove: (...x) => x.forEach((y) => c.delete(y)), contains: (x) => c.has(x) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  _matches(sel) { // ".a .b" (descendant) or ".a" or "tag"
    const parts = sel.trim().split(/\s+/);
    const test = (el, p) => (p.startsWith('.') ? el._c?.has(p.slice(1)) : el.tagName === p.toUpperCase());
    if (!test(this, parts.at(-1))) return false;
    let i = parts.length - 2;
    for (let a = this.parent; a && i >= 0; a = a.parent) if (test(a, parts[i])) i--;
    return i < 0;
  }
  querySelectorAll(sel) {
    const sels = sel.split(',');
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (sels.some((s) => c._matches(s))) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
const doc = { createElement: (t) => new El(t) };
globalThis.document = doc;

const { revealPlan, revealWin, BURST_PARTICLES, TILE_STAGGER_MS, ROW_STAGGER_MS } = await import('../../src/ui/WinReveal.js');
const { AnimationEngine, getAnimationNames } = await import('../../src/ui/AnimationEngine.js');

const n = (tag, cls, ...kids) => { const e = new El(tag, cls); kids.forEach((k) => e.appendChild(k)); return e; };
const tiles = (k, tag = 't') => Array.from({ length: k }, (_, i) => { const t = n('div', 'tile'); t.dataset.id = `${tag}${i}`; return t; });
function winnerSection({ concealed = 5, melds = [3], rows = 3, tag = 'w' } = {}) {
  const hand = n('div', 'winning-hand',
    n('div', 'winning-hand-concealed', ...tiles(concealed, `${tag}c`)),
    n('div', 'winning-hand-melds', ...melds.map((k, i) => n('div', 'winning-hand-meld', ...tiles(k, `${tag}m${i}-`)))),
    n('div', 'winning-hand-winning-tile', ...tiles(1, `${tag}win`)));
  const tbody = n('tbody', '', ...Array.from({ length: rows }, () => n('tr', '')));
  const table = n('table', 'score-screen-fan', tbody, n('tfoot', '', n('tr', '')));
  return n('section', 'score-screen-winner', n('div', 'score-screen-winner-head'), hand, table);
}
function card(...winners) {
  return n('div', 'score-screen', n('h2', 'score-screen-title'), ...winners, n('section', 'score-screen-standings', n('ol', '', n('li', ''))), n('div', 'score-screen-actions', n('button', '')));
}
function fakeEngine(active = true) {
  const calls = [];
  return { calls, isActive: () => active, play: (el, name, opts) => { calls.push({ el, name, opts }); return Promise.resolve({ finished: true }); } };
}
const increasing = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

// ---------------------------------------------------------------------------
section('1. revealPlan — one winner', () => {
  const c = card(winnerSection());
  const { steps, counts, end } = revealPlan(c);
  assert(steps[0].el === c.querySelector('.score-screen-title') && steps[0].animation === 'title-celebrate' && steps[0].delay === 0, 'the title springs in first');
  const tileSteps = steps.filter((s) => s.animation === 'tile-reveal');
  assert(tileSteps.length === 8 && counts.tiles === 8, 'every concealed + meld tile flips up (5 + 3)');
  assert(tileSteps.map((s) => s.el.dataset.id).join(',') === 'wc0,wc1,wc2,wc3,wc4,wm0-0,wm0-1,wm0-2', 'left to right: concealed tiles, then the melds');
  assert(tileSteps.every((s, i) => i === 0 || s.delay - tileSteps[i - 1].delay === TILE_STAGGER_MS), `one tile every ${TILE_STAGGER_MS} ms`);
  const win = steps.filter((s) => s.animation === 'winning-tile-drop');
  assert(win.length === 1 && win[0].el.dataset.id === 'wwin0' && win[0].delay > tileSteps.at(-1).delay, 'then the winning tile drops in, after the last hand tile');
  const rows = steps.filter((s) => s.animation === 'slide-up');
  assert(rows.length === 4 && counts.rows === 4 && rows[0].delay > win[0].delay && increasing(rows.map((r) => r.delay)), 'then the breakdown lines (3 + the total), in order');
  assert(rows.every((r, i) => i === 0 || r.delay - rows[i - 1].delay === ROW_STAGGER_MS) && rows[0].options.distance === 8, `one line every ${ROW_STAGGER_MS} ms, a short slide`);
  assert(steps.every((s) => s.options.fill === 'backwards'), 'every step holds its first frame until its turn (fill backwards)');
  assert(!steps.some((s) => c.querySelector('.score-screen-standings').contains(s.el) || c.querySelector('.score-screen-actions').contains(s.el)), 'standings and buttons are never hidden or delayed');
  assert(end > rows.at(-1).delay, `the plan ends after the last line (${end} ms)`);
});

// ---------------------------------------------------------------------------
section('2. revealPlan — two winners; a draw', () => {
  const c = card(winnerSection({ tag: 'a' }), winnerSection({ concealed: 11, melds: [], rows: 2, tag: 'b' }));
  const { steps, counts } = revealPlan(c);
  const firstA = steps.find((s) => s.el.dataset.id?.startsWith('a'));
  const lastA = steps.filter((s) => s.el.dataset.id?.startsWith('a')).at(-1);
  const rowsA = steps.filter((s) => s.animation === 'slide-up').slice(0, 4);
  const firstB = steps.find((s) => s.el.dataset.id?.startsWith('b'));
  assert(counts.tiles === 8 + 11 && counts.winningTiles === 2 && counts.rows === 4 + 3, `both winners staged (${JSON.stringify(counts)})`);
  assert(firstA.delay < lastA.delay && firstB.delay > rowsA.at(-1).delay, 'the second winner starts after the first winner\'s last line');
  assert(steps.filter((s) => s.animation === 'title-celebrate').length === 1, 'one title');
  const draw = n('div', 'score-screen', n('h2', 'score-screen-title'), n('p', 'score-screen-draw-note'));
  assert(revealPlan(draw).steps.length === 0 && revealPlan(null).steps.length === 0, 'a draw / abortive card (no winner section) stages nothing');
});

// ---------------------------------------------------------------------------
await sectionAsync('3. revealWin — plays the plan; confetti', async () => {
  const c = card(winnerSection());
  const e = fakeEngine();
  const r = await revealWin(e, c, { celebrate: false, doc });
  assert(e.calls.length === revealPlan(c).steps.length && r.tiles === 8 && r.winningTiles === 1 && r.rows === 4 && r.particles === 0, `every step played, no confetti (${JSON.stringify(r)})`);
  assert(e.calls.every((call, i) => call.opts.delay === revealPlan(c).steps[i].delay), 'with the plan\'s delays');

  const c2 = card(winnerSection());
  const e2 = fakeEngine();
  let seenBurst = null;
  const origPlay = e2.play;
  e2.play = (el, name, opts) => { if (name === 'burst-particle' && !seenBurst) seenBurst = c2.querySelector('.win-burst'); return origPlay(el, name, opts); };
  const r2 = await revealWin(e2, c2, { celebrate: true, doc, random: () => 0.5 });
  const parts = e2.calls.filter((x) => x.name === 'burst-particle');
  assert(r2.particles === BURST_PARTICLES && parts.length === BURST_PARTICLES, `celebrate → ${BURST_PARTICLES} confetti pieces`);
  assert(seenBurst && seenBurst.parent === null && c2.querySelector('.win-burst') === null, 'the confetti box was on the card while flying and is removed once they land');
  assert(parts.every((p) => p.opts.fill === 'backwards' && Number.isFinite(p.opts.dx) && Number.isFinite(p.opts.dy)), 'each piece gets its own direction');
  const angles = new Set(parts.map((p) => Math.round(Math.atan2(p.opts.dy + 20, p.opts.dx) * 10)));
  assert(angles.size >= BURST_PARTICLES - 2, 'the pieces spread in all directions');
});

// ---------------------------------------------------------------------------
await sectionAsync('4. Off means untouched', async () => {
  const c = card(winnerSection());
  const off = fakeEngine(false);
  const r = await revealWin(off, c, { celebrate: true, doc });
  assert(r.skipped && r.reason === 'inactive' && off.calls.length === 0 && c.querySelector('.win-burst') === null, 'engine inactive (setting / reduced motion) → nothing played, no confetti');
  assert((await revealWin(null, c)).reason === 'inactive', 'no engine → skipped');
  assert((await revealWin(fakeEngine(), null)).reason === 'no-card', 'no card → skipped');
  assert((await revealWin(fakeEngine(), n('div', 'score-screen', n('h2', 'score-screen-title')))).reason === 'no-win', 'a draw card → skipped');
  // A real engine with the setting off never calls el.animate.
  const engine = new AnimationEngine({ enabled: false, win: null });
  let animated = 0;
  for (const t of c.querySelectorAll('.tile')) t.animate = () => { animated++; return { finished: Promise.resolve() }; };
  await revealWin(engine, c, { celebrate: true, doc });
  assert(animated === 0, 'real engine, Animations off → no element animated');
});

// ---------------------------------------------------------------------------
await sectionAsync('5. The real AnimationEngine', async () => {
  const c = card(winnerSection({ concealed: 2, melds: [], rows: 1 }));
  const seen = [];
  const all = [c.querySelector('.score-screen-title'), ...c.querySelectorAll('.tile'), ...c.querySelectorAll('tr')];
  for (const el of all) el.animate = (kf, timing) => { seen.push({ el, kf, timing }); return { finished: Promise.resolve(), cancel() {} }; };
  const engine = new AnimationEngine({ win: null });
  const r = await revealWin(engine, c, { doc });
  assert(r.tiles === 2 && seen.length === 1 + 2 + 1 + 2, `title, 2 tiles, the winning tile and 2 lines animated (${seen.length})`);
  assert(seen.every((s) => s.timing.fill === 'backwards'), 'el.animate gets fill backwards');
  const tileDelays = seen.filter((s) => s.el.classList.contains('tile')).map((s) => s.timing.delay);
  assert(increasing(tileDelays), `the delays reach el.animate in order (${tileDelays})`);
  assert(seen.find((s) => s.el.dataset.id === 'wwin0').kf.some((k) => String(k.boxShadow ?? '').includes('22px')), 'the winning tile glows');
  assert(engine.getActiveCount() === 0, 'nothing left running');
});

// ---------------------------------------------------------------------------
await sectionAsync('6. cancelWithin', async () => {
  const engine = new AnimationEngine({ win: null });
  const forever = (el) => { el.animate = () => { let rej; const finished = new Promise((_, r) => { rej = r; }); finished.catch(() => {}); return { finished, cancel: () => rej(new Error('cancel')) }; }; return el; };
  const overlay = forever(n('div', 'overlay'));
  const inner = forever(n('div', 'tile'));
  const deep = forever(n('span', 'p'));
  overlay.appendChild(n('div', 'card', inner, n('div', '', deep)));
  const outside = forever(n('div', 'tile'));
  const ps = [engine.play(overlay, 'fade-in'), engine.play(inner, 'pulse'), engine.play(deep, 'pulse'), engine.play(outside, 'pulse')];
  assert(engine.getActiveCount() === 4, 'four running');
  const cancelled = engine.cancelWithin(overlay);
  assert(cancelled === 3 && engine.getActiveCount() === 1, 'the overlay and everything inside it cancelled; the table tile keeps flying');
  const res = await Promise.all(ps.slice(0, 3));
  assert(res.every((x) => x.cancelled), 'their promises resolve { cancelled }');
  let idle = false;
  engine.whenIdle().then(() => { idle = true; });
  await new Promise((r) => setTimeout(r, 0));
  assert(!idle, 'whenIdle still waits for the outside animation');
  engine.cancelWithin(outside);
  await new Promise((r) => setTimeout(r, 0));
  assert(idle && engine.getActiveCount() === 0, '…and resolves once it is cancelled too');
  assert(engine.cancelWithin(null) === 0 && engine.cancelWithin(n('div', '')) === 0, 'null / an empty root → 0');
});

// ---------------------------------------------------------------------------
section('7. Presets', () => {
  const names = getAnimationNames();
  assert(['tile-reveal', 'winning-tile-drop', 'title-celebrate', 'burst-particle'].every((x) => names.includes(x)), 'the reveal presets are registered on the shared engine');
  let kf = null;
  const engine = new AnimationEngine({ win: null });
  const el = n('span', '');
  el.animate = (k) => { kf = k; return { finished: Promise.resolve() }; };
  engine.play(el, 'burst-particle', { dx: 100, dy: -50, spin: 90 });
  assert(kf && kf.at(-1).transform.includes('translate(100px, -10px)') && kf.at(-1).opacity === 0, `confetti lands at (dx, dy + 40) and fades (${kf?.at(-1).transform})`);
});

summary();
