/**
 * TableInfoRenderer.js — Task 102: the ruleset-specific facts shown in the
 * middle of the table, under the wall counter.
 *
 *   renderTableInfo(container, info)
 *     info.doraIndicators  Tile[]   Riichi — the dora indicators showing
 *     info.riichiSeats     number[] Riichi — seats in riichi
 *     info.honba           number   Riichi — repeat counters
 *     info.riichiSticks    number   Riichi — deposits on the table
 *     info.bonusTiles      Tile[][] Chinese Official — flowers set aside, per seat
 *     info.seatNames       string[] display names, per seat
 *   Every field is optional; with none the panel is empty and hidden
 *   (Hong Kong). Renders INSIDE the container (container isolation) and
 *   replaces its previous content. Returns the `.table-info` element.
 *
 *   tableInfoFrom(gameManager) — reads those fields from a GameManager's
 *   table view and turn flow (duck-typed; no ruleset imports).
 */

import { createTileElement } from './TileRenderer.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Collects the table-info fields from a GameManager (any ruleset). */
export function tableInfoFrom(gameManager) {
  const view = typeof gameManager?.getTableView === 'function' ? gameManager.getTableView() : {};
  const flow = typeof gameManager?.getTurnFlow === 'function' ? gameManager.getTurnFlow() : null;
  const players = typeof gameManager?.getPlayers === 'function' ? gameManager.getPlayers() : [];
  return {
    doraIndicators: Array.isArray(view.doraIndicators) ? view.doraIndicators : undefined,
    riichiSeats: Array.isArray(view.riichiSeats) ? view.riichiSeats : undefined,
    honba: Number.isInteger(flow?.honba) ? flow.honba : undefined,
    riichiSticks: Number.isInteger(flow?.riichiSticks) ? flow.riichiSticks : undefined,
    bonusTiles: Array.isArray(view.bonusTiles) ? view.bonusTiles : undefined,
    seatNames: players.map((p) => p.displayName),
  };
}

export function renderTableInfo(container, info = {}) {
  if (!(container instanceof Element)) throw new TypeError('[TableInfoRenderer] container must be a DOM Element.');
  container.innerHTML = '';
  const root = el('div', 'table-info');
  const name = (seat) => info.seatNames?.[seat] ?? `Seat ${seat + 1}`;

  if (Array.isArray(info.doraIndicators) && info.doraIndicators.length) {
    const row = el('div', 'table-info-row table-info-row--dora');
    row.appendChild(el('span', 'table-info-label', 'Dora indicator'));
    const tiles = el('span', 'table-info-tiles');
    for (const t of info.doraIndicators) tiles.appendChild(createTileElement(t, { size: 'sm' }));
    row.appendChild(tiles);
    root.appendChild(row);
  }

  const counters = [];
  if (Number.isInteger(info.honba) && info.honba > 0) counters.push(`${info.honba} honba`);
  if (Number.isInteger(info.riichiSticks) && info.riichiSticks > 0) counters.push(`${info.riichiSticks} riichi stick${info.riichiSticks === 1 ? '' : 's'}`);
  if (counters.length) root.appendChild(el('div', 'table-info-row table-info-row--counters', counters.join(' · ')));

  if (Array.isArray(info.riichiSeats) && info.riichiSeats.length) {
    root.appendChild(el('div', 'table-info-row table-info-row--riichi', `Riichi: ${info.riichiSeats.map(name).join(', ')}`));
  }

  if (Array.isArray(info.bonusTiles) && info.bonusTiles.some((b) => b.length)) {
    const block = el('div', 'table-info-row table-info-row--flowers');
    block.appendChild(el('span', 'table-info-label', 'Flowers'));
    info.bonusTiles.forEach((list, seat) => {
      if (!list.length) return;
      const who = el('span', 'table-info-flowers');
      who.appendChild(el('span', 'table-info-flowers-name', name(seat)));
      for (const t of list) who.appendChild(createTileElement(t, { size: 'sm' }));
      block.appendChild(who);
    });
    root.appendChild(block);
  }

  root.hidden = root.childElementCount === 0;
  container.appendChild(root);
  return root;
}
