/**
 * riichiRules.test.mjs — Task 81: RiichiRules legal actions & special calls,
 * plus RiichiHandAnalysis.
 *
 * Sections:
 *   1. Hand analysis — kinds, every decomposition, Seven Pairs (distinct
 *      pairs), Thirteen Orphans, waits (incl. karaten), validation
 *   2. Engine basics — interface, ids, options validation, tile-set options
 *      (dead wall, sanma), structural checkWin, scoreHand not yet available
 *   3. Self turn — discard list, closed / added Kans, Kan limits, no WIN
 *   4. Riichi declaration — eligibility rules and the discard options
 *   5. After riichi — drawn tile only; closed Kan only when waits AND
 *      reading are unchanged (examples found by exhaustive search)
 *   6. Nine-terminals abortive draw
 *   7. Calls on a discard — Pon, open Kan, Chi (left player only, shapes,
 *      no Chi in sanma), nothing in riichi / on the final discard, Kan limit
 *   8. Swap-calling ban (kuikae) — forbidden faces after Pon / Chi, discard
 *      filtering, calls not offered when they'd leave no legal discard,
 *      kuikae:false
 *   9. Action shapes + purity — real Tile objects from the hand; hand unchanged
 *
 * Run: node tests/rules/riichiRules.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { tiles, hand, makeTileFactory, faceIds } from '../_helpers/tiles.mjs';
import { RiichiRules, DEFAULT_RIICHI_OPTIONS, SANMA_EXCLUDED_FACE_IDS } from '../../src/rules/riichi/RiichiRules.js';
import {
  KIND_COUNT, kindOfFaceId, faceIdOfKind, countsFromTiles, decomposeStandard, isSevenPairs, isThirteenOrphans,
  analyzeComplete, findWaits, isTenpai,
} from '../../src/rules/riichi/RiichiHandAnalysis.js';
import { isValidRuleEngine } from '../../src/rules/RuleEngineInterface.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { Tile } from '../../src/core/Tile.js';
import { ACTION_TYPE, KONG_TYPE, MELD_TYPE, RULESET_ID, SEAT_KIND } from '../../src/utils/constants.js';

const counts = (spec) => countsFromTiles(tiles(spec));
const waitsOf = (spec, m = 0) => findWaits(counts(spec), m).map(faceIdOfKind).join(' ');
const ids = (spec) => faceIds(spec).join(' ');

/** A player whose hand is built from a spec; `drawn` is the LAST tile of the concealed spec. */
function player(concealedSpec, meldSpecs = [], { seatIndex = 1, score = 25000 } = {}) {
  const f = makeTileFactory();
  const h = hand(concealedSpec, meldSpecs, f);
  return { seatIndex, score, getHand: () => h, factory: f };
}
const lastTile = (p) => p.getHand().concealedTiles[p.getHand().concealedTiles.length - 1];
const self = (p, extra = {}) => ({ kind: 'self', seatIndex: p.seatIndex, playerCount: 4, drawnTile: lastTile(p), wallRemaining: 50, ...extra });
const types = (actions) => actions.map((a) => (a.type === ACTION_TYPE.KONG ? `kong:${a.kongType}` : a.type)).join(',');
const rules = new RiichiRules();
/** Discarded tiles get their own instance ids so they never clash with hand tiles. */
const discTile = (() => { let n = 0; return (id) => Tile.fromId(id, `${id}#disc${++n}`); })();

// ---------------------------------------------------------------------------
section('1. Hand analysis', () => {
  assert(KIND_COUNT === 34 && kindOfFaceId('dots-1') === 0 && kindOfFaceId('bamboo-1') === 9 && kindOfFaceId('characters-9') === 26, 'suit kinds 0–26');
  assert(kindOfFaceId('wind-east') === 27 && kindOfFaceId('dragon-white') === 33 && faceIdOfKind(31) === 'dragon-red', 'honour kinds 27–33');
  assertThrows(() => kindOfFaceId('flower-1'), TypeError, 'bonus face rejected');
  assertThrows(() => faceIdOfKind(34), RangeError, 'kind out of range');
  assertThrows(() => countsFromTiles(tiles('11111d')), RangeError, 'five copies rejected');

  const d = decomposeStandard(counts('111222333d 456b EE'), 0);
  assert(d.length === 2, `111222333 reads as three triplets OR three runs (${d.length} decompositions)`);
  assert(d.some((x) => x.sets.filter((s) => s.type === 'triplet').length === 3) && d.some((x) => x.sets.filter((s) => s.type === 'run' && s.kind === 0).length === 3), 'both readings listed');
  assert(decomposeStandard(counts('123d 456d 789d 123b 99c'), 0).length === 1, 'single reading');
  assert(decomposeStandard(counts('123d 456d 789d 99c'), 1).length === 1, 'with one meld: 3 sets + pair');
  assert(decomposeStandard(counts('123d 456d 789d 123b 9c 8c'), 0).length === 0, 'incomplete → none');
  assert(decomposeStandard(counts('89d 1b 123c 456c 789c EE'), 0).length === 0, 'runs never wrap across suits');

  assert(isSevenPairs(counts('11d 33d 55d 77b 99b EE RR'), 0), 'Seven Pairs');
  assert(!isSevenPairs(counts('1111d 55d 77b 99b EE RR'), 0), 'four of a kind is not two pairs');
  assert(!isSevenPairs(counts('11d 33d 55d 77b 99b E'), 1), 'Seven Pairs needs a closed hand');
  assert(isThirteenOrphans(counts('19d 19b 19c ESWNRGH 1d'), 0), 'Thirteen Orphans');
  assert(!isThirteenOrphans(counts('19d 19b 19c ESWNRG 11d'), 0), 'missing white dragon → not Thirteen Orphans');
  const a = analyzeComplete(counts('112233d 445566b 77c'), 0);
  assert(a.isComplete && a.sevenPairs && a.standard.length === 1, 'a hand can read as Seven Pairs AND as standard (123 123 456 456 77) — both reported');
  assert(!analyzeComplete(counts('22d 44d 66d 22b 44b 66b 88b'), 0).standard.length, '22 44 66 can\'t form runs → Seven Pairs only');

  assert(waitsOf('23d 456b 789b 123c EE') === ids('1d 4d'), 'ryanmen 23 → 1, 4');
  assert(waitsOf('13d 456b 789b 123c EE') === ids('2d'), 'kanchan 13 → 2');
  assert(waitsOf('2345d 678b 123c EEE') === ids('2d 5d'), 'nobetan 2345 → 2, 5');
  assert(waitsOf('11d 99d 456b 123c EEE') === ids('1d 9d'), 'shanpon 11 + 99 → 1, 9');
  assert(waitsOf('11d 33d 55d 77b 99b EE R') === ids('R'), 'Seven Pairs tanki');
  assert(waitsOf('19d 19b 19c ESWNRGH') === ids('19d 19b 19c ESWNRGH'), 'Thirteen Orphans 13-sided wait');
  assert(waitsOf('1111d 23d 456b 789b E') === ids('E'), '1111 23 + E: 111 + 123 + EE pair → E is the only wait');
  assert(waitsOf('5555d 678b 123c 789c') === '', 'karaten: the only shape-wait is a fifth 5d, which can never arrive → no waits');
  assert(isTenpai(counts('23d 456b 789b 123c EE'), 0) && !isTenpai(counts('25d 456b 789b 123c EE'), 0), 'isTenpai');
  assertThrows(() => findWaits(counts('23d 456b 789b 123c EE'), 1), RangeError, 'wrong tile total for the meld count');
  assertThrows(() => decomposeStandard(new Array(33).fill(0), 0), TypeError, 'bad counts array');
});

// ---------------------------------------------------------------------------
section('2. Engine basics', () => {
  assert(isValidRuleEngine(rules), 'implements RuleEngineInterface');
  assert(rules.getRulesetId() === RULESET_ID.RIICHI && rules.getDisplayName() === 'Riichi Mahjong', 'id + name');
  assert(Object.isFrozen(DEFAULT_RIICHI_OPTIONS) && rules.getOptions().playerCount === 4 && rules.getOptions().kuikae === true, 'defaults');
  const t4 = rules.getTileSetOptions(); const t3 = new RiichiRules({ playerCount: 3 }).getTileSetOptions();
  assert(t4.deadWallSize === 14 && t4.includeBonus === false && t4.excludedFaceIds.length === 0, '4P: 136 tiles, 14-tile dead wall');
  assert(t3.excludedFaceIds.join() === SANMA_EXCLUDED_FACE_IDS.join() && t3.excludedFaceIds.join() === 'characters-2,characters-3,characters-4,characters-5,characters-6,characters-7,characters-8', '3P removes characters 2–8');
  assertThrows(() => new RiichiRules({ playerCount: 2 }), RangeError, 'playerCount 2 throws');
  assertThrows(() => new RiichiRules({ bogus: 1 }), TypeError, 'unknown option throws');
  assertThrows(() => new RiichiRules({ kuikae: 'yes' }), TypeError, 'non-boolean kuikae throws');
  assertThrows(() => new RiichiRules({ maxKongs: 5 }), RangeError, 'maxKongs > 4 throws');
  assertThrows(() => new RiichiRules({ riichiMinimumScore: -1 }), TypeError, 'negative riichi minimum throws');

  assert(rules.checkWin(hand('123d 456d 789d 123b 99c')).structure === 'standard', 'checkWin: standard');
  assert(rules.checkWin(hand('11d 33d 55d 77b 99b EE RR')).structure === 'seven-pairs', 'checkWin: Seven Pairs');
  assert(rules.checkWin(hand('19d 19b 19c ESWNRGH 9c')).structure === 'thirteen-orphans', 'checkWin: Thirteen Orphans');
  assert(rules.checkWin(hand('123d 456d 99c', [{ type: MELD_TYPE.PON, spec: 'EEE' }, { type: MELD_TYPE.CHI, spec: '123b' }])).isWin, 'checkWin with melds');
  assert(!rules.checkWin(hand('123d 456d 789d 123b 9c')).isWin, 'checkWin: 13 tiles → not a win');
  assert(!rules.checkWin(hand('123d 456d 789d 124b 99c')).isWin, 'checkWin: incomplete');
  assertThrows(() => rules.scoreHand(hand('123d 456d 789d 123b 99c'), {}), TypeError, 'scoreHand (Task 85) needs a winType and winning tile');
  assertThrows(() => rules.getLegalActions(null, player('1d')), TypeError, 'null state throws');
  assertThrows(() => rules.getLegalActions({ kind: 'x' }, player('1d')), TypeError, 'unknown state kind throws');
  assert(typeof rules.getTerminology().riichi === 'string', 'provisional terminology (Task 87 replaces)');
});

// ---------------------------------------------------------------------------
section('3. Self turn: discards and Kans', () => {
  const p = player('1111d 234b 567c 89c E 5d');
  const acts = rules.getLegalActions(self(p), p);
  assert(types(acts) === 'kong:concealed,discard', `closed Kan of 1d + discard (${types(acts)})`);
  const disc = acts.find((a) => a.type === ACTION_TYPE.DISCARD);
  assert(disc.allowedTiles.length === 14 && disc.allowedTiles.every((t) => p.getHand().concealedTiles.includes(t)), 'any of the 14 tiles may be discarded');
  assert(acts[0].tiles.length === 4 && acts[0].tiles.every((t) => t.id === 'dots-1'), 'Kan lists the four hand tiles');
  assert(!acts.some((a) => a.type === ACTION_TYPE.WIN), 'an incomplete hand gets no WIN');

  const done = player('123d 456d 789d 123b 99c');
  assert(rules.getLegalActions(self(done), done).some((a) => a.type === ACTION_TYPE.WIN), 'Task 82: a complete closed hand drawn by Tsumo wins (Fully Concealed Hand)');

  const added = player('234b 567c 89c E 5d R', [{ type: MELD_TYPE.PON, spec: 'RRR' }]);
  const aa = rules.getLegalActions(self(added), added).find((a) => a.kongType === KONG_TYPE.ADDED);
  assert(aa && aa.faceId === 'dragon-red' && aa.meldIndex === 0 && aa.tile.id === 'dragon-red', 'added Kan onto own Pon');
  assert(!rules.getLegalActions(self(p, { kongCount: 4 }), p).some((a) => a.type === ACTION_TYPE.KONG), 'no Kan once four Kans were declared this hand');
  assert(rules.getLegalActions(self(p, { kongCount: 3 }), p).some((a) => a.type === ACTION_TYPE.KONG), 'a fourth Kan is still allowed');
  assert(!rules.getLegalActions(self(p, { wallRemaining: 0 }), p).some((a) => a.type === ACTION_TYPE.KONG), 'no Kan on the last tile (no replacement)');
  assert(!new RiichiRules({ maxKongs: 0 }).getLegalActions(self(p), p).some((a) => a.type === ACTION_TYPE.KONG), 'maxKongs 0 → no Kans');
  assertThrows(() => rules.getLegalActions(self(p, { kongCount: -1 }), p), TypeError, 'bad kongCount throws');
});

// ---------------------------------------------------------------------------
section('4. Riichi declaration', () => {
  // 13-tile tenpai 23d 456b 789b 123c EE + drawn 9d → discarding 9d keeps 1d/4d wait.
  const p = player('23d 456b 789b 123c EE 9d');
  const r = rules.getLegalActions(self(p), p).find((a) => a.type === ACTION_TYPE.RIICHI);
  assert(r, 'closed tenpai-after-discard hand → RIICHI offered');
  assert(r.options.length === 1 && r.options[0].faceId === 'dots-9' && r.options[0].waits.join(' ') === ids('1d 4d'), 'only discarding 9d keeps tenpai; waits 1d / 4d');
  assert(r.allowedTiles.length === 1 && r.allowedTiles[0] === lastTile(p), 'allowedTiles are the real tiles to discard');

  const multi = player('234d 456b 789b 123c E R');
  const rm = rules.getLegalActions(self(multi), multi).find((a) => a.type === ACTION_TYPE.RIICHI);
  assert(rm && rm.options.map((o) => o.faceId).join() === 'wind-east,dragon-red', `two riichi discards, ordered by kind (${rm?.options.map((o) => o.faceId)})`);
  assert(rm.options[0].waits.join() === 'dragon-red' && rm.options[1].waits.join() === 'wind-east', 'discard E → tanki on R; discard R → tanki on E');

  const notTenpai = player('258d 456b 789b 123c E S');
  assert(!rules.getLegalActions(self(notTenpai), notTenpai).some((a) => a.type === ACTION_TYPE.RIICHI), 'no tenpai after any discard → no RIICHI');
  const open = player('23d 456b 123c EE 9d', [{ type: MELD_TYPE.PON, spec: '777b' }]);
  assert(!rules.getLegalActions(self(open), open).some((a) => a.type === ACTION_TYPE.RIICHI), 'open hand → no RIICHI');
  const kanClosed = player('23d 456b 123c EE 9d', [{ type: MELD_TYPE.KONG, spec: '7777b', concealed: true }]);
  assert(rules.getLegalActions(self(kanClosed), kanClosed).some((a) => a.type === ACTION_TYPE.RIICHI), 'a closed Kan keeps the hand closed → RIICHI offered');
  const poor = player('23d 456b 789b 123c EE 9d', [], { score: 900 });
  assert(!rules.getLegalActions(self(poor), poor).some((a) => a.type === ACTION_TYPE.RIICHI), 'fewer than 1000 points → no RIICHI');
  assert(rules.getLegalActions(self(poor, { score: 1000 }), poor).some((a) => a.type === ACTION_TYPE.RIICHI), 'state.score overrides player.score');
  assert(!rules.getLegalActions(self(p, { wallRemaining: 3 }), p).some((a) => a.type === ACTION_TYPE.RIICHI), '4P: fewer than 4 live-wall tiles → no RIICHI');
  assert(rules.getLegalActions(self(p, { wallRemaining: 4 }), p).some((a) => a.type === ACTION_TYPE.RIICHI), '4P: exactly 4 left → RIICHI');
  assert(new RiichiRules({ playerCount: 3 }).getLegalActions(self(p, { wallRemaining: 3, playerCount: 3 }), p).some((a) => a.type === ACTION_TYPE.RIICHI), '3P: 3 left is enough');
  assert(!rules.getLegalActions(self(p, { isRiichi: true }), p).some((a) => a.type === ACTION_TYPE.RIICHI), 'already in riichi → no second declaration');
  assert(new RiichiRules({ riichiMinimumScore: 0 }).getLegalActions(self(poor), poor).some((a) => a.type === ACTION_TYPE.RIICHI), 'riichiMinimumScore option');
  // Karaten: the only wait (1d) is a kind whose four copies are all in the player's closed Kan.
  const kara = player('23d 456b 123c EE 9d', [{ type: MELD_TYPE.KONG, spec: '1111d', concealed: true }]);
  const kr = rules.getLegalActions(self(kara), kara).find((a) => a.type === ACTION_TYPE.RIICHI);
  assert(kr && kr.options[0].waits.join() === 'dots-4', 'a wait on a kind held four times in an own Kan is dropped (1d), the other (4d) remains');
  const karaOnly = player('13d 456b 123c EE 9d', [{ type: MELD_TYPE.KONG, spec: '2222d', concealed: true }]);
  assert(!rules.getLegalActions(self(karaOnly), karaOnly).some((a) => a.type === ACTION_TYPE.RIICHI), 'kanchan 1-3 waiting on 2d with all 2d in an own Kan → no RIICHI');
});

// ---------------------------------------------------------------------------
section('5. After riichi', () => {
  const p = player('23d 456b 789b 123c EE 7c');
  const acts = rules.getLegalActions(self(p, { isRiichi: true }), p);
  assert(types(acts) === 'discard' && acts[0].allowedTiles.length === 1 && acts[0].allowedTiles[0] === lastTile(p), 'only the drawn tile may be discarded');
  assertThrows(() => rules.getLegalActions(self(p, { isRiichi: true, drawnTile: null }), p), TypeError, 'riichi self turn needs the drawn tile');

  // Examples found by exhaustive search (see the Task 81 manifest entry). Last tile = drawn.
  const ok = player('1112256789d EEE 1d');        // waits 4,7 — kan 1d keeps 22 + 56 789: waits unchanged, 1d a triplet in every reading
  assert(rules.getLegalActions(self(ok, { isRiichi: true }), ok).some((a) => a.kongType === KONG_TYPE.CONCEALED), 'riichi Kan allowed: waits and reading unchanged');
  const ok2 = player('1355678999d EEE 9d');       // wait 2 (kanchan 13), 999 always a triplet
  assert(rules.getLegalActions(self(ok2, { isRiichi: true }), ok2).some((a) => a.kongType === KONG_TYPE.CONCEALED), 'riichi Kan allowed (second example)');
  const waitChange = player('1233567888d EEE 8d'); // waits 3,4 → after Kan 3 only
  assert(!rules.getLegalActions(self(waitChange, { isRiichi: true }), waitChange).some((a) => a.type === ACTION_TYPE.KONG), 'riichi Kan refused: it would change the waits');
  const reading = player('2223455666d EEE 2d');   // waits 2,4,5,7 either way, but 222 isn't a triplet in every reading
  assert(!rules.getLegalActions(self(reading, { isRiichi: true }), reading).some((a) => a.type === ACTION_TYPE.KONG), 'riichi Kan refused: same waits but the reading changes');
  const reading2 = player('6667788899d EEE 6d');
  assert(!rules.getLegalActions(self(reading2, { isRiichi: true }), reading2).some((a) => a.type === ACTION_TYPE.KONG), 'riichi Kan refused: reading changes (second example)');
  // No okurikan: holding 1111d in a riichi hand but drawing something else.
  const f = makeTileFactory();
  const h = hand('1112256789d EEE', [], f); const extra = Tile.fromId('dots-1', 'dots-1#x'); h.addConcealedTile(extra);
  const late = { seatIndex: 1, score: 25000, getHand: () => h };
  const drawnOther = h.concealedTiles.find((t) => t.id === 'dots-9');
  assert(!rules.getLegalActions(self(late, { isRiichi: true, drawnTile: drawnOther }), late).some((a) => a.type === ACTION_TYPE.KONG), 'riichi Kan only with the tile just drawn (no okurikan)');
  assert(!rules.getLegalActions(self(ok, { isRiichi: true, kongCount: 4 }), ok).some((a) => a.type === ACTION_TYPE.KONG), 'riichi Kan respects the Kan limit');
});

// ---------------------------------------------------------------------------
section('6. Nine-terminals abortive draw', () => {
  const p = player('19d 19b 1c ESWN 2d 3d 5b 6b 7b');
  const first = { isFirstUninterruptedTurn: true };
  const a = rules.getLegalActions(self(p, first), p).find((x) => x.type === ACTION_TYPE.ABORTIVE_DRAW);
  assert(a && a.reason === 'nine-terminals' && a.faceIds.length === 9, 'nine different terminals/honours on the first turn → offered');
  assert(!rules.getLegalActions(self(p), p).some((x) => x.type === ACTION_TYPE.ABORTIVE_DRAW), 'not offered after the first turn');
  const eight = player('19d 19b 1c ESW 2d 3d 5b 6b 7b 8b');
  assert(!rules.getLegalActions(self(eight, first), eight).some((x) => x.type === ACTION_TYPE.ABORTIVE_DRAW), 'eight kinds → not offered');
  const dup = player('19d 19b 1c ESW 11d 99d 5b 6b');
  assert(!rules.getLegalActions(self(dup, first), dup).some((x) => x.type === ACTION_TYPE.ABORTIVE_DRAW), 'duplicates don\'t count as extra kinds');
  assert(!new RiichiRules({ nineTerminalsDraw: false }).getLegalActions(self(p, first), p).some((x) => x.type === ACTION_TYPE.ABORTIVE_DRAW), 'nineTerminalsDraw:false disables it');
});

// ---------------------------------------------------------------------------
section('7. Calls on a discard', () => {
  const f = discTile;
  const disc = (faceId, fromSeat = 0, extra = {}) => ({ kind: 'discard', seatIndex: 1, playerCount: 4, wallRemaining: 40, discard: { tile: f(faceId), fromSeat }, ...extra });
  const p = player('555d 34d 789b 123c E S');
  const acts = rules.getLegalActions(disc('dots-5'), p);
  assert(types(acts) === 'kong:exposed,pon,chi', `5d from the left: open Kan, Pon, Chi 3-4-5 (${types(acts)})`);
  const chi = acts.find((a) => a.type === ACTION_TYPE.CHI);
  assert(chi.sequence.join() === 'dots-3,dots-4,dots-5' && chi.handTiles.map((t) => t.id).join() === 'dots-3,dots-4', 'Chi sequence + hand tiles');
  assert(types(rules.getLegalActions(disc('dots-5', 2), p)) === 'kong:exposed,pon', 'from across: no Chi');
  assert(rules.getLegalActions(disc('dots-5', 1), p).length === 0, 'own discard → nothing');
  const three = player('34567d 789b 123c E S');
  const shapes = rules.getLegalActions(disc('dots-5'), three).filter((a) => a.type === ACTION_TYPE.CHI).map((a) => a.sequence.map((id) => id.slice(-1)).join(''));
  assert(shapes.join() === '345,456,567', `all three Chi shapes (${shapes})`);
  assert(rules.getLegalActions(disc('wind-east'), player('EE 34d 789b 123c 55d S')).map((a) => a.type).join() === 'pon', 'honours: Pon only, never Chi');
  const sanma = new RiichiRules({ playerCount: 3 });
  assert(!sanma.getLegalActions({ ...disc('dots-5'), playerCount: 3 }, p).some((a) => a.type === ACTION_TYPE.CHI), 'three-player: no Chi');
  assert(rules.getLegalActions(disc('dots-5', 0, { isRiichi: true }), p).length === 0, 'in riichi: no calls (only Ron, when it wins)');
  assert(rules.getLegalActions(disc('dots-5', 0, { wallRemaining: 0 }), p).length === 0, 'final discard: no calls');
  assert(types(rules.getLegalActions(disc('dots-5', 0, { kongCount: 4 }), p)) === 'pon,chi', 'Kan limit reached: Pon/Chi only');
  const four = player('5d', [{ type: MELD_TYPE.PON, spec: '111b' }, { type: MELD_TYPE.PON, spec: '222b' }, { type: MELD_TYPE.PON, spec: '333b' }, { type: MELD_TYPE.PON, spec: '444b' }]);
  assert(rules.getLegalActions(disc('dots-5'), four).every((a) => a.type === ACTION_TYPE.WIN), 'four melds: no calls (a Ron on the single wait is fine — Toitoi, Task 83)');
  assertThrows(() => rules.getLegalActions({ kind: 'discard', discard: {} }, p), TypeError, 'malformed discard state throws');
});

// ---------------------------------------------------------------------------
section('8. Swap-calling ban (kuikae)', () => {
  const f = discTile;
  const t = (id) => f(id);
  assert([...rules.kuikaeForbiddenFaces({ type: 'pon', tile: t('dots-5') })].join() === 'dots-5', 'after Pon: the called kind');
  assert([...rules.kuikaeForbiddenFaces({ type: 'chi', tile: t('dots-3'), sequence: ['dots-3', 'dots-4', 'dots-5'] })].sort().join() === 'dots-3,dots-6', 'Chi at the low end (3 for 345): 3 and 6 (suji)');
  assert([...rules.kuikaeForbiddenFaces({ type: 'chi', tile: t('dots-5'), sequence: ['dots-3', 'dots-4', 'dots-5'] })].sort().join() === 'dots-2,dots-5', 'Chi at the high end (5 for 345): 5 and 2');
  assert([...rules.kuikaeForbiddenFaces({ type: 'chi', tile: t('dots-4'), sequence: ['dots-3', 'dots-4', 'dots-5'] })].join() === 'dots-4', 'Chi in the middle: the called kind only');
  assert([...rules.kuikaeForbiddenFaces({ type: 'chi', tile: t('dots-7'), sequence: ['dots-7', 'dots-8', 'dots-9'] })].join() === 'dots-7', 'Chi 7 for 789: no tile beyond 9');
  assert(new RiichiRules({ kuikae: false }).kuikaeForbiddenFaces({ type: 'pon', tile: t('dots-5') }).size === 0, 'kuikae:false → nothing forbidden');
  assertThrows(() => rules.kuikaeForbiddenFaces({ type: 'kong', tile: t('dots-5') }), TypeError, 'bad lastCall type throws');
  assertThrows(() => rules.kuikaeForbiddenFaces({ type: 'chi', tile: t('dots-5'), sequence: ['dots-1', 'dots-2', 'dots-3'] }), TypeError, 'chi sequence must contain the called tile');

  // After the call: only a kuikae-filtered DISCARD.
  const after = player('56d 6d 789b 123c E S', [{ type: MELD_TYPE.CHI, spec: '345d' }]);
  const acts = rules.getLegalActions({ kind: 'self', seatIndex: 1, wallRemaining: 40, lastCall: { type: 'chi', tile: t('dots-3'), sequence: ['dots-3', 'dots-4', 'dots-5'] } }, after);
  assert(types(acts) === 'discard', 'after a call: DISCARD only (no Kan, riichi or abortive draw)');
  const allowedIds = acts[0].allowedTiles.map((x) => x.id);
  assert(!allowedIds.includes('dots-6') && !allowedIds.includes('dots-3') && allowedIds.includes('dots-5') && allowedIds.length === 9, 'both 6d are forbidden after calling 3 for 345; 5d is fine');

  // A call that would leave only forbidden tiles is not offered.
  const disc = (faceId, fromSeat = 0) => ({ kind: 'discard', seatIndex: 1, playerCount: 4, wallRemaining: 40, discard: { tile: t(faceId), fromSeat } });
  const melds3 = [{ type: MELD_TYPE.PON, spec: '111b' }, { type: MELD_TYPE.PON, spec: '222b' }, { type: MELD_TYPE.PON, spec: '333b' }];
  const chiTight = player('34d 6d 6d', [...melds3]);
  // 3-4 + 6 + 6 with three melds: Chi 5 (low end? no — 5 completes 345 at the HIGH end) → forbidden 5 and 2 → 66 remain → legal.
  assert(rules.getLegalActions(disc('dots-5'), chiTight).some((a) => a.type === ACTION_TYPE.CHI), 'Chi offered when a legal discard remains');
  const chiDead = player('45d 6d 6d', [...melds3]);
  // Chi 3 for 3-4-5 (low end) forbids 3 and 6 → only 6d,6d remain → no legal discard → not offered.
  assert(!rules.getLegalActions(disc('dots-3'), chiDead).some((a) => a.type === ACTION_TYPE.CHI), 'Chi NOT offered when only swap tiles would remain');
  assert(new RiichiRules({ kuikae: false }).getLegalActions(disc('dots-3'), chiDead).some((a) => a.type === ACTION_TYPE.CHI), '…but offered with kuikae:false');
  const ponOk = player('55d 5d E', [...melds3]);
  assert(rules.getLegalActions(disc('dots-5'), ponOk).some((a) => a.type === ACTION_TYPE.PON), 'Pon offered: 5d + E remain and E is a legal discard');
});

// ---------------------------------------------------------------------------
section('9. Action shapes + purity, with a real PlayerManager', () => {
  const pm = new PlayerManager({ seatIndex: 2, seatKind: SEAT_KIND.AI, aiDifficulty: 'basic' });
  for (const tl of tiles('23d 456b 789b 123c EE 9d')) pm.addTileToHand(tl);
  pm.addScore(25000);
  const before = pm.getHand().concealedTiles.map((x) => x.instanceId).join();
  const tilesNow = pm.getHand().concealedTiles;
  const acts = rules.getLegalActions({ kind: 'self', seatIndex: 2, playerCount: 4, drawnTile: tilesNow[tilesNow.length - 1], wallRemaining: 30 }, pm);
  assert(acts.every((a) => a.seatIndex === 2), 'every action carries the seat');
  const riichi = acts.find((a) => a.type === ACTION_TYPE.RIICHI);
  assert(riichi && riichi.allowedTiles.every((x) => tilesNow.includes(x)), 'RIICHI tiles are the hand\'s own Tile objects (PlayerManager score used)');
  assert(pm.getHand().concealedTiles.map((x) => x.instanceId).join() === before, 'getLegalActions never mutates the hand');
});

summary();
