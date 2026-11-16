/**
 * RoundProgression.js
 *
 * What happens between hands (Task 33): does the dealer repeat, who deals
 * next, does the prevailing (round) wind advance, and is the session over.
 *
 * Hong Kong convention: the dealer keeps the deal after winning or after an
 * exhaustive draw; otherwise the deal passes to the next seat. Each time the
 * deal has gone all the way round back to the first dealer, the round wind
 * advances (East → South → …). The session ends after the round of
 * `finalRoundWind` completes (or when `maxHands` is reached as a safety cap).
 *
 * REBUILT (after Task 77).
 */

import { WIND_ORDER } from '../utils/constants.js';

/**
 * Seat winds for a deal: the dealer is East, then turn order S, W, N.
 * Three-player tables have no North seat.
 * @returns {import('../utils/constants.js').WIND[]} wind per seat index
 */
export function assignSeatWinds(dealerIndex, playerCount) {
  return Array.from({ length: playerCount }, (_, seat) => WIND_ORDER[(seat - dealerIndex + playerCount) % playerCount]);
}

/**
 * @param {Object} s
 * @param {number} s.dealerIndex
 * @param {number} s.startingDealerIndex  the session's first dealer
 * @param {Object} s.roundWind            current WIND
 * @param {Object} s.finalRoundWind       last WIND round of the session
 * @param {boolean} s.dealerWon
 * @param {boolean} s.wasDraw
 * @param {number} s.playerCount
 * @param {number} s.handIndex            0-based index of the hand just finished
 * @param {number} [s.maxHands=Infinity]
 * @returns {{ dealerIndex: number, roundWind: Object, dealerRepeats: boolean, isSessionComplete: boolean }}
 */
export function computeNextHand({ dealerIndex, startingDealerIndex, roundWind, finalRoundWind, dealerWon, wasDraw, playerCount, handIndex, maxHands = Infinity }) {
  const dealerRepeats = dealerWon || wasDraw;
  let nextDealer = dealerIndex;
  let nextWind = roundWind;
  let complete = false;
  if (!dealerRepeats) {
    nextDealer = (dealerIndex + 1) % playerCount;
    if (nextDealer === startingDealerIndex) {
      if (roundWind.order >= finalRoundWind.order) complete = true;
      else nextWind = WIND_ORDER[roundWind.order + 1];
    }
  }
  if (handIndex + 1 >= maxHands) complete = true;
  return { dealerIndex: nextDealer, roundWind: nextWind, dealerRepeats, isSessionComplete: complete };
}
