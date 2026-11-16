/**
 * EndGameScreen.js — renderEndGameScreen(container, players, options)
 * (Task 58): "Match Complete!", optional ruleset subtitle, winner (ties all
 * named), ranked standings, Play Again (primary) / Return to Menu. At least
 * one action required. Renders a panel inside the container.
 * REBUILT (after Task 77).
 */
import { h, button, assertContainer } from './_screenKit.js';

export function renderEndGameScreen(container, players, options = {}) {
  assertContainer(container, 'EndGameScreen');
  if (!Array.isArray(players) || players.length === 0) throw new TypeError('[EndGameScreen] players must be a non-empty array.');
  const onPlayAgain = typeof options.onPlayAgain === 'function' ? options.onPlayAgain : null;
  const onReturnToMenu = typeof options.onReturnToMenu === 'function' ? options.onReturnToMenu : null;
  if (!onPlayAgain && !onReturnToMenu) throw new TypeError('[EndGameScreen] supply onPlayAgain and/or onReturnToMenu.');

  container.innerHTML = '';
  const panel = h('div', 'end-game-screen');
  const header = h('header', 'end-game-screen-header');
  header.appendChild(h('h1', 'end-game-screen-title', 'Match Complete!'));
  if (options.rulesetLabel) header.appendChild(h('p', 'end-game-screen-subtitle', options.rulesetLabel));
  panel.appendChild(header);

  const ranked = players.slice().sort((a, b) => (b.score - a.score) || (a.seatIndex - b.seatIndex));
  const top = ranked[0].score;
  const winners = ranked.filter((p) => p.score === top).map((p) => p.displayName);
  const winBox = h('section', 'end-game-screen-winner');
  const trophy = h('span', 'end-game-screen-trophy', '🏆');
  trophy.setAttribute('aria-hidden', 'true');
  const text = winners.length === 1 ? `${winners[0]} ${winners[0] === 'You' ? 'win' : 'wins'} the match!` : `${winners.join(' and ')} tie for first place!`;
  winBox.append(trophy, h('p', 'end-game-screen-winner-text', text));
  panel.appendChild(winBox);

  const ol = h('ol', 'end-game-screen-standings');
  ranked.forEach((p, i) => {
    const li = h('li', `end-game-screen-standing-row${i === 0 ? ' end-game-screen-standing-row--first' : ''}`);
    li.append(
      h('span', 'end-game-screen-rank', String(i + 1)),
      h('span', 'end-game-screen-name', p.displayName),
      h('span', 'end-game-screen-score', `${p.score} pts`),
    );
    ol.appendChild(li);
  });
  panel.appendChild(ol);

  const actions = h('div', 'end-game-screen-actions');
  if (onPlayAgain) actions.appendChild(button('end-game-screen-btn end-game-screen-btn--primary', 'Play Again', () => onPlayAgain()));
  if (onReturnToMenu) actions.appendChild(button(`end-game-screen-btn ${onPlayAgain ? 'end-game-screen-btn--secondary' : 'end-game-screen-btn--primary'}`, 'Return to Menu', () => onReturnToMenu()));
  panel.appendChild(actions);
  container.appendChild(panel);
  return panel;
}
