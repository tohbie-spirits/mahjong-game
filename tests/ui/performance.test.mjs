/**
 * performance.test.mjs — Task 119: the performance pass.
 *
 * Sections:
 *   1. Shanten, suit by suit — equal to the original whole-hand search on
 *      150,000 random hands (every meld count, clustered and scattered); the
 *      memos stay bounded
 *   2. The Advanced AI — the same decisions with a cold and a warm memo; its
 *      turns now fit in a frame budget (p95 / worst case on real games)
 *   3. Tile templates — each face (and the back) built once, then cloned:
 *      fresh nodes, identical markup, a change to one copy never leaks into
 *      the next; a new document starts a new cache
 *   4. Animation throttling — nothing animates while the page is hidden,
 *      running animations finish when it hides, a cap on concurrent ones,
 *      the listener removed on destroy
 *
 * Run: node tests/ui/performance.test.mjs
 */
import { section, sectionAsync, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { installFakeDom } from '../_helpers/fakeDom.mjs';
import {
  _regularShantenReference, calculateShantenUnchecked, calculateShantenBreakdown,
  clearShantenMemo, getShantenMemoStats,
} from '../../src/ai/advanced/HandEfficiencyEvaluator.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { Tile } from '../../src/core/Tile.js';
import { createTileSVG, createTileBackSVG, createTileElement } from '../../src/ui/TileRenderer.js';
import { AnimationEngine } from '../../src/ui/AnimationEngine.js';

// ---------------------------------------------------------------------------
section('1. Shanten, suit by suit', () => {
  let seed = 4242; const r = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  let bad = 0; let n = 0; const byMeld = [0, 0, 0, 0, 0];
  for (let k = 0; k < 150000; k++) {
    const meld = Math.floor(r() * 5);
    const size = Math.max(1, 14 - 3 * meld - (r() < 0.5 ? 1 : 0) - Math.floor(r() * 3));
    const c = new Array(34).fill(0);
    const centre = r() < 0.6 ? Math.floor(r() * 34) : -1;
    for (let t = 0; t < size;) {
      const i = centre >= 0 && r() < 0.75 ? Math.min(33, Math.max(0, centre + Math.floor(r() * 7) - 3)) : Math.floor(r() * 34);
      if (c[i] < 4) { c[i]++; t++; }
    }
    if (k % 5000 === 0) clearShantenMemo();
    if (_regularShantenReference(c, meld) !== calculateShantenUnchecked(c, meld)) bad++;
    n++; byMeld[meld]++;
  }
  assert(bad === 0 && byMeld.every((x) => x > 10000), `${n} random hands (${byMeld.join(' / ')} by meld count): suit-by-suit = the whole-hand search every time (${bad} differences)`);
  // Known values.
  const cnt = (spec) => { const c = new Array(34).fill(0); for (const i of spec) c[i]++; return c; };
  assert(calculateShantenBreakdown(cnt([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 18]), { meldCount: 0 }).regular === 0, 'a ready hand: 0');
  assert(calculateShantenBreakdown(cnt([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 18, 18]), { meldCount: 0 }).regular === -1, 'a complete hand: −1');
  assert(calculateShantenBreakdown(cnt([0, 4, 8, 9, 13, 17, 18, 22, 26, 27, 28, 29, 30]), { meldCount: 0 }).regular === 8, 'thirteen scattered tiles: 8 (regular shape)');
  clearShantenMemo();
  for (let k = 0; k < 60000; k++) { const c = new Array(34).fill(0); let t = 0; let x = k; while (t < 13) { const i = (x * 7 + t * 13) % 34; x = (x * 31 + 7) % 1000003; if (c[i] < 4) { c[i]++; t++; } } calculateShantenUnchecked(c, 0); }
  assert(getShantenMemoStats().size <= 50000, `the memo stays bounded (${getShantenMemoStats().size} ≤ 50000 after 60,000 distinct hands)`);
});

// ---------------------------------------------------------------------------
section('2. The Advanced AI', () => {
  const rng = (s) => { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const play = (make, n, seed, times) => {
    const cfg = buildPlayerConfigs({ playerCount: n, difficulty: 'advanced', humanSeatIndex: -1 });
    const random = rng(seed);
    const gm = new GameManager({ ruleEngine: make(n), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories: { advanced: () => new AdvancedStrategy({ random }) } }), eventBus: new EventBus(), seed });
    const log = [];
    for (let h = 0; h < 2; h++) {
      while (!gm.isRoundOver()) { const t0 = performance.now(); const r = gm.playAITurn(); times?.push(performance.now() - t0); log.push(r.type + ':' + (r.tile?.id ?? '')); }
      if (gm.isGameComplete()) break; gm.startNextHand();
    }
    return log.join(',');
  };
  const makers = { 'Hong Kong': () => new HongKongRules(), Riichi: (n) => new RiichiRules({ playerCount: n }), 'Chinese Official': (n) => new ChineseOfficialRules({ playerCount: n }) };
  const times = [];
  for (const [name, make] of Object.entries(makers)) {
    clearShantenMemo();
    const cold = play(make, 4, 17, null);
    const warm = play(make, 4, 17, times); // memo now full of the same hands
    assert(cold === warm && cold.length > 100, `${name}: every AI decision identical with a cold and a warm memo`);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(0.95 * (times.length - 1))]; const max = times.at(-1);
  assert(p95 < 40 && max < 250, `${times.length} Advanced turns: p95 ${p95.toFixed(1)} ms, worst ${max.toFixed(1)} ms (before Task 119: p95 ≈ 70, p99 ≈ 156, worst ≈ 366 ms)`);
});

// ---------------------------------------------------------------------------
section('3. Tile templates', () => {
  installFakeDom();
  const ser = (n) => `${n.tagName}[${[...n._attrs].map(([k, v]) => `${k}=${v}`).join(',')}|${JSON.stringify(n.dataset)}|${n._text}](${n.children.map(ser).join('')})`;
  const t = Tile.fromId('dots-5', 'dots-5#1');
  const a = createTileSVG(t); const b = createTileSVG(t);
  assert(a !== b && ser(a) === ser(b) && a.children.length > 3, 'the same face twice: two separate nodes, identical markup');
  a.setAttribute('data-x', '1'); a.children[0].setAttribute('fill', 'red');
  assert(ser(createTileSVG(t)) === ser(b), 'changing one copy never leaks into the next');
  const backs = [createTileBackSVG(), createTileBackSVG()];
  assert(backs[0] !== backs[1] && ser(backs[0]) === ser(backs[1]) && backs[0].children.length > 10, 'the face-down back: cloned, identical');
  const all = ['dots-1', 'bamboo-1', 'characters-9', 'wind-east', 'dragon-white', 'dragon-green'].map((id) => Tile.fromId(id, `${id}#9`));
  assert(new Set(all.map((x) => ser(createTileSVG(x)))).size === all.length, 'different faces stay different');
  const el = createTileElement(t);
  assert(el.dataset.instanceId === 'dots-5#1' && el.children[0].dataset.face === 'dots-5', 'tile elements carry their own identity around the shared drawing');
  const first = createTileSVG(t);
  installFakeDom(); // a new document
  const second = createTileSVG(t);
  assert(second.ownerDocument === globalThis.document && first.ownerDocument !== second.ownerDocument && ser(first) === ser(second), 'a new document builds its own templates');
});

// ---------------------------------------------------------------------------
await sectionAsync('4. Animation throttling', async () => {
  const listeners = new Map();
  const doc = { hidden: false, addEventListener: (t, f) => listeners.set(t, f), removeEventListener: (t, f) => { if (listeners.get(t) === f) listeners.delete(t); } };
  const win = { document: doc, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  const fakeEl = () => {
    const el = { classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) };
    el.animate = () => { let ok, no; const anim = { finished: new Promise((a, b) => { ok = a; no = b; }), cancel() { no(new Error('cancelled')); }, finish() { ok(); } }; el.anim = anim; return anim; };
    return el;
  };
  const engine = new AnimationEngine({ win, maxConcurrent: 3 });
  assert(engine.getMaxConcurrent() === 3 && listeners.has('visibilitychange'), 'a cap, and a visibility listener');
  const els = [fakeEl(), fakeEl(), fakeEl(), fakeEl()];
  const runs = els.slice(0, 3).map((e) => engine.play(e, 'pop-in'));
  const over = await engine.play(els[3], 'pop-in');
  assert(engine.getActiveCount() === 3 && over.skipped && over.reason === 'busy', 'a fourth concurrent animation is skipped ("busy"), not queued');
  els[0].anim.finish();
  assert((await runs[0]).finished === true, 'finished ones resolve as before');
  doc.hidden = true; listeners.get('visibilitychange')();
  const settled = await Promise.all(runs.slice(1));
  assert(settled.every((x) => x.cancelled) && engine.getActiveCount() === 0, 'hiding the page finishes everything running (nothing waits on unseen animations)');
  const hid = await engine.play(fakeEl(), 'pop-in');
  assert(hid.skipped && hid.reason === 'hidden', 'while hidden nothing animates ("hidden")');
  doc.hidden = false;
  const back = engine.play(fakeEl(), 'pop-in');
  assert(engine.getActiveCount() === 1, 'visible again: animations run');
  engine.cancelAll(); await back;
  const st = engine.getStats();
  assert(st.started === 4 && st.busy === 1 && st.hidden === 1, `stats: ${JSON.stringify(st)}`);
  engine.destroy();
  assert(!listeners.has('visibilitychange'), 'destroy removes the visibility listener');
  assertThrows(() => new AnimationEngine({ win, maxConcurrent: 0 }), TypeError, 'the cap must be a positive integer');
  const free = new AnimationEngine({ win, pauseWhenHidden: false });
  doc.hidden = true;
  const r = free.play(fakeEl(), 'pop-in');
  assert(free.getActiveCount() === 1, 'pauseWhenHidden: false keeps animating (opt-out)');
  free.cancelAll(); await r; free.destroy(); doc.hidden = false;
});

summary();
