/**
 * BasicStrategy.js
 *
 * The Basic AI tier (Tasks 37–39), deliberately simple:
 *
 *   chooseDiscard — connectedness heuristic: a suited tile "connects" to
 *     every other tile of its suit within 2 ranks (and to duplicates); an
 *     honour only to exact duplicates. The least-connected tile(s) go first;
 *     ties are broken randomly.
 *   chooseClaim — Kong always; Pon always; Chi only when it rescues at least
 *     one hand tile whose ONLY connection is its own Chi partner. Pass otherwise.
 *   chooseWinDeclaration — accept unless the rule engine says the hand does
 *     not clear the win threshold (`meetsMinimum`, else `points > 0`), always
 *     scoring the COMPLETE hand (a temporary view for Ron).
 *
 * REBUILT (after Task 77) from the plan's Task 37–39 descriptions.
 *
 * Task 90 (Riichi): discards respect context.allowedDiscards; WIN actions
 * that carry the engine's `validation` are accepted as offered; in Riichi it
 * only Pons / Kans Yakuhai tiles (dragons, seat wind, round wind) and never
 * Chis — keeping hands closed so it can declare riichi; chooseRiichi declares
 * on the discard with the most live waits; chooseAbortiveDraw always accepts.
 *
 * Task 98 (Chinese Official): a hand needs 8 points, and staying closed is
 * worth 2–4 of them, so Basic calls sparingly — self-declared Kongs; Pung /
 * Kong of a valuable honour (a dragon, the seat or prevalent wind: 2 points
 * each); and Pung / Chow in a suit the hand is already heading for a flush in
 * (≥ 10 of its tiles in that suit or honours). Otherwise it passes.
 */

import { AIStrategyInterface } from '../AIStrategyInterface.js';
import { createHandViewWithExtraTile } from '../../core/Hand.js';
import { ACTION_TYPE, AI_DIFFICULTY, WIN_SOURCE } from '../../utils/constants.js';
import { isRiichiContext, valuableHonorFaces, chooseRiichiDeclaration } from '../RiichiAIHelpers.js';
import { isChineseOfficialContext } from '../ChineseOfficialAIHelpers.js';

/** Connections of tile `t` among `others` (t itself excluded by identity). */
export function connectedness(t, others) {
  let n = 0;
  for (const o of others) {
    if (o === t) continue;
    if (o.id === t.id) { n++; continue; }
    if (t.isSuited && o.isSuited && o.suit === t.suit && Math.abs(o.value - t.value) <= 2) n++;
  }
  return n;
}

export class BasicStrategy extends AIStrategyInterface {
  /** @param {{ random?: function(): number }} [options] */
  constructor({ random = Math.random } = {}) {
    super(AI_DIFFICULTY.BASIC);
    if (typeof random !== 'function') throw new TypeError('[BasicStrategy] random must be a function.');
    this._random = random;
  }

  chooseDiscard(player, context = {}) {
    const tiles = player.getHand().concealedTiles;
    if (tiles.length === 0) throw new Error(`[BasicStrategy] Seat ${player.seatIndex} has no tiles to discard from`);
    // Task 90: only tiles the rule engine allows (riichi lock, swap-calling ban).
    const allowed = Array.isArray(context.allowedDiscards) && context.allowedDiscards.length
      ? tiles.filter((t) => context.allowedDiscards.some((a) => a.instanceId === t.instanceId)) : tiles;
    const pool = allowed.length ? allowed : tiles;
    let best = Infinity; let candidates = [];
    for (const t of pool) {
      const c = connectedness(t, tiles);
      if (c < best) { best = c; candidates = [t]; }
      else if (c === best) candidates.push(t);
    }
    return candidates[Math.floor(this._random() * candidates.length)];
  }

  chooseClaim(player, actions, context = {}) {
    if (!Array.isArray(actions) || actions.length === 0) return { type: ACTION_TYPE.PASS };
    if (isRiichiContext(context)) {
      // Task 90: self-declared Kans are fine; calls only for Yakuhai (an open hand needs a yaku).
      const self = actions.filter((a) => a.type === ACTION_TYPE.KONG && a.fromSeat === undefined);
      if (self.length) return this._pick(self);
      const valuable = valuableHonorFaces(player, context);
      const yakuhai = actions.filter((a) => (a.type === ACTION_TYPE.PON || a.type === ACTION_TYPE.KONG) && valuable.has(a.faceId));
      return yakuhai.length ? this._pick(yakuhai) : { type: ACTION_TYPE.PASS };
    }
    if (isChineseOfficialContext(context)) return this._chooseMcrClaim(player, actions, context);
    const kongs = actions.filter((a) => a.type === ACTION_TYPE.KONG);
    if (kongs.length) return this._pick(kongs);
    const pons = actions.filter((a) => a.type === ACTION_TYPE.PON);
    if (pons.length) return this._pick(pons);
    const tiles = player.getHand().concealedTiles;
    const rescuing = actions.filter((a) => a.type === ACTION_TYPE.CHI && a.handTiles.some((h) => {
      const partner = a.handTiles.find((x) => x !== h);
      return connectedness(h, tiles.filter((x) => x !== partner)) === 0;
    }));
    if (rescuing.length) return this._pick(rescuing);
    return { type: ACTION_TYPE.PASS };
  }

  chooseWinDeclaration(player, winAction, context = {}) {
    // Task 90: a rule engine that validated the win itself (Riichi) knows
    // things a re-score here can't (riichi, ippatsu, furiten …).
    if (winAction && typeof winAction.validation === 'object' && winAction.validation !== null) return winAction.validation.valid === true;
    const ruleEngine = context.ruleEngine;
    if (!ruleEngine || typeof ruleEngine.scoreHand !== 'function') return true;
    const isRon = winAction.winType === WIN_SOURCE.DISCARD;
    const hand = isRon ? createHandViewWithExtraTile(player.getHand(), winAction.tile) : player.getHand();
    const score = ruleEngine.scoreHand(hand, {
      winType: winAction.winType,
      winningTile: winAction.tile,
      seatWind: context.seatWind ?? player.seatWind,
      roundWind: context.roundWind,
      isLastTile: context.wallRemaining === 0,
    });
    if (typeof score.meetsMinimum === 'boolean') return score.meetsMinimum;
    return score.points > 0;
  }

  /** Task 90 — Riichi: declare on the discard with the most live waits. */
  chooseRiichi(player, riichiAction, context = {}) {
    return chooseRiichiDeclaration(player, riichiAction, context, { minLive: 1 });
  }

  /** Task 90 — Riichi nine terminals: always take the redeal. */
  chooseAbortiveDraw() {
    return true;
  }

  /** @private — Task 98: Chinese Official claim policy (see header). */
  _chooseMcrClaim(player, actions, context) {
    const self = actions.filter((a) => a.type === ACTION_TYPE.KONG && a.fromSeat === undefined);
    if (self.length) return this._pick(self);
    const valuable = valuableHonorFaces(player, context);
    const honor = actions.filter((a) => (a.type === ACTION_TYPE.PON || a.type === ACTION_TYPE.KONG) && valuable.has(a.faceId));
    if (honor.length) return this._pick(honor);
    const hand = player.getHand();
    const all = [...hand.concealedTiles, ...hand.melds.flatMap((m) => m.tiles)];
    const flushy = (suit) => all.filter((t) => t.suit === suit || t.isHonor).length >= 10;
    const inSuit = actions.filter((a) => a.type !== ACTION_TYPE.WIN && a.tile?.isSuited && flushy(a.tile.suit));
    return inSuit.length ? this._pick(inSuit) : { type: ACTION_TYPE.PASS };
  }

  /** @private */
  _pick(list) {
    return list[Math.floor(this._random() * list.length)];
  }
}
