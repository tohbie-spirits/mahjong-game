/**
 * WinningHandDisplay.js
 *
 * renderWinningHand(container, hand, { winningTile }) — a winning hand inside
 * ScoreScreen's winner cards (Task 59): sorted concealed tiles and melds on
 * the left, the completing tile at the right end after a thin rule with a
 * `tile--winning` glow. If the winning tile is among the concealed tiles it
 * is moved to the end. All tiles at `tile--sm`.
 *
 * REBUILT (after Task 77).
 */

import { Tile } from '../core/Tile.js';
import { createTileElement } from './TileRenderer.js';

export function renderWinningHand(container, hand, { winningTile = null } = {}) {
  if (!(container instanceof Element)) throw new TypeError('[WinningHandDisplay] container must be a DOM Element.');
  if (!hand || !Array.isArray(hand.melds)) throw new TypeError('[WinningHandDisplay] hand must be a Hand.');
  const root = document.createElement('div');
  root.className = 'winning-hand';

  let tiles = hand.concealedTiles.sort(Tile.compare);
  if (winningTile) tiles = tiles.filter((t) => t.instanceId !== winningTile.instanceId);

  const concealed = document.createElement('div');
  concealed.className = 'winning-hand-concealed';
  for (const t of tiles) concealed.appendChild(createTileElement(t, { size: 'sm' }));
  root.appendChild(concealed);

  if (hand.melds.length) {
    const melds = document.createElement('div');
    melds.className = 'winning-hand-melds';
    for (const m of hand.melds) {
      const g = document.createElement('div');
      g.className = 'winning-hand-meld';
      m.tiles.forEach((t, i) => {
        const node = createTileElement(t, { size: 'sm', faceDown: m.concealed && m.isKong && (i === 0 || i === 3) });
        if (!m.concealed && m.calledTile && m.calledTile.instanceId === t.instanceId) node.classList.add('tile--claimed');
        g.appendChild(node);
      });
      melds.appendChild(g);
    }
    root.appendChild(melds);
  }

  if (winningTile) {
    const wrap = document.createElement('div');
    wrap.className = 'winning-hand-winning-tile';
    const node = createTileElement(winningTile, { size: 'sm' });
    node.classList.add('tile--winning');
    node.setAttribute('aria-label', `Winning tile: ${winningTile.label}`);
    wrap.appendChild(node);
    root.appendChild(wrap);
  }
  container.appendChild(root);
  return root;
}
