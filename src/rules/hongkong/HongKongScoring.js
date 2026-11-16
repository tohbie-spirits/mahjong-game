/**
 * HongKongScoring.js
 *
 * Fan calculation for Hong Kong Mahjong (Task 24 base, Task 25 patterns).
 *
 * REBUILT (after Task 77). The original fan table was lost; this one follows
 * common Hong Kong (Cantonese) table rules. Every number is in the exported
 * HONG_KONG_FAN table / options, so house rules can be changed in one place.
 *
 *   Pattern                      Fan   Notes
 *   Self-drawn (自摸)              1
 *   Concealed hand (門前清)         1    no exposed meld (concealed Kongs allowed)
 *   All Chows (平糊)               1    every set a chow
 *   All Pungs (對對糊)             3    every set a pung/kong
 *   Mixed One Suit (混一色)         3    one numbered suit + honours
 *   Pure One Suit (清一色)          7    one numbered suit only (replaces mixed)
 *   Dragon Pung                   1 each
 *   Seat Wind / Prevailing Wind   1 each (both can apply to one pung)
 *   Small Three Dragons (小三元)    5    two dragon pungs + dragon pair (replaces dragon pungs)
 *   Great Three Dragons (大三元)    8    three dragon pungs (replaces dragon pungs)
 *   Small Four Winds (小四喜)       10   three wind pungs + wind pair (replaces wind fan)
 *   Great Four Winds (大四喜)       13   four wind pungs
 *   All Honours (字一色)            10
 *   All Terminals (清么九)          10
 *   Thirteen Orphans (十三么)       13
 *   Seven Pairs (七對子)            4    only when the ruleset enables it
 *   Win on the last tile          1
 *   Win on a Kong replacement     1    self-drawn replacement tile
 *   Chicken Hand (雞糊)            0    nothing else scores
 *
 * Total fan is capped at `limitFan` (13). Points come from HONG_KONG_POINTS
 * (the common "half-spicy" doubling table); a hand meets the minimum when
 * fan ≥ `minimumFan` (default 3 — the classic 三番起糊).
 *
 * Several decompositions can fit one hand (e.g. 111222333 as pungs or
 * chows); the highest-scoring one is used.
 */

import { analyzeHand } from './HongKongHandAnalysis.js';
import { HONG_KONG_PATTERN_NAMES } from './HongKongTerminology.js';
import { WIN_SOURCE } from '../../utils/constants.js';

/** Fan per pattern id. */
export const HONG_KONG_FAN = Object.freeze({
  'self-drawn': 1,
  'concealed-hand': 1,
  'all-chows': 1,
  'all-pungs': 3,
  'mixed-one-suit': 3,
  'pure-one-suit': 7,
  'dragon-pung': 1,
  'seat-wind': 1,
  'round-wind': 1,
  'small-three-dragons': 5,
  'big-three-dragons': 8,
  'small-four-winds': 10,
  'big-four-winds': 13,
  'all-honors': 10,
  'all-terminals': 10,
  'thirteen-orphans': 13,
  'seven-pairs': 4,
  'last-tile': 1,
  'kong-replacement': 1,
  'chicken-hand': 0,
});

/** Points paid per fan (index = fan, capped at the last entry). */
export const HONG_KONG_POINTS = Object.freeze([1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384]);

export const DEFAULT_HONG_KONG_SCORING_OPTIONS = Object.freeze({
  minimumFan: 3,
  limitFan: 13,
  allowSevenPairs: false,
});

const suitOf = (faceId) => faceId.slice(0, faceId.indexOf('-'));
const isHonorFace = (faceId) => faceId.startsWith('wind-') || faceId.startsWith('dragon-');
const isTerminalFace = (faceId) => !isHonorFace(faceId) && /-(1|9)$/.test(faceId);

/** @private */
function _entry(id, times = 1) {
  return { id, name: HONG_KONG_PATTERN_NAMES[id]?.name ?? id, fan: HONG_KONG_FAN[id] * times };
}

/**
 * Scores one standard decomposition.
 * @private
 */
function _scoreDecomposition(groups, hand, context) {
  const sets = groups.filter((g) => g.kind !== 'pair');
  const pair = groups.find((g) => g.kind === 'pair');
  const allFaces = groups.flatMap((g) => g.faceIds);
  const out = [];

  const pungLike = sets.filter((g) => g.kind === 'pung' || g.kind === 'kong');
  const dragonPungs = pungLike.filter((g) => g.faceIds[0].startsWith('dragon-'));
  const windPungs = pungLike.filter((g) => g.faceIds[0].startsWith('wind-'));
  const pairFace = pair.faceIds[0];

  // Limit / big patterns first.
  const allHonors = allFaces.every(isHonorFace);
  const allTerminals = allFaces.every(isTerminalFace);
  if (allHonors) out.push(_entry('all-honors'));
  if (allTerminals) out.push(_entry('all-terminals'));

  // Winds.
  if (windPungs.length === 4) {
    out.push(_entry('big-four-winds'));
  } else if (windPungs.length === 3 && pairFace.startsWith('wind-')) {
    out.push(_entry('small-four-winds'));
  } else {
    for (const g of windPungs) {
      const face = g.faceIds[0];
      if (context.seatWind && face === `wind-${context.seatWind.id}`) out.push(_entry('seat-wind'));
      if (context.roundWind && face === `wind-${context.roundWind.id}`) out.push(_entry('round-wind'));
    }
  }

  // Dragons.
  if (dragonPungs.length === 3) out.push(_entry('big-three-dragons'));
  else if (dragonPungs.length === 2 && pairFace.startsWith('dragon-')) out.push(_entry('small-three-dragons'));
  else if (dragonPungs.length > 0) out.push(_entry('dragon-pung', dragonPungs.length));

  // Shape.
  if (sets.every((g) => g.kind === 'chow')) out.push(_entry('all-chows'));
  if (!allHonors && sets.every((g) => g.kind !== 'chow')) out.push(_entry('all-pungs'));

  // Suits.
  if (!allHonors) {
    const numbered = new Set(allFaces.filter((f) => !isHonorFace(f)).map(suitOf));
    if (numbered.size === 1) {
      out.push(allFaces.some(isHonorFace) ? _entry('mixed-one-suit') : _entry('pure-one-suit'));
    }
  }
  return out;
}

/** @private — context-only patterns that apply to every structure. */
function _situational(hand, context) {
  const out = [];
  if (context.winType === WIN_SOURCE.SELF) out.push(_entry('self-drawn'));
  if (hand.isConcealed) out.push(_entry('concealed-hand'));
  if (context.isLastTile) out.push(_entry('last-tile'));
  if (context.isKongReplacement && context.winType === WIN_SOURCE.SELF) out.push(_entry('kong-replacement'));
  return out;
}

/**
 * Scores a COMPLETE hand (for a Ron, pass a view that includes the claimed
 * tile — see createHandViewWithExtraTile).
 *
 * @param {import('../../core/Hand.js').Hand} hand
 * @param {Object} [context]  { winType, winningTile, seatWind, roundWind, isLastTile, isKongReplacement }
 * @param {Object} [options]  { minimumFan, limitFan, allowSevenPairs }
 * @returns {{ fan: number, points: number, meetsMinimum: boolean, minimumFan: number, isLimit: boolean,
 *             structure: string|null, breakdown: {id: string, name: string, fan: number}[] }}
 */
export function scoreHongKongHand(hand, context = {}, options = {}) {
  const opts = { ...DEFAULT_HONG_KONG_SCORING_OPTIONS, ...options };
  const analysis = analyzeHand(hand, { allowSevenPairs: opts.allowSevenPairs });

  if (!analysis.isComplete) {
    return { fan: 0, points: 0, meetsMinimum: false, minimumFan: opts.minimumFan, isLimit: false, structure: null, breakdown: [] };
  }

  const situational = _situational(hand, context);
  const candidates = [];
  if (analysis.thirteenOrphans) candidates.push({ structure: 'thirteen-orphans', entries: [_entry('thirteen-orphans')] });
  if (analysis.sevenPairs) {
    const extra = [];
    const tilesIds = hand.concealedTiles.map((t) => t.id);
    const honors = tilesIds.every(isHonorFace);
    const numbered = new Set(tilesIds.filter((f) => !isHonorFace(f)).map(suitOf));
    if (honors) extra.push(_entry('all-honors'));
    else if (numbered.size === 1) extra.push(tilesIds.some(isHonorFace) ? _entry('mixed-one-suit') : _entry('pure-one-suit'));
    candidates.push({ structure: 'seven-pairs', entries: [_entry('seven-pairs'), ...extra, ...situational] });
  }
  for (const groups of analysis.standard) {
    candidates.push({ structure: 'standard', entries: [..._scoreDecomposition(groups, hand, context), ...situational] });
  }

  let best = null;
  for (const c of candidates) {
    const raw = c.entries.reduce((s, e) => s + e.fan, 0);
    if (!best || raw > best.raw) best = { ...c, raw };
  }

  let breakdown = best.entries.filter((e) => e.fan > 0);
  if (breakdown.length === 0) breakdown = [_entry('chicken-hand')];
  const fan = Math.min(best.raw, opts.limitFan);
  const points = HONG_KONG_POINTS[Math.min(fan, HONG_KONG_POINTS.length - 1)];
  return {
    fan,
    points,
    meetsMinimum: fan >= opts.minimumFan,
    minimumFan: opts.minimumFan,
    isLimit: best.raw >= opts.limitFan,
    structure: best.structure,
    breakdown,
  };
}
