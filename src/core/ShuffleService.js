/**
 * ShuffleService.js
 *
 * Fisher–Yates shuffling with an injectable random source, so games can be
 * reproduced from a seed in tests and simulations.
 *
 * REBUILT (after Task 77) from the project plan.
 */

/**
 * Deterministic PRNG (mulberry32). Returns a function producing [0, 1).
 * @param {number} seed  any 32-bit integer
 * @returns {function(): number}
 */
export function createSeededRandom(seed) {
  if (!Number.isFinite(seed)) throw new TypeError('[ShuffleService] seed must be a finite number.');
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a shuffled COPY of `items` (the input is never mutated).
 * @template T
 * @param {T[]} items
 * @param {function(): number} [random=Math.random]  returns [0, 1)
 * @returns {T[]}
 */
export function shuffle(items, random = Math.random) {
  if (!Array.isArray(items)) throw new TypeError('[ShuffleService] shuffle requires an array.');
  if (typeof random !== 'function') throw new TypeError('[ShuffleService] random must be a function.');
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
