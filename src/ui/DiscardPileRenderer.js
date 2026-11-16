/**
 * DiscardPileRenderer.js
 *
 * renderDiscardPile(container, discardPile) — one player's discards, oldest
 * first, wrapped into rows of 6 at `tile--sm`; claimed discards get
 * `tile--claimed` (Task 47). Discards are public for every seat.
 *
 * REBUILT (after Task 77).
 */

import { createTileElement } from './TileRenderer.js';

const ROW = 6;

export function renderDiscardPile(container, discardPile) {
  if (!(container instanceof Element)) throw new TypeError('[DiscardPileRenderer] container must be a DOM Element.');
  if (!discardPile || !Array.isArray(discardPile.entries)) throw new TypeError('[DiscardPileRenderer] discardPile must be a DiscardPile.');
  container.innerHTML = '';
  const pile = document.createElement('div');
  pile.className = 'discard-pile';
  const entries = discardPile.entries;
  pile.setAttribute('aria-label', `${entries.length} discards`);
  let row = null;
  entries.forEach((entry, i) => {
    if (i % ROW === 0) {
      row = document.createElement('div');
      row.className = 'discard-row';
      pile.appendChild(row);
    }
    const node = createTileElement(entry.tile, { size: 'sm' });
    if (entry.claimed) node.classList.add('tile--claimed');
    if (i === entries.length - 1) node.classList.add('tile--latest');
    row.appendChild(node);
  });
  container.appendChild(pile);
  return pile;
}
