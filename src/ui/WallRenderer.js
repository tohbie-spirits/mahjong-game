/**
 * WallRenderer.js
 *
 * renderWallIndicator(container, wallManager) — the remaining-tiles readout
 * (Task 48): exact count from `remainingCount` (dead wall excluded) beside a
 * decorative, identity-free face-down stack that shrinks in four steps.
 * ≤ 4 tiles → `wall-indicator--low`; 0 → `wall-indicator--empty`.
 *
 * REBUILT (after Task 77).
 */

import { createFaceDownTileElement } from './TileRenderer.js';

export const LOW_WALL_THRESHOLD = 4;

/** Stack height (0–4) for a remaining/total ratio. */
export function stackSizeFor(remaining, total) {
  if (remaining <= 0 || total <= 0) return 0;
  const ratio = remaining / total;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

export function renderWallIndicator(container, wallManager) {
  if (!(container instanceof Element)) throw new TypeError('[WallRenderer] container must be a DOM Element.');
  if (!wallManager || typeof wallManager.remainingCount !== 'number') throw new TypeError('[WallRenderer] wallManager must be a WallManager.');
  container.innerHTML = '';
  const remaining = wallManager.remainingCount;
  const total = wallManager.totalCount;
  const root = document.createElement('div');
  root.className = 'wall-indicator';
  if (remaining === 0) root.classList.add('wall-indicator--empty');
  else if (remaining <= LOW_WALL_THRESHOLD) root.classList.add('wall-indicator--low');

  const stack = document.createElement('div');
  stack.className = 'wall-indicator-stack';
  stack.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < stackSizeFor(remaining, total); i++) stack.appendChild(createFaceDownTileElement({ size: 'sm' }));

  const count = document.createElement('div');
  count.className = 'wall-indicator-count';
  count.setAttribute('aria-label', `${remaining} tile${remaining === 1 ? '' : 's'} left in the wall`);
  const num = document.createElement('span');
  num.className = 'wall-indicator-number';
  num.textContent = String(remaining);
  const label = document.createElement('span');
  label.className = 'wall-indicator-label';
  label.textContent = 'left';
  count.append(num, label);

  root.append(stack, count);
  container.appendChild(root);
  return root;
}
