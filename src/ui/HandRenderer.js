/**
 * HandRenderer.js
 *
 * Renders hands into a Renderer seat-hand container (Tasks 45, 46, 50).
 *
 *   renderLocalPlayerHand(container, hand, { sort, onDiscard })
 *     The viewer's own hand, face up, sorted on a COPY (the real hand's order
 *     is never touched). With `onDiscard`, every concealed tile (never a meld
 *     tile) becomes a button: tabindex 0, "Discard 5 of Dots", click /
 *     Enter / Space → onDiscard(tile). Legality is the caller's job.
 *
 *   renderOpponentHand(container, hand, { compact })
 *     Concealed tiles as identity-free face-down placeholders built from
 *     `hand.concealedCount` alone — never reads `concealedTiles`.
 *
 * Melds render the same for everyone: open melds face up with the claimed
 * tile marked `tile--claimed`; a concealed Kong shows its outer two tiles
 * face down.
 *
 * REBUILT (after Task 77).
 */

import { Tile } from '../core/Tile.js';
import { createTileElement, createFaceDownTileElement } from './TileRenderer.js';

function _assertContainer(container) {
  if (!(container instanceof Element)) throw new TypeError('[HandRenderer] container must be a DOM Element.');
}
function _assertHand(hand) {
  if (!hand || typeof hand.concealedCount !== 'number' || !Array.isArray(hand.melds)) throw new TypeError('[HandRenderer] hand must be a Hand.');
}

function _renderMeld(meld, size) {
  const group = document.createElement('div');
  group.className = `hand-meld hand-meld--${meld.type}${meld.concealed ? ' hand-meld--concealed' : ''}`;
  group.setAttribute('aria-label', `${meld.concealed ? 'Concealed ' : ''}${meld.type} of ${meld.tiles[0].label}`);
  meld.tiles.forEach((t, i) => {
    const faceDown = meld.concealed && meld.isKong && (i === 0 || i === 3);
    const node = createTileElement(t, { faceDown, size });
    if (!meld.concealed && meld.calledTile && meld.calledTile.instanceId === t.instanceId) node.classList.add('tile--claimed');
    group.appendChild(node);
  });
  return group;
}

function _appendMeldsGroup(root, hand, size) {
  if (hand.melds.length === 0) return;
  const melds = document.createElement('div');
  melds.className = 'hand-melds';
  for (const m of hand.melds) melds.appendChild(_renderMeld(m, size));
  root.appendChild(melds);
}

/**
 * @param {Element} container
 * @param {import('../core/Hand.js').Hand} hand
 * @param {{ sort?: boolean, onDiscard?: function(Tile): void, highlightInstanceId?: string }} [options]
 * @returns {HTMLDivElement}
 */
/**
 * Task 102: `isDiscardable(tile)` (optional) marks tiles that may not be
 * discarded right now (Riichi's riichi lock / kuikae) as `.tile--locked`,
 * aria-disabled, with no click / key handlers.
 */
/**
 * Task 107: `onLockedAttempt(tile, element)` (optional) is called when a
 * locked tile is clicked, so the screen can say why it can't be discarded.
 *
 * Task 115 — keyboard: with onDiscard the hand is ONE Tab stop (roving
 * tabindex): the tile `focusInstanceId` (else the drawn tile, else the last)
 * has tabindex 0, the rest −1; ←/→ (and ↑/↓), Home and End move between the
 * tiles, Enter / Space discards (or, on a locked tile, reports the attempt).
 * Locked tiles stay reachable — aria-disabled, named "… — can't be discarded
 * now" — so a keyboard user hears why. Discardable tiles carry
 * `.tile--discardable`. `onFocusTile(tile)` reports keyboard moves. Without
 * onDiscard (not your turn) the group itself is focusable (tabindex −1) so
 * focus has somewhere to stay while the table redraws.
 */
export function renderLocalPlayerHand(container, hand, { sort = true, onDiscard, highlightInstanceId, isDiscardable, onLockedAttempt, focusInstanceId, onFocusTile } = {}) {
  _assertContainer(container);
  _assertHand(hand);
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'hand hand--local';

  const concealed = document.createElement('div');
  concealed.className = 'hand-concealed';
  concealed.setAttribute('role', 'group');
  const tiles = hand.concealedTiles;
  if (sort) tiles.sort(Tile.compare);
  // Task 105: the tile just drawn sits at the end, set apart (.tile--drawn).
  const ordered = highlightInstanceId && tiles.some((t) => t.instanceId === highlightInstanceId)
    ? [...tiles.filter((t) => t.instanceId !== highlightInstanceId), ...tiles.filter((t) => t.instanceId === highlightInstanceId)]
    : tiles;
  const interactive = typeof onDiscard === 'function';
  concealed.setAttribute('aria-label', interactive
    ? `Your hand, ${ordered.length} tiles. Arrow keys choose a tile, Enter discards it.`
    : `Your hand, ${ordered.length} tiles.`);
  if (!interactive) concealed.tabIndex = -1;
  const rovingId = interactive
    ? (ordered.find((t) => t.instanceId === focusInstanceId) ?? ordered.find((t) => t.instanceId === highlightInstanceId) ?? ordered[ordered.length - 1])?.instanceId
    : null;
  const nodes = [];
  const move = (from, to) => {
    const target = nodes[to];
    if (!target) return;
    nodes[from].tabIndex = -1;
    target.tabIndex = 0;
    try { target.focus(); } catch { /* headless */ }
    onFocusTile?.(ordered[to]);
  };
  ordered.forEach((t, i) => {
    const node = createTileElement(t);
    if (highlightInstanceId && t.instanceId === highlightInstanceId) node.classList.add('tile--drawn');
    const locked = interactive && typeof isDiscardable === 'function' && !isDiscardable(t);
    if (interactive) {
      node.setAttribute('role', 'button');
      node.tabIndex = t.instanceId === rovingId ? 0 : -1;
      node.addEventListener('keydown', (e) => {
        const k = e.key;
        const to = k === 'ArrowRight' || k === 'ArrowDown' ? i + 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? ordered.length - 1 : null;
        if (to !== null) { e.preventDefault?.(); move(i, Math.max(0, Math.min(ordered.length - 1, to))); return; }
        if (k === 'Enter' || k === ' ') {
          e.preventDefault?.();
          if (locked) onLockedAttempt?.(t, node); else onDiscard(t);
        }
      });
      node.addEventListener('focus', () => onFocusTile?.(t));
    }
    if (locked) {
      node.classList.add('tile--locked');
      node.setAttribute('aria-disabled', 'true');
      node.setAttribute('aria-label', `${t.label} — can\u2019t be discarded now`);
      node.title = 'This tile cannot be discarded now';
      if (typeof onLockedAttempt === 'function') node.addEventListener('click', () => onLockedAttempt(t, node));
    } else if (interactive) {
      node.classList.add('tile--discardable');
      node.setAttribute('aria-label', `Discard ${t.label}${highlightInstanceId && t.instanceId === highlightInstanceId ? ' (just drawn)' : ''}`);
      node.addEventListener('click', () => onDiscard(t));
    }
    nodes.push(node);
    concealed.appendChild(node);
  });
  root.appendChild(concealed);
  _appendMeldsGroup(root, hand, 'md');
  container.appendChild(root);
  return root;
}

/**
 * @param {Element} container
 * @param {import('../core/Hand.js').Hand} hand
 * @param {{ compact?: boolean }} [options]
 * @returns {HTMLDivElement}
 */
export function renderOpponentHand(container, hand, { compact = true } = {}) {
  _assertContainer(container);
  _assertHand(hand);
  container.innerHTML = '';
  const size = compact ? 'sm' : 'md';
  const root = document.createElement('div');
  root.className = `hand hand--opponent${compact ? ' hand--compact' : ''}`;
  const concealed = document.createElement('div');
  concealed.className = 'hand-concealed';
  concealed.setAttribute('aria-label', `${hand.concealedCount} hidden tiles`);
  for (let i = 0; i < hand.concealedCount; i++) concealed.appendChild(createFaceDownTileElement({ size }));
  root.appendChild(concealed);
  _appendMeldsGroup(root, hand, size);
  container.appendChild(root);
  return root;
}
