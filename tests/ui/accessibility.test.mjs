/**
 * accessibility.test.mjs — Task 115: the accessibility pass.
 *
 * Sections:
 *   1. Contrast — every text colour token on every surface, both themes: WCAG AA 4.5:1
 *      (3:1 for the large-title red); button text on the accent fill
 *   2. Announcer — batching into one update, repeats still read, polite vs assertive, flush, destroy
 *   3. GameAnnouncer — event sentences; REAL all-AI Riichi hands narrated (one sentence per discard / call / riichi; the result assertive)
 *   4. FocusTrap — Tab / Shift+Tab wrap, Escape, focus pulled back in, focus restored on release (or to restoreTo)
 *   5. The hand by keyboard — one Tab stop, arrows / Home / End, Enter discards, Enter on a locked tile explains,
 *      labels, the waiting hand is focusable
 *   6. Pause menu — the keyboard shortcut list
 *
 * Run: node tests/ui/accessibility.test.mjs
 */
import { readFileSync } from 'node:fs';
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { installFakeDom, makeEvent } from '../_helpers/fakeDom.mjs';

const { document, fire } = installFakeDom();
const { createAnnouncer } = await import('../../src/ui/Announcer.js');
const { connectGameAnnouncer, describeOutcome } = await import('../../src/ui/GameAnnouncer.js');
const { trapFocus, focusableWithin } = await import('../../src/ui/FocusTrap.js');
const { renderLocalPlayerHand } = await import('../../src/ui/HandRenderer.js');
const { renderPauseMenu } = await import('../../src/ui/components/PauseMenu.js');
const { EventBus } = await import('../../src/core/EventBus.js');
const { GameManager } = await import('../../src/core/GameManager.js');
const { RiichiRules } = await import('../../src/rules/riichi/RiichiRules.js');
const { buildPlayerConfigs, createAIManagerForSeats } = await import('../../src/ai/StrategyRegistry.js');
const { BasicStrategy } = await import('../../src/ai/basic/BasicStrategy.js');
const { Tile } = await import('../../src/core/Tile.js');
const { Hand } = await import('../../src/core/Hand.js');

// ---------------------------------------------------------------------------
section('1. Contrast', () => {
  const vars = (f) => Object.fromEntries([...readFileSync(new URL(`../../styles/${f}`, import.meta.url), 'utf8').matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const theme of ['theme-dark.css', 'theme-light.css']) {
    const v = vars(theme);
    const fails = [];
    for (const fg of ['color-text-primary', 'color-text-secondary', 'color-text-muted', 'color-accent', 'color-warning']) {
      for (const bg of ['color-bg', 'color-surface', 'color-surface-hover']) {
        const r = ratio(v[fg], v[bg]);
        if (r < 4.5) fails.push(`${fg} on ${bg} ${r.toFixed(2)}`);
      }
    }
    assert(fails.length === 0, `${theme}: every text colour reaches 4.5:1 on every surface${fails.length ? ` — ${fails.join('; ')}` : ''}`);
    const big = ['color-bg', 'color-surface', 'color-surface-hover'].map((bg) => ratio(v['color-celebration'], v[bg]));
    assert(big.every((r) => r >= 3), `${theme}: the title red reaches 3:1 (large text only) — ${big.map((r) => r.toFixed(2))}`);
    assert(ratio(v['color-bg'], v['color-accent']) >= 4.5, `${theme}: button text on the accent fill ${ratio(v['color-bg'], v['color-accent']).toFixed(2)}:1`);
  }
});

// ---------------------------------------------------------------------------
section('2. Announcer', () => {
  const timers = [];
  const set = (fn) => { timers.push(fn); return timers.length; };
  const run = () => { while (timers.length) timers.shift()(); };
  const a = createAnnouncer({ doc: document, setTimer: set, clearTimer: () => {} });
  const [polite, assertive] = a.regions();
  assert(polite.getAttribute('aria-live') === 'polite' && assertive.getAttribute('aria-live') === 'assertive' && polite.classList.contains('sr-only') && polite.getAttribute('aria-atomic') === 'true', 'two visually hidden live regions (polite + assertive), atomic');
  assert(polite.parent === document.body, 'on <body>, outside every screen (screen changes keep them)');
  a.announce('AI 1 discards 5 of Dots.'); a.announce('AI 2 calls Pung.'); a.announce('  ');
  run();
  assert(polite.textContent === 'AI 1 discards 5 of Dots. AI 2 calls Pung.', 'messages in one burst become ONE update');
  a.announce('AI 1 discards 5 of Dots.');
  let cleared = false;
  const orig = timers.push.bind(timers);
  timers.push = (fn) => { cleared = polite.textContent === ''; return orig(fn); };
  run(); run();
  timers.push = orig;
  assert(polite.textContent === 'AI 1 discards 5 of Dots.' && cleared, 'the region is emptied first, so the same sentence is read again');
  a.announce('You win!', { assertive: true });
  run();
  assert(assertive.textContent === 'You win!' && polite.textContent === 'AI 1 discards 5 of Dots.', 'assertive messages go to the assertive region');
  assert(a.history().length === 3 && a.history().at(-1).kind === 'assertive', 'history');
  a.destroy();
  assert(polite.parent === null && assertive.parent === null, 'destroy removes the regions');
  const noDoc = createAnnouncer({ doc: null });
  noDoc.announce('x');
  assert(noDoc.history().length === 0, 'no document → a silent no-op');
});

// ---------------------------------------------------------------------------
section('3. GameAnnouncer', () => {
  const said = [];
  const ann = { announce: (t, o) => said.push({ t, assertive: !!o?.assertive }) };
  const players = [{ displayName: 'You' }, { displayName: 'AI 1' }, { displayName: 'AI 2' }, { displayName: 'AI 3' }];
  const bus = new EventBus();
  const tile = Tile.fromId('dots-5', 'dots-5#a');
  const g = connectGameAnnouncer(bus, ann, { players, humanSeatIndex: 0, drawnTile: () => Tile.fromId('bamboo-3', 'b3#1'), terms: { pon: 'Pon' } });
  bus.emit('game:tile-drawn', { seatIndex: 0 });
  bus.emit('game:tile-drawn', { seatIndex: 2 });
  bus.emit('game:tile-discarded', { seatIndex: 2, tile });
  bus.emit('game:tile-discarded', { seatIndex: 0, tile });
  bus.emit('game:claim', { seatIndex: 1, type: 'pon' });
  bus.emit('game:claim', { seatIndex: 1, type: 'win' });
  bus.emit('game:riichi', { seatIndex: 3 });
  bus.emit('game:bonus-tile', { seatIndex: 0, tile: Tile.fromId('flower-1', 'f1') });
  assert(said.map((x) => x.t).join(' | ') === 'You draw 3 of Bamboo. | AI 2 discards 5 of Dots. | You discard 5 of Dots. | AI 1 calls Pon. | AI 3 declares riichi. | You set aside ' + Tile.fromId('flower-1', 'x').label + '.',
    `sentences: ${said.map((x) => x.t).join(' | ')}`);
  bus.emit('game:round-over', { outcome: { type: 'win', winners: [{ seatIndex: 2, winType: 'discard', calledFrom: 0 }] } });
  assert(said.at(-1).t === 'AI 2 wins on your discard.' && said.at(-1).assertive, 'the result interrupts (assertive)');
  const name = (s) => (s === 0 ? 'You' : players[s].displayName);
  assert(describeOutcome({ type: 'win', winners: [{ seatIndex: 0, winType: 'self' }] }, { name, humanSeatIndex: 0 }) === 'You win by self-draw!', 'you win');
  assert(describeOutcome({ type: 'win', winners: [{ seatIndex: 1, winType: 'discard', calledFrom: 3 }, { seatIndex: 2, winType: 'discard', calledFrom: 3 }] }, { name, humanSeatIndex: 0 }) === 'AI 1 wins on AI 3’s discard. AI 2 wins on AI 3’s discard.', 'double Ron');
  assert(/Draw game/.test(describeOutcome({ type: 'draw', results: [] }, { name, humanSeatIndex: 0 })) && /Abortive/.test(describeOutcome({ type: 'abortive' }, { name, humanSeatIndex: 0 })), 'draws');
  g.disconnect();
  const n = said.length;
  bus.emit('game:tile-discarded', { seatIndex: 1, tile });
  assert(said.length === n, 'disconnect');
  assertThrows(() => connectGameAnnouncer(bus, {}, { players, humanSeatIndex: 0 }), TypeError, 'needs an announcer');

  // Real hands.
  let s = 31 >>> 0; const random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let discards = 0; let calls = 0; let riichis = 0; let ends = 0;
  const lines = [];
  for (const seed of [3, 11]) {
    const rb = new EventBus();
    const cfg = buildPlayerConfigs({ playerCount: 4, difficulty: 'basic', humanSeatIndex: -1 });
    const gm = new GameManager({ ruleEngine: new RiichiRules(), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories: { basic: () => new BasicStrategy({ random }) } }), eventBus: rb, seed });
    rb.on('game:tile-discarded', () => discards++);
    rb.on('game:claim', (p) => { if (['chi', 'pon', 'kong'].includes(p.type)) calls++; });
    rb.on('game:riichi', () => riichis++);
    rb.on('game:round-over', () => ends++);
    connectGameAnnouncer(rb, { announce: (t, o) => lines.push({ t, a: !!o?.assertive }) }, { players: gm.getPlayers(), humanSeatIndex: 0, drawnTile: () => gm.getLastDrawnTile?.(), terms: { chi: 'Chi', pon: 'Pon', kong: 'Kan' } });
    for (let h = 0; h < 3; h++) { if (h) { if (gm.isGameComplete()) break; gm.startNextHand(); } for (let i = 0; i < 800 && !gm.isRoundOver(); i++) gm.playAITurn(); gm.settleRound(); }
  }
  const count = (re) => lines.filter((x) => re.test(x.t)).length;
  assert(discards > 50 && count(/discards? .+\.$/) === discards, `every real discard is announced (${discards})`);
  assert(count(/ calls? (Chi|Pon|Kan)\.$/) === calls && count(/declares? riichi/) === riichis, `every call (${calls}) and riichi (${riichis})`);
  assert(lines.filter((x) => x.a).length === ends && ends >= 4, `one assertive result per hand (${ends})`);
  assert(!lines.some((x) => /undefined|null|a tile/.test(x.t)), 'no sentence is missing its tile or player');
});

// ---------------------------------------------------------------------------
section('4. FocusTrap', () => {
  const outside = document.createElement('button'); document.body.appendChild(outside);
  const overlay = document.createElement('div'); document.body.appendChild(overlay);
  const [a, b, c] = ['A', 'B', 'C'].map((t) => { const x = document.createElement('button'); x.textContent = t; overlay.appendChild(x); return x; });
  const hidden = document.createElement('button'); hidden.hidden = true; overlay.appendChild(hidden);
  outside.focus();
  let esc = 0;
  const release = trapFocus(overlay, { onEscape: () => esc++, doc: document });
  assert(document.activeElement === a, 'focus moves into the overlay');
  assert(focusableWithin(overlay).length === 3, 'hidden elements are not focus stops');
  c.focus();
  const tab = makeEvent('keydown', { key: 'Tab', shiftKey: false });
  c.dispatchEvent(tab);
  assert(document.activeElement === a && tab.defaultPrevented, 'Tab on the last element wraps to the first');
  a.dispatchEvent(makeEvent('keydown', { key: 'Tab', shiftKey: true }));
  assert(document.activeElement === c, 'Shift+Tab on the first wraps to the last');
  b.dispatchEvent(makeEvent('keydown', { key: 'Escape' }));
  assert(esc === 1, 'Escape calls onEscape');
  document.dispatchEvent(makeEvent('focusin', { target: outside }));
  assert(document.activeElement === a, 'focus that escapes (a click behind) is pulled back');
  release();
  assert(document.activeElement === outside, 'release returns focus to where it was');
  b.dispatchEvent(makeEvent('keydown', { key: 'Escape' }));
  assert(esc === 1, 'released: Escape does nothing more');
  const gone = document.createElement('button'); document.body.appendChild(gone); gone.focus(); gone.remove();
  const fallback = document.createElement('button'); document.body.appendChild(fallback);
  const r2 = trapFocus(overlay, { doc: document, restoreTo: () => fallback });
  r2();
  assert(document.activeElement === fallback, 'the old element is gone (the table redrew) → restoreTo()');
  assertThrows(() => trapFocus(null), TypeError, 'needs an element');
});

// ---------------------------------------------------------------------------
section('5. The hand by keyboard', () => {
  const box = document.createElement('div'); document.body.appendChild(box);
  const tiles = ['dots-1', 'dots-2', 'dots-3', 'wind-east'].map((id, i) => Tile.fromId(id, `${id}#k${i}`));
  const hand = new Hand(tiles);
  const discarded = []; const attempts = []; const focused = [];
  renderLocalPlayerHand(box, hand, { onDiscard: (t) => discarded.push(t.id), isDiscardable: (t) => t.id !== 'dots-2', onLockedAttempt: (t) => attempts.push(t.id), onFocusTile: (t) => focused.push(t.id), highlightInstanceId: 'wind-east#k3' });
  const nodes = box.querySelectorAll('.hand-concealed .tile');
  const stops = nodes.filter((n) => n.tabIndex === 0);
  assert(stops.length === 1 && stops[0] === nodes.at(-1), 'one Tab stop for the whole hand — the drawn tile');
  assert(nodes.every((n) => n.getAttribute('role') === 'button') && nodes.filter((n) => n.classList.contains('tile--discardable')).length === 3, 'every tile a button; the discardable ones marked');
  const group = box.querySelector('.hand-concealed');
  assert(group.getAttribute('role') === 'group' && /Arrow keys/.test(group.getAttribute('aria-label')), `the hand is a labelled group ("${group.getAttribute('aria-label')}")`);
  assert(nodes.at(-1).getAttribute('aria-label') === 'Discard East Wind (just drawn)' && /can’t be discarded now/.test(nodes[1].getAttribute('aria-label')), 'labels: "Discard …", "(just drawn)", and why a locked tile is locked');
  nodes[3].dispatchEvent(makeEvent('keydown', { key: 'Home' }));
  assert(document.activeElement === nodes[0] && nodes[0].tabIndex === 0 && nodes[3].tabIndex === -1 && focused.at(-1) === 'dots-1', 'Home → the first tile; the Tab stop moves with focus; reported');
  nodes[0].dispatchEvent(makeEvent('keydown', { key: 'ArrowLeft' }));
  assert(document.activeElement === nodes[0], '← at the start stays put');
  nodes[0].dispatchEvent(makeEvent('keydown', { key: 'ArrowRight' }));
  assert(document.activeElement === nodes[1], '→ moves on (locked tiles are reachable)');
  nodes[1].dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
  assert(attempts.join() === 'dots-2' && discarded.length === 0, 'Enter on a locked tile explains instead of discarding');
  nodes[1].dispatchEvent(makeEvent('keydown', { key: 'End' }));
  nodes[3].dispatchEvent(makeEvent('keydown', { key: ' ' }));
  assert(discarded.join() === 'wind-east', 'End, then Space discards');
  renderLocalPlayerHand(box, hand, { onDiscard: () => {}, focusInstanceId: 'dots-3#k2' });
  assert(box.querySelectorAll('.hand-concealed .tile')[2].tabIndex === 0, 'focusInstanceId keeps the same tile as the Tab stop after a redraw');
  renderLocalPlayerHand(box, hand, {});
  assert(box.querySelector('.hand-concealed').tabIndex === -1 && box.querySelectorAll('.hand-concealed .tile').every((n) => n.getAttribute('role') !== 'button'), 'not your turn: plain tiles, and the group can hold focus while the table redraws');
});

// ---------------------------------------------------------------------------
section('6. Pause menu', () => {
  const box = document.createElement('div');
  renderPauseMenu(box, { onResume() {}, onQuit() {}, shortcuts: [['P / Esc', 'Pause'], ['M', 'Sound']] });
  const dts = box.querySelectorAll('.pause-menu-keys-list dt');
  assert(dts.length === 2 && dts[0].querySelectorAll('kbd').map((k) => k.textContent).join() === 'P,Esc', 'shortcuts listed with <kbd> keys');
  const b2 = document.createElement('div');
  renderPauseMenu(b2, { onResume() {}, onQuit() {} });
  assert(b2.querySelector('.pause-menu-keys') === null, 'no list when none is given');
});

summary();
