/**
 * HintAdvisor.js — Tasks 116–117: the hint system's brain.
 *
 * Hints are the ADVANCED AI's own judgement, explained — not a second, weaker
 * heuristic. For a discard the advisor asks AdvancedStrategy (efficiency,
 * hand value for the ruleset's minimum, and its push / balance / fold defence)
 * which tile it would throw, then describes the hand that leaves:
 *
 *   discardHint(player, context) → {
 *     kind: 'discard', tile, faceId, mode ('push' | 'balance' | 'fold' | 'efficient' | 'forced' | 'fallback'),
 *     shanten,               // tiles from ready (0 = ready) for the hand kept, plain shape
 *     valueShanten,          // …to a hand that can actually WIN (minimum fan / yaku / 8 points) — the AI's own number
 *     waits: [{ faceId, live, ron, tsumo }],   // when ready: every winning tile, checked with the RULE ENGINE
 *     useful: [{ faceId, remaining }], usefulCount,   // when not ready: tiles that bring it closer
 *     danger, threat,        // the defence layer's numbers (0–1)
 *     alternatives: [{ faceId, shanten, ukeire, danger }],   // the next-best discards
 *     notes: [{ code, … }],  // ruleset advice (below)
 *   }
 *
 *   actionHint(player, actions, context) → {
 *     kind: 'action', action (one of `actions`, or { type: 'pass' }), reason, …details
 *   }   for the choices offered after your own draw: Win, Kong, Riichi, the nine-terminals draw.
 *
 * Every "you can win on X" is the rule engine's verdict (checkWin + scoreHand
 * with the ruleset's minimum), never a guess — the same check the AI uses.
 * The advisor only sees what the human seat can see (GameManager#getDecisionContext).
 *
 * NOTES (Task 117 adds the Riichi and Chinese Official ones):
 *   value-route    the hand is complete-able but not worth enough yet — the fastest route that is
 *                  (Hong Kong: honour Pung / one suit / all Pungs; Chinese Official: an MCR route and its points)
 *   dead-waits     ready, but no winning tile reaches the minimum
 *   tsumo-only     some waits only qualify by self-draw
 *   riichi-lock    in riichi: the drawn tile goes unless it wins                       (Riichi)
 *   furiten        a winning tile is in your own discards: no Ron                        (Riichi)
 *   no-yaku        ready and closed, but only riichi would give a yaku — declare it      (Riichi)
 *   flowers        flowers don't count toward the 8 points                               (Chinese Official)
 */

import { Tile } from '../core/Tile.js';
import { STANDARD_FACE_IDS } from '../core/TileSetGenerator.js';
import { ACTION_TYPE, KONG_TYPE, WIN_SOURCE, RULESET_ID } from '../utils/constants.js';
import { AdvancedStrategy, tileToKindIndex, readTable, shapeOptionsFor, meldDescriptorsOf } from './advanced/AdvancedStrategy.js';
import { countsFromTiles, calculateShanten, calculateUkeire } from './advanced/HandEfficiencyEvaluator.js';
import { analyzeValueRoutes } from './advanced/HandValuePlanner.js';
import { isRiichiContext } from './RiichiAIHelpers.js';
import { isChineseOfficialContext, analyzeMcrRoutes, MCR_MINIMUM } from './ChineseOfficialAIHelpers.js';

export const HINT_NOTE = Object.freeze({
  VALUE_ROUTE: 'value-route', DEAD_WAITS: 'dead-waits', TSUMO_ONLY: 'tsumo-only',
  RIICHI_LOCK: 'riichi-lock', FURITEN: 'furiten', NO_YAKU: 'no-yaku', FLOWERS: 'flowers',
});

const WIND_KIND = Object.freeze({ east: 27, south: 28, west: 29, north: 30 });
const windIndex = (w) => (w ? WIND_KIND[typeof w === 'string' ? w.replace(/^wind-/, '') : w.id] ?? null : null);
const rulesetOf = (context) => (typeof context?.ruleEngine?.getRulesetId === 'function' ? context.ruleEngine.getRulesetId() : null);

export class HintAdvisor {
  /** @param {{ strategy?: AdvancedStrategy }} [options] */
  constructor({ strategy } = {}) {
    this._s = strategy ?? new AdvancedStrategy({ random: () => 0.5 });
  }

  // ---------------------------------------------------------------------------
  // Discards
  // ---------------------------------------------------------------------------

  discardHint(player, context = {}) {
    if (!player || typeof player.getHand !== 'function') throw new TypeError('[HintAdvisor] discardHint needs a player.');
    if (!context.ruleEngine) throw new TypeError('[HintAdvisor] discardHint needs a decision context (GameManager#getDecisionContext).');
    const hand = player.getHand();
    const tile = this._s.chooseDiscard(player, context);
    const decision = this._s.lastDecision ?? { mode: this._s.lastDiscardMode, candidates: [] };
    const mode = decision.mode ?? this._s.lastDiscardMode ?? 'efficient';
    const kind = tileToKindIndex(tile);
    const kept = hand.clone();
    kept.removeConcealedTile(tile);

    const view = (() => { try { return readTable(player, context); } catch { return null; } })();
    const visible = view?.visibleCounts ?? null;
    const counts = countsFromTiles(kept.concealedTiles, tileToKindIndex);
    const meldCount = kept.meldCount;
    const shape = shapeOptionsFor(context);
    let shanten = null;
    try { shanten = calculateShanten(counts, { meldCount, ...shape }); } catch { shanten = null; }

    const waits = shanten === 0 || shanten === null ? this._waits(kept, player, context, visible) : [];
    const ready = waits.length > 0;
    let useful = [];
    let usefulCount = 0;
    if (!ready) {
      try {
        const u = calculateUkeire(counts, { meldCount, ...shape, ...(visible ? { visibleCounts: visible } : {}) });
        useful = u.tiles.map((t) => ({ faceId: STANDARD_FACE_IDS[t.index], remaining: t.remaining })).sort((a, b) => b.remaining - a.remaining);
        usefulCount = u.total;
      } catch { /* leave empty */ }
    }

    const cand = (decision.candidates ?? []).find((c) => c.discardIndex === kind) ?? null;
    const alternatives = (decision.candidates ?? []).filter((c) => c.discardIndex !== kind).slice(0, 3)
      .map((c) => ({ faceId: STANDARD_FACE_IDS[c.discardIndex], shanten: c.shanten, ukeire: c.ukeire, danger: c.danger ?? null }));

    const hint = {
      kind: 'discard',
      ruleset: rulesetOf(context),
      tile,
      faceId: tile.id,
      mode,
      shanten,
      valueShanten: typeof cand?.shanten === 'number' ? cand.shanten : (typeof this._s.lastValueShanten === 'number' ? this._s.lastValueShanten : shanten),
      waits,
      useful,
      usefulCount,
      danger: typeof cand?.danger === 'number' ? cand.danger : null,
      threat: typeof decision.threat === 'number' ? decision.threat : null,
      alternatives,
      notes: [],
    };
    hint.notes = this._notes(hint, { player, context, kept, counts });
    return hint;
  }

  /**
   * Every tile that would complete `kept` — checked with the rule engine — and
   * whether it can actually be declared on a discard (ron) or a self-draw (tsumo).
   * @private
   */
  _waits(kept, player, context, visible) {
    const rules = context.ruleEngine;
    if (typeof rules?.checkWin !== 'function' || typeof rules.scoreHand !== 'function') return [];
    const riichi = isRiichiContext(context);
    const seat = context.seatIndex ?? player.seatIndex;
    const inRiichi = riichi && (context.table?.riichiSeats ?? []).includes(seat);
    const own = new Map();
    for (const t of [...kept.concealedTiles, ...kept.melds.flatMap((m) => m.tiles)]) own.set(t.id, (own.get(t.id) ?? 0) + 1);
    const out = [];
    for (let k = 0; k < STANDARD_FACE_IDS.length; k++) {
      const faceId = STANDARD_FACE_IDS[k];
      if ((own.get(faceId) ?? 0) >= 4) continue;
      const probe = Tile.fromId(faceId, `${faceId}#hint`);
      const view = kept.clone();
      view.addConcealedTile(probe);
      let complete = false;
      try { complete = !!rules.checkWin(view, { winningTile: probe })?.isWin; } catch { complete = false; }
      if (!complete) continue;
      const base = { winningTile: probe, seatWind: context.seatWind ?? player.seatWind, roundWind: context.roundWind, isLastTile: false, ...(inRiichi ? { isRiichi: true } : {}) };
      const meets = (winType) => { try { return !!rules.scoreHand(view, { ...base, winType }).meetsMinimum; } catch { return false; } };
      const live = Math.max(0, 4 - (own.get(faceId) ?? 0) - (visible?.[k] ?? 0));
      out.push({ faceId, live, ron: meets(WIN_SOURCE.DISCARD), tsumo: meets(WIN_SOURCE.SELF) });
    }
    return out;
  }

  /** Ruleset advice for a discard hint. @private */
  _notes(hint, { player, context, kept, counts }) {
    const notes = [];
    const seat = context.seatIndex ?? player.seatIndex;
    const roles = { seatWindIndex: windIndex(context.seatWind ?? player.seatWind), roundWindIndex: windIndex(context.roundWind) };
    const melds = meldDescriptorsOf(kept.melds);
    const ready = hint.waits.length > 0;

    if (isRiichiContext(context)) {
      const inRiichi = (context.table?.riichiSeats ?? []).includes(seat);
      if (hint.mode === 'forced' && inRiichi) notes.push({ code: HINT_NOTE.RIICHI_LOCK });
      if (ready) {
        const mine = new Set((context.table?.discards?.[seat] ?? []).map((t) => t.id));
        const furiten = hint.waits.filter((w) => mine.has(w.faceId)).map((w) => w.faceId);
        if (furiten.length) notes.push({ code: HINT_NOTE.FURITEN, faceIds: furiten });
        const closed = kept.melds.every((m) => m.concealed === true);
        if (!inRiichi && closed && !hint.waits.some((w) => w.ron)) {
          // Would riichi give the hand its yaku? Ask the engine with the riichi flag.
          const rules = context.ruleEngine;
          const withRiichi = hint.waits.some((w) => {
            const probe = Tile.fromId(w.faceId, `${w.faceId}#hint-r`);
            const view = kept.clone(); view.addConcealedTile(probe);
            try { return !!rules.scoreHand(view, { winningTile: probe, winType: WIN_SOURCE.DISCARD, seatWind: context.seatWind ?? player.seatWind, roundWind: context.roundWind, isRiichi: true }).meetsMinimum; } catch { return false; }
          });
          if (withRiichi) notes.push({ code: HINT_NOTE.NO_YAKU, fixedByRiichi: true });
        }
      }
    }

    if (ready) {
      if (!hint.waits.some((w) => w.ron || w.tsumo) && !notes.some((n) => n.code === HINT_NOTE.NO_YAKU)) notes.push({ code: HINT_NOTE.DEAD_WAITS });
      else if (hint.waits.some((w) => !w.ron && w.tsumo) && !notes.some((n) => n.code === HINT_NOTE.NO_YAKU)) {
        notes.push({ code: HINT_NOTE.TSUMO_ONLY, faceIds: hint.waits.filter((w) => !w.ron && w.tsumo).map((w) => w.faceId) });
      }
    } else if (typeof hint.valueShanten === 'number' && typeof hint.shanten === 'number' && hint.valueShanten > hint.shanten) {
      // Close to a shape, but not to a hand worth enough: name the fastest route that is.
      try {
        if (isChineseOfficialContext(context)) {
          const r = analyzeMcrRoutes(counts, melds, roles).best;
          if (r) notes.push({ code: HINT_NOTE.VALUE_ROUTE, ruleset: RULESET_ID.CHINESE_OFFICIAL, route: r.route, points: r.points, minimum: MCR_MINIMUM, ...(r.suit !== undefined ? { suit: r.suit } : {}), ...(r.honor !== undefined ? { honorFaceId: STANDARD_FACE_IDS[r.honor] } : {}) });
        } else if (!isRiichiContext(context)) {
          const minimumFan = typeof context.ruleEngine?.getMinimumFan === 'function' ? context.ruleEngine.getMinimumFan() : 0;
          const r = analyzeValueRoutes(counts, melds, { minimumFan, ...roles }).best;
          if (r) notes.push({ code: HINT_NOTE.VALUE_ROUTE, ruleset: rulesetOf(context), route: r.route, fan: r.fan, minimum: minimumFan, ...(r.suit !== undefined ? { suit: r.suit } : {}), ...(r.honor !== undefined ? { honorFaceId: STANDARD_FACE_IDS[r.honor] } : {}) });
        }
      } catch { /* no route note */ }
    }

    const flowers = context.table?.bonusTiles?.[seat]?.length ?? 0;
    if (isChineseOfficialContext(context) && flowers > 0 && notes.some((n) => n.code === HINT_NOTE.VALUE_ROUTE || n.code === HINT_NOTE.DEAD_WAITS)) notes.push({ code: HINT_NOTE.FLOWERS, count: flowers });
    return notes;
  }

  // ---------------------------------------------------------------------------
  // Choices after your own draw
  // ---------------------------------------------------------------------------

  actionHint(player, actions, context = {}) {
    if (!Array.isArray(actions) || actions.length === 0) throw new TypeError('[HintAdvisor] actionHint needs the offered actions.');
    const of = (type) => actions.filter((a) => a.type === type);
    const win = of(ACTION_TYPE.WIN)[0];
    if (win) {
      return { kind: 'action', action: win, reason: 'win', score: win.score ?? win.validation ?? null };
    }
    const abortive = of(ACTION_TYPE.ABORTIVE_DRAW)[0];
    if (abortive) {
      const kinds = new Set(player.getHand().concealedTiles.filter((t) => t.isTerminalOrHonor).map((t) => t.id)).size;
      const take = this._s.chooseAbortiveDraw(player, abortive, context);
      if (take) return { kind: 'action', action: abortive, reason: 'nine-terminals', kinds };
      if (!of(ACTION_TYPE.RIICHI).length && !of(ACTION_TYPE.KONG).length) return { kind: 'action', action: { type: ACTION_TYPE.PASS }, reason: 'go-for-orphans', kinds };
    }
    const riichi = of(ACTION_TYPE.RIICHI)[0];
    if (riichi) {
      const pick = this._s.chooseRiichi(player, riichi, context);
      if (pick) {
        const option = (riichi.options ?? []).find((o) => o.tiles?.some((t) => t.instanceId === pick.instanceId)) ?? null;
        return { kind: 'action', action: riichi, reason: 'riichi', tile: pick, faceId: pick.id, waits: option?.waits ?? [] };
      }
      return { kind: 'action', action: { type: ACTION_TYPE.PASS }, reason: 'riichi-few-waits' };
    }
    const kongs = of(ACTION_TYPE.KONG);
    if (kongs.length) {
      let pick = null;
      try { pick = this._s.chooseClaim(player, kongs, context); } catch { pick = null; }
      if (pick && pick.type === ACTION_TYPE.KONG && kongs.includes(pick)) {
        return { kind: 'action', action: pick, reason: pick.kongType === KONG_TYPE.CONCEALED ? 'kong-concealed' : 'kong-added', faceId: pick.faceId };
      }
      return { kind: 'action', action: { type: ACTION_TYPE.PASS }, reason: 'kong-slows', faceId: kongs[0].faceId };
    }
    return { kind: 'action', action: { type: ACTION_TYPE.PASS }, reason: 'nothing' };
  }

  // ---------------------------------------------------------------------------
  // Task 118: calling another player's discard (Chi / Pon / Kong)
  // ---------------------------------------------------------------------------

  /**
   * The Advanced AI's own call on a discard: the offered action it would take
   * (the same object, ready for GameManager#resolveHumanClaim) or a pass.
   * @param {Object} player
   * @param {Object[]} options   GameManager#getPendingClaim().options
   * @param {Object} context     GameManager#getDecisionContext(seat) while the claim is pending
   * @returns {{ kind: 'claim', action, reason: 'claim' | 'pass-claim', type?, faceId, sequence? }}
   */
  claimHint(player, options, context = {}) {
    if (!player || typeof player.getHand !== 'function') throw new TypeError('[HintAdvisor] claimHint needs a player.');
    if (!Array.isArray(options) || options.length === 0) throw new TypeError('[HintAdvisor] claimHint needs the offered calls.');
    if (!context.ruleEngine) throw new TypeError('[HintAdvisor] claimHint needs a decision context (GameManager#getDecisionContext).');
    const faceId = options[0].tile?.id ?? options[0].faceId ?? null;
    let pick = null;
    try { pick = this._s.chooseClaim(player, options, context); } catch { pick = null; }
    if (pick && pick.type !== ACTION_TYPE.PASS && options.includes(pick)) {
      return { kind: 'claim', action: pick, reason: 'claim', type: pick.type, faceId, ...(pick.sequence ? { sequence: pick.sequence.slice() } : {}) };
    }
    return { kind: 'claim', action: { type: ACTION_TYPE.PASS }, reason: 'pass-claim', faceId, offered: [...new Set(options.map((o) => o.type))] };
  }
}
