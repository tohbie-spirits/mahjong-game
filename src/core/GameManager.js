/**
 * GameManager.js
 *
 * Session orchestration (Tasks 31–33, 41, 60, 65): wires wall, dealing,
 * players, TurnManager, the rule engine, the resolvers and (optionally) the
 * AI manager into a playable multi-hand session for 3 or 4 players.
 *
 * REBUILT (after Task 77) to the exact API GameScreen.js, main.js and the
 * save system use:
 *
 *   getPlayers() · getTurnManager() · getWall() · getRuleEngine()
 *   performDraw()       → { type: 'drawn', seatIndex, tile, actions, isReplacement }
 *                       | { type: 'exhausted', results }
 *   performDiscard(t)   → { type: 'discarded', seatIndex, tile, winners|null, claim|null }
 *   declareTsumo()      → winner record
 *   declareKong(action) → { meld, draw }   (draw = the replacement performDraw() result)
 *   playAITurn()        → { type: 'not-applicable' } | { type: 'exhausted', results }
 *                       | { type: 'tsumo', winner } | { type: 'discarded', … }
 *   playRoundWithAI()   → the round's outcome (all-AI tables / tests)
 *   isRoundOver() · settleRound() · isGameComplete() · startNextHand()
 *   getHandIndex() · getFinalRoundWind() · getExcludedFaceIds() · static restore()
 *   getSeatDifficulties()  (Task 79)
 *
 * Task 79: when an aiManager is given, the constructor and restore() check
 * that it has a strategy for every AI seat's aiDifficulty (seats may mix
 * tiers); build one with StrategyRegistry.createAIManagerForSeats().
 *
 * Claims on a discard (performDiscard):
 *   - AI seats with an aiManager decide through it (chooseWinDeclaration /
 *     chooseClaim). Without an aiManager every AI seat takes the best legal
 *     claim (Tasks 31–33 behaviour).
 *   - A HUMAN seat is automatically given a legal Ron. Its Chi / Pon / Kong
 *     on others' discards (Task 118 — before, it could never call them):
 *     with setHumanClaimPrompts(true) (GameScreen turns it on) a discard the
 *     human could call — and whose call would beat every AI's choice by
 *     claim priority — stops the discard: performDiscard() / playAITurn() /
 *     declareRiichi() return { type: 'awaiting-claim', options, claimSeat },
 *     getPendingClaim() describes it, and resolveHumanClaim(action | PASS)
 *     finishes the discard exactly as if the choice had been made in line.
 *     Every other call throws until then. Off (the default, and every AI-only
 *     table), the human never claims Chi / Pon / Kong (the pre-Task-118 rule).
 *   - A claimed Kong leaves the claimer at AWAITING_DRAW with a pending
 *     replacement draw (Task 42 fix), so the next performDraw() draws it.
 *
 * Events on the EventBus: game:hand-started, game:tile-drawn,
 * game:tile-discarded, game:claim, game:riichi (Task 109), game:bonus-tile
 * (Task 97), game:round-over, game:round-settled. (Nothing in the game logic
 * listens — they are for the UI: sounds, the screen-reader announcer.)
 *
 * TURN FLOW HOOKS (Task 89). A rule engine MAY provide createTurnFlow(gm);
 * Hong Kong doesn't, so for it every hook below is skipped and nothing
 * changes. With a flow (Riichi — RiichiTurnFlow.js):
 *   constructor  flow.onSessionStart() (starting scores)   _startRound  flow.onHandStart()
 *   getSelfActions / reactions  state += flow.selfStateExtras / discardStateExtras
 *   performDiscard  flow.onDiscardPlaced → reactions → flow.afterDiscardResolved
 *                   (may end the hand as an ABORTIVE draw); triple Ron → abortive
 *   declareKong     the other seats may first rob the Kan (chankan), else
 *                   flow.onSelfKong        scoring context += flow.scoringContext
 *   new methods     declareRiichi(tile), declareAbortiveDraw(), getTurnFlow()
 *   getTableView    += flow.tableViewExtras()
 * Task 97 (Chinese Official — ChineseOfficialTurnFlow.js), still generic:
 *   BONUS TILES  when the flow has onBonusTile(seat, tile), a bonus tile it
 *                recognises (flow.isBonusTile) is set aside and replaced from
 *                the wall's replacement end — after the deal (dealer first,
 *                repeating until no seat holds one) and on every draw; the
 *                drawn result lists them as `bonusTiles`. Event
 *                game:bonus-tile { seatIndex, tile }. A Kong replacement
 *                stays a Kong replacement through any flowers it brings.
 *   ONE WINNER   flow.maxWinnersPerDiscard() (when provided) caps the winners
 *                of one discard / robbed Kong — the first in turn order.
 * Generic (every ruleset): performDiscard refuses a tile outside the DISCARD
 * action's allowedTiles when the rule engine lists them (HK never does), and
 * AI discards fall back to an allowed tile. Outcomes may now also be
 * { type: 'abortive', reason, seatIndex } — treated like a draw for the next
 * hand until Task 91's flow settlement.
 */

import { gameEventBus } from './EventBus.js';
import { PlayerManager } from './PlayerManager.js';
import { WallManager } from './WallManager.js';
import { TurnManager } from './TurnManager.js';
import { createDeck } from './DeckGenerator.js';
import { createSeededRandom } from './ShuffleService.js';
import { dealInitialHands } from './DealingService.js';
import { resolveClaim, resolveSelfKong } from './ClaimResolver.js';
import { filterDiscardClaimActions, resolveClaimPriority, applyClaimResolution } from './TurnInterruptionResolver.js';
import { resolveTsumoWin, resolveRonWin } from './WinResolver.js';
import { resolveExhaustiveDraw } from './DrawResolver.js';
import { computeNextHand, assignSeatWinds } from './RoundProgression.js';
import { isValidRuleEngine } from '../rules/RuleEngineInterface.js';
import { ACTION_TYPE, TURN_PHASE, KONG_TYPE, WIND, WIND_ORDER, SEAT_KIND, WIN_SOURCE } from '../utils/constants.js';

/**
 * Task 79: when an AIManager is supplied it must hold a strategy for every
 * AI seat's difficulty. Checked when the session is built (or restored) so a
 * mis-wired table fails at once with a clear message instead of throwing on
 * that seat's first turn. A null aiManager stays allowed (Tasks 31–33
 * behaviour: AI seats then take the best legal claim and playAITurn() is
 * not applicable).
 */
function assertAIManagerCoversSeats(aiManager, players, where) {
  if (aiManager === null || aiManager === undefined) return;
  if (typeof aiManager.hasStrategy !== 'function') throw new TypeError(`[GameManager] ${where}: aiManager must be an AIManager.`);
  const missing = players.filter((p) => p.seatKind === SEAT_KIND.AI && !aiManager.hasStrategy(p.aiDifficulty));
  if (missing.length) {
    const list = missing.map((p) => `seat ${p.seatIndex} "${p.aiDifficulty}"`).join(', ');
    throw new Error(`[GameManager] ${where}: no AI strategy registered for ${list}.`);
  }
}

const CLAIM_RANK = Object.freeze({ [ACTION_TYPE.KONG]: 0, [ACTION_TYPE.PON]: 1, [ACTION_TYPE.CHI]: 2 });

export class GameManager {
  /**
   * @param {Object} options
   * @param {Object} options.ruleEngine              a RuleEngineInterface implementation
   * @param {Object[]} options.playerConfigs         3 or 4 × { seatIndex, displayName, seatKind, aiDifficulty }
   * @param {Object} [options.aiManager=null]        AIManager (Task 36)
   * @param {import('./EventBus.js').EventBus} [options.eventBus=gameEventBus]
   * @param {number} [options.seed]                  reproducible walls (tests/simulations)
   * @param {number} [options.dealerIndex=0]         first dealer
   * @param {Object} [options.finalRoundWind=WIND.EAST]  last prevailing-wind round of the session
   * @param {number} [options.maxHands=32]           safety cap on hands per session
   */
  constructor({ ruleEngine, playerConfigs, aiManager = null, eventBus = gameEventBus, seed, dealerIndex = 0, finalRoundWind = WIND.EAST, maxHands = 32 } = {}) {
    if (!isValidRuleEngine(ruleEngine)) throw new TypeError('[GameManager] ruleEngine must implement RuleEngineInterface.');
    if (!Array.isArray(playerConfigs) || playerConfigs.length < 3 || playerConfigs.length > 4) {
      throw new RangeError('[GameManager] playerConfigs must list 3 or 4 players.');
    }
    playerConfigs.forEach((c, i) => {
      if (c?.seatIndex !== i) throw new RangeError(`[GameManager] playerConfigs[${i}].seatIndex must be ${i}.`);
    });
    if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex >= playerConfigs.length) throw new RangeError('[GameManager] dealerIndex out of range.');
    if (!WIND_ORDER.includes(finalRoundWind)) throw new TypeError('[GameManager] finalRoundWind must be a WIND value.');
    if (!Number.isInteger(maxHands) || maxHands < 1) throw new RangeError('[GameManager] maxHands must be a positive integer.');

    this._ruleEngine = ruleEngine;
    this._aiManager = aiManager;
    this._eventBus = eventBus;
    this._players = playerConfigs.map((c) => new PlayerManager(c));
    assertAIManagerCoversSeats(aiManager, this._players, 'constructor');
    this._playerCount = this._players.length;
    this._startingDealerIndex = dealerIndex;
    this._dealerIndex = dealerIndex;
    this._roundWind = WIND.EAST;
    this._finalRoundWind = finalRoundWind;
    this._handIndex = 0;
    this._maxHands = maxHands;
    this._pendingClaim = null; // Task 118
    this._humanClaimPrompts = false;
    this._excludedFaceIds = (ruleEngine.getTileSetOptions().excludedFaceIds ?? []).slice();
    this._random = seed !== undefined ? createSeededRandom(seed) : Math.random;
    // Task 89: an optional ruleset turn flow (Riichi); null for Hong Kong.
    this._flow = typeof ruleEngine.createTurnFlow === 'function' ? ruleEngine.createTurnFlow(this) : null;
    this._flow?.onSessionStart();
    this._startRound();
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getPlayers() { return this._players.slice(); }
  getPlayer(seatIndex) { return this._players[seatIndex]; }
  getPlayerCount() { return this._playerCount; }
  getTurnManager() { return this._turnManager; }
  getWall() { return this._wall; }
  getRuleEngine() { return this._ruleEngine; }
  getAIManager() { return this._aiManager; }
  /** Task 89: the ruleset's turn flow (RiichiTurnFlow), or null. */
  getTurnFlow() { return this._flow ?? null; }
  /** Task 79: each seat's AI difficulty (null for a human seat), in seat order. */
  getSeatDifficulties() { return this._players.map((p) => p.aiDifficulty ?? null); }
  getEventBus() { return this._eventBus; }
  getDealerIndex() { return this._dealerIndex; }
  getStartingDealerIndex() { return this._startingDealerIndex; }
  getRoundWind() { return this._roundWind; }
  getHandIndex() { return this._handIndex; }
  getFinalRoundWind() { return this._finalRoundWind; }
  getExcludedFaceIds() { return this._excludedFaceIds.slice(); }
  getMaxHands() { return this._maxHands; }
  /** { roundWind, dealerIndex, handIndex } */
  getRoundState() { return { roundWind: this._roundWind, dealerIndex: this._dealerIndex, handIndex: this._handIndex }; }
  /** Same as getRoundState() — kept as a property for snapshot code. */
  get roundState() { return this.getRoundState(); }
  /** The latest discard { tile, fromSeat }, or null. */
  getLastDiscard() { return this._lastDiscard ? { ...this._lastDiscard } : null; }
  /** Task 91: the tile the current seat just drew (null after a discard or a claim). */
  getLastDrawnTile() { return this._lastDrawnTile ?? null; }
  /** Task 99: true when the tile the current seat just drew was a Kong replacement. */
  wasLastDrawReplacement() { return this._lastDrawnTile ? this._lastDrawWasReplacement === true : false; }
  /** True when the current seat's next performDraw() is a Kong replacement. */
  hasPendingReplacement() { return this._pendingReplacement; }
  /** { type: 'win', winners } | { type: 'draw', results } | null */
  getLastOutcome() { return this._lastOutcome; }
  isRoundOver() { return this._turnManager.isRoundOver(); }

  /** Public table view for AI strategies and UI: every seat's discards and melds. */
  getTableView() {
    return {
      discards: this._players.map((p) => p.getDiscardPile().tiles),
      melds: this._players.map((p) => p.getHand().melds),
      dealerIndex: this._dealerIndex,
      roundWind: this._roundWind,
      wallRemaining: this._wall.remainingCount,
      // Task 89 (only with a turn flow): seats in riichi and the dora indicators showing.
      ...(this._flow ? this._flow.tableViewExtras() : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Turn actions
  // -------------------------------------------------------------------------

  /**
   * Draws for the current seat (a Kong replacement when one is pending).
   * Ends the round as an exhaustive draw when the wall is empty.
   */
  performDraw() {
    this._assertActive('performDraw');
    const tm = this._turnManager;
    if (tm.getPhase() !== TURN_PHASE.AWAITING_DRAW) throw new Error('[GameManager] performDraw() called outside the draw phase.');
    const seatIndex = tm.getCurrentPlayerIndex();
    const isReplacement = this._pendingReplacement;
    let tile = isReplacement ? this._wall.drawReplacement() : this._wall.draw();
    this._pendingReplacement = false;
    // Task 97: bonus tiles (flowers) are set aside and replaced.
    const bonusTiles = [];
    while (tile && this._isBonus(tile)) {
      this._setAsideBonus(seatIndex, tile);
      bonusTiles.push(tile);
      tile = this._wall.drawReplacement();
    }

    if (!tile) {
      const results = resolveExhaustiveDraw(this._players, this._ruleEngine);
      tm.declareDraw();
      this._lastOutcome = { type: 'draw', results };
      this._eventBus?.emit('game:round-over', { outcome: this._lastOutcome });
      return { type: 'exhausted', results, ...(bonusTiles.length ? { bonusTiles } : {}) };
    }

    this._players[seatIndex].addTileToHand(tile);
    tm.markDrawn();
    this._lastDrawnTile = tile;
    this._lastDrawWasReplacement = isReplacement;
    this._eventBus?.emit('game:tile-drawn', { seatIndex, isReplacement });
    return { type: 'drawn', seatIndex, tile, actions: this.getSelfActions(), isReplacement, ...(bonusTiles.length ? { bonusTiles } : {}) };
  }

  /** @private — Task 97: does the ruleset set this tile aside? */
  _isBonus(tile) {
    return !!this._flow && typeof this._flow.onBonusTile === 'function' && this._flow.isBonusTile(tile);
  }

  /** @private — Task 97: hands a bonus tile to the flow. */
  _setAsideBonus(seatIndex, tile) {
    this._flow.onBonusTile(seatIndex, tile);
    this._eventBus?.emit('game:bonus-tile', { seatIndex, tile });
  }

  /**
   * @private — Task 97: after the deal, each seat (dealer first) sets aside its
   * bonus tiles and draws replacements, round after round until none is left.
   */
  _replaceInitialBonusTiles() {
    if (!this._flow || typeof this._flow.onBonusTile !== 'function') return;
    for (let pass = 0; pass < 64; pass++) {
      let found = false;
      for (let i = 0; i < this._playerCount; i++) {
        const seat = (this._dealerIndex + i) % this._playerCount;
        const player = this._players[seat];
        for (const t of player.getHand().concealedTiles.filter((x) => this._isBonus(x))) {
          found = true;
          player.removeTileFromHand(t);
          this._setAsideBonus(seat, t);
          const r = this._wall.drawReplacement();
          if (r) player.addTileToHand(r);
        }
      }
      if (!found) return;
    }
  }

  /** @private — Task 97: caps a winner list (first in turn order) when the flow says so. */
  _capWinners(actions) {
    const max = this._flow && typeof this._flow.maxWinnersPerDiscard === 'function' ? this._flow.maxWinnersPerDiscard() : Infinity;
    return actions.slice(0, max);
  }

  /** Legal self-actions for the current seat right now (after a draw or a claim). */
  getSelfActions() {
    this._assertActive('getSelfActions');
    const tm = this._turnManager;
    if (tm.getPhase() !== TURN_PHASE.AWAITING_DISCARD) return [];
    const seatIndex = tm.getCurrentPlayerIndex();
    const player = this._players[seatIndex];
    return this._ruleEngine.getLegalActions({
      kind: 'self',
      seatIndex,
      playerCount: this._playerCount,
      drawnTile: this._lastDrawnTile,
      isReplacementDraw: this._lastDrawWasReplacement,
      wallRemaining: this._wall.remainingCount,
      seatWind: player.seatWind,
      roundWind: this._roundWind,
      ...(this._flow ? this._flow.selfStateExtras(seatIndex) : {}),
    }, player);
  }

  /** Declares a self-drawn win for the current seat. */
  declareTsumo() {
    this._assertActive('declareTsumo');
    const seatIndex = this._turnManager.getCurrentPlayerIndex();
    const win = this.getSelfActions().find((a) => a.type === ACTION_TYPE.WIN);
    if (!win) throw new Error('[GameManager] declareTsumo(): no legal self-drawn win right now.');
    const player = this._players[seatIndex];
    const winner = resolveTsumoWin({
      player,
      winningTile: this._lastDrawnTile,
      ruleEngine: this._ruleEngine,
      context: this._scoringContext(player, { isKongReplacement: this._lastDrawWasReplacement, winType: WIN_SOURCE.SELF, winningTile: this._lastDrawnTile }),
    });
    this._turnManager.declareWin();
    this._lastOutcome = { type: 'win', winners: [winner] };
    this._eventBus?.emit('game:round-over', { outcome: this._lastOutcome });
    return winner;
  }

  /**
   * Declares a concealed or added Kong for the current seat, then draws the
   * replacement tile.
   * @param {Object} action  a KONG action from getSelfActions()
   * @returns {{ meld: import('./Hand.js').Meld, draw: Object }}
   */
  declareKong(action) {
    this._assertActive('declareKong');
    const tm = this._turnManager;
    const seatIndex = tm.getCurrentPlayerIndex();
    if (tm.getPhase() !== TURN_PHASE.AWAITING_DISCARD) throw new Error('[GameManager] declareKong() only after drawing.');
    if (!action || action.type !== ACTION_TYPE.KONG || action.seatIndex !== seatIndex) throw new TypeError('[GameManager] declareKong() needs a kong action for the current seat.');
    if (![KONG_TYPE.CONCEALED, KONG_TYPE.ADDED].includes(action.kongType)) throw new TypeError('[GameManager] only concealed or added kongs are declared on your own turn.');
    const legal = this.getSelfActions().some((a) => a.type === ACTION_TYPE.KONG && a.faceId === action.faceId && a.kongType === action.kongType);
    if (!legal) throw new Error('[GameManager] that kong is not legal right now.');

    // Task 89: with a turn flow, the other players may rob the Kan first (chankan).
    if (this._flow) {
      const rob = this._flow.robbableKong(action);
      if (rob) {
        const wins = [];
        for (let step = 1; step < this._playerCount; step++) {
          const s = (seatIndex + step) % this._playerCount;
          const choice = this._chooseReaction(s, rob.tile, seatIndex, rob.robbedKong);
          if (choice && choice.type === ACTION_TYPE.WIN) wins.push(choice);
        }
        if (wins.length) {
          this._flow.setChankan(rob.robbedKong);
          const ordered = this._capWinners(resolveClaimPriority(wins, seatIndex, this._playerCount).actions);
          const winners = ordered.map((a) => resolveRonWin({
            player: this._players[a.seatIndex], winningTile: rob.tile, fromSeat: seatIndex, ruleEngine: this._ruleEngine,
            context: this._scoringContext(this._players[a.seatIndex], { winType: WIN_SOURCE.DISCARD, winningTile: rob.tile, isChankan: true }),
          }));
          tm.declareWin();
          this._lastOutcome = { type: 'win', winners, chankan: true };
          this._eventBus?.emit('game:round-over', { outcome: this._lastOutcome });
          return { meld: null, draw: null, robbed: winners };
        }
      }
    }
    const meld = resolveSelfKong(action, this._players[seatIndex]);
    this._flow?.onSelfKong(seatIndex, action.kongType);
    this._eventBus?.emit('game:claim', { seatIndex, type: ACTION_TYPE.KONG, kongType: action.kongType });
    tm.forceSetTurn(seatIndex, TURN_PHASE.AWAITING_DRAW);
    this._pendingReplacement = true;
    this._lastDrawnTile = null;
    const draw = this.performDraw();
    return { meld, draw };
  }

  /**
   * The current seat discards `tile`; other seats may claim it.
   * @param {import('./Tile.js').Tile} tile
   */
  performDiscard(tile) {
    this._assertActive('performDiscard');
    const tm = this._turnManager;
    if (tm.getPhase() !== TURN_PHASE.AWAITING_DISCARD) throw new Error('[GameManager] performDiscard() outside the discard phase.');
    const seatIndex = tm.getCurrentPlayerIndex();
    const player = this._players[seatIndex];
    // Task 89: a ruleset may restrict the discard (Riichi lock, swap-calling
    // ban) through DISCARD.allowedTiles; HK never lists them.
    const selfActions = this.getSelfActions();
    const allowed = selfActions.find((a) => a.type === ACTION_TYPE.DISCARD)?.allowedTiles;
    if (allowed && !allowed.some((t) => t.instanceId === tile?.instanceId)) {
      throw new Error(`[GameManager] ${tile?.id ?? 'that tile'} may not be discarded right now.`);
    }
    const skippedTsumo = !!this._flow && this._flow.isRiichi(seatIndex) && selfActions.some((a) => a.type === ACTION_TYPE.WIN);
    player.discardTile(tile);
    this._lastDrawnTile = null;
    this._lastDrawWasReplacement = false;
    this._lastDiscard = { tile, fromSeat: seatIndex };
    this._flow?.onDiscardPlaced(seatIndex, tile, { skippedTsumo });
    this._eventBus?.emit('game:tile-discarded', { seatIndex, tile });

    const chosen = [];
    let humanOffer = null;
    for (let step = 1; step < this._playerCount; step++) {
      const s = (seatIndex + step) % this._playerCount;
      if (this._humanClaimPrompts && this._players[s].seatKind === SEAT_KIND.HUMAN) {
        const actions = this._reactionActions(s, tile, seatIndex);
        const win = actions.find((a) => a.type === ACTION_TYPE.WIN);
        if (win) chosen.push(win); // a legal Ron stays automatic
        else if (actions.length) humanOffer = { seat: s, claims: actions };
        continue;
      }
      const choice = this._chooseReaction(s, tile, seatIndex);
      if (choice) chosen.push(choice);
    }
    if (humanOffer) {
      // Offer only the calls that would actually happen: a call an AI's choice outranks is moot.
      const options = humanOffer.claims.filter((a) => { const r = resolveClaimPriority([...chosen, a], seatIndex, this._playerCount); return r?.type === 'claim' && r.action === a; });
      if (options.length) {
        this._pendingClaim = { tile, fromSeat: seatIndex, seatIndex: humanOffer.seat, options, chosen, riichi: false };
        return { type: 'awaiting-claim', seatIndex, tile, claimSeat: humanOffer.seat, options: options.slice(), winners: null, claim: null };
      }
    }
    return this._resolveDiscardReactions(seatIndex, tile, chosen);
  }

  /** @private — the rest of a discard once every seat's reaction is known (Task 118 split). */
  _resolveDiscardReactions(seatIndex, tile, chosen) {
    const tm = this._turnManager;
    const player = this._players[seatIndex];
    const resolution = resolveClaimPriority(chosen, seatIndex, this._playerCount);

    if (!resolution) {
      const flowResult = this._flow?.afterDiscardResolved({ seat: seatIndex, tile });
      tm.advanceAfterDiscard();
      if (flowResult?.abortive) return { type: 'discarded', seatIndex, tile, winners: null, claim: null, abortive: this._endAbortive(flowResult.abortive) };
      return { type: 'discarded', seatIndex, tile, winners: null, claim: null };
    }

    tm.recordDiscard();
    if (resolution.type === 'win') {
      if (this._flow?.isTripleRonAbort(resolution.actions.length)) {
        this._flow.afterDiscardResolved({ seat: seatIndex, tile, winners: resolution.actions });
        return { type: 'discarded', seatIndex, tile, winners: null, claim: null, abortive: this._endAbortive('triple-ron') };
      }
      const winners = this._capWinners(resolution.actions).map((a) => resolveRonWin({
        player: this._players[a.seatIndex],
        winningTile: tile,
        fromSeat: seatIndex,
        ruleEngine: this._ruleEngine,
        context: this._scoringContext(this._players[a.seatIndex], { winType: WIN_SOURCE.DISCARD, winningTile: tile }),
      }));
      player.getDiscardPile().markLastClaimed(winners[0].seatIndex, ACTION_TYPE.WIN);
      this._flow?.afterDiscardResolved({ seat: seatIndex, tile, winners });
      tm.declareWin();
      this._lastOutcome = { type: 'win', winners };
      this._eventBus?.emit('game:round-over', { outcome: this._lastOutcome });
      return { type: 'discarded', seatIndex, tile, winners, claim: null };
    }

    const action = resolution.action;
    const meld = resolveClaim(action, this._players);
    applyClaimResolution(tm, action);
    if (action.type === ACTION_TYPE.KONG) this._pendingReplacement = true;
    const flowResult = this._flow?.afterDiscardResolved({ seat: seatIndex, tile, claim: { action, meld } });
    this._eventBus?.emit('game:claim', { seatIndex: action.seatIndex, type: action.type, fromSeat: seatIndex });
    if (flowResult?.abortive) return { type: 'discarded', seatIndex, tile, winners: null, claim: { action, meld }, abortive: this._endAbortive(flowResult.abortive) };
    return { type: 'discarded', seatIndex, tile, winners: null, claim: { action, meld } };
  }

  /**
   * Task 89 — declares riichi by discarding `tile` (a tile from the RIICHI
   * action's allowedTiles). The declaration stands only if the discard isn't
   * won off; the turn flow then takes the riichi stick.
   * @returns {Object} the performDiscard() result plus `riichi: true`
   */
  declareRiichi(tile) {
    this._assertActive('declareRiichi');
    if (!this._flow) throw new Error('[GameManager] this ruleset has no riichi.');
    const seatIndex = this._turnManager.getCurrentPlayerIndex();
    const act = this.getSelfActions().find((a) => a.type === ACTION_TYPE.RIICHI);
    if (!act) throw new Error('[GameManager] riichi is not legal right now.');
    if (!act.allowedTiles.some((t) => t.instanceId === tile?.instanceId)) throw new Error('[GameManager] that discard does not leave the hand tenpai.');
    this._flow.onRiichiDeclared(seatIndex);
    this._eventBus?.emit('game:riichi', { seatIndex }); // Task 109: for the UI / audio (no game logic listens)
    const r = this.performDiscard(tile);
    if (this._pendingClaim) this._pendingClaim.riichi = true;
    return { ...r, riichi: true };
  }

  /**
   * Task 89 — declares an offered abortive draw (Riichi nine terminals).
   * @returns {{ type: 'abortive', reason: string, seatIndex: number }}
   */
  declareAbortiveDraw() {
    this._assertActive('declareAbortiveDraw');
    const seatIndex = this._turnManager.getCurrentPlayerIndex();
    const act = this.getSelfActions().find((a) => a.type === ACTION_TYPE.ABORTIVE_DRAW);
    if (!act) throw new Error('[GameManager] no abortive draw can be declared right now.');
    return this._endAbortive(act.reason, seatIndex);
  }

  /** @private — ends the round as an abortive draw. */
  _endAbortive(reason, seatIndex = null) {
    this._turnManager.declareAbortiveDraw();
    this._lastOutcome = { type: 'abortive', reason, seatIndex };
    this._eventBus?.emit('game:round-over', { outcome: this._lastOutcome });
    return this._lastOutcome;
  }

  /** @private — the legal reactions (Win / Kong / Pon / Chi) a seat has to a discard. */
  _reactionActions(seat, tile, fromSeat, robbedKong = null) {
    const player = this._players[seat];
    return filterDiscardClaimActions(this._ruleEngine.getLegalActions({
      kind: 'discard',
      seatIndex: seat,
      playerCount: this._playerCount,
      discard: robbedKong ? { tile, fromSeat, robbedKong } : { tile, fromSeat },
      wallRemaining: this._wall.remainingCount,
      seatWind: player.seatWind,
      roundWind: this._roundWind,
      ...(this._flow ? this._flow.discardStateExtras(seat) : {}),
    }, player));
  }

  /** @private — one seat's reaction to a discard (an action or null for pass). */
  _chooseReaction(seat, tile, fromSeat, robbedKong = null) {
    const player = this._players[seat];
    const actions = this._reactionActions(seat, tile, fromSeat, robbedKong);
    if (actions.length === 0) return null;
    const win = actions.find((a) => a.type === ACTION_TYPE.WIN);

    if (player.seatKind === SEAT_KIND.HUMAN) return win ?? null; // see header

    const ai = this._aiManager;
    const context = this._aiContext(seat, { discard: { tile, fromSeat } });
    if (!ai) {
      if (win) return win;
      return actions.slice().sort((a, b) => CLAIM_RANK[a.type] - CLAIM_RANK[b.type])[0];
    }
    if (win && ai.chooseWinDeclaration(player, win, context)) return win;
    const claims = actions.filter((a) => a.type !== ACTION_TYPE.WIN);
    if (claims.length === 0) return null;
    const pick = ai.chooseClaim(player, claims, context);
    return pick && pick.type !== ACTION_TYPE.PASS && claims.includes(pick) ? pick : null;
  }

  /**
   * Plays one whole AI turn for the current seat (draw → self-Kong/Tsumo loop
   * → discard), or just the discard when the seat has already claimed a meld.
   */
  playAITurn() {
    if (this.isRoundOver()) return { type: 'not-applicable', reason: 'round-over' };
    if (this._pendingClaim) return { type: 'not-applicable', reason: 'awaiting-claim', seatIndex: this._pendingClaim.seatIndex };
    const tm = this._turnManager;
    const seatIndex = tm.getCurrentPlayerIndex();
    const player = this._players[seatIndex];
    if (player.seatKind !== SEAT_KIND.AI) return { type: 'not-applicable', reason: 'human-seat', seatIndex };
    if (!this._aiManager) return { type: 'not-applicable', reason: 'no-ai-manager', seatIndex };
    const ai = this._aiManager;

    let actions = [];
    if (tm.getPhase() === TURN_PHASE.AWAITING_DRAW) {
      const draw = this.performDraw();
      if (draw.type === 'exhausted') return { type: 'exhausted', results: draw.results };
      actions = draw.actions;
    } else {
      actions = this.getSelfActions();
    }

    for (let guard = 0; guard < 8; guard++) {
      const win = actions.find((a) => a.type === ACTION_TYPE.WIN);
      if (win && ai.chooseWinDeclaration(player, win, this._aiContext(seatIndex))) {
        return { type: 'tsumo', seatIndex, winner: this.declareTsumo() };
      }
      const kongs = actions.filter((a) => a.type === ACTION_TYPE.KONG);
      if (kongs.length === 0) break;
      const pick = ai.chooseClaim(player, kongs, this._aiContext(seatIndex));
      if (!pick || pick.type !== ACTION_TYPE.KONG || !kongs.includes(pick)) break;
      const kong = this.declareKong(pick);
      if (kong.robbed) return { type: 'chankan', seatIndex, winners: kong.robbed };
      const { draw } = kong;
      if (draw.type === 'exhausted') return { type: 'exhausted', results: draw.results };
      actions = draw.actions;
    }

    // Task 90: Riichi special calls the AI may take before discarding.
    const abortive = actions.find((a) => a.type === ACTION_TYPE.ABORTIVE_DRAW);
    if (abortive && ai.chooseAbortiveDraw(player, abortive, this._aiContext(seatIndex))) {
      return { type: 'abortive', seatIndex, outcome: this.declareAbortiveDraw() };
    }
    const riichi = actions.find((a) => a.type === ACTION_TYPE.RIICHI);
    if (riichi) {
      const pick = ai.chooseRiichi(player, riichi, this._aiContext(seatIndex));
      if (pick && riichi.allowedTiles.some((t) => t.instanceId === pick.instanceId)) {
        const r = this.declareRiichi(pick);
        if (r.type === 'awaiting-claim') return { ...r, riichi: true };
        return { type: 'discarded', seatIndex, tile: pick, winners: r.winners, claim: r.claim, riichi: true, ...(r.abortive ? { abortive: r.abortive } : {}) };
      }
    }

    // Task 89: a ruleset may restrict discards (DISCARD.allowedTiles).
    const allowed = actions.find((a) => a.type === ACTION_TYPE.DISCARD)?.allowedTiles ?? null;
    let tile = ai.chooseDiscard(player, this._aiContext(seatIndex, allowed ? { allowedDiscards: allowed } : {}));
    const concealed = player.getHand().concealedTiles;
    if (!tile || !concealed.some((t) => t.instanceId === tile.instanceId)) {
      console.warn(`[GameManager] AI seat ${seatIndex} chose an invalid discard; discarding its last tile instead.`);
      tile = concealed[concealed.length - 1];
    }
    if (allowed && !allowed.some((t) => t.instanceId === tile.instanceId)) tile = allowed[allowed.length - 1];
    const result = this.performDiscard(tile);
    if (result.type === 'awaiting-claim') return result;
    return { type: 'discarded', seatIndex, tile, winners: result.winners, claim: result.claim, ...(result.abortive ? { abortive: result.abortive } : {}) };
  }

  /**
   * Plays AI turns until the round ends (every seat must be AI).
   * @param {{ maxTurns?: number }} [options]
   * @returns {Object} the round outcome
   */
  playRoundWithAI({ maxTurns = 1000 } = {}) {
    for (let i = 0; i < maxTurns && !this.isRoundOver(); i++) {
      const r = this.playAITurn();
      if (r.type === 'not-applicable') throw new Error(`[GameManager] playRoundWithAI(): ${r.reason}`);
    }
    if (!this.isRoundOver()) throw new Error('[GameManager] playRoundWithAI(): turn limit reached.');
    return this._lastOutcome;
  }

  // -------------------------------------------------------------------------
  // Hand end, settlement, session
  // -------------------------------------------------------------------------

  /**
   * Applies point transfers for the finished hand (Task 60). Idempotent.
   *   Tsumo: every other player pays winner.points.
   *   Ron:   the discarder pays winner.points (each winner independently).
   *   Draw:  nothing. Winners below the minimum fan are skipped.
   * @returns {{ settled: true, transfers: {from: number, to: number, amount: number}[] }}
   */
  settleRound() {
    if (!this.isRoundOver()) throw new Error('[GameManager] settleRound() before the round is over.');
    if (this._settlement) return this._settlement;
    const outcome = this._lastOutcome;
    if (this._flow) return this._settleWithFlow(outcome);
    const transfers = [];
    if (outcome?.type === 'win') {
      for (const w of outcome.winners) {
        if (!w.meetsMinimum) continue;
        if (w.winType === 'self') {
          for (const p of this._players) {
            if (p.seatIndex !== w.seatIndex) transfers.push({ from: p.seatIndex, to: w.seatIndex, amount: w.points });
          }
        } else {
          transfers.push({ from: w.calledFrom, to: w.seatIndex, amount: w.points });
        }
      }
    }
    for (const t of transfers) {
      this._players[t.from].addScore(-t.amount);
      this._players[t.to].addScore(t.amount);
    }
    this._settlement = { settled: true, transfers };
    this._eventBus?.emit('game:round-settled', { transfers, handIndex: this._handIndex });
    return this._settlement;
  }

  /**
   * @private — Task 91: settlement through the ruleset's turn flow (Riichi):
   * Ron / Tsumo + honba + riichi sticks, tenpai payments / Nagashi Mangan,
   * nothing for an abortive draw; at the end of the session the sticks left
   * on the table go to the top player. `from` / `to` null = the table.
   */
  _settleWithFlow(outcome) {
    const transfers = this._flow.settle(outcome);
    const apply = (t) => {
      if (t.from !== null) this._players[t.from].addScore(-t.amount);
      if (t.to !== null) this._players[t.to].addScore(t.amount);
    };
    transfers.forEach(apply);
    this._settlement = { settled: true, transfers };
    if (this._nextHandPlan().isSessionComplete) {
      const leftover = this._flow.leftoverSticksTransfer();
      if (leftover) { apply(leftover); transfers.push(leftover); }
    }
    this._eventBus?.emit('game:round-settled', { transfers, handIndex: this._handIndex });
    return this._settlement;
  }

  /** @private — what happens next, given the finished hand. */
  _nextHandPlan() {
    const outcome = this._lastOutcome;
    if (this._flow) {
      // Task 91: Riichi dealer continuation; the session also ends on a bust.
      const plan = computeNextHand({
        dealerIndex: this._dealerIndex, startingDealerIndex: this._startingDealerIndex, roundWind: this._roundWind,
        finalRoundWind: this._finalRoundWind, dealerWon: this._flow.dealerKeeps(outcome), wasDraw: false,
        playerCount: this._playerCount, handIndex: this._handIndex, maxHands: this._maxHands,
      });
      return this._settlement && this._flow.isBust() ? { ...plan, isSessionComplete: true, bust: true } : plan;
    }
    const dealerWon = outcome?.type === 'win' && outcome.winners.some((w) => w.seatIndex === this._dealerIndex);
    return computeNextHand({
      dealerIndex: this._dealerIndex,
      startingDealerIndex: this._startingDealerIndex,
      roundWind: this._roundWind,
      finalRoundWind: this._finalRoundWind,
      dealerWon,
      wasDraw: outcome?.type === 'draw' || outcome?.type === 'abortive',
      playerCount: this._playerCount,
      handIndex: this._handIndex,
      maxHands: this._maxHands,
    });
  }

  /** True once the finished hand was the session's last. */
  isGameComplete() {
    if (!this.isRoundOver()) return false;
    // Task 91: with a turn flow the session can end on a bust, which needs the
    // settled scores — settle first (settleRound is idempotent).
    if (this._flow) this.settleRound();
    return this._nextHandPlan().isSessionComplete;
  }

  /** Deals the next hand (settling the finished one first if needed). */
  startNextHand() {
    if (!this.isRoundOver()) throw new Error('[GameManager] startNextHand() before the round is over.');
    if (this.isGameComplete()) throw new Error('[GameManager] the session is complete.');
    this.settleRound();
    const plan = this._nextHandPlan();
    this._dealerIndex = plan.dealerIndex;
    this._roundWind = plan.roundWind;
    this._handIndex += 1;
    this._startRound();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** @private */
  _startRound() {
    const options = this._ruleEngine.getTileSetOptions();
    const winds = assignSeatWinds(this._dealerIndex, this._playerCount);
    this._players.forEach((p, i) => {
      p.resetForNewHand();
      p.seatWind = winds[i];
    });
    const deck = createDeck({ includeBonus: options.includeBonus, excludedFaceIds: this._excludedFaceIds, random: this._random });
    this._wall = new WallManager(deck);
    if (options.deadWallSize > 0) this._wall.reserveDeadWall(options.deadWallSize);
    const hands = dealInitialHands(this._wall, this._playerCount, { dealerIndex: this._dealerIndex });
    hands.forEach((tiles, i) => tiles.forEach((t) => this._players[i].addTileToHand(t)));
    this._turnManager = new TurnManager({ playerCount: this._playerCount, startingIndex: this._dealerIndex, eventBus: this._eventBus });
    this._lastDiscard = null;
    this._lastDrawnTile = null;
    this._lastDrawWasReplacement = false;
    this._pendingReplacement = false;
    this._lastOutcome = null;
    this._settlement = null;
    this._flow?.onHandStart();
    this._replaceInitialBonusTiles();
    this._eventBus?.emit('game:hand-started', { handIndex: this._handIndex, dealerIndex: this._dealerIndex, roundWind: this._roundWind });
  }

  /** @private */
  _scoringContext(player, extra) {
    return {
      seatWind: player.seatWind,
      roundWind: this._roundWind,
      isLastTile: this._wall.remainingCount === 0,
      isKongReplacement: false,
      ...extra,
      ...(this._flow ? this._flow.scoringContext(player, extra) : {}),
    };
  }

  /** @private — context passed to AI strategies. */
  _aiContext(seatIndex, extra = {}) {
    const player = this._players[seatIndex];
    return {
      ruleEngine: this._ruleEngine,
      seatIndex,
      playerCount: this._playerCount,
      seatWind: player.seatWind,
      roundWind: this._roundWind,
      dealerIndex: this._dealerIndex,
      wallRemaining: this._wall.remainingCount,
      drawnTile: this._lastDrawnTile,
      table: this.getTableView(),
      ...extra,
    };
  }

  /**
   * Task 116: what a decision for `seatIndex` may know — the same context the
   * AI seats get (rule engine, winds, wall, the table view of discards and
   * melds), plus the discards the rules allow right now. Used for hints for a
   * human seat; reveals nothing that seat can't see.
   */
  getDecisionContext(seatIndex = this._turnManager.getCurrentPlayerIndex()) {
    if (!Number.isInteger(seatIndex) || !this._players[seatIndex]) throw new RangeError(`[GameManager] getDecisionContext: no seat ${seatIndex}.`);
    let extra = {};
    if (this._pendingClaim?.seatIndex === seatIndex) return this._aiContext(seatIndex, { discard: { tile: this._pendingClaim.tile, fromSeat: this._pendingClaim.fromSeat } }); // Task 118
    if (!this.isRoundOver() && this._turnManager.getCurrentPlayerIndex() === seatIndex && this._turnManager.getPhase() === TURN_PHASE.AWAITING_DISCARD) {
      const allowed = this.getSelfActions().find((a) => a.type === ACTION_TYPE.DISCARD)?.allowedTiles ?? null;
      if (Array.isArray(allowed)) extra = { allowedDiscards: allowed };
    }
    return this._aiContext(seatIndex, extra);
  }

  /** @private */
  _assertActive(method) {
    if (this.isRoundOver()) throw new Error(`[GameManager] ${method}() after the round is over.`);
    if (this._pendingClaim) throw new Error(`[GameManager] ${method}() while the human's claim on a discard is pending (resolveHumanClaim first).`);
  }

  /** Task 118: lets the human seat call Chi / Pon / Kong on others' discards (see header). */
  setHumanClaimPrompts(on) { this._humanClaimPrompts = on === true; return this; }
  getHumanClaimPrompts() { return this._humanClaimPrompts === true; }

  /**
   * Task 118: the discard waiting on the human's call, or null.
   * @returns {{ tile, fromSeat: number, seatIndex: number, options: Object[] } | null}
   */
  getPendingClaim() {
    const p = this._pendingClaim;
    return p ? { tile: p.tile, fromSeat: p.fromSeat, seatIndex: p.seatIndex, options: p.options.slice() } : null;
  }

  /**
   * Task 118: the human's answer to a pending claim — one of getPendingClaim().options
   * (the same object) or { type: 'pass' }. Finishes the discard: returns what
   * performDiscard() would have returned.
   */
  resolveHumanClaim(choice) {
    const p = this._pendingClaim;
    if (!p) throw new Error('[GameManager] resolveHumanClaim(): no claim is pending.');
    const pass = !choice || choice.type === ACTION_TYPE.PASS;
    if (!pass && !p.options.includes(choice)) throw new Error('[GameManager] resolveHumanClaim(): that is not one of the offered calls.');
    this._pendingClaim = null;
    const result = this._resolveDiscardReactions(p.fromSeat, p.tile, pass ? p.chosen : [...p.chosen, choice]);
    return p.riichi ? { ...result, riichi: true } : result;
  }

  /**
   * Rebuilds a GameManager mid-session without dealing (Task 65).
   * @param {Object} s
   * @returns {GameManager}
   */
  static restore(s) {
    if (!s || typeof s !== 'object') throw new TypeError('[GameManager] restore requires a state object.');
    const { ruleEngine, players, wall, turnManager, roundState, dealerIndex, finalRoundWind, excludedFaceIds, handIndex } = s;
    if (!isValidRuleEngine(ruleEngine)) throw new TypeError('[GameManager] restore: ruleEngine must implement RuleEngineInterface.');
    if (!Array.isArray(players) || players.length < 3 || players.length > 4) throw new RangeError('[GameManager] restore: 3 or 4 players required.');
    if (!(wall instanceof WallManager)) throw new TypeError('[GameManager] restore: wall must be a WallManager.');
    if (!(turnManager instanceof TurnManager)) throw new TypeError('[GameManager] restore: turnManager must be a TurnManager.');
    const roundWind = roundState?.roundWind;
    if (!WIND_ORDER.includes(roundWind)) throw new TypeError('[GameManager] restore: roundState.roundWind must be a WIND value.');
    if (!WIND_ORDER.includes(finalRoundWind)) throw new TypeError('[GameManager] restore: finalRoundWind must be a WIND value.');

    assertAIManagerCoversSeats(s.aiManager ?? null, players, 'restore');

    const gm = Object.create(GameManager.prototype);
    gm._pendingClaim = null; gm._humanClaimPrompts = false; // Task 118 (GameScreen turns prompts on)
    gm._ruleEngine = ruleEngine;
    gm._aiManager = s.aiManager ?? null;
    gm._eventBus = s.eventBus === undefined ? gameEventBus : s.eventBus;
    gm._players = players.slice();
    gm._playerCount = players.length;
    gm._startingDealerIndex = Number.isInteger(s.startingDealerIndex) ? s.startingDealerIndex : 0;
    gm._dealerIndex = dealerIndex;
    gm._roundWind = roundWind;
    gm._finalRoundWind = finalRoundWind;
    gm._handIndex = Number.isInteger(handIndex) ? handIndex : 0;
    gm._maxHands = Number.isInteger(s.maxHands) ? s.maxHands : 32;
    gm._excludedFaceIds = Array.isArray(excludedFaceIds) ? excludedFaceIds.slice() : [];
    gm._random = Math.random;
    gm._wall = wall;
    gm._turnManager = turnManager;
    gm._lastDiscard = s.lastDiscard ?? null;
    gm._lastDrawnTile = s.lastDrawnTile ?? null;
    gm._lastDrawWasReplacement = s.lastDrawWasReplacement === true && !!gm._lastDrawnTile; // Task 99
    gm._pendingReplacement = s.pendingReplacement === true;
    gm._lastOutcome = null;
    gm._settlement = null;
    // Task 89/91: a ruleset turn flow is rebuilt and given back its saved state.
    gm._flow = typeof ruleEngine.createTurnFlow === 'function' ? ruleEngine.createTurnFlow(gm) : null;
    if (gm._flow) {
      gm._flow.onHandStart();
      if (s.flowState && typeof gm._flow.restoreState === 'function') gm._flow.restoreState(s.flowState);
    }
    return gm;
  }
}
