/**
 * TurnIndicatorRenderer.js
 *
 *   renderSeatLabel(container, player) — name, seat wind (once assigned),
 *     a Dealer badge (seatWind === East) and the running score.
 *   highlightCurrentPlayer(renderer, turnManager) — `table-seat--active` on
 *     exactly the current seat plus a "Drawing" / "Discarding" hint; nothing
 *     highlighted once the round is over. Both are idempotent (Task 49).
 *
 * REBUILT (after Task 77).
 */

import { WIND, TURN_PHASE } from '../utils/constants.js';

export function renderSeatLabel(container, player) {
  if (!(container instanceof Element)) throw new TypeError('[TurnIndicatorRenderer] container must be a DOM Element.');
  if (!player || typeof player.displayName !== 'string') throw new TypeError('[TurnIndicatorRenderer] player must be a PlayerManager.');
  container.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'seat-label';

  const name = document.createElement('span');
  name.className = 'seat-label-name';
  name.textContent = player.displayName;
  label.appendChild(name);

  if (player.seatWind) {
    const wind = document.createElement('span');
    wind.className = 'seat-label-wind';
    wind.title = `${player.seatWind.label} seat`;
    wind.textContent = player.seatWind.char;
    wind.setAttribute('aria-label', `${player.seatWind.label} seat`);
    label.appendChild(wind);
    if (player.seatWind === WIND.EAST) {
      const dealer = document.createElement('span');
      dealer.className = 'seat-label-dealer';
      dealer.textContent = 'Dealer';
      label.appendChild(dealer);
    }
  }

  const score = document.createElement('span');
  score.className = 'seat-label-score';
  score.textContent = `${player.score} pts`;
  label.appendChild(score);

  const phase = document.createElement('span');
  phase.className = 'seat-label-phase';
  // Task 115: not a live region — the game announcer (GameAnnouncer.js) says what happens.
  label.appendChild(phase);

  container.appendChild(label);
  return label;
}

export function highlightCurrentPlayer(renderer, turnManager) {
  if (!renderer || typeof renderer.getSeatContainer !== 'function') throw new TypeError('[TurnIndicatorRenderer] renderer must be a Renderer.');
  if (!turnManager || typeof turnManager.getCurrentPlayerIndex !== 'function') throw new TypeError('[TurnIndicatorRenderer] turnManager must be a TurnManager.');
  const count = renderer.getPlayerCount();
  for (let i = 0; i < count; i++) {
    renderer.getSeatContainer(i).classList.remove('table-seat--active');
    const hint = renderer.getSeatLabelContainer(i).querySelector('.seat-label-phase');
    if (hint) hint.textContent = '';
  }
  if (turnManager.isRoundOver()) return null;
  const current = turnManager.getCurrentPlayerIndex();
  renderer.getSeatContainer(current).classList.add('table-seat--active');
  const hint = renderer.getSeatLabelContainer(current).querySelector('.seat-label-phase');
  if (hint) hint.textContent = turnManager.getPhase() === TURN_PHASE.AWAITING_DRAW ? 'Drawing' : 'Discarding';
  return current;
}
