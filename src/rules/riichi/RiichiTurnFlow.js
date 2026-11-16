/**
 * RiichiTurnFlow.js — Riichi-specific turn flow (Task 89).
 *
 * GameManager stays ruleset-agnostic: a rule engine MAY provide
 * createTurnFlow(gameManager), and GameManager then calls the flow at fixed
 * points (see GameManager's header). Hong Kong provides none, so nothing
 * changes there. This flow keeps every piece of per-hand Riichi state:
 *
 *   RIICHI         declareRiichi(tile) marks the seat PENDING; the declaration
 *                  stands only if that discard is not won off (Ron) — then the
 *                  player pays a 1000-point stick to the table and becomes
 *                  "in riichi" (forced tsumogiri: RiichiRules' DISCARD
 *                  allowedTiles). DOUBLE RIICHI when declared on the player's
 *                  first discard of an uninterrupted first go-around.
 *   IPPATSU        from the moment the riichi stands until the player's next
 *                  discard; broken by any call or Kan by anyone.
 *   FIRST TURN     "uninterrupted" until the first call or Kan; a seat is on its
 *                  first turn until it has discarded (Tenhou / Chiihou, nine
 *                  terminals, Double Riichi).
 *   FURITEN        temporary — a tile that completes your hand passes without
 *                  your Ron (yaku or not) → no Ron until your next discard;
 *                  riichi — the same after declaring riichi, or skipping a
 *                  Tsumo win while in riichi → no Ron for the rest of the hand.
 *                  (Discard furiten is RiichiRules' own-discard check.)
 *   KUIKAE         after a Chi / Pon the next discard is filtered (lastCall).
 *   KANS           counted for the 4-Kan limit; kan dora: a closed Kan reveals
 *                  its indicator at once, an open / added Kan at the next
 *                  discard (so a Rinshan win after an open Kan doesn't see it).
 *   CHANKAN        GameManager offers the tile of an added Kan (and, for
 *                  Thirteen Orphans, a closed Kan) to the other players first.
 *   ABORTIVE DRAWS nine terminals (declared), four winds (4P: the first four
 *                  discards, no calls, all the same wind), four riichi (4P),
 *                  four Kans by more than one player (after the next discard),
 *                  triple Ron (option).
 *   SCORING        context for scoreHand: riichi / double riichi / ippatsu /
 *                  first turn / chankan flags and dora (RiichiDoraState).
 *   SESSION        starting scores (25000 4P, 35000 3P), honba and riichi sticks
 *                  on the table.
 *
 * Task 91 — SETTLEMENT + SESSION (GameManager#settleRound / _nextHandPlan):
 *   settle(outcome)        → transfers via RiichiScoring.settleRiichiHand: Ron /
 *                            Tsumo payments + honba + sticks to the winner; tenpai
 *                            payments or Nagashi Mangan at an exhaustive draw;
 *                            nothing for an abortive draw. Updates honba / sticks.
 *   dealerKeeps(outcome)   dealer win, exhaustive draw with the dealer tenpai,
 *                          or an abortive draw.
 *   isBust()               someone below 0 (option bustEndsGame).
 *   leftoverSticksTransfer()  at the end of the session the sticks still on the
 *                          table go to the top player (ties: the seat closest to
 *                          the starting dealer) — option leftoverSticksToTop.
 *   toJSON() / restoreState(state)  everything above + the per-hand state, for saves.
 */

import { countsFromTiles, findWaits, kindOfFaceId } from './RiichiHandAnalysis.js';
import { settleRiichiHand, isNagashiEligible } from './RiichiScoring.js';
import { Tile } from '../../core/Tile.js';
import { ACTION_TYPE, KONG_TYPE, WIN_SOURCE, SUIT } from '../../utils/constants.js';

export class RiichiTurnFlow {
  /**
   * @param {import('./RiichiRules.js').RiichiRules} rules
   * @param {Object} gm  the GameManager (read through its public getters)
   */
  constructor(rules, gm) {
    this._rules = rules;
    this._gm = gm;
    this.honba = 0;
    this.riichiSticks = 0;
    this._hand = null;
  }

  /** Called once by GameManager before the first deal: starting scores. */
  onSessionStart() {
    const start = this._rules.getOptions().startingScore ?? (this._gm.getPlayerCount() === 3 ? 35000 : 25000);
    for (const p of this._gm.getPlayers()) p.addScore(start - p.score);
  }

  /** Called by GameManager after every deal. */
  onHandStart() {
    const n = this._gm.getPlayerCount();
    this._hand = {
      riichi: new Array(n).fill(null),          // { double, ippatsu } once it stands
      pendingRiichi: null,                      // seat whose declaration discard is in the air
      tempFuriten: new Array(n).fill(false),
      riichiFuriten: new Array(n).fill(false),
      hasDiscarded: new Array(n).fill(false),
      uninterrupted: true,
      lastCall: new Array(n).fill(null),
      kongCount: 0,
      kongSeats: [],
      pendingKanDora: 0,
      firstDiscards: [],
      dora: this._rules.createDoraState(this._gm.getWall()),
      chankan: null,
    };
  }

  // -------------------------------------------------------------------------
  // Read-only views
  // -------------------------------------------------------------------------

  /** Task 97: what GameManager#getTableView adds — seats in riichi and the dora indicators showing. */
  tableViewExtras() { return { riichiSeats: this.getRiichiSeats(), doraIndicators: this.getDoraIndicators() }; }

  isRiichi(seat) { return this._hand?.riichi[seat] !== null && this._hand?.riichi[seat] !== undefined; }
  isFirstUninterruptedTurn(seat) { return this._hand.uninterrupted && !this._hand.hasDiscarded[seat]; }
  getKongCount() { return this._hand.kongCount; }
  getDoraState() { return this._hand.dora; }
  getDoraIndicators() { return this._hand.dora.getDoraIndicators(); }
  /** Seats whose riichi stands (for AI table reading). */
  getRiichiSeats() { return this._hand.riichi.map((r, i) => (r ? i : -1)).filter((i) => i >= 0); }
  getFuriten(seat) { return { temporary: this._hand.tempFuriten[seat], riichi: this._hand.riichiFuriten[seat] }; }

  /** Extra fields for a 'self' legal-action state. */
  selfStateExtras(seat) {
    const h = this._hand;
    const r = h.riichi[seat];
    return {
      isRiichi: !!r,
      isDoubleRiichi: !!r?.double,
      isIppatsu: !!r?.ippatsu,
      score: this._gm.getPlayer(seat).score,
      kongCount: h.kongCount,
      isFirstUninterruptedTurn: this.isFirstUninterruptedTurn(seat),
      ...(h.lastCall[seat] ? { lastCall: h.lastCall[seat] } : {}),
    };
  }

  /** Extra fields for a 'discard' legal-action state (incl. chankan). */
  discardStateExtras(seat) {
    const h = this._hand;
    const r = h.riichi[seat];
    return {
      isRiichi: !!r,
      isDoubleRiichi: !!r?.double,
      isIppatsu: !!r?.ippatsu,
      kongCount: h.kongCount,
      isTemporaryFuriten: h.tempFuriten[seat],
      isRiichiFuriten: h.riichiFuriten[seat],
    };
  }

  /**
   * Scoring context additions for a win by `player`.
   * @param {Object} player
   * @param {{ winType: string, winningTile: Object, isChankan?: boolean }} win
   */
  scoringContext(player, { winType, winningTile, isChankan = false } = {}) {
    const seat = player.seatIndex;
    const r = this._hand.riichi[seat];
    const hand = player.getHand().clone();
    if (winType === WIN_SOURCE.DISCARD && winningTile && !hand.concealedTiles.some((t) => t.instanceId === winningTile.instanceId)) hand.addConcealedTile(winningTile);
    return {
      isRiichi: !!r,
      isDoubleRiichi: !!r?.double,
      isIppatsu: !!r?.ippatsu,
      isFirstUninterruptedTurn: winType === WIN_SOURCE.SELF && this.isFirstUninterruptedTurn(seat),
      isDealer: seat === this._gm.getDealerIndex(),
      playerCount: this._gm.getPlayerCount(),
      ...(isChankan ? { isChankan: true, robbedKongType: this._hand.chankan ?? KONG_TYPE.ADDED } : {}),
      dora: this._hand.dora.doraContext(hand, { isRiichi: !!r }),
    };
  }

  // -------------------------------------------------------------------------
  // Events (called by GameManager)
  // -------------------------------------------------------------------------

  /** A riichi declaration is about to be discarded. */
  onRiichiDeclared(seat) {
    if (this.isRiichi(seat)) throw new Error('[RiichiTurnFlow] already in riichi.');
    this._hand.pendingRiichi = { seat, double: this.isFirstUninterruptedTurn(seat) };
  }

  /**
   * Called right after a discard is placed, BEFORE reactions are collected:
   * reveals kan dora waiting for this discard; a riichi player who skipped a
   * Tsumo win becomes riichi-furiten; the discarder's temporary furiten ends.
   */
  onDiscardPlaced(seat, tile, { skippedTsumo = false } = {}) {
    const h = this._hand;
    while (h.pendingKanDora > 0) { h.dora.revealKanDora(); h.pendingKanDora--; }
    if (skippedTsumo && h.riichi[seat]) h.riichiFuriten[seat] = true;
    h.tempFuriten[seat] = false;
    h.lastCall[seat] = null;
  }

  /**
   * Called after the reactions to a discard are resolved.
   * @returns {{ abortive: string|null }}
   */
  afterDiscardResolved({ seat, tile, winners = null, claim = null }) {
    const h = this._hand;
    const n = this._gm.getPlayerCount();
    const won = !!(winners && winners.length);

    // Riichi declaration outcome.
    const pending = h.pendingRiichi;
    h.pendingRiichi = null;
    if (pending && pending.seat === seat && !won) {
      h.riichi[seat] = { double: pending.double, ippatsu: true };
      this._gm.getPlayer(seat).addScore(-(this._rules.getOptions().riichiStickValue ?? 1000));
      this.riichiSticks++;
    } else if (h.riichi[seat]) {
      h.riichi[seat].ippatsu = false; // the riichi player's next discard ends ippatsu
    }

    // First go-around bookkeeping (before claims interrupt it).
    if (h.uninterrupted && !h.hasDiscarded[seat]) h.firstDiscards.push(tile);
    h.hasDiscarded[seat] = true;
    if (won) return { abortive: null };

    // Furiten for everyone this tile would have completed.
    const k = kindOfFaceId(tile.id);
    for (let s = 0; s < n; s++) {
      if (s === seat) continue;
      const hand = this._gm.getPlayer(s).getHand();
      if (hand.concealedTiles.length !== 13 - 3 * hand.meldCount) continue;
      if (findWaits(countsFromTiles(hand.concealedTiles), hand.meldCount).includes(k)) {
        if (h.riichi[s]) h.riichiFuriten[s] = true;
        else h.tempFuriten[s] = true;
      }
    }

    if (claim) this._onCall(claim.action);

    // Abortive draws decided by this discard.
    if (n === 4 && !claim && h.uninterrupted && h.firstDiscards.length === 4
      && h.firstDiscards.every((t) => t.suit === SUIT.WIND && t.id === h.firstDiscards[0].id)) return { abortive: 'four-winds' };
    if (n === 4 && h.riichi.every(Boolean)) return { abortive: 'four-riichi' };
    if (h.kongCount >= 4 && new Set(h.kongSeats).size > 1 && !(claim && claim.action.type === ACTION_TYPE.KONG)) return { abortive: 'four-kans' };
    return { abortive: null };
  }

  /** A claimed Chi / Pon / open Kan. @private */
  _onCall(action) {
    const h = this._hand;
    this._interrupt();
    if (action.type === ACTION_TYPE.CHI) h.lastCall[action.seatIndex] = { type: 'chi', tile: action.tile, sequence: action.sequence };
    if (action.type === ACTION_TYPE.PON) h.lastCall[action.seatIndex] = { type: 'pon', tile: action.tile };
    if (action.type === ACTION_TYPE.KONG) {
      h.kongCount++; h.kongSeats.push(action.seatIndex); h.pendingKanDora++;
    }
  }

  /** Calls and Kans end ippatsu for everyone and the uninterrupted first go-around. @private */
  _interrupt() {
    const h = this._hand;
    h.uninterrupted = false;
    for (const r of h.riichi) if (r) r.ippatsu = false;
  }

  /** Before a self-declared Kan is resolved: what the other players may rob. */
  robbableKong(action) {
    if (action.kongType === KONG_TYPE.ADDED) return { tile: action.tile, robbedKong: KONG_TYPE.ADDED };
    if (action.kongType === KONG_TYPE.CONCEALED) return { tile: action.tiles[0], robbedKong: KONG_TYPE.CONCEALED };
    return null;
  }

  /** Marks a chankan in progress (for the scoring context). */
  setChankan(kongType) { this._hand.chankan = kongType; }

  /** A self-declared Kan went through (nobody robbed it). */
  onSelfKong(seat, kongType) {
    const h = this._hand;
    this._interrupt();
    h.kongCount++;
    h.kongSeats.push(seat);
    if (kongType === KONG_TYPE.CONCEALED) h.dora.revealKanDora();
    else h.pendingKanDora++;
  }

  /** Triple Ron aborts the hand (4P, option tripleRonAbort). */
  isTripleRonAbort(winnerCount) {
    return this._gm.getPlayerCount() === 4 && winnerCount >= 3 && this._rules.getOptions().tripleRonAbort !== false;
  }

  /** True while `seat` must discard exactly its drawn tile. */
  isLockedToDrawnTile(seat) { return this.isRiichi(seat); }

  // -------------------------------------------------------------------------
  // Task 91 — settlement and session
  // -------------------------------------------------------------------------

  /** True when the dealer keeps the deal after `outcome`. */
  dealerKeeps(outcome) {
    const dealer = this._gm.getDealerIndex();
    if (!outcome) return false;
    if (outcome.type === 'win') return outcome.winners.some((w) => w.seatIndex === dealer);
    if (outcome.type === 'draw') return (outcome.results ?? []).some((r) => r.seatIndex === dealer && r.tenpai);
    return outcome.type === 'abortive';
  }

  /**
   * Point transfers for the finished hand (and honba / sticks for the next).
   * @returns {{ from: number|null, to: number|null, amount: number, reason: string }[]}
   */
  settle(outcome) {
    const opts = this._rules.getOptions();
    const n = this._gm.getPlayerCount();
    let o;
    if (outcome?.type === 'win') {
      o = { type: 'win', winners: outcome.winners.filter((w) => w.meetsMinimum).map((w) => ({ seatIndex: w.seatIndex, winType: w.winType, calledFrom: w.calledFrom, score: { basePoints: w.score.basePoints } })) };
      if (!o.winners.length) o = { type: 'abortive', reason: 'no-valid-winner' };
    } else if (outcome?.type === 'draw') {
      const nagashi = opts.nagashiMangan ? this._gm.getPlayers().filter((p) => isNagashiEligible(p.getDiscardPile().entries)).map((p) => p.seatIndex) : [];
      o = { type: 'draw', results: outcome.results, nagashi };
    } else {
      o = { type: 'abortive', reason: outcome?.reason };
    }
    const r = settleRiichiHand({
      outcome: o, playerCount: n, dealerIndex: this._gm.getDealerIndex(), honba: this.honba, riichiSticks: this.riichiSticks,
      options: { riichiStickValue: opts.riichiStickValue, nagashiMangan: opts.nagashiMangan },
    });
    this.honba = r.honba;
    this.riichiSticks = r.riichiSticks;
    this.lastSettlement = { ...r, nagashi: o.nagashi ?? [] };
    return r.transfers;
  }

  /** Someone has fewer than 0 points (and the option is on). */
  isBust() {
    return this._rules.getOptions().bustEndsGame === true && this._gm.getPlayers().some((p) => p.score < 0);
  }

  /** At the end of the session: the sticks still on the table go to the top player. */
  leftoverSticksTransfer() {
    const opts = this._rules.getOptions();
    if (!opts.leftoverSticksToTop || this.riichiSticks === 0) return null;
    const n = this._gm.getPlayerCount();
    const start = this._gm.getStartingDealerIndex();
    const order = Array.from({ length: n }, (_, i) => (start + i) % n);
    const top = order.reduce((best, s) => (this._gm.getPlayer(s).score > this._gm.getPlayer(best).score ? s : best), order[0]);
    const t = { from: null, to: top, amount: this.riichiSticks * opts.riichiStickValue, reason: 'leftover-sticks' };
    this.riichiSticks = 0;
    return t;
  }

  // -------------------------------------------------------------------------
  // Persistence (Task 91)
  // -------------------------------------------------------------------------

  toJSON() {
    const h = this._hand;
    const tileRef = (t) => ({ id: t.id, instanceId: t.instanceId });
    return {
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      hand: h && {
        riichi: h.riichi, pendingRiichi: h.pendingRiichi, tempFuriten: h.tempFuriten, riichiFuriten: h.riichiFuriten,
        hasDiscarded: h.hasDiscarded, uninterrupted: h.uninterrupted, kongCount: h.kongCount, kongSeats: h.kongSeats,
        pendingKanDora: h.pendingKanDora, firstDiscards: h.firstDiscards.map(tileRef),
        lastCall: h.lastCall.map((c) => (c ? { type: c.type, tile: tileRef(c.tile), sequence: c.sequence ?? null } : null)),
        dora: h.dora.toJSON(),
        chankan: h.chankan,
      },
    };
  }

  /** Restores toJSON() output (after onHandStart() rebuilt the dora state from the wall). */
  restoreState(state) {
    if (!state || typeof state !== 'object') throw new TypeError('[RiichiTurnFlow] restoreState needs a state object.');
    if (!Number.isInteger(state.honba) || state.honba < 0 || !Number.isInteger(state.riichiSticks) || state.riichiSticks < 0) {
      throw new TypeError('[RiichiTurnFlow] restoreState: honba / riichiSticks must be non-negative integers.');
    }
    this.honba = state.honba;
    this.riichiSticks = state.riichiSticks;
    const s = state.hand;
    if (!s) return;
    const h = this._hand;
    const n = this._gm.getPlayerCount();
    const arr = (a, name) => { if (!Array.isArray(a) || a.length !== n) throw new TypeError(`[RiichiTurnFlow] restoreState: ${name} must list every seat.`); return a.slice(); };
    const tile = (r) => Tile.fromId(r.id, r.instanceId);
    h.riichi = arr(s.riichi, 'riichi').map((r) => (r ? { double: !!r.double, ippatsu: !!r.ippatsu } : null));
    h.pendingRiichi = s.pendingRiichi ?? null;
    h.tempFuriten = arr(s.tempFuriten, 'tempFuriten').map(Boolean);
    h.riichiFuriten = arr(s.riichiFuriten, 'riichiFuriten').map(Boolean);
    h.hasDiscarded = arr(s.hasDiscarded, 'hasDiscarded').map(Boolean);
    h.uninterrupted = !!s.uninterrupted;
    h.kongCount = s.kongCount ?? 0;
    h.kongSeats = Array.isArray(s.kongSeats) ? s.kongSeats.slice() : [];
    h.pendingKanDora = s.pendingKanDora ?? 0;
    h.firstDiscards = (s.firstDiscards ?? []).map(tile);
    h.lastCall = arr(s.lastCall, 'lastCall').map((c) => (c ? { type: c.type, tile: tile(c.tile), ...(c.sequence ? { sequence: c.sequence } : {}) } : null));
    if (s.dora) h.dora.restoreState(s.dora);
    h.chankan = s.chankan ?? null;
  }
}
