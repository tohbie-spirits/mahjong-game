/**
 * ScoreScreen.js — renderScoreScreen(container, outcome, players, options)
 * (Tasks 57, 59, 60). Outcome: { type: 'win', winners } | { type: 'draw',
 * results } | null. Win: red "Round Over — Win!", one card per winner (name,
 * wind badge, Tsumo/Ron badge, winning hand, fan breakdown table with total
 * and points). Draw: "Round Over — Draw" with tenpai players. Always the
 * standings (score desc, seat asc). Actions: Next Hand (primary; absent when
 * isGameComplete) and Return to Menu (secondary, primary when complete).
 * Renders inside the container; never touches the container's className.
 * Task 102: options.format (src/ui/scoreFormat.js; Hong Kong by default)
 * words the breakdown and totals in the ruleset's own unit — fan, han + fu
 * (with the limit name), or points + flowers — and an abortive draw
 * ({ type: 'abortive', reason }) gets its own title and explanation.
 * REBUILT (after Task 77).
 */
import { h, button, assertContainer } from './_screenKit.js';
import { renderWinningHand } from '../WinningHandDisplay.js';
import { scoreFormatFor } from '../scoreFormat.js';

function _standings(players) {
  return players.slice().sort((a, b) => (b.score - a.score) || (a.seatIndex - b.seatIndex));
}

export function renderScoreScreen(container, outcome, players, options = {}) {
  assertContainer(container, 'ScoreScreen');
  if (!Array.isArray(players) || players.length === 0) throw new TypeError('[ScoreScreen] players must be a non-empty array.');
  const onNextHand = typeof options.onNextHand === 'function' ? options.onNextHand : null;
  const onReturnToMenu = typeof options.onReturnToMenu === 'function' ? options.onReturnToMenu : null;
  if (!onNextHand && !onReturnToMenu) throw new TypeError('[ScoreScreen] supply onNextHand and/or onReturnToMenu.');
  const complete = options.isGameComplete === true;
  const format = options.format ?? scoreFormatFor();

  container.innerHTML = '';
  const card = h('div', 'score-screen');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Round result');
  const isWin = outcome?.type === 'win';
  const title = h('h2', `score-screen-title${isWin ? ' score-screen-title--win' : ''}`, format.outcomeTitle(outcome));
  card.appendChild(title);

  if (isWin) {
    for (const w of outcome.winners) {
      const p = players[w.seatIndex];
      const wc = h('section', 'score-screen-winner');
      const head = h('div', 'score-screen-winner-head');
      head.appendChild(h('span', 'score-screen-winner-name', p?.displayName ?? w.displayName ?? `Seat ${w.seatIndex + 1}`));
      if (p?.seatWind) head.appendChild(h('span', 'score-screen-badge score-screen-badge--wind', `${p.seatWind.char} ${p.seatWind.label}`));
      head.appendChild(h('span', 'score-screen-badge score-screen-badge--wintype', w.winType === 'self' ? 'Tsumo' : 'Ron'));
      if (w.winType !== 'self' && Number.isInteger(w.calledFrom) && players[w.calledFrom]) {
        head.appendChild(h('span', 'score-screen-from', `on ${players[w.calledFrom].displayName}'s discard`));
      }
      wc.appendChild(head);
      if (w.hand) renderWinningHand(wc, w.hand, { winningTile: w.winningTile ?? null });

      if (Array.isArray(w.breakdown) && w.breakdown.length) {
        const table = h('table', 'score-screen-fan');
        const tb = h('tbody');
        for (const b of w.breakdown) {
          const tr = h('tr');
          tr.append(h('td', 'score-screen-fan-name', b.name), h('td', 'score-screen-fan-value', format.breakdownValue(b)));
          tb.appendChild(tr);
        }
        const tf = h('tfoot');
        const tr = h('tr');
        tr.append(h('td', 'score-screen-fan-name', 'Total'), h('td', 'score-screen-fan-value', format.total(w)));
        tf.appendChild(tr);
        table.append(tb, tf);
        wc.appendChild(table);
      } else {
        wc.appendChild(h('p', 'score-screen-empty', 'No breakdown available'));
      }
      if (w.meetsMinimum === false) wc.appendChild(h('p', 'score-screen-note', format.belowMinimum));
      card.appendChild(wc);
    }
  } else if (outcome?.type === 'abortive') {
    card.appendChild(h('p', 'score-screen-draw-note', format.abortiveNote(outcome)));
  } else if (outcome?.type === 'draw' && Array.isArray(outcome.results)) {
    const tenpai = outcome.results.filter((r) => r.tenpai).map((r) => players[r.seatIndex]?.displayName ?? r.displayName);
    card.appendChild(h('p', 'score-screen-draw-note', tenpai.length ? `The wall ran out. Ready hands: ${tenpai.join(', ')}.` : 'The wall ran out. Nobody was ready.'));
  } else {
    card.appendChild(h('p', 'score-screen-draw-note', 'The hand ended without a winner.'));
  }

  const stand = h('section', 'score-screen-standings');
  stand.appendChild(h('h3', 'score-screen-standings-title', 'Standings'));
  const ol = h('ol', 'score-screen-standings-list');
  for (const p of _standings(players)) {
    const li = h('li', 'score-screen-standing');
    li.append(h('span', 'score-screen-standing-name', p.displayName), h('span', 'score-screen-standing-score', `${p.score} pts`));
    ol.appendChild(li);
  }
  stand.appendChild(ol);
  card.appendChild(stand);

  const actions = h('div', 'score-screen-actions');
  let primary = null;
  if (onNextHand && !complete) {
    primary = button('score-screen-btn score-screen-btn--primary', 'Next Hand', () => onNextHand());
    actions.appendChild(primary);
  }
  if (onReturnToMenu) {
    const b = button(`score-screen-btn ${complete || !primary ? 'score-screen-btn--primary' : 'score-screen-btn--secondary'}`, complete ? 'See Final Results' : 'Return to Menu', () => onReturnToMenu());
    actions.appendChild(b);
    primary = primary ?? b;
  }
  card.appendChild(actions);
  container.appendChild(card);
  try { primary?.focus(); } catch { /* headless */ }
  return card;
}
