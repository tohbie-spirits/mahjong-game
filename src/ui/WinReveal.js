/**
 * WinReveal.js — Task 106: the winning-hand reveal on the round-over card.
 *
 * ScoreScreen (Task 57) renders the result card all at once; GameScreen then
 * calls revealWin(engine, card, { celebrate }) and this module stages it:
 *
 *   1. the title springs in (any win) — a draw's card just pops in as before;
 *   2. per winner card, one after another: the hand's tiles flip up left to
 *      right (concealed tiles, then melds), then the completing tile drops in
 *      and glows;
 *   3. the score breakdown lines slide in one by one, the total last;
 *   4. when the human won (`celebrate`), a burst of confetti from the title.
 *
 * Purely decorative (the plan's core / decorative-shell separation): the
 * card is complete and its buttons work from the first frame. Every staged
 * element uses fill 'backwards', so it is held at its first keyframe
 * (hidden) only while waiting for its turn — when animations are off (the
 * setting, OS reduce-motion, no engine) nothing is touched and the card
 * simply shows. The returned promise always resolves.
 *
 *   revealWin(engine, card, { celebrate, doc, random, tileStaggerMs, rowStaggerMs })
 *     → Promise<{ tiles, winningTiles, rows, particles, skipped? }>
 *   revealPlan(card, options) → the same staging as plain data
 *     [{ el, animation, delay, options }] — what revealWin plays (tested in Node).
 */

import { defineAnimation } from './AnimationEngine.js';

export const TILE_STAGGER_MS = 45;
export const ROW_STAGGER_MS = 80;
export const WINNER_GAP_MS = 250;
export const BURST_PARTICLES = 18;

defineAnimation('tile-reveal', {
  keyframes: [
    { opacity: 0, transform: 'translateY(14px) rotateX(75deg)' },
    { opacity: 1, transform: 'translateY(-3px) rotateX(0deg)', offset: 0.7 },
    { opacity: 1, transform: 'translateY(0) rotateX(0deg)' },
  ],
  duration: 260,
  easing: 'ease-out',
});

defineAnimation('winning-tile-drop', {
  keyframes: [
    { opacity: 0, transform: 'translateY(-26px) scale(1.35)', boxShadow: '0 0 0 0 rgba(224,184,79,0)' },
    { opacity: 1, transform: 'translateY(2px) scale(1)', offset: 0.45 },
    { opacity: 1, transform: 'translateY(0) scale(1.08)', boxShadow: '0 0 0 3px rgba(224,184,79,0.9), 0 0 22px 6px rgba(224,184,79,0.75)', offset: 0.7 },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ],
  duration: 720,
  easing: 'ease-out',
});

defineAnimation('title-celebrate', {
  keyframes: [
    { opacity: 0, transform: 'scale(0.6)', letterSpacing: '0.2em' },
    { opacity: 1, transform: 'scale(1.1)', offset: 0.6 },
    { opacity: 1, transform: 'scale(1)', letterSpacing: 'normal' },
  ],
  duration: 480,
  easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)',
});

defineAnimation('burst-particle', {
  keyframes: (el, o) => [
    { opacity: 1, transform: 'translate(0, 0) rotate(0deg) scale(1)' },
    { opacity: 1, transform: `translate(${(o.dx ?? 0) * 0.7}px, ${(o.dy ?? 0) * 0.7}px) rotate(${(o.spin ?? 0) * 0.7}deg) scale(1)`, offset: 0.6 },
    { opacity: 0, transform: `translate(${o.dx ?? 0}px, ${(o.dy ?? 0) + 40}px) rotate(${o.spin ?? 0}deg) scale(0.5)` },
  ],
  duration: 900,
  easing: 'cubic-bezier(0.15, 0.7, 0.35, 1)',
});

const usable = (engine) => !!engine && typeof engine.play === 'function' && (typeof engine.isActive !== 'function' || engine.isActive());
const all = (root, sel) => (root && typeof root.querySelectorAll === 'function' ? [...root.querySelectorAll(sel)] : []);

/**
 * The staging as plain data (no DOM is created or animated here).
 * @param {Element} card the `.score-screen` card
 * @returns {{ steps: {el: Element, animation: string, delay: number, options: Object}[], counts: {tiles: number, winningTiles: number, rows: number}, end: number }}
 */
export function revealPlan(card, { tileStaggerMs = TILE_STAGGER_MS, rowStaggerMs = ROW_STAGGER_MS } = {}) {
  const steps = [];
  const counts = { tiles: 0, winningTiles: 0, rows: 0 };
  const winners = all(card, '.score-screen-winner');
  if (!winners.length) return { steps, counts, end: 0 };

  const title = all(card, '.score-screen-title')[0];
  if (title) steps.push({ el: title, animation: 'title-celebrate', delay: 0, options: { fill: 'backwards' } });

  let t = 200; // after the title has started
  for (const section of winners) {
    const tiles = all(section, '.winning-hand-concealed .tile, .winning-hand-meld .tile');
    tiles.forEach((el, i) => steps.push({ el, animation: 'tile-reveal', delay: t + i * tileStaggerMs, options: { fill: 'backwards' } }));
    counts.tiles += tiles.length;
    t += tiles.length * tileStaggerMs + 120;
    for (const el of all(section, '.winning-hand-winning-tile .tile')) {
      steps.push({ el, animation: 'winning-tile-drop', delay: t, options: { fill: 'backwards' } });
      counts.winningTiles++;
      t += 320;
    }
    const rows = all(section, '.score-screen-fan tbody tr, .score-screen-fan tfoot tr');
    rows.forEach((el, i) => steps.push({ el, animation: 'slide-up', delay: t + i * rowStaggerMs, options: { fill: 'backwards', distance: 8 } }));
    counts.rows += rows.length;
    t += rows.length * rowStaggerMs + WINNER_GAP_MS;
  }
  return { steps, counts, end: t };
}

/**
 * Stages the round-over card's reveal (see the module doc).
 * @param {import('./AnimationEngine.js').AnimationEngine} engine
 * @param {Element} card
 * @param {{ celebrate?: boolean, doc?: Document, random?: function(): number, tileStaggerMs?: number, rowStaggerMs?: number }} [options]
 */
export function revealWin(engine, card, { celebrate = false, doc = typeof document !== 'undefined' ? document : null, random = Math.random, ...timing } = {}) {
  const empty = { tiles: 0, winningTiles: 0, rows: 0, particles: 0 };
  if (!usable(engine)) return Promise.resolve({ ...empty, skipped: true, reason: 'inactive' });
  if (!card) return Promise.resolve({ ...empty, skipped: true, reason: 'no-card' });
  const { steps, counts } = revealPlan(card, timing);
  if (!steps.length) return Promise.resolve({ ...empty, skipped: true, reason: 'no-win' });

  const plays = steps.map((s) => engine.play(s.el, s.animation, { ...s.options, delay: s.delay }));
  let particles = 0;
  if (celebrate) {
    const burst = _burst(engine, card, { doc, random });
    particles = burst.count;
    plays.push(burst.done);
  }
  return Promise.all(plays).then(() => ({ ...counts, particles }));
}

/** Confetti from the title: particles in a container that is removed when they land. @private */
function _burst(engine, card, { doc, random }) {
  if (!doc || typeof doc.createElement !== 'function' || typeof card.appendChild !== 'function') return { count: 0, done: Promise.resolve() };
  let box;
  const pieces = [];
  try {
    box = doc.createElement('div');
    box.className = 'win-burst';
    box.setAttribute?.('aria-hidden', 'true');
    for (let i = 0; i < BURST_PARTICLES; i++) {
      const p = doc.createElement('span');
      p.className = `win-burst-particle win-burst-particle--${i % 4}`;
      box.appendChild(p);
      pieces.push(p);
    }
    card.appendChild(box);
  } catch {
    return { count: 0, done: Promise.resolve() };
  }
  const done = Promise.all(pieces.map((p, i) => {
    const angle = (i / pieces.length) * Math.PI * 2 + random() * 0.4;
    const dist = 70 + random() * 90;
    return engine.play(p, 'burst-particle', {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist * 0.6 - 20,
      spin: (random() - 0.5) * 540,
      delay: 120 + random() * 120,
      fill: 'backwards',
    });
  })).then(() => { box.remove?.(); });
  return { count: pieces.length, done };
}
