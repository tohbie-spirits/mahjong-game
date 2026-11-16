/**
 * riichiTurnFlow.test.mjs — Task 89: Riichi turn flow through GameManager.
 *
 * Hands and draw order are rigged on a real Riichi GameManager (rig() below
 * rebuilds hands, wall and dead wall, then restarts the flow's hand state),
 * then the real GameManager API is driven: performDraw / declareRiichi /
 * performDiscard / declareKong / declareTsumo / declareAbortiveDraw.
 *
 * Sections:
 *   1. Session + hooks — starting scores 25000 / 35000; HK has no flow and
 *      no allowedTiles (unchanged)
 *   2. Riichi — declaration, stick taken only when the discard isn't won off,
 *      riichi lock enforced, illegal declarations refused, riichi Tsumo
 *   3. Double riichi + ippatsu — and ippatsu broken by a call
 *   4. Furiten — temporary (incl. no-yaku waits) cleared by own discard;
 *      riichi furiten from a declined Ron and from a skipped Tsumo; Ron
 *      refused but Tsumo allowed
 *   5. Swap-calling ban after a Chi enforced by performDiscard
 *   6. Kans — closed Kan reveals kan dora at once; added Kan at the next
 *      discard; chankan robs an added Kan; dora reach the score
 *   7. Abortive draws — nine terminals, four winds, four riichi, triple Ron,
 *      four Kans by two players
 *
 * Run: node tests/core/riichiTurnFlow.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { faceIds } from '../_helpers/tiles.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { WallManager } from '../../src/core/WallManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Tile } from '../../src/core/Tile.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { AIStrategyInterface } from '../../src/ai/AIStrategyInterface.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { ACTION_TYPE, SEAT_KIND, TURN_PHASE, KONG_TYPE, MELD_TYPE } from '../../src/utils/constants.js';
import { Meld } from '../../src/core/Hand.js';

/** A scripted AI: never wins by choice unless told, claims what it's told. */
class Scripted extends AIStrategyInterface {
  constructor({ win = true, claim = () => null } = {}) { super('basic'); this.win = win; this.claim = claim; }
  chooseDiscard(p) { const t = p.getHand().concealedTiles; return t[t.length - 1]; }
  chooseClaim(p, actions) { return this.claim(p, actions) ?? { type: ACTION_TYPE.PASS }; }
  chooseWinDeclaration() { return this.win; }
}

let uid = 0;
const mk = (id) => Tile.fromId(id, `${id}#r${++uid}`);
const many = (spec) => faceIds(spec).map(mk);

/**
 * Rigs hands and the wall. `draws` are the live-wall tiles in draw order;
 * `dora` the first dora indicator (dead-wall position 5); `kinds` seat kinds.
 */
function rig({ hands, draws, dora = 'characters-9', rules = new RiichiRules(), kinds = ['human', 'human', 'human', 'human'], ai = null, dealer = 0 }) {
  const n = hands.length;
  const configs = hands.map((_, i) => ({ seatIndex: i, displayName: `P${i}`, seatKind: kinds[i] === 'ai' ? SEAT_KIND.AI : SEAT_KIND.HUMAN, aiDifficulty: kinds[i] === 'ai' ? 'basic' : null }));
  const gm = new GameManager({ ruleEngine: rules, playerConfigs: configs, aiManager: ai ? new AIManager({ strategies: [ai] }) : null, eventBus: new EventBus(), seed: 1, dealerIndex: dealer });
  gm.getPlayers().forEach((p, i) => { p.resetForNewHand(); for (const t of many(hands[i])) p.addTileToHand(t); });
  const dead = [...many('1b 1b 1b 1b'), mk(dora), ...many('1c 1c 1c 1c 9c 9c 9c 9c 9c')];
  // Four filler draws at the end so riichi (≥ one live tile per player) stays possible.
  const wall = new WallManager([...many(draws), ...many('8c 8c 8c 8c'), ...dead]);
  wall.reserveDeadWall(14);
  gm._wall = wall;
  gm.getTurnFlow().onHandStart();
  gm.getTurnManager().forceSetTurn(dealer, TURN_PHASE.AWAITING_DRAW);
  return gm;
}
const find = (gm, seat, id) => gm.getPlayer(seat).getHand().concealedTiles.filter((t) => t.id === id).pop();
const discard = (gm, id) => gm.performDiscard(find(gm, gm.getTurnManager().getCurrentPlayerIndex(), id));
const has = (actions, type) => actions.some((a) => a.type === type);
// Filler hands that never win or call (scattered honours / terminals).
const IDLE = ['19d 19b 19c ESWN RG 5d', '28d 28b 28c ESWN RG 6d', '37d 37b 37c ESWN RG 4b'];

// ---------------------------------------------------------------------------
section('1. Session + hooks', () => {
  const cfg = (n) => Array.from({ length: n }, (_, i) => ({ seatIndex: i, displayName: `P${i}`, seatKind: SEAT_KIND.HUMAN, aiDifficulty: null }));
  const g4 = new GameManager({ ruleEngine: new RiichiRules(), playerConfigs: cfg(4), eventBus: new EventBus(), seed: 2 });
  assert(g4.getPlayers().every((p) => p.score === 25000), 'four-player Riichi starts everyone at 25000');
  const g3 = new GameManager({ ruleEngine: new RiichiRules({ playerCount: 3 }), playerConfigs: cfg(3), eventBus: new EventBus(), seed: 2 });
  assert(g3.getPlayers().every((p) => p.score === 35000), 'three-player Riichi starts at 35000');
  assert(new GameManager({ ruleEngine: new RiichiRules({ startingScore: 30000 }), playerConfigs: cfg(4), eventBus: new EventBus(), seed: 2 }).getPlayer(0).score === 30000, 'startingScore option');
  const hk = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: cfg(4), eventBus: new EventBus(), seed: 2 });
  assert(hk.getTurnFlow() === null && hk.getPlayer(0).score === 0 && !('riichiSeats' in hk.getTableView()), 'Hong Kong: no turn flow, scores and table view unchanged');
  hk.performDraw();
  assert(!hk.getSelfActions().find((a) => a.type === ACTION_TYPE.DISCARD).allowedTiles, 'Hong Kong DISCARD lists no allowedTiles');
  assert(g4.getTableView().riichiSeats.length === 0 && g4.getTableView().doraIndicators.length === 1, 'Riichi table view adds riichi seats + dora indicators');
});

// ---------------------------------------------------------------------------
section('2. Riichi', () => {
  const gm = rig({ hands: ['23d 456b 789b 123c EE', ...IDLE], draws: '9d 1b 2b 3b 9b 8b' });
  gm.performDraw();
  const act = gm.getSelfActions().find((a) => a.type === ACTION_TYPE.RIICHI);
  assert(act && act.allowedTiles.length === 1 && act.allowedTiles[0].id === 'dots-9', 'RIICHI offered: discard 9d keeps 1d/4d');
  assertThrows(() => gm.declareRiichi(find(gm, 0, 'wind-east')), Error, 'a discard that breaks tenpai is refused');
  gm.declareRiichi(find(gm, 0, 'dots-9'));
  const flow = gm.getTurnFlow();
  assert(flow.isRiichi(0) && gm.getPlayer(0).score === 24000 && flow.riichiSticks === 1, 'riichi stands: 1000 to the table');
  assert(gm.getTableView().riichiSeats.join() === '0', 'table view shows seat 0 in riichi');
  for (let s = 1; s <= 3; s++) { gm.performDraw(); discard(gm, gm.getPlayer(s).getHand().concealedTiles.slice(-1)[0].id); }
  gm.performDraw(); // seat 0 draws 9b
  const da = gm.getSelfActions().find((a) => a.type === ACTION_TYPE.DISCARD);
  assert(da.allowedTiles.length === 1 && da.allowedTiles[0].id === 'bamboo-9', 'in riichi: only the drawn tile may be discarded');
  assertThrows(() => discard(gm, 'wind-east'), Error, 'performDiscard enforces the riichi lock');
  assert(!has(gm.getSelfActions(), ACTION_TYPE.RIICHI), 'no second riichi');

  // Declaration discard won off → riichi void, no stick.
  const g2 = rig({ hands: ['23d 456b 789b 123c EE', '78d 234b 456b 678c 55c', ...IDLE.slice(0, 2)], draws: '9d 1b 2b' });
  g2.performDraw();
  const r = g2.declareRiichi(find(g2, 0, 'dots-9'));
  assert(r.winners && r.winners[0].seatIndex === 1, 'seat 1 wins off the declaration tile (Pinfu)');
  assert(g2.getPlayer(0).score === 25000 && g2.getTurnFlow().riichiSticks === 0 && !g2.getTurnFlow().isRiichi(0), 'a declaration that is won off never stands — no stick taken');

  // Riichi Tsumo: breakdown has Riichi + Tsumo (and the dora context runs).
  const g3 = rig({ hands: ['23d 456b 789b 123c EE', ...IDLE], draws: '9d 1b 2b 3b 1d', dora: 'wind-north' });
  g3.performDraw(); g3.declareRiichi(find(g3, 0, 'dots-9'));
  for (let s = 1; s <= 3; s++) { g3.performDraw(); discard(g3, g3.getPlayer(s).getHand().concealedTiles.slice(-1)[0].id); }
  g3.performDraw();
  const w = g3.declareTsumo();
  const ids = w.score.breakdown.map((b) => b.id);
  // Declared on the first discard and won on the next draw → Double Riichi + Ippatsu (not plain Riichi).
  assert(ids.includes('double-riichi') && ids.includes('ippatsu') && ids.includes('menzen-tsumo') && w.score.breakdown.find((b) => b.id === 'dora')?.han === 2, `riichi Tsumo scored with dora from the dead wall (North indicator → East ×2): ${ids.join(', ')}`);
  assert(w.score.breakdown.some((b) => b.id === 'uraDora'), 'a riichi winner also counts ura dora (9c indicator → 1c)');
});

// ---------------------------------------------------------------------------
section('3. Double riichi + ippatsu', () => {
  const gm = rig({ hands: ['23d 456b 789b 123c EE', '1d 19b 19c ESWN RG 5d 6c', ...IDLE.slice(1)], draws: '9d 5b 2b 3b' });
  gm.performDraw();
  gm.declareRiichi(find(gm, 0, 'dots-9'));
  gm.performDraw(); // seat 1 draws 5b
  const r = discard(gm, 'dots-1');
  const w = r.winners?.[0];
  const ids = w?.score.breakdown.map((b) => b.id) ?? [];
  assert(w && w.seatIndex === 0 && ids.includes('double-riichi') && ids.includes('ippatsu') && !ids.includes('riichi'), `first-discard riichi + Ron before the next discard: Double Riichi + Ippatsu (${ids.join(', ')})`);

  // A call in between breaks ippatsu (seat 2 is an AI that Pons the 7b).
  const pon = new Scripted({ claim: (p, a) => a.find((x) => x.type === ACTION_TYPE.PON) });
  const g2 = rig({ hands: ['23d 456b 789b 123c EE', '7b 9d 19b 19c ESWN RG 5c', '77b 28d 28c ESWN RG 5d', IDLE[2]], draws: '9d 3b 1d', kinds: ['human', 'human', 'ai', 'human'], ai: pon });
  g2.performDraw(); g2.declareRiichi(find(g2, 0, 'dots-9'));
  g2.performDraw(); const claim = discard(g2, 'bamboo-7');
  assert(claim.claim?.action.type === ACTION_TYPE.PON && claim.claim.action.seatIndex === 2, 'seat 2 Pons 7b');
  discard(g2, 'dots-5'); // seat 2's post-Pon discard passes
  assert(g2.getTurnFlow().selfStateExtras(0).isIppatsu === false, 'a call by anyone ends ippatsu');
});

// ---------------------------------------------------------------------------
section('4. Furiten', () => {
  // Seat 1 waits 1d/4d with an East seat... (seat 1 is South) → no yaku: can't Ron, but becomes temp-furiten.
  const gm = rig({ hands: [IDLE[0].replace('5d', '4d'), '23d 456b 789b 123c EE', IDLE[1], IDLE[2]], draws: '9d 2b 3b 4b 5b', kinds: ['human', 'human', 'human', 'human'] });
  gm.performDraw(); discard(gm, 'dots-4');
  assert(gm.getTurnFlow().getFuriten(1).temporary, 'a passing winning tile (even without a yaku) makes the waiting player temporarily furiten');
  gm.performDraw(); discard(gm, 'bamboo-2');
  assert(!gm.getTurnFlow().getFuriten(1).temporary, 'cleared by the player\'s own next discard');

  // Riichi furiten from a declined Ron: seat 0 (in riichi) is a scripted AI that never declares wins.
  const decline = new Scripted({ win: false });
  const g2 = rig({ hands: ['23d 456b 789b 123c EE', IDLE[0], IDLE[1], IDLE[2]], draws: '9d 2b 3b 5b 1d', kinds: ['ai', 'human', 'human', 'human'], ai: decline });
  g2.performDraw(); g2.declareRiichi(find(g2, 0, 'dots-9'));
  g2.performDraw(); discard(g2, 'dots-1'); // seat 1 throws 1d — seat 0 declines
  const flow = g2.getTurnFlow();
  assert(flow.getFuriten(0).riichi, 'a declined winning tile after riichi → riichi furiten for the rest of the hand');
  const ronState = { kind: 'discard', seatIndex: 0, playerCount: 4, wallRemaining: 20, discard: { tile: mk('dots-4'), fromSeat: 2 }, ...flow.discardStateExtras(0) };
  assert(!has(g2.getRuleEngine().getLegalActions(ronState, g2.getPlayer(0)), ACTION_TYPE.WIN), 'Ron on the other wait (4d) is now refused');
  g2.performDraw(); discard(g2, 'bamboo-3');
  g2.performDraw(); discard(g2, 'bamboo-5');
  g2.performDraw(); // seat 0 draws 1d
  assert(has(g2.getSelfActions(), ACTION_TYPE.WIN), '…but Tsumo is still allowed');

  // Skipping a Tsumo win in riichi → riichi furiten.
  const g3 = rig({ hands: ['23d 456b 789b 123c EE', ...IDLE], draws: '9d 2b 3b 5b 1d' });
  g3.performDraw(); g3.declareRiichi(find(g3, 0, 'dots-9'));
  for (let s = 1; s <= 3; s++) { g3.performDraw(); discard(g3, g3.getPlayer(s).getHand().concealedTiles.slice(-1)[0].id); }
  g3.performDraw();
  assert(has(g3.getSelfActions(), ACTION_TYPE.WIN), 'seat 0 could Tsumo on 1d…');
  discard(g3, 'dots-1');
  assert(g3.getTurnFlow().getFuriten(0).riichi, '…but discards it instead → riichi furiten');
});

// ---------------------------------------------------------------------------
section('5. Swap-calling ban', () => {
  const chi = new Scripted({ claim: (p, a) => a.find((x) => x.type === ACTION_TYPE.CHI) });
  const gm = rig({ hands: ['3d 19b 19c ESWN RG 9d 8d', '45d 6d 19b 19c ESWN RG', IDLE[1], IDLE[2]], draws: '2c 2b', kinds: ['human', 'ai', 'human', 'human'], ai: chi });
  gm.performDraw();
  const r = discard(gm, 'dots-3');
  assert(r.claim?.action.type === ACTION_TYPE.CHI && r.claim.action.seatIndex === 1, 'seat 1 Chis 3-4-5 with the 3');
  const da = gm.getSelfActions().find((a) => a.type === ACTION_TYPE.DISCARD);
  assert(!da.allowedTiles.some((t) => t.id === 'dots-6') && da.allowedTiles.length === 10, 'the 6 (other end of 3-4-5) may not be discarded right after the Chi');
  assertThrows(() => discard(gm, 'dots-6'), Error, 'performDiscard refuses the swap tile');
  discard(gm, 'wind-east');
  assert(!gm.getTurnFlow().selfStateExtras(1).lastCall, 'the ban ends with that discard');
});

// ---------------------------------------------------------------------------
section('6. Kans, kan dora, chankan', () => {
  const g1 = rig({ hands: ['1111d 23b 456c 789c E', ...IDLE], draws: '9b 2c' });
  g1.performDraw();
  const kan = g1.getSelfActions().find((a) => a.type === ACTION_TYPE.KONG);
  const res = g1.declareKong(kan);
  assert(res.draw.type === 'drawn' && res.draw.isReplacement && res.draw.tile.id === 'bamboo-1', 'closed Kan → replacement from the dead wall');
  assert(g1.getTurnFlow().getDoraIndicators().length === 2 && g1.getTurnFlow().getKongCount() === 1, 'a closed Kan reveals its kan-dora indicator at once');

  // Added Kan: the indicator waits for the next discard.
  const g2 = rig({ hands: ['5d 23b 456c 789c E', ...IDLE], draws: '5d 2c 3c' });
  g2.getPlayer(0).addMeld(new Meld({ type: MELD_TYPE.PON, tiles: many('5d 5d 5d'), calledFrom: 2 }));
  g2.performDraw();
  const added = g2.getSelfActions().find((a) => a.type === ACTION_TYPE.KONG && a.kongType === KONG_TYPE.ADDED);
  g2.declareKong(added);
  assert(g2.getTurnFlow().getDoraIndicators().length === 1, 'an added Kan does not reveal its indicator yet (a Rinshan win would not see it)');
  discard(g2, 'wind-east');
  assert(g2.getTurnFlow().getDoraIndicators().length === 2, '…it is revealed with the next discard');

  // Chankan: seat 1 waits on 5d (34 + 5, Pinfu) and robs the added Kan.
  const g3 = rig({ hands: ['5d 23b 456c 789c E', '34d 456b 789b 123c 55c', IDLE[1], IDLE[2]], draws: '5d 2c' });
  g3.getPlayer(0).addMeld(new Meld({ type: MELD_TYPE.PON, tiles: many('5d 5d 5d'), calledFrom: 2 }));
  g3.performDraw();
  const rob = g3.declareKong(g3.getSelfActions().find((a) => a.type === ACTION_TYPE.KONG));
  const w = rob.robbed?.[0];
  assert(w && w.seatIndex === 1 && w.calledFrom === 0 && rob.meld === null, 'seat 1 robs the Kan: Ron from seat 0, no Kan made');
  assert(w.score.breakdown.some((b) => b.id === 'chankan') && g3.getLastOutcome().chankan === true, 'scored with Chankan');
  assert(g3.getTurnFlow().getKongCount() === 0, 'a robbed Kan is never counted');
});

// ---------------------------------------------------------------------------
section('7. Abortive draws', () => {
  const g1 = rig({ hands: [IDLE[0], IDLE[1], IDLE[2], IDLE[0]], draws: '2c', rules: new RiichiRules() });
  g1.performDraw();
  assert(has(g1.getSelfActions(), ACTION_TYPE.ABORTIVE_DRAW), 'nine terminals offered on the first draw');
  const ab = g1.declareAbortiveDraw();
  assert(ab.type === 'abortive' && ab.reason === 'nine-terminals' && g1.isRoundOver() && g1.getLastOutcome().type === 'abortive', 'declared: the hand ends as an abortive draw');
  assertThrows(() => g1.declareAbortiveDraw(), Error, 'not after the hand is over');

  const winds = ['E 28d 28b 28c SWN RG', 'E 37d 37b 37c SWN RG', 'E 46d 46b 46c SWN RG', 'E 19d 19b 19c SWN R'];
  const g2 = rig({ hands: winds.map((h, i) => (i === 3 ? `${h} 5c` : h)), draws: '2c 3c 4c 5c' });
  let last;
  for (let s = 0; s < 4; s++) { g2.performDraw(); last = discard(g2, 'wind-east'); }
  assert(last.abortive?.reason === 'four-winds' && g2.isRoundOver(), 'four East discards on the first go-around → four winds');

  const tenpai = '23d 456b 789b 123c EE';
  const g3 = rig({ hands: [tenpai, tenpai, tenpai, tenpai], draws: '9d 9d 9d 9d' });
  for (let s = 0; s < 4; s++) { g3.performDraw(); last = g3.declareRiichi(find(g3, s, 'dots-9')); }
  assert(last.abortive?.reason === 'four-riichi' && g3.getTurnFlow().riichiSticks === 4, 'the fourth riichi stands → four riichi abort (sticks stay on the table)');

  const pinfuWait = '23d 456b 789b 123c 55c';
  const g4 = rig({ hands: [IDLE[0], pinfuWait, pinfuWait, pinfuWait], draws: '2c' });
  g4.performDraw();
  const tr = discard(g4, 'dots-1');
  assert(tr.abortive?.reason === 'triple-ron' && !tr.winners, 'three Ron on one discard → triple-Ron abort');
  const g5 = rig({ hands: [IDLE[0], pinfuWait, pinfuWait, pinfuWait], draws: '2c', rules: new RiichiRules({ tripleRonAbort: false }) });
  g5.performDraw();
  assert(discard(g5, 'dots-1').winners.length === 3, 'tripleRonAbort:false → three winners');

  const g6 = rig({ hands: [...IDLE, IDLE[0]], draws: '2c 3c' });
  Object.assign(g6.getTurnFlow()._hand, { kongCount: 4, kongSeats: [0, 0, 1, 1], uninterrupted: false });
  g6.performDraw();
  assert(discard(g6, 'characters-2').abortive?.reason === 'four-kans', 'four Kans by two players → abort after the next discard');
  const g7 = rig({ hands: [...IDLE, IDLE[0]], draws: '2c 3c' });
  Object.assign(g7.getTurnFlow()._hand, { kongCount: 4, kongSeats: [2, 2, 2, 2], uninterrupted: false });
  g7.performDraw();
  assert(!discard(g7, 'characters-2').abortive, 'four Kans by ONE player (Suukantsu chance) → no abort');
});

summary();
