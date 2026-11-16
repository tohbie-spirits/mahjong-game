/**
 * RiichiAIHelpers.js — Task 90: the shared Riichi adaptation layer for the
 * Basic and Advanced AI tiers.
 *
 *   isRiichiContext(context)                 the AI context's rule engine is Riichi
 *   valuableHonorFaces(player, context)      dragons + seat wind + round wind (Yakuhai faces)
 *   liveCount(faceIds, player, context)      unseen copies of those faces from this seat's view
 *   chooseRiichiDeclaration(player, action, context, { minLive })
 *                                            → the tile to declare riichi with, or null
 *   distinctTerminalHonorKinds(tiles)        for the nine-terminals decision
 *
 * Riichi decisions the strategies make with these:
 *   - accept every WIN the rule engine offers (Riichi WIN actions carry the
 *     engine's own `validation`, which already includes riichi / ippatsu …);
 *   - respect DISCARD.allowedTiles (riichi lock, swap-calling ban);
 *   - declare riichi on the discard that leaves the most LIVE waiting tiles;
 *   - avoid opening a hand without a yaku (Basic: only Yakuhai Pons/Kans;
 *     Advanced: its value planner with Riichi's 1-han minimum — see AdvancedStrategy).
 */

import { RULESET_ID } from '../utils/constants.js';

export function isRiichiContext(context) {
  return typeof context?.ruleEngine?.getRulesetId === 'function' && context.ruleEngine.getRulesetId() === RULESET_ID.RIICHI;
}

export function valuableHonorFaces(player, context = {}) {
  const out = new Set(['dragon-red', 'dragon-green', 'dragon-white']);
  const seat = context.seatWind ?? player.seatWind;
  if (seat) out.add(`wind-${typeof seat === 'string' ? seat : seat.id}`);
  if (context.roundWind) out.add(`wind-${typeof context.roundWind === 'string' ? context.roundWind : context.roundWind.id}`);
  return out;
}

/** Unseen copies of `faceIds` from `player`'s view (own tiles + every discard + every meld). */
export function liveCount(faceIds, player, context = {}) {
  const seen = new Map();
  const add = (t) => seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
  const counted = new Set();
  const addOnce = (t) => { if (!counted.has(t.instanceId)) { counted.add(t.instanceId); add(t); } };
  for (const t of player.getHand().concealedTiles) addOnce(t);
  for (const m of player.getHand().melds) for (const t of m.tiles) addOnce(t);
  const table = context.table ?? {};
  for (const pile of table.discards ?? []) for (const t of pile ?? []) addOnce(t);
  for (const melds of table.melds ?? []) for (const m of melds ?? []) for (const t of m.tiles) addOnce(t);
  return faceIds.reduce((a, f) => a + Math.max(0, 4 - (seen.get(f) ?? 0)), 0);
}

/**
 * Picks the riichi discard leaving the most live waits (then the most wait
 * kinds; the just-drawn tile when it is one of the copies). Returns null when
 * even the best option has fewer than `minLive` live tiles.
 * @returns {Object|null} a tile from riichiAction.allowedTiles
 */
export function chooseRiichiDeclaration(player, riichiAction, context = {}, { minLive = 1 } = {}) {
  const options = riichiAction?.options ?? [];
  let best = null;
  for (const o of options) {
    // Discarding this tile makes one more copy of its face visible.
    const live = liveCount(o.waits, player, context) - (o.waits.includes(o.faceId) ? 1 : 0);
    if (!best || live > best.live || (live === best.live && o.waits.length > best.option.waits.length)) best = { option: o, live };
  }
  if (!best || best.live < minLive) return null;
  const drawn = context.drawnTile;
  return best.option.tiles.find((t) => drawn && t.instanceId === drawn.instanceId) ?? best.option.tiles[best.option.tiles.length - 1];
}

export function distinctTerminalHonorKinds(tiles) {
  return new Set(tiles.filter((t) => t.isTerminalOrHonor).map((t) => t.id)).size;
}
