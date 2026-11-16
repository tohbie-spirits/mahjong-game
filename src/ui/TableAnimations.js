/**
 * TableAnimations.js — Tasks 104–105: the tile movements on the table, built
 * on AnimationEngine (Task 103). GameScreen captures where things were BEFORE
 * it re-renders, re-renders, then asks these helpers to fly the new elements
 * in from there (FLIP). All of them resolve, never reject, and do nothing
 * when the engine is off (setting, reduced motion) or the element is gone.
 *
 *   rectOf(el)                         { left, top, width, height } | null
 *   lastTileRect(container)            rect of the last `.tile` in it (or of the container)
 *   findTileByInstance(container, id)  the tile element showing that instance
 *   animateDiscard(engine, { from, pileContainer, tile, delay })      Task 104
 *       the newly discarded tile flies from `from` (the hand) into the pile
 *   animateDraw(engine, { from, handContainer, tile, delay })         Task 105
 *       the drawn tile flies from `from` (the wall) into the hand
 *   animateGhost(engine, { from, to, doc, size })                     Task 105
 *       a face-down stand-in flies from `from` to `to` and is removed —
 *       for an opponent's draw, whose tiles carry no identity on screen
 *   popNew(engine, elements)                                          Task 105
 *       pops in elements that just appeared (new flowers on the table)
 */

import { createFaceDownTileElement } from './TileRenderer.js';
import { defineAnimation } from './AnimationEngine.js';

export const DISCARD_FLY_MS = 230;
export const DRAW_FLY_MS = 200;

/** A plain rect, or null when the element can't be measured. */
export function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  try {
    const r = el.getBoundingClientRect();
    if (!r || !(r.width > 0) || !(r.height > 0)) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  } catch {
    return null;
  }
}

/** Rect of the last tile in a container (e.g. an opponent's hand), else of the container. */
export function lastTileRect(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return null;
  const tiles = container.querySelectorAll('.tile');
  return rectOf(tiles[tiles.length - 1]) ?? rectOf(container);
}

/** The tile element in `container` showing tile instance `instanceId`. */
export function findTileByInstance(container, instanceId) {
  if (!container || typeof container.querySelectorAll !== 'function' || !instanceId) return null;
  for (const el of container.querySelectorAll('.tile')) if (el.dataset?.instanceId === instanceId) return el;
  return null;
}

const skipped = (reason) => Promise.resolve({ skipped: true, reason });
const usable = (engine) => !!engine && typeof engine.fly === 'function' && (typeof engine.isActive !== 'function' || engine.isActive());

/**
 * Task 107 — the small squash a tile makes when it lands in a pile (played
 * after the discard flight; transform-origin is the tile's bottom edge).
 */
defineAnimation('tile-land', {
  keyframes: [
    { transformOrigin: '50% 100%', transform: 'scale(1.08, 0.9)' },
    { transformOrigin: '50% 100%', transform: 'scale(0.97, 1.04)', offset: 0.55 },
    { transformOrigin: '50% 100%', transform: 'scale(1, 1)' },
  ],
  duration: 160,
  easing: 'ease-out',
});

/**
 * Task 104 — the discarded tile flies from the hand into its pile.
 * Task 107 — and squashes as it lands (`land: false` to skip).
 */
export function animateDiscard(engine, { from, pileContainer, tile, delay = 0, duration = DISCARD_FLY_MS, land = true } = {}) {
  if (!usable(engine)) return skipped('inactive');
  if (!from || !tile) return skipped('no-source');
  const el = findTileByInstance(pileContainer, tile.instanceId);
  if (!el) return skipped('not-found');
  const flight = engine.fly(el, from, { duration, delay, fill: 'backwards' });
  if (!land || typeof engine.play !== 'function') return flight;
  return flight.then((r) => (r && r.finished && el.isConnected !== false ? engine.play(el, 'tile-land').then(() => r) : r));
}

/** Task 105 — the drawn tile flies from the wall into the hand. */
export function animateDraw(engine, { from, handContainer, tile, delay = 0, duration = DRAW_FLY_MS } = {}) {
  if (!usable(engine)) return skipped('inactive');
  if (!from || !tile) return skipped('no-source');
  const el = findTileByInstance(handContainer, tile.instanceId);
  if (!el) return skipped('not-found');
  return engine.fly(el, from, { duration, delay, fill: 'backwards' });
}

/**
 * Task 105 — a face-down stand-in flies from `from` to `to`, then is removed
 * (an opponent's draw: their tiles carry no identity on screen).
 */
export function animateGhost(engine, { from, to, doc = typeof document !== 'undefined' ? document : null, size = 'sm', duration = DRAW_FLY_MS } = {}) {
  if (!usable(engine)) return skipped('inactive');
  if (!from || !to || !doc?.body) return skipped('no-source');
  let ghost;
  try {
    ghost = createFaceDownTileElement({ size });
    ghost.classList.add('tile-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, margin: '0', pointerEvents: 'none', zIndex: '15' }); // Task 112: under overlays (20), over the table
    doc.body.appendChild(ghost);
  } catch {
    return skipped('error');
  }
  return engine.fly(ghost, from, { duration, scale: false }).then((r) => {
    ghost.remove?.();
    return r;
  });
}

/** Task 105 — pops in elements that just appeared. */
export function popNew(engine, elements) {
  if (!usable(engine) || typeof engine.play !== 'function') return skipped('inactive');
  const list = [...(elements ?? [])].filter(Boolean);
  return Promise.all(list.map((el) => engine.play(el, 'pop-in', { replace: true })));
}
