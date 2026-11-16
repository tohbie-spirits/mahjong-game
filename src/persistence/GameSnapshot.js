/**
 * GameSnapshot.js
 *
 * Bridge between a live GameManager and the JSON blob SaveGameManager stores
 * (Task 65).
 *
 *   buildSnapshot(gameManager, { rulesetId, difficulty })  → plain object
 *   hydrateGameManager(snapshot, { RULE_ENGINE_FACTORIES, STRATEGY_FACTORIES, eventBus })
 *                                                           → GameManager
 *
 * Snapshot format: rulesetId, difficulty, playerConfigs (SaveGameManager's
 * anchor), handIndex, dealerIndex, startingDealerIndex, maxHands,
 * finalRoundWind (WIND id), excludedFaceIds, roundState.roundWind (WIND id),
 * players[{ seatIndex, displayName, seatKind, aiDifficulty, score,
 * seatWind (id|null), concealedTiles [{id,instanceId}], melds [Meld JSON],
 * discards [{id, instanceId, claimed, claimedBy, claimedAction}] }],
 * wall { tiles [{id,instanceId}], drawIndex, liveWallEnd, deadWallReserved,
 * deadWallStart, deadWallDrawIndex }, turn { currentPlayerIndex, phase },
 * pendingReplacement, lastDiscard { fromSeat, instanceId } | null.
 *
 * Not serialised: the wall RNG (future hands get fresh random walls),
 * DiscardEntry tags (unused in Hong Kong), the last outcome (saves are only
 * made mid-hand or at the start of a hand).
 *
 * REBUILT (after Task 77) from the plan's Task 65 description; adds
 * startingDealerIndex / maxHands / pendingReplacement / lastDiscard so a save
 * taken right after an AI claims a Kong restores exactly.
 *
 * Task 79: hydrate builds the AIManager from every AI seat's aiDifficulty via
 * StrategyRegistry (so Advanced and mixed tables restore), and throws if a
 * seat's tier has no strategy. `difficulty` stays in the snapshot as the
 * session label used by the leaderboard and Restart.
 */

import { Tile } from '../core/Tile.js';
import { Meld } from '../core/Hand.js';
import { PlayerManager } from '../core/PlayerManager.js';
import { WallManager } from '../core/WallManager.js';
import { TurnManager } from '../core/TurnManager.js';
import { GameManager } from '../core/GameManager.js';
import { STRATEGY_FACTORIES as DEFAULT_STRATEGY_FACTORIES, createAIManagerForSeats } from '../ai/StrategyRegistry.js';
import { WIND_ORDER } from '../utils/constants.js';

const windId = (w) => (w ? w.id : null);
const windFromId = (id) => (id === null || id === undefined ? null : WIND_ORDER.find((w) => w.id === id) ?? null);

/**
 * @param {GameManager} gameManager
 * @param {{ rulesetId: string, difficulty: string }} meta
 * @returns {Object}
 */
export function buildSnapshot(gameManager, { rulesetId, difficulty } = {}) {
  if (!(gameManager instanceof GameManager)) throw new TypeError('[GameSnapshot] buildSnapshot requires a GameManager.');
  if (typeof rulesetId !== 'string' || rulesetId === '') throw new TypeError('[GameSnapshot] buildSnapshot requires a rulesetId.');
  // Task 118: a discard waiting on the human's call is not a resumable state (the app saves only at hand start and after your own discard).
  if (gameManager.getPendingClaim?.()) throw new Error('[GameSnapshot] cannot save while a claim on a discard is pending.');
  const players = gameManager.getPlayers();
  const wallState = gameManager.getWall().getWallStateSnapshot();
  const tm = gameManager.getTurnManager();
  const last = gameManager.getLastDiscard();
  return {
    rulesetId,
    difficulty: difficulty ?? null,
    playerConfigs: players.map((p) => p.toConfig()),
    handIndex: gameManager.getHandIndex(),
    dealerIndex: gameManager.getDealerIndex(),
    startingDealerIndex: gameManager.getStartingDealerIndex(),
    maxHands: gameManager.getMaxHands(),
    finalRoundWind: windId(gameManager.getFinalRoundWind()),
    excludedFaceIds: gameManager.getExcludedFaceIds(),
    roundState: { roundWind: windId(gameManager.getRoundWind()) },
    players: players.map((p) => ({
      ...p.toConfig(),
      score: p.score,
      seatWind: windId(p.seatWind),
      concealedTiles: p.getHand().concealedTiles.map((t) => t.toJSON()),
      melds: p.getHand().melds.map((m) => m.toJSON()),
      discards: p.getDiscardPile().entries.map((e) => e.toJSON()),
    })),
    wall: { ...wallState, tiles: wallState.tiles.map((t) => t.toJSON()) },
    turn: { currentPlayerIndex: tm.getCurrentPlayerIndex(), phase: tm.getPhase() },
    pendingReplacement: gameManager.hasPendingReplacement(),
    // Task 91: the ruleset turn flow's state (Riichi), or null.
    lastDrawnTile: typeof gameManager.getLastDrawnTile === 'function' && gameManager.getLastDrawnTile() ? gameManager.getLastDrawnTile().instanceId : null,
    // Task 99: was that draw a Kong replacement (Out with Replacement Tile / Rinshan after a reload)?
    lastDrawWasReplacement: typeof gameManager.wasLastDrawReplacement === 'function' ? gameManager.wasLastDrawReplacement() : false,
    flowState: typeof gameManager.getTurnFlow === 'function' && gameManager.getTurnFlow() ? gameManager.getTurnFlow().toJSON() : null,
    lastDiscard: last ? { fromSeat: last.fromSeat, instanceId: last.tile.instanceId } : null,
  };
}

/**
 * Rebuilds a GameManager from a snapshot.
 * @param {Object} snapshot
 * @param {{ RULE_ENGINE_FACTORIES: Object, STRATEGY_FACTORIES?: Object, eventBus?: Object }} factories
 *   STRATEGY_FACTORIES defaults to StrategyRegistry's (Task 79).
 * @returns {GameManager}
 * @throws {Error} unknown rulesetId, an AI seat whose difficulty has no
 *   strategy factory (Task 79), or a structurally broken snapshot
 */
export function hydrateGameManager(snapshot, { RULE_ENGINE_FACTORIES, STRATEGY_FACTORIES = DEFAULT_STRATEGY_FACTORIES, eventBus } = {}) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('[GameSnapshot] hydrate requires a snapshot object.');
  const makeRules = RULE_ENGINE_FACTORIES?.[snapshot.rulesetId];
  if (typeof makeRules !== 'function') throw new Error(`[GameSnapshot] unknown rulesetId: ${snapshot.rulesetId}`);
  // Task 102: engines with 3-player variants (Riichi, Chinese Official) need the table size.
  const ruleEngine = makeRules({ playerCount: Array.isArray(snapshot.players) ? snapshot.players.length : 4 });

  if (!Array.isArray(snapshot.players) || snapshot.players.length < 3) throw new Error('[GameSnapshot] snapshot.players is missing or too short.');

  // Task 79: strategies come from each AI seat's own aiDifficulty (seats may
  // mix tiers), not from the session-level `difficulty` label. A seat whose
  // tier has no factory is an error — main.js then clears the save and
  // opens the New Game wizard, instead of restoring a table that would stop
  // on that seat's first turn (the pre-Task-79 behaviour was a warning).
  let aiManager;
  try {
    aiManager = createAIManagerForSeats(snapshot.players, { factories: STRATEGY_FACTORIES });
  } catch (err) {
    throw new Error(`[GameSnapshot] cannot restore the AI seats: ${err.message}`);
  }
  const players = snapshot.players.map((ps) => {
    const p = new PlayerManager({ seatIndex: ps.seatIndex, displayName: ps.displayName, seatKind: ps.seatKind, aiDifficulty: ps.aiDifficulty, score: ps.score ?? 0 });
    p.seatWind = windFromId(ps.seatWind);
    for (const t of ps.concealedTiles ?? []) p.addTileToHand(Tile.fromJSON(t));
    for (const m of ps.melds ?? []) p.addMeld(Meld.fromJSON(m));
    for (const d of ps.discards ?? []) {
      const entry = p.getDiscardPile().discard(Tile.fromJSON(d));
      if (d.claimed) entry.markClaimed(d.claimedBy ?? null, d.claimedAction ?? null);
    }
    return p;
  });

  const w = snapshot.wall;
  if (!w || !Array.isArray(w.tiles)) throw new Error('[GameSnapshot] snapshot.wall is missing.');
  const wall = WallManager.restore({ ...w, tiles: w.tiles.map((t) => Tile.fromJSON(t)) });

  const tm = new TurnManager({ playerCount: players.length, startingIndex: snapshot.dealerIndex ?? 0, eventBus });
  tm.forceSetTurn(snapshot.turn.currentPlayerIndex, snapshot.turn.phase);

  let lastDiscard = null;
  if (snapshot.lastDiscard) {
    const tile = players[snapshot.lastDiscard.fromSeat]?.getDiscardPile().tiles.find((t) => t.instanceId === snapshot.lastDiscard.instanceId);
    if (tile) lastDiscard = { tile, fromSeat: snapshot.lastDiscard.fromSeat };
  }

  const roundWind = windFromId(snapshot.roundState?.roundWind);
  const finalRoundWind = windFromId(snapshot.finalRoundWind);
  if (!roundWind || !finalRoundWind) throw new Error('[GameSnapshot] snapshot winds are invalid.');

  return GameManager.restore({
    ruleEngine,
    players,
    wall,
    turnManager: tm,
    roundState: { roundWind },
    dealerIndex: snapshot.dealerIndex,
    startingDealerIndex: snapshot.startingDealerIndex,
    maxHands: snapshot.maxHands,
    finalRoundWind,
    excludedFaceIds: snapshot.excludedFaceIds ?? [],
    handIndex: snapshot.handIndex,
    aiManager,
    eventBus,
    pendingReplacement: snapshot.pendingReplacement === true,
    lastDiscard,
    flowState: snapshot.flowState ?? null,
    // Task 91: the current seat's drawn tile (the riichi lock needs it after a restore).
    lastDrawnTile: snapshot.lastDrawnTile ? players[snapshot.turn.currentPlayerIndex]?.getHand().concealedTiles.find((t) => t.instanceId === snapshot.lastDrawnTile) ?? null : null,
    lastDrawWasReplacement: snapshot.lastDrawWasReplacement === true && !!snapshot.lastDrawnTile,
  });
}
