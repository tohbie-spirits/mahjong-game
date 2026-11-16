/**
 * TurnInterruptionResolver.js
 *
 * Claim priority + turn redirection (Task 28). After a discard every other
 * seat may want to claim it; this decides who gets it and moves the turn.
 *
 *   Win (Ron) > Kong = Pon > Chi.  Several Ron claims all win (multiple
 *   winners are settled independently, Task 60). Pon and Kong on one tile can
 *   only come from one seat (there are only four copies).
 *
 * REBUILT (after Task 77), including Task 42's fix: a claimed Kong leaves the
 * claimer at AWAITING_DRAW (it still needs its replacement tile) rather than
 * jumping straight to AWAITING_DISCARD.
 */

import { ACTION_TYPE, TURN_PHASE } from '../utils/constants.js';

const PRIORITY = Object.freeze({ [ACTION_TYPE.WIN]: 0, [ACTION_TYPE.KONG]: 1, [ACTION_TYPE.PON]: 1, [ACTION_TYPE.CHI]: 2 });

/** Keeps only genuine claim actions (drops DISCARD / PASS). */
export function filterDiscardClaimActions(actions) {
  return (actions ?? []).filter((a) => a && a.type in PRIORITY);
}

/**
 * Picks the winning claim(s).
 * @param {Object[]} chosen  at most one chosen action per seat (PASS omitted)
 * @param {number} discarderIndex
 * @param {number} playerCount
 * @returns {{ type: 'win', actions: Object[] } | { type: 'claim', action: Object } | null}
 */
export function resolveClaimPriority(chosen, discarderIndex, playerCount) {
  const claims = filterDiscardClaimActions(chosen);
  if (claims.length === 0) return null;
  const wins = claims.filter((a) => a.type === ACTION_TYPE.WIN);
  const seatDistance = (a) => (a.seatIndex - discarderIndex + playerCount) % playerCount;
  if (wins.length > 0) {
    return { type: 'win', actions: wins.slice().sort((a, b) => seatDistance(a) - seatDistance(b)) };
  }
  const best = claims.slice().sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || seatDistance(a) - seatDistance(b))[0];
  return { type: 'claim', action: best };
}

/**
 * Moves the turn to the claimer after a Chi / Pon / Kong.
 * @param {import('./TurnManager.js').TurnManager} turnManager
 * @param {Object} action
 */
export function applyClaimResolution(turnManager, action) {
  const phase = action.type === ACTION_TYPE.KONG ? TURN_PHASE.AWAITING_DRAW : TURN_PHASE.AWAITING_DISCARD;
  turnManager.forceSetTurn(action.seatIndex, phase);
}
