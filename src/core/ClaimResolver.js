/**
 * ClaimResolver.js
 *
 * Applies a chosen Chi / Pon / Kong action to the table (Task 27):
 * moves tiles out of the claimer's hand into a new meld, marks the claimed
 * discard, and for self-declared Kongs builds the concealed / added meld.
 * Ruleset-agnostic: works purely from the action objects rule engines emit.
 *
 * REBUILT (after Task 77).
 */

import { Meld } from './Hand.js';
import { ACTION_TYPE, MELD_TYPE, KONG_TYPE } from '../utils/constants.js';

/**
 * Resolves a claim on another player's discard.
 * @param {Object} action  CHI / PON / KONG(exposed) action
 * @param {import('./PlayerManager.js').PlayerManager[]} players
 * @returns {Meld} the new meld
 */
export function resolveClaim(action, players) {
  if (!action || ![ACTION_TYPE.CHI, ACTION_TYPE.PON, ACTION_TYPE.KONG].includes(action.type)) {
    throw new TypeError('[ClaimResolver] resolveClaim needs a chi, pon or kong action.');
  }
  if (action.type === ACTION_TYPE.KONG && action.kongType !== KONG_TYPE.EXPOSED) {
    throw new TypeError('[ClaimResolver] only an exposed kong is a discard claim; use resolveSelfKong.');
  }
  const claimer = players[action.seatIndex];
  const discarder = players[action.fromSeat];
  if (!claimer || !discarder) throw new RangeError('[ClaimResolver] unknown claimer or discarder seat.');
  const last = discarder.getDiscardPile().last;
  if (!last || last.tile !== action.tile || last.claimed) {
    throw new Error('[ClaimResolver] the claimed tile is not the discarder\'s latest unclaimed discard.');
  }

  const handTiles = action.handTiles.map((t) => claimer.removeTileFromHand(t));
  discarder.getDiscardPile().markLastClaimed(action.seatIndex, action.type);
  const type = action.type === ACTION_TYPE.CHI ? MELD_TYPE.CHI : action.type === ACTION_TYPE.PON ? MELD_TYPE.PON : MELD_TYPE.KONG;
  const meld = new Meld({
    type,
    tiles: [...handTiles, action.tile],
    concealed: false,
    calledFrom: action.fromSeat,
    calledTile: action.tile,
    kongType: type === MELD_TYPE.KONG ? KONG_TYPE.EXPOSED : null,
  });
  claimer.addMeld(meld);
  return meld;
}

/**
 * Resolves a self-declared Kong (concealed, or added onto an own Pon).
 * @param {Object} action  KONG action with kongType concealed | added
 * @param {import('./PlayerManager.js').PlayerManager} player
 * @returns {Meld}
 */
export function resolveSelfKong(action, player) {
  if (!action || action.type !== ACTION_TYPE.KONG) throw new TypeError('[ClaimResolver] resolveSelfKong needs a kong action.');
  const hand = player.getHand();
  if (action.kongType === KONG_TYPE.CONCEALED) {
    const tiles = action.tiles.map((t) => player.removeTileFromHand(t));
    const meld = new Meld({ type: MELD_TYPE.KONG, tiles, concealed: true, kongType: KONG_TYPE.CONCEALED });
    player.addMeld(meld);
    return meld;
  }
  if (action.kongType === KONG_TYPE.ADDED) {
    const pon = hand.melds[action.meldIndex];
    if (!pon || pon.type !== MELD_TYPE.PON || pon.faceId !== action.faceId) throw new Error('[ClaimResolver] added kong needs a matching pon.');
    const tile = player.removeTileFromHand(action.tile);
    const meld = pon.upgradeToKong(tile);
    hand.replaceMeld(action.meldIndex, meld);
    return meld;
  }
  throw new TypeError(`[ClaimResolver] unsupported self kong type: ${action.kongType}`);
}
