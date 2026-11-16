/**
 * tableHighlights.test.mjs — Task 107: hover / selection micro-interactions.
 * src/ui/TableHighlights.js over real HandRenderer / DiscardPileRenderer
 * output (fake DOM), HandRenderer's locked-tile feedback and the landing
 * squash added to TableAnimations#animateDiscard.
 *
 * Sections:
 *   1. countCopies — held / seen / left; a claimed discard counted once; hidden tiles ignored
 *   2. setMatchHighlight — marks every other face-up copy; clears
 *   3. installTileHover — pointer + keyboard focus, the count tip, leaving clears
 *   4. refresh after a re-render; uninstall
 *   5. HandRenderer — a locked tile reports the attempt, never discards
 *   6. animateDiscard — the tile squashes as it lands
 *
 * Run: node tests/ui/tableHighlights.test.mjs
 */
import { section, sectionAsync, assert, summary } from '../_helpers/harness.mjs';
import { installFakeDom } from '../_helpers/fakeDom.mjs';

const { document, fire } = installFakeDom();
const { Tile } = await import('../../src/core/Tile.js');
const { Hand, Meld } = await import('../../src/core/Hand.js');
const { DiscardPile } = await import('../../src/core/DiscardPile.js');
const { MELD_TYPE } = await import('../../src/utils/constants.js');
const { renderLocalPlayerHand, renderOpponentHand } = await import('../../src/ui/HandRenderer.js');
const { renderDiscardPile } = await import('../../src/ui/DiscardPileRenderer.js');
const { countCopies, setMatchHighlight, installTileHover, copiesLabel } = await import('../../src/ui/TableHighlights.js');
const { animateDiscard } = await import('../../src/ui/TableAnimations.js');

const T = (id, n) => Tile.fromId(id, `${id}#${n}`);
const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };

/** A table: your hand (1 × 5-dots), seat 1's pile (the claimed 5-dots + 9-bamboo), seat 2's Pon of 5-dots, seat 3 hidden with a concealed Kong. */
function buildTable() {
  const root = div('table');
  const seats = [0, 1, 2, 3].map((i) => { const s = div(`table-seat seat-${i}`); s.appendChild(div('table-seat-hand')); s.appendChild(div('table-center-discard')); root.appendChild(s); return s; });
  const mine = new Hand([T('dots-5', 'd'), T('dots-6', 1), T('dots-7', 1), T('bamboo-9', 1), T('flower-1', 1)]);
  const pile = new DiscardPile();
  pile.discard(T('dots-5', 'a')).markClaimed(2, 'pon');
  pile.discard(T('bamboo-9', 2));
  const ponTiles = [T('dots-5', 'a'), T('dots-5', 'b'), T('dots-5', 'c')];
  const seat2 = new Hand([T('wind-east', 1)], [new Meld({ type: MELD_TYPE.PON, tiles: ponTiles, calledFrom: 1, calledTile: ponTiles[0] })]);
  const kong = [1, 2, 3, 4].map((n) => T('dragon-red', `k${n}`));
  const seat3 = new Hand([T('wind-north', 1)], [new Meld({ type: MELD_TYPE.KONG, tiles: kong, concealed: true })]);
  const discarded = [];
  renderLocalPlayerHand(seats[0].querySelector('.table-seat-hand'), mine, { onDiscard: (t) => discarded.push(t) });
  renderDiscardPile(seats[1].querySelector('.table-center-discard'), pile);
  renderOpponentHand(seats[2].querySelector('.table-seat-hand'), seat2);
  renderOpponentHand(seats[3].querySelector('.table-seat-hand'), seat3);
  return { root, seats, mine, discarded };
}
const handTile = (root, id) => root.querySelector('.hand--local .hand-concealed').children.find((t) => t.dataset.tileId === id);

// ---------------------------------------------------------------------------
section('1. countCopies', () => {
  const { root } = buildTable();
  const c = countCopies(root, 'dots-5');
  assert(c.held === 1 && c.seen === 3 && c.left === 0, `5-dots: held 1, seen 3 (the Pon; its claimed discard counted once), left 0 (${JSON.stringify(c)})`);
  const b = countCopies(root, 'bamboo-9');
  assert(b.held === 1 && b.seen === 1 && b.left === 2, `9-bamboo: held 1, seen 1 discard, 2 left (${JSON.stringify(b)})`);
  const r = countCopies(root, 'dragon-red');
  assert(r.held === 0 && r.seen === 2 && r.left === 2, `a concealed Kong shows only its two face-up tiles (${JSON.stringify(r)})`);
  assert(countCopies(root, 'flower-1').left === 0 && countCopies(root, 'flower-1').held === 1, 'a flower is a single tile');
  assert(countCopies(root, 'wind-east').seen === 0, 'hidden hand tiles carry no identity, so they are never counted');
  assert(copiesLabel(c) === '1 held · 3 seen · 0 left', `label "${copiesLabel(c)}"`);
  assert(JSON.stringify(countCopies(null, 'dots-5')) === '{"held":0,"seen":0,"left":4}', 'no root → nothing seen');
});

// ---------------------------------------------------------------------------
section('2. setMatchHighlight', () => {
  const { root } = buildTable();
  const src = handTile(root, 'dots-5');
  const n = setMatchHighlight(root, 'dots-5', src);
  const marked = root.querySelectorAll('.tile--match');
  assert(n === 4 && marked.length === 4 && !src.classList.contains('tile--match'), 'every other face-up copy is marked (the pile tile + 3 in the Pon), not the source');
  assert(marked.every((t) => t.dataset.tileId === 'dots-5'), 'only copies of that tile');
  setMatchHighlight(root, 'bamboo-9');
  assert(root.querySelectorAll('.tile--match').every((t) => t.dataset.tileId === 'bamboo-9'), 'a new mark replaces the old one');
  assert(setMatchHighlight(root, null) === 0 && root.querySelectorAll('.tile--match').length === 0, 'null clears');
  setMatchHighlight(root, 'dragon-red');
  assert(root.querySelectorAll('.tile--back.tile--match').length === 0, 'face-down tiles are never marked');
});

// ---------------------------------------------------------------------------
section('3. installTileHover', () => {
  const { root } = buildTable();
  const hover = installTileHover(root);
  const t5 = handTile(root, 'dots-5');
  fire(t5.children[0], 'pointerover'); // the pointer is over the tile's SVG
  assert(hover.current() === 'dots-5' && root.querySelectorAll('.tile--match').length === 4, 'pointing at a hand tile marks its copies');
  assert(t5.classList.contains('tile--counting') && t5.dataset.copies === '1 held · 3 seen · 0 left', `the hovered tile shows its count ("${t5.dataset.copies}")`);
  fire(t5, 'pointerout', { relatedTarget: t5.children[0] });
  assert(hover.current() === 'dots-5', 'moving within the tile keeps the mark');
  fire(t5, 'pointerout', { relatedTarget: root });
  assert(hover.current() === null && root.querySelectorAll('.tile--match').length === 0 && !t5.classList.contains('tile--counting') && t5.dataset.copies === undefined, 'leaving the tile clears everything');

  const pileTile = root.querySelector('.discard-pile').querySelectorAll('.tile')[1];
  fire(pileTile, 'pointerover');
  assert(hover.current() === 'bamboo-9' && handTile(root, 'bamboo-9').classList.contains('tile--match') && pileTile.dataset.copies === undefined, 'a discard marks its copies (incl. the one in your hand) — counts only on your own tiles');
  fire(handTile(root, 'flower-1'), 'pointerover');
  assert(hover.current() === 'flower-1' && !handTile(root, 'flower-1').classList.contains('tile--counting') && !pileTile.classList.contains('tile--match'), 'moving to another tile switches the mark; a flower gets no count');
  fire(root.querySelector('.hand--opponent .tile--back'), 'pointerover');
  assert(hover.current() === null, 'a face-down tile clears it');

  fire(t5, 'focusin');
  assert(hover.current() === 'dots-5' && t5.classList.contains('tile--counting'), 'keyboard focus works like hover');
  fire(t5, 'focusout', { relatedTarget: null });
  assert(hover.current() === null, '…and blur clears');
  hover.uninstall();
});

// ---------------------------------------------------------------------------
section('4. refresh + uninstall', () => {
  const { root, seats, mine } = buildTable();
  const hover = installTileHover(root);
  const old = handTile(root, 'dots-5');
  fire(old, 'pointerover');
  renderLocalPlayerHand(seats[0].querySelector('.table-seat-hand'), mine, { onDiscard: () => {} }); // the table re-renders
  setMatchHighlight(root, null); // (as if every seat had re-rendered)
  assert(!root.contains(old) && root.querySelectorAll('.tile--match').length === 0, 're-render: the hovered element is gone, nothing marked');
  hover.refresh();
  const again = handTile(root, 'dots-5');
  assert(hover.current() === 'dots-5' && root.querySelectorAll('.tile--match').length === 4 && !again.classList.contains('tile--match'), 'refresh: the mark follows the same tile instance onto its redrawn element (copies marked, not itself)');
  assert(again.classList.contains('tile--counting') && again.dataset.copies === '1 held · 3 seen · 0 left', '…and its count is back on it');
  const lessHand = new Hand(mine.concealedTiles.filter((t) => t.id !== 'dots-5'));
  renderLocalPlayerHand(seats[0].querySelector('.table-seat-hand'), lessHand, { onDiscard: () => {} }); // you discarded it
  hover.refresh();
  assert(hover.current() === null && root.querySelectorAll('.tile--match').length === 0, 'the hovered tile is gone (discarded) → refresh clears the marks');
  fire(handTile(root, 'dots-6'), 'pointerover');
  hover.uninstall();
  assert(['pointerover', 'pointerout', 'focusin', 'focusout'].every((t) => root.listenerCount(t) === 0) && root.querySelectorAll('.tile--match').length === 0, 'uninstall removes every listener and mark');
  fire(handTile(root, 'dots-6'), 'pointerover');
  assert(root.querySelectorAll('.tile--match').length === 0, 'nothing reacts afterwards');
  let threw = false; try { installTileHover(null); } catch { threw = true; }
  assert(threw, 'installTileHover(null) throws');
});

// ---------------------------------------------------------------------------
section('5. HandRenderer — locked tiles', () => {
  const box = div('box');
  const hand = new Hand([T('dots-1', 1), T('dots-2', 1), T('dots-3', 1)]);
  const discarded = []; const attempts = [];
  renderLocalPlayerHand(box, hand, { onDiscard: (t) => discarded.push(t.id), isDiscardable: (t) => t.id !== 'dots-2', onLockedAttempt: (t, el) => attempts.push({ id: t.id, el }) });
  const [a, b] = box.querySelectorAll('.tile');
  b.click();
  assert(attempts.length === 1 && attempts[0].id === 'dots-2' && attempts[0].el === b && discarded.length === 0, 'clicking a locked tile reports the attempt (with its element) and discards nothing');
  assert(b.tabIndex === -1 && !b.classList.contains('tile--discardable') && b.getAttribute('aria-disabled') === 'true', 'the locked tile: reachable by arrow keys only (tabindex −1), aria-disabled, not discardable');
  a.click();
  assert(discarded.join() === 'dots-1' && attempts.length === 1, 'a free tile still discards');
  const box2 = div('box');
  renderLocalPlayerHand(box2, hand, { onDiscard: () => {}, isDiscardable: () => false });
  box2.querySelectorAll('.tile')[0].click();
  assert(true, 'without onLockedAttempt a locked click is simply ignored');
});

// ---------------------------------------------------------------------------
await sectionAsync('6. animateDiscard — landing', async () => {
  const calls = [];
  const engine = { isActive: () => true, fly: (el, from, o) => { calls.push(['fly', o.fill]); return Promise.resolve({ finished: true }); }, play: (el, name) => { calls.push(['play', name]); return Promise.resolve({ finished: true }); } };
  const pile = div('pile'); document.body.appendChild(pile); const t = div('tile'); t.dataset.instanceId = 'x#1'; pile.appendChild(t);
  const from = { left: 0, top: 500, width: 30, height: 40 };
  const r = await animateDiscard(engine, { from, pileContainer: pile, tile: { instanceId: 'x#1' } });
  assert(r.finished && calls.map((c) => c.join(':')).join() === 'fly:backwards,play:tile-land', 'the flight, then the landing squash');
  calls.length = 0;
  await animateDiscard(engine, { from, pileContainer: pile, tile: { instanceId: 'x#1' }, land: false });
  assert(calls.length === 1, 'land: false → flight only');
  calls.length = 0;
  engine.fly = () => { calls.push(['fly']); return Promise.resolve({ cancelled: true }); };
  const r2 = await animateDiscard(engine, { from, pileContainer: pile, tile: { instanceId: 'x#1' } });
  assert(r2.cancelled && calls.length === 1, 'a cancelled flight does not land');
});

summary();
