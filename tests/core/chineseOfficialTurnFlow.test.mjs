/**
 * chineseOfficialTurnFlow.test.mjs — Task 97: Chinese Official turn flow and
 * flower-tile handling, driven through the real GameManager.
 *
 * Sections:
 *   1. Session + hooks — starting scores, table view, other rulesets unchanged
 *   2. Flowers in the deal — set aside dealer first, replaced from the end of
 *      the wall until none is left; random deals keep every tile accounted for
 *   3. Flowers on a draw — set aside and replaced (chains, a Kong replacement
 *      stays a Kong replacement, a flower as the last tile → exhaustive draw)
 *   4. Flowers in scoring — 1 point each, after the minimum
 *   5. Last copy — visible copies, the Last Tile fan
 *   6. Robbing the Kong — added Kong robbed; concealed never
 *   7. One winner per discard (option multipleWinners)
 *   8. Settlement + session — base 8, the deal passes every hand
 *   9. Saves — flowers set aside survive a snapshot
 *
 * Run: node tests/core/chineseOfficialTurnFlow.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { faceIds } from '../_helpers/tiles.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { WallManager } from '../../src/core/WallManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Tile } from '../../src/core/Tile.js';
import { Meld } from '../../src/core/Hand.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { ChineseOfficialTurnFlow } from '../../src/rules/chineseOfficial/ChineseOfficialTurnFlow.js';
import { settleChineseOfficialHand, MCR_BASE_PAYMENT } from '../../src/rules/chineseOfficial/ChineseOfficialScoring.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { ACTION_TYPE, SEAT_KIND, TURN_PHASE, KONG_TYPE, MELD_TYPE, RULESET_ID } from '../../src/utils/constants.js';

let uid = 0;
const mk = (id) => Tile.fromId(id, `${id}#t${++uid}`);
const many = (spec) => faceIds(spec).map(mk);
/** Tiles from a spec where F1…F4 / S1…S4 are flowers / seasons. */
const tl = (spec) => spec.split(' ').filter(Boolean).flatMap((part) => (/^[FS][1-4]$/.test(part) ? [mk(`${part[0] === 'F' ? 'flower' : 'season'}-${part[1]}`)] : many(part)));
const humans = (n) => Array.from({ length: n }, (_, i) => ({ seatIndex: i, displayName: `P${i}`, seatKind: SEAT_KIND.HUMAN, aiDifficulty: null }));
const IDLE = ['19d 19b 19c ESWN RG 5d', '28d 28b 28c ESWN RG 6d', '37d 37b 37c ESWN RG 4b', '46d 46b 46c ESWN RG 5b'];

/**
 * A rigged hand: `hands` per seat, `front` = the next normal draws, `back` =
 * the tiles at the replacement end (the LAST one is drawn first).
 */
function rig({ hands, front = '', back = '', rules = new ChineseOfficialRules({ playerCount: hands.length }), dealer = 0, melds = [] }) {
  const gm = new GameManager({ ruleEngine: rules, playerConfigs: humans(hands.length), eventBus: new EventBus(), seed: 1, dealerIndex: dealer });
  gm.getPlayers().forEach((p, i) => {
    p.resetForNewHand();
    for (const t of tl(hands[i])) p.addTileToHand(t);
    for (const m of melds[i] ?? []) p.addMeld(m);
  });
  gm._wall = new WallManager([...tl(front), ...tl('9b 9b 9b 9b 8b 8b 8b 8b'), ...tl(back)]);
  gm.getTurnFlow().onHandStart();
  gm.getTurnManager().forceSetTurn(dealer, TURN_PHASE.AWAITING_DRAW);
  return gm;
}
const find = (gm, seat, id) => gm.getPlayer(seat).getHand().concealedTiles.filter((t) => t.id === id).pop();
const discard = (gm, id) => gm.performDiscard(find(gm, gm.getTurnManager().getCurrentPlayerIndex(), id));
const meld = (type, spec, extra = {}) => new Meld({ type, tiles: tl(spec), concealed: false, ...extra });

// ---------------------------------------------------------------------------
section('1. Session + hooks', () => {
  const gm = new GameManager({ ruleEngine: new ChineseOfficialRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 2 });
  assert(gm.getTurnFlow() instanceof ChineseOfficialTurnFlow, 'ChineseOfficialRules provides a turn flow');
  assert(gm.getPlayers().every((p) => p.score === 0), 'MCR starts everyone at 0');
  assert(new GameManager({ ruleEngine: new ChineseOfficialRules({ startingScore: 500 }), playerConfigs: humans(4), eventBus: new EventBus(), seed: 2 }).getPlayer(0).score === 500, 'startingScore option');
  const tv = gm.getTableView();
  assert(Array.isArray(tv.bonusTiles) && tv.bonusTiles.length === 4 && !('riichiSeats' in tv), 'table view lists each seat\'s flowers, no riichi fields');
  const r = new GameManager({ ruleEngine: new RiichiRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 2 });
  assert(Array.isArray(r.getTableView().riichiSeats) && Array.isArray(r.getTableView().doraIndicators) && !('bonusTiles' in r.getTableView()), 'Riichi table view unchanged (via tableViewExtras)');
  const hk = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 2 });
  assert(hk.getTurnFlow() === null && hk.getWall().remainingCount === 136 - 52, 'Hong Kong: no flow, no flowers');
  const f = gm.getTurnFlow();
  assert(f.dealerKeeps({ type: 'win', winners: [{ seatIndex: 0 }] }) === false && f.isBust() === false && f.leftoverSticksTransfer() === null, 'no dealer repeat, no bust, no sticks');
  assert(f.isRiichi(0) === false && f.getRiichiSeats().length === 0 && f.isTripleRonAbort(3) === false && f.afterDiscardResolved() === null, 'riichi / abortive hooks are no-ops');
  assertThrows(() => f.onRiichiDeclared(0), Error, 'no riichi in MCR');
  assert(f.maxWinnersPerDiscard() === 1 && new ChineseOfficialRules({ multipleWinners: true }).createTurnFlow(gm).maxWinnersPerDiscard() === Infinity, 'one winner per discard unless multipleWinners');
  assertThrows(() => new ChineseOfficialRules({ basePayment: -1 }), TypeError, 'basePayment ≥ 0');
  assertThrows(() => new ChineseOfficialRules({ multipleWinners: 'no' }), TypeError, 'multipleWinners boolean');
});

// ---------------------------------------------------------------------------
section('2. Flowers in the deal', () => {
  const events = [];
  const gm = rig({ hands: ['F1 123d 456d 789d 123b', IDLE[0], 'F2 S3 123b 456b 789b 12c', IDLE[2]], dealer: 2, back: '5c 6c F4 7c' });
  gm.getEventBus().on('game:bonus-tile', (e) => events.push(`${e.seatIndex}:${e.tile.id}`));
  gm._replaceInitialBonusTiles();
  const f = gm.getTurnFlow();
  assert(events.join(' ') === '2:flower-2 2:season-3 0:flower-1 2:flower-4', `dealer (seat 2) first, then seat 0; a flower drawn as a replacement is set aside next round (${events.join(' ')})`);
  assert(f.getFlowerCount(2) === 3 && f.getFlowerCount(0) === 1 && f.getFlowerCount(1) === 0, 'flower counts');
  assert(gm.getPlayers().every((p) => !p.getHand().concealedTiles.some((t) => t.isBonus) && p.getHand().concealedTiles.length === 13), 'no flower left in any hand, all hands 13');
  assert(find(gm, 2, 'characters-7') && find(gm, 2, 'characters-5') && find(gm, 0, 'characters-6'), 'replacements came from the end of the wall (7c, 6c, then 5c after the F4)');
  assert(gm.getSelfActions().length === 0 && gm.getTurnFlow().selfStateExtras(2).flowerCount === 3, 'flowerCount reaches the rule engine state');

  let ok = 0; let flowers = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = new GameManager({ ruleEngine: new ChineseOfficialRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed });
    const set = g.getTurnFlow().getSetAsideTiles().length;
    flowers += set;
    const clean = g.getPlayers().every((p) => p.getHand().concealedTiles.length === 13 && !p.getHand().concealedTiles.some((t) => t.isBonus));
    if (clean && g.getWall().remainingCount === 144 - 52 - set) ok++;
  }
  assert(ok === 30 && flowers > 0, `30 random deals: hands clean, 144 = 52 + flowers + wall (${flowers} flowers set aside in all)`);
  const g3 = new GameManager({ ruleEngine: new ChineseOfficialRules({ playerCount: 3 }), playerConfigs: humans(3), eventBus: new EventBus(), seed: 4 });
  assert(g3.getWall().remainingCount === 144 - 39 - g3.getTurnFlow().getSetAsideTiles().length, 'three players: same accounting');
  const nf = new GameManager({ ruleEngine: new ChineseOfficialRules({ flowers: false }), playerConfigs: humans(4), eventBus: new EventBus(), seed: 4 });
  assert(nf.getWall().remainingCount === 136 - 52 && nf.getTurnFlow().getSetAsideTiles().length === 0, 'flowers:false → 136 tiles, nothing set aside');
});

// ---------------------------------------------------------------------------
section('3. Flowers on a draw', () => {
  const gm = rig({ hands: IDLE, front: 'F1 2c', back: '3c 4c' });
  const before = gm.getWall().remainingCount;
  const d = gm.performDraw();
  assert(d.type === 'drawn' && d.bonusTiles?.length === 1 && d.tile.id === 'characters-4' && !d.isReplacement, `a flower drawn → set aside, replaced from the end (4c), not a Kong replacement (${d.tile?.id})`);
  assert(gm.getTurnFlow().getFlowerCount(0) === 1 && gm.getWall().remainingCount === before - 2, 'counted; two tiles left the wall');
  assert(!gm.getPlayer(0).getHand().concealedTiles.some((t) => t.isBonus) && gm.getPlayer(0).getHand().concealedTiles.length === 14, 'the hand holds 14 standard tiles');
  assert(gm.getTableView().bonusTiles[0][0].id === 'flower-1', 'shown in the table view');

  const chain = rig({ hands: IDLE, front: 'F1', back: '3c F2' });
  const c = chain.performDraw();
  assert(c.bonusTiles.map((t) => t.id).join() === 'flower-1,flower-2' && c.tile.id === 'characters-3', 'a flower replaced by a flower → both set aside');

  const k = rig({ hands: ['1111d 23d 456b 789c 1b', IDLE[1], IDLE[2], IDLE[3]], front: '9c', back: '5c F3' });
  k.performDraw();
  const kong = k.declareKong(k.getSelfActions().find((a) => a.type === ACTION_TYPE.KONG));
  assert(kong.draw.isReplacement === true && kong.draw.bonusTiles?.[0].id === 'flower-3' && kong.draw.tile.id === 'characters-5', `a Kong replacement that brings a flower is still a Kong replacement (${JSON.stringify({ r: kong.draw.isReplacement, b: kong.draw.bonusTiles?.map((t) => t.id), t: kong.draw.tile?.id, ty: kong.draw.type })})`);

  const end = rig({ hands: IDLE, front: '', back: '' });
  end._wall = new WallManager(tl('F4'));
  const e = end.performDraw();
  assert(e.type === 'exhausted' && e.bonusTiles?.[0].id === 'flower-4' && end.getTurnFlow().getFlowerCount(0) === 1, 'a flower as the last tile → set aside, no replacement → exhaustive draw');
});

// ---------------------------------------------------------------------------
section('4. Flowers in scoring', () => {
  // 123d 456b 789c 111d E + E: Mixed Straight 8 + Fully Concealed 4 + Tile Hog 2 + Pung of Terminals 1 + Single Wait 1 = 16.
  const gm = rig({ hands: ['123d 456b 789c 111d E', IDLE[1], IDLE[2], IDLE[3]], front: 'F1', back: 'E F2' });
  const d = gm.performDraw();
  const win = d.actions.find((a) => a.type === ACTION_TYPE.WIN);
  assert(d.bonusTiles?.length === 2 && win && win.validation.flowerPoints === 2 && win.validation.points === 16 && win.score.points === 18, `two flowers: 16 points + 2 = 18 (${win?.score.points})`);
  const w = gm.declareTsumo();
  assert(w.points === 18 && w.breakdown.some((b) => b.id === 'flower-tiles' && b.points === 2), 'the winner record carries the flower line');

  // 7 points of fans + flowers never reach the minimum.
  // Seat 1: 234d 567b 678c 22d 34b + a discarded 5b = 6 points (All Chows, All Simples, Concealed Hand).
  const low = rig({ hands: ['5b 19d 19b 19c SWN RG', '234d 567b 678c 22d 34b', IDLE[2], IDLE[3]] });
  for (const id of ['flower-1', 'flower-2', 'flower-3']) low.getTurnFlow().onBonusTile(1, mk(id));
  low.getTurnManager().forceSetTurn(0, TURN_PHASE.AWAITING_DISCARD);
  const r = low.performDiscard(find(low, 0, 'bamboo-5'));
  assert(!r.winners, 'a 6-point hand with three flowers is still below 8 — no Ron');
});

// ---------------------------------------------------------------------------
section('5. Last copy', () => {
  const gm = rig({ hands: ['123d 456b 789c 111d E', IDLE[1], IDLE[2], IDLE[3]], front: '' });
  const f = gm.getTurnFlow();
  const e = mk('wind-east');
  assert(f.visibleCopies(e) === 0, 'nothing visible');
  gm.getPlayer(1).getDiscardPile().discard(mk('wind-east'));
  gm.getPlayer(2).getDiscardPile().discard(mk('wind-east'));
  assert(f.visibleCopies(e) === 2 && !f.scoringContext(gm.getPlayer(0), { winningTile: e }).isLastCopy, 'two discarded → not yet the last copy');
  const claimed = mk('wind-east'); gm.getPlayer(3).getDiscardPile().discard(claimed); gm.getPlayer(3).getDiscardPile().markLastClaimed(2, ACTION_TYPE.PON);
  assert(f.visibleCopies(e) === 2, 'a claimed discard is counted in its meld, not twice in the river');
  gm.getPlayer(3).getDiscardPile().discard(mk('wind-east'));
  assert(f.visibleCopies(e) === 3 && f.scoringContext(gm.getPlayer(0), { winningTile: e }).isLastCopy, 'three visible → the winning tile is the last copy');
  gm.getPlayer(2).addMeld(meld(MELD_TYPE.PON, '5c 5c 5c'));
  assert(f.visibleCopies(mk('characters-5')) === 3, 'exposed meld tiles are visible');
  gm.getPlayer(1).addMeld(new Meld({ type: MELD_TYPE.KONG, tiles: tl('9d 9d 9d 9d'), concealed: true }));
  assert(f.visibleCopies(mk('dots-9')) === 0, 'a concealed Kong is not visible');

  // Through the engine: seat 2 shows a Pung of 5b; seat 3 discards the fourth 5b; seat 0 (46b closed wait) Rons it.
  // The winner's own concealed copies never count — the other three must be on the table.
  const g = rig({ hands: ['123d 789b 456c 11d 46b', IDLE[1], '19d 19b 19c ESWN R', '5b 19d 19b 19c SWN RG'], melds: [[], [], [meld(MELD_TYPE.PON, '5b 5b 5b')]] });
  g.getTurnManager().forceSetTurn(3, TURN_PHASE.AWAITING_DISCARD);
  const r = g.performDiscard(find(g, 3, 'bamboo-5'));
  assert(r.winners?.[0].seatIndex === 0 && r.winners[0].breakdown.some((b) => b.id === 'last-tile'), `Ron on the last 5b scores Last Tile (${r.winners?.[0].breakdown.map((b) => b.id).join(' ')})`);
  const g2 = rig({ hands: ['123d 789b 456c 11d 46b', IDLE[1], IDLE[2], '5b 19d 19b 19c SWN RG'] });
  g2.getTurnManager().forceSetTurn(3, TURN_PHASE.AWAITING_DISCARD);
  const r2 = g2.performDiscard(find(g2, 3, 'bamboo-5'));
  assert(r2.winners?.[0] && !r2.winners[0].breakdown.some((b) => b.id === 'last-tile'), 'with the other copies unseen → no Last Tile');
});

// ---------------------------------------------------------------------------
section('6. Robbing the Kong', () => {
  // Seat 0 has an exposed Pung of 5b and draws the fourth; seat 1 waits on 5b.
  const gm = rig({
    hands: ['123d 456d 789d 1c', '123d 456c 789b 111c 5b', IDLE[2], IDLE[3]],
    melds: [[meld(MELD_TYPE.PON, '5b 5b 5b')]], front: '5b',
  });
  gm.getPlayer(1).removeTileFromHand(find(gm, 1, 'bamboo-5'));
  gm.getPlayer(1).addTileToHand(mk('bamboo-4'));
  gm.getPlayer(1).removeTileFromHand(find(gm, 1, 'characters-1'));
  gm.getPlayer(1).addTileToHand(mk('bamboo-6'));
  // seat 1: 123d 456c 789b 11c 46b → closed wait on 5b.
  gm.performDraw();
  const added = gm.getSelfActions().find((a) => a.type === ACTION_TYPE.KONG && a.kongType === KONG_TYPE.ADDED);
  const res = gm.declareKong(added);
  assert(res.robbed?.length === 1 && res.robbed[0].seatIndex === 1 && res.robbed[0].calledFrom === 0, 'the added Kong is robbed by seat 1');
  assert(res.robbed[0].breakdown.some((b) => b.id === 'robbing-the-kong'), 'scored with Robbing the Kong');
  assert(gm.getTurnFlow().robbableKong({ kongType: KONG_TYPE.CONCEALED, tile: mk('bamboo-5') }) === null, 'a concealed Kong is never offered');
});

// ---------------------------------------------------------------------------
section('7. One winner per discard', () => {
  const hands = ['E 19d 19b 19c SWN RG 5d', '123d 456b 789c 111d E', '123c 456d 789b 111b E', IDLE[3]];
  const run = (rules) => {
    const gm = rig({ hands, rules });
    gm.getTurnManager().forceSetTurn(0, TURN_PHASE.AWAITING_DISCARD);
    return gm.performDiscard(find(gm, 0, 'wind-east'));
  };
  const one = run(new ChineseOfficialRules());
  assert(one.winners?.length === 1 && one.winners[0].seatIndex === 1, 'two players can Ron → only the first in turn order (seat 1) wins');
  const two = run(new ChineseOfficialRules({ multipleWinners: true }));
  assert(two.winners?.length === 2, 'multipleWinners:true → both');
});

// ---------------------------------------------------------------------------
section('8. Settlement + session', () => {
  const ron = settleChineseOfficialHand({ outcome: { type: 'win', winners: [{ seatIndex: 1, winType: 'discard', calledFrom: 3, points: 10, meetsMinimum: true }] }, playerCount: 4 });
  assert(JSON.stringify(ron.map((t) => [t.from, t.amount])) === JSON.stringify([[0, 8], [2, 8], [3, 18]]), `Ron: discarder pays 8 + 10, the others 8 (${JSON.stringify(ron)})`);
  const tsumo = settleChineseOfficialHand({ outcome: { type: 'win', winners: [{ seatIndex: 2, winType: 'self', points: 12, meetsMinimum: true }] }, playerCount: 3 });
  assert(tsumo.length === 2 && tsumo.every((t) => t.amount === 20 && t.to === 2), 'Tsumo (3 players): each other player pays 8 + 12');
  assert(settleChineseOfficialHand({ outcome: { type: 'draw' }, playerCount: 4 }).length === 0 && settleChineseOfficialHand({ outcome: null, playerCount: 4 }).length === 0, 'draw → nothing');
  assert(settleChineseOfficialHand({ outcome: { type: 'win', winners: [{ seatIndex: 0, winType: 'self', points: 9, meetsMinimum: true }] }, playerCount: 4, basePayment: 0 })[0].amount === 9, 'basePayment option');
  assert(MCR_BASE_PAYMENT === 8, 'base 8');
  assertThrows(() => settleChineseOfficialHand({ outcome: null, playerCount: 1 }), RangeError, 'playerCount checked');
  assertThrows(() => settleChineseOfficialHand({ outcome: { type: 'win', winners: [{ seatIndex: 0, winType: 'self', points: 'x', meetsMinimum: true }] }, playerCount: 4 }), TypeError, 'points checked');

  // Through GameManager: a dealer Tsumo of 18 → each pays 26, dealer passes.
  const gm = rig({ hands: ['123d 456b 789c 111d E', IDLE[1], IDLE[2], IDLE[3]], front: 'F1', back: 'E F2' });
  gm.performDraw();
  gm.declareTsumo();
  const st = gm.settleRound();
  assert(st.transfers.length === 3 && st.transfers.every((t) => t.amount === 26) && gm.getPlayer(0).score === 78, `dealer Tsumo 18 → 3 × (8 + 18) = 78 (${gm.getPlayer(0).score})`);
  assert(gm.getPlayers().reduce((a, p) => a + p.score, 0) === 0, 'zero-sum');
  gm.startNextHand();
  assert(gm.getDealerIndex() === 1, 'the deal passes even after a dealer win');

  // A whole East round: four hands, one per dealer, then complete.
  const s = new GameManager({ ruleEngine: new ChineseOfficialRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 7 });
  const dealers = [];
  for (let h = 0; h < 8; h++) {
    dealers.push(s.getDealerIndex());
    while (!s.isRoundOver()) {
      const d = s.performDraw();
      if (d.type !== 'drawn') break;
      s.performDiscard(s.getPlayer(d.seatIndex).getHand().concealedTiles.slice(-1)[0]);
    }
    s.settleRound();
    if (s.isGameComplete()) break;
    s.startNextHand();
  }
  assert(dealers.join() === '0,1,2,3' && s.isGameComplete(), `four hands, each seat deals once (${dealers.join()})`);
  assert(s.getPlayers().reduce((a, p) => a + p.score, 0) === 0, 'the session stays zero-sum');
});

// ---------------------------------------------------------------------------
section('9. Saves', () => {
  const gm = new GameManager({ ruleEngine: new ChineseOfficialRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 11 });
  for (let i = 0; i < 12 && !gm.isRoundOver(); i++) {
    const d = gm.performDraw();
    if (d.type !== 'drawn') break;
    gm.performDiscard(gm.getPlayer(d.seatIndex).getHand().concealedTiles.slice(-1)[0]);
  }
  const before = gm.getTurnFlow().toJSON();
  const set = gm.getTurnFlow().getSetAsideTiles().length;
  const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: RULESET_ID.CHINESE_OFFICIAL, difficulty: 'basic' })));
  const back = hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: { [RULESET_ID.CHINESE_OFFICIAL]: () => new ChineseOfficialRules() }, eventBus: new EventBus() });
  assert(set > 0 && JSON.stringify(back.getTurnFlow().toJSON()) === JSON.stringify(before), `flowers set aside survive the snapshot (${set})`);
  assert(back.getTurnFlow().getSetAsideTiles().every((t) => t.isBonus), 'restored as bonus tiles');
  const f = back.getTurnFlow();
  assertThrows(() => f.restoreState({ bonus: [[]] }), TypeError, 'every seat required');
  assertThrows(() => f.restoreState({ bonus: [[{ id: 'dots-1', instanceId: 'x' }], [], [], []] }), TypeError, 'only bonus tiles');
  assertThrows(() => f.restoreState(null), TypeError, 'state required');
});

summary();
