/**
 * gameFlow.test.mjs — rebuilt Tasks 19, 27–34, 60: TurnManager, claim
 * resolution + priority, wins, exhaustive draws, round progression,
 * GameManager orchestration, settlement, restore, and a headless full-game
 * simulation (random play, no AI manager).
 * Run: node tests/core/gameFlow.test.mjs
 */
import { section, assert, assertThrows, summary, mulberry32 } from '../_helpers/harness.mjs';
import { EventBus } from '../../src/core/EventBus.js';
import { TurnManager } from '../../src/core/TurnManager.js';
import { resolveClaimPriority, filterDiscardClaimActions } from '../../src/core/TurnInterruptionResolver.js';
import { computeNextHand, assignSeatWinds } from '../../src/core/RoundProgression.js';
import { GameManager } from '../../src/core/GameManager.js';
import { WallManager } from '../../src/core/WallManager.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { tiles, makeTileFactory } from '../_helpers/tiles.mjs';
import { ACTION_TYPE, TURN_PHASE, ROUND_END_REASON, WIND, SEAT_KIND, AI_DIFFICULTY } from '../../src/utils/constants.js';

const configs = (n, humanSeat = null) => Array.from({ length: n }, (_, i) => ({
  seatIndex: i,
  displayName: i === humanSeat ? 'You' : `AI ${i}`,
  seatKind: i === humanSeat ? SEAT_KIND.HUMAN : SEAT_KIND.AI,
  aiDifficulty: i === humanSeat ? null : AI_DIFFICULTY.BASIC,
}));
const newGame = (opts = {}) => new GameManager({ ruleEngine: new HongKongRules(opts.rules), playerConfigs: configs(opts.n ?? 4, opts.human ?? null), eventBus: new EventBus(), seed: opts.seed ?? 1, ...opts.gm });

/** All tile instance ids in play (hands, melds, discards, wall) — claimed discards counted once. */
function allInstanceIds(gm) {
  const ids = new Set();
  for (const p of gm.getPlayers()) {
    for (const t of p.getHand().allTiles) ids.add(t.instanceId);
    for (const t of p.getDiscardPile().tiles) ids.add(t.instanceId);
  }
  const snap = gm.getWall().getWallStateSnapshot();
  for (const t of snap.tiles.slice(snap.drawIndex, snap.liveWallEnd)) ids.add(t.instanceId);
  return ids;
}

/** Random headless play of the current hand (all AI seats auto-claim without an aiManager). */
function playHandRandomly(gm, rand) {
  let guard = 0;
  while (!gm.isRoundOver() && guard++ < 500) {
    const tm = gm.getTurnManager();
    let actions;
    if (tm.getPhase() === TURN_PHASE.AWAITING_DRAW) {
      const d = gm.performDraw();
      if (d.type === 'exhausted') break;
      actions = d.actions;
    } else actions = gm.getSelfActions();
    if (actions.some((a) => a.type === ACTION_TYPE.WIN)) { gm.declareTsumo(); break; }
    const kong = actions.find((a) => a.type === ACTION_TYPE.KONG);
    if (kong && rand() < 0.7) { const r = gm.declareKong(kong); if (r.draw.type === 'exhausted') break; continue; }
    const hand = gm.getPlayer(tm.getCurrentPlayerIndex()).getHand().concealedTiles;
    gm.performDiscard(hand[Math.floor(rand() * hand.length)]);
  }
  return gm.getLastOutcome();
}

section('TurnManager', () => {
  const tm = new TurnManager({ playerCount: 4, startingIndex: 2 });
  assert(tm.getCurrentPlayerIndex() === 2 && tm.getPhase() === TURN_PHASE.AWAITING_DRAW, 'starts with the dealer drawing');
  tm.markDrawn();
  assert(tm.getPhase() === TURN_PHASE.AWAITING_DISCARD, 'markDrawn → awaiting discard');
  tm.advanceAfterDiscard();
  assert(tm.getCurrentPlayerIndex() === 3 && tm.getTurnCount() === 1, 'advance to next seat');
  assertThrows(() => tm.advanceAfterDiscard(), Error, 'cannot advance from the draw phase');
  tm.forceSetTurn(0, TURN_PHASE.AWAITING_DISCARD);
  assert(tm.getCurrentPlayerIndex() === 0, 'forceSetTurn');
  tm.declareDraw();
  assert(tm.isRoundOver() && tm.getEndReason() === ROUND_END_REASON.WALL_EXHAUSTED, 'declareDraw ends the round');
  assertThrows(() => tm.declareWin(), Error, 'cannot end twice');
  assertThrows(() => new TurnManager({ playerCount: 5 }), RangeError, 'bad player count');
});

section('Claim priority', () => {
  const win2 = { type: ACTION_TYPE.WIN, seatIndex: 2 }; const win3 = { type: ACTION_TYPE.WIN, seatIndex: 3 };
  const pon3 = { type: ACTION_TYPE.PON, seatIndex: 3 }; const chi1 = { type: ACTION_TYPE.CHI, seatIndex: 1 };
  let r = resolveClaimPriority([chi1, pon3], 0, 4);
  assert(r.type === 'claim' && r.action === pon3, 'pon beats chi');
  r = resolveClaimPriority([chi1, pon3, win2], 0, 4);
  assert(r.type === 'win' && r.actions.length === 1 && r.actions[0] === win2, 'win beats everything');
  r = resolveClaimPriority([win3, win2], 1, 4);
  assert(r.actions.map((a) => a.seatIndex).join() === '2,3', 'multiple Ron winners, ordered from the discarder');
  assert(resolveClaimPriority([{ type: ACTION_TYPE.PASS }], 0, 4) === null, 'only passes → null');
  assert(filterDiscardClaimActions([{ type: 'discard' }, chi1]).length === 1, 'filter drops non-claims');
});

section('Round progression', () => {
  const w = assignSeatWinds(1, 4);
  assert(w[1] === WIND.EAST && w[2] === WIND.SOUTH && w[0] === WIND.NORTH, 'dealer is East, then turn order');
  assert(assignSeatWinds(0, 3).length === 3 && !assignSeatWinds(0, 3).includes(WIND.NORTH), '3-player: no North seat');
  const base = { startingDealerIndex: 0, roundWind: WIND.EAST, finalRoundWind: WIND.EAST, playerCount: 4, handIndex: 0 };
  let n = computeNextHand({ ...base, dealerIndex: 0, dealerWon: true, wasDraw: false });
  assert(n.dealerRepeats && n.dealerIndex === 0 && !n.isSessionComplete, 'dealer win → dealer repeats');
  n = computeNextHand({ ...base, dealerIndex: 0, dealerWon: false, wasDraw: true });
  assert(n.dealerRepeats, 'draw → dealer repeats');
  n = computeNextHand({ ...base, dealerIndex: 2, dealerWon: false, wasDraw: false });
  assert(n.dealerIndex === 3 && !n.isSessionComplete, 'non-dealer win → deal passes');
  n = computeNextHand({ ...base, dealerIndex: 3, dealerWon: false, wasDraw: false });
  assert(n.isSessionComplete, 'deal back to the first dealer after the final wind → session complete');
  n = computeNextHand({ ...base, finalRoundWind: WIND.SOUTH, dealerIndex: 3, dealerWon: false, wasDraw: false });
  assert(!n.isSessionComplete && n.roundWind === WIND.SOUTH && n.dealerIndex === 0, 'otherwise the round wind advances');
  n = computeNextHand({ ...base, dealerIndex: 0, dealerWon: true, wasDraw: false, handIndex: 9, maxHands: 10 });
  assert(n.isSessionComplete, 'maxHands safety cap');
});

section('GameManager setup', () => {
  const gm = newGame();
  const ps = gm.getPlayers();
  assert(ps.length === 4 && ps.every((p) => p.getHand().concealedCount === 13), 'four hands of 13');
  assert(ps[0].seatWind === WIND.EAST && gm.getTurnManager().getCurrentPlayerIndex() === 0, 'dealer East acts first');
  assert(gm.getWall().remainingCount === 136 - 52, 'wall after dealing');
  assert(allInstanceIds(gm).size === 136, 'all 136 tiles accounted for');
  assert(gm.getRoundState().roundWind === WIND.EAST && gm.getHandIndex() === 0 && gm.getFinalRoundWind() === WIND.EAST, 'round state');
  assert(gm.getExcludedFaceIds().length === 0, 'no excluded faces');
  const g3 = newGame({ n: 3 });
  assert(g3.getPlayers().length === 3 && g3.getWall().remainingCount === 136 - 39, '3-player uses the full set');
  assertThrows(() => new GameManager({ ruleEngine: {}, playerConfigs: configs(4) }), TypeError, 'bad rule engine');
  assertThrows(() => new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: configs(2) }), RangeError, 'needs 3–4 players');
  const a = newGame({ seed: 5 }); const b = newGame({ seed: 5 });
  assert(a.getPlayer(0).getHand().concealedTiles.map((t) => t.instanceId).join() === b.getPlayer(0).getHand().concealedTiles.map((t) => t.instanceId).join(), 'seeded deals reproducible');
});

section('Draw / discard cycle', () => {
  const gm = newGame({ seed: 2 });
  const d = gm.performDraw();
  assert(d.type === 'drawn' && d.seatIndex === 0 && gm.getPlayer(0).getHand().concealedCount === 14, 'dealer draws to 14');
  assert(d.actions[d.actions.length - 1].type === ACTION_TYPE.DISCARD, 'self actions end with DISCARD');
  assertThrows(() => gm.performDraw(), Error, 'cannot draw twice');
  const r = gm.performDiscard(d.tile);
  assert(r.type === 'discarded' && gm.getPlayer(0).getDiscardPile().length === 1, 'discard recorded');
  if (!r.claim && !r.winners) {
    assert(gm.getTurnManager().getCurrentPlayerIndex() === 1 && gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW, 'next seat to draw');
  } else assert(true, 'discard was claimed (seed-dependent)');
  assert(gm.getLastDiscard().tile === d.tile, 'last discard tracked');
});

/**
 * Builds an exact table via GameManager.restore(): hands from specs, a wall
 * whose next tiles are `wallSpec` (then filler), current seat + phase.
 */
function rigTable({ hands, wallSpec = '', current = 0, phase = TURN_PHASE.AWAITING_DISCARD, rules = new HongKongRules({ minimumFan: 0 }), humanSeat = null, aiManager = null }) {
  const f = makeTileFactory();
  const n = hands.length;
  const players = hands.map((spec, i) => {
    const p = new PlayerManager({ seatIndex: i, displayName: `P${i}`, seatKind: i === humanSeat ? SEAT_KIND.HUMAN : SEAT_KIND.AI, aiDifficulty: i === humanSeat ? null : AI_DIFFICULTY.BASIC });
    for (const t of tiles(spec, f)) p.addTileToHand(t);
    p.seatWind = assignSeatWinds(0, n)[i];
    return p;
  });
  const wallTiles = [...tiles(wallSpec, f), ...tiles('9c 9c 9b 9b 1c 1c 1b 1b 5c 5c', f)];
  const wall = new WallManager(wallTiles);
  const tm = new TurnManager({ playerCount: n, startingIndex: 0 });
  tm.forceSetTurn(current, phase);
  return GameManager.restore({ ruleEngine: rules, players, wall, turnManager: tm, roundState: { roundWind: WIND.EAST }, dealerIndex: 0, finalRoundWind: WIND.EAST, excludedFaceIds: [], handIndex: 0, eventBus: new EventBus(), aiManager });
}

section('Claims without an AI manager (exact tables)', () => {
  // Seat 0 discards 5d. Seat 1 (left of… next after 0) could Chi 3-4-5; seat 2 holds a pair → Pon wins.
  let gm = rigTable({ hands: ['5d 1b', '34d 9b', '55d 7c', '2c 8c'] });
  let r = gm.performDiscard(gm.getPlayer(0).getHand().findByFace('dots-5'));
  assert(r.claim && r.claim.action.type === ACTION_TYPE.PON && r.claim.action.seatIndex === 2, 'Pon (seat 2) beats Chi (seat 1)');
  assert(gm.getTurnManager().getCurrentPlayerIndex() === 2 && gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DISCARD, 'turn jumps to the Pon claimer, straight to discard');
  assert(gm.getPlayer(2).getHand().meldCount === 1 && gm.getPlayer(0).getDiscardPile().last.claimedBy === 2, 'meld added, discard marked');
  assert(r.claim.meld.calledFrom === 0 && r.claim.meld.calledTile.id === 'dots-5', 'meld records where the tile came from');

  gm = rigTable({ hands: ['5d 1b', '34d 9b', '2c 7c', '2b 8c'] });
  r = gm.performDiscard(gm.getPlayer(0).getHand().findByFace('dots-5'));
  assert(r.claim && r.claim.action.type === ACTION_TYPE.CHI && r.claim.action.seatIndex === 1, 'Chi taken by the next seat when nothing beats it');

  gm = rigTable({ hands: ['5d 1b', '9b 9c', '1c 7c', '555d 8c'], wallSpec: '6c 2d' });
  r = gm.performDiscard(gm.getPlayer(0).getHand().findByFace('dots-5'));
  assert(r.claim && r.claim.action.type === ACTION_TYPE.KONG && r.claim.action.seatIndex === 3, 'exposed Kong claimed');
  assert(gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW && gm.hasPendingReplacement(), 'Kong claimer must draw a replacement first (Task 42 fix)');
  const before = gm.getWall().peekUpcoming(1)[0];
  const d = gm.performDraw();
  assert(d.isReplacement && d.tile !== before, 'replacement drawn from the far end, not the next live tile');

  gm = rigTable({ hands: ['E 1b', '9b 9c', '1c 7c', '2b 8c'] });
  r = gm.performDiscard(gm.getPlayer(0).getHand().findByFace('wind-east'));
  assert(!r.claim && !r.winners && gm.getTurnManager().getCurrentPlayerIndex() === 1, 'no claims → next seat draws');
});

section('Human seat: auto-Ron only, never auto Chi/Pon/Kong', () => {
  let gm = rigTable({ hands: ['5d 1b', '55d 9b', '1c 7c', '2b 8c'], humanSeat: 1 });
  let r = gm.performDiscard(gm.getPlayer(0).getHand().findByFace('dots-5'));
  assert(!r.claim && !r.winners, 'human pair holder does not auto-pon');
  // Human waiting on East with a complete hand otherwise → auto Ron.
  gm = rigTable({ hands: ['E 1b', '123d 456d 789b 234c E', '1c 7c', '2b 8c'], humanSeat: 1 });
  r = gm.performDiscard(gm.getPlayer(0).getHand().findByFace('wind-east'));
  assert(r.winners && r.winners.length === 1 && r.winners[0].seatIndex === 1 && r.winners[0].winType === 'discard', 'human seat is given the Ron');
  assert(gm.playAITurn().type === 'not-applicable', 'playAITurn after the round ends is not applicable');
});

section('Tsumo, Ron, self-Kong and settlement (exact tables)', () => {
  // Tsumo: seat 0 waits on East; next wall tile is East.
  let gm = rigTable({ hands: ['123d 456d 789b 234c E', '1b 9b', '1c 7c', '2b 8c'], wallSpec: 'E', phase: TURN_PHASE.AWAITING_DRAW });
  const d = gm.performDraw();
  assert(d.actions.some((a) => a.type === ACTION_TYPE.WIN), 'Tsumo offered after drawing the winning tile');
  let bus = gm.getEventBus(); let settledEvent = null; bus.on('game:round-settled', (e) => { settledEvent = e; });
  const w = gm.declareTsumo();
  assert(w.winType === 'self' && w.seatIndex === 0 && gm.isRoundOver() && w.hand.concealedCount === 14, 'declareTsumo ends the round with a complete hand');
  let s = gm.settleRound();
  let scores = gm.getPlayers().map((p) => p.score);
  assert(s.transfers.length === 3 && scores[0] === w.points * 3 && scores.slice(1).every((x) => x === -w.points), 'Tsumo: everyone pays the winner');
  assert(scores.reduce((a, b) => a + b, 0) === 0, 'zero-sum');
  assert(gm.settleRound() === s && gm.getPlayers()[0].score === scores[0], 'settleRound idempotent');
  assert(settledEvent && settledEvent.transfers.length === 3, 'game:round-settled emitted');
  assertThrows(() => rigTable({ hands: ['1d', '2d', '3d', '4d'] }).settleRound(), Error, 'settleRound before the round ends throws');

  // Ron: seat 0 discards East; seats 1 and 3 both wait on it → double Ron, discarder pays both.
  gm = rigTable({ hands: ['E 1b', '123d 456d 789b 234c E', '1c 7c', '123b 456b 789c 234d E'] });
  const r = gm.performDiscard(gm.getPlayer(0).getHand().findByFace('wind-east'));
  assert(r.winners && r.winners.length === 2 && r.winners.map((x) => x.seatIndex).join() === '1,3', 'two Ron winners');
  gm.settleRound();
  scores = gm.getPlayers().map((p) => p.score);
  assert(scores[0] === -(r.winners[0].points + r.winners[1].points) && scores[2] === 0, 'Ron: only the discarder pays (each winner independently)');

  // Below-minimum winner is not paid.
  gm = rigTable({ hands: ['E 1b', '123d 456d 789b 234c E', '1c 7c', '2b 8c'], rules: new HongKongRules({ minimumFan: 0 }) });
  gm.performDiscard(gm.getPlayer(0).getHand().findByFace('wind-east'));
  const lo = gm.getLastOutcome().winners[0];
  lo.meetsMinimum = false; // simulate an under-threshold record (Task 60 guard)
  assert(gm.settleRound().transfers.length === 0, 'winners below the minimum are skipped');

  // Concealed Kong: seat 0 holds EEE, draws the 4th.
  gm = rigTable({ hands: ['EEE 123d 456d 78b 9c 1c', '1b 9b', '1c 7c', '2b 8c'], wallSpec: 'E 3c', phase: TURN_PHASE.AWAITING_DRAW });
  const dk = gm.performDraw();
  const kong = dk.actions.find((a) => a.type === ACTION_TYPE.KONG);
  assert(kong && kong.kongType === 'concealed', 'concealed Kong offered');
  const k = gm.declareKong(kong);
  assert(k.meld.isKong && k.meld.concealed && k.draw.type === 'drawn' && k.draw.isReplacement, 'declareKong builds the meld and draws a replacement');
  assert(gm.getPlayer(0).getHand().concealedCount === 11 && gm.getPlayer(0).getHand().meldCount === 1, '14 − 4 + 1 = 11 concealed tiles');
});

section('Exhaustive draw', () => {
  const gm = newGame({ seed: 7, rules: { minimumFan: 99, limitFan: 99 } }); // nobody can win
  let guard = 0; let last;
  while (!gm.isRoundOver() && guard++ < 400) {
    if (gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW) {
      last = gm.performDraw();
      if (last.type === 'exhausted') break;
    }
    const seat = gm.getTurnManager().getCurrentPlayerIndex();
    const hand = gm.getPlayer(seat).getHand().concealedTiles;
    gm.performDiscard(hand[hand.length - 1]);
  }
  assert(gm.isRoundOver() && gm.getTurnManager().getEndReason() === ROUND_END_REASON.WALL_EXHAUSTED, 'round ends as a draw');
  const out = gm.getLastOutcome();
  assert(out.type === 'draw' && out.results.length === 4 && out.results.every((r) => typeof r.tenpai === 'boolean'), 'tenpai results per player');
  const s = gm.settleRound();
  assert(s.transfers.length === 0 && gm.getPlayers().every((p) => p.score === 0), 'draw: no transfers');
  assert(!gm.isGameComplete(), 'dealer repeats after a draw → session continues');
  gm.startNextHand();
  assert(gm.getHandIndex() === 1 && gm.getDealerIndex() === 0 && !gm.isRoundOver(), 'next hand dealt, dealer kept');
});

section('Headless full-game simulation (random play)', () => {
  const rand = mulberry32(34);
  let sessions = 0; let hands = 0; let wins = 0; let draws = 0; let conservationOk = true; let zeroSum = true;
  for (const n of [4, 3]) {
    for (let s = 0; s < 12; s++) {
      const gm = newGame({ n, seed: 100 + s + n * 50, rules: { minimumFan: 0 }, gm: { maxHands: 16 } });
      let guard = 0;
      while (guard++ < 40) {
        const expected = allInstanceIds(gm).size;
        playHandRandomly(gm, rand);
        if (allInstanceIds(gm).size !== expected) conservationOk = false;
        hands++;
        const out = gm.getLastOutcome();
        if (out?.type === 'win') wins++; else draws++;
        gm.settleRound();
        if (gm.getPlayers().reduce((a, p) => a + p.score, 0) !== 0) zeroSum = false;
        if (gm.isGameComplete()) break;
        gm.startNextHand();
      }
      if (gm.isGameComplete()) sessions++;
    }
  }
  console.log(`    ${sessions} sessions · ${hands} hands · ${wins} wins · ${draws} draws`);
  assert(sessions === 24, 'every session (12 × 4-player, 12 × 3-player) terminates');
  assert(conservationOk, 'tile conservation holds through every hand');
  assert(zeroSum, 'scores stay zero-sum');
  assert(wins > 0 && draws > 0, 'both wins and draws occur');
});

section('Restore', () => {
  const gm = newGame({ seed: 8 });
  const d = gm.performDraw();
  gm.performDiscard(d.tile);
  const restored = GameManager.restore({
    ruleEngine: gm.getRuleEngine(),
    players: gm.getPlayers(),
    wall: WallManager.restore(gm.getWall().getWallStateSnapshot()),
    turnManager: gm.getTurnManager(),
    roundState: gm.getRoundState(),
    dealerIndex: gm.getDealerIndex(),
    finalRoundWind: gm.getFinalRoundWind(),
    excludedFaceIds: gm.getExcludedFaceIds(),
    handIndex: gm.getHandIndex(),
    eventBus: new EventBus(),
  });
  assert(restored instanceof GameManager && restored.getWall().remainingCount === gm.getWall().remainingCount, 'restored with wall intact');
  if (!restored.isRoundOver() && restored.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW) {
    const d2 = restored.performDraw();
    assert(d2.type === 'drawn' || d2.type === 'exhausted', 'restored game can continue');
  } else assert(true, 'restored mid-claim state');
  assertThrows(() => GameManager.restore({ ruleEngine: gm.getRuleEngine(), players: gm.getPlayers(), wall: {}, turnManager: gm.getTurnManager(), roundState: gm.getRoundState(), finalRoundWind: WIND.EAST }), TypeError, 'restore validates the wall');
});

summary();
