/**
 * TableHighlights.js — Task 107: hover / focus micro-interactions on the table.
 *
 * Point at (or keyboard-focus) any face-up tile on the table — in your hand, a
 * discard pile, a meld, the flowers — and every other visible copy of that
 * tile lights up (`.tile--match`). A tile in YOUR hand also gets a small
 * count: how many copies you hold, how many are visible elsewhere on the table
 * and how many are still unseen (in the wall or other hands) — the
 * "how many are left?" question every mahjong player asks.
 *
 *   countCopies(root, tileId)       { held, seen, left } — reads the DOM only
 *   setMatchHighlight(root, tileId) marks every other face-up copy; null clears
 *   installTileHover(root)          delegated listeners on `root`
 *     → { refresh(), clear(), uninstall() }
 *
 * Only face-up tiles carry a data-tile-id (TileRenderer gives opponents'
 * hidden tiles none), so nothing here can reveal a hidden tile. A claimed
 * discard (`.tile--claimed` in a discard pile) is the same physical tile as
 * the one shown in the caller's meld, so it is counted once. Flowers and
 * seasons are single tiles — they light up but get no count.
 */

const HAND = '.hand--local .hand-concealed';
const FACE_UP = '.tile[data-tile-id]:not(.tile--back)';

function _facesUp(root, tileId) {
  if (!root || typeof root.querySelectorAll !== 'function' || !tileId) return [];
  return [...root.querySelectorAll(FACE_UP)].filter((el) => el.dataset?.tileId === tileId);
}

const _inHand = (el) => typeof el.closest === 'function' && !!el.closest(HAND);
const _claimedDiscard = (el) => el.classList?.contains('tile--claimed') && typeof el.closest === 'function' && !!el.closest('.discard-pile');
const _single = (tileId) => /^(flower|season)/.test(tileId);

/**
 * @param {Element} root the table (or any container)
 * @param {string} tileId e.g. 'dots-5'
 * @returns {{held: number, seen: number, left: number}}
 */
export function countCopies(root, tileId) {
  const all = _facesUp(root, tileId);
  const held = all.filter(_inHand).length;
  const seen = all.filter((el) => !_inHand(el) && !_claimedDiscard(el)).length;
  const total = _single(tileId) ? 1 : 4;
  return { held, seen, left: Math.max(0, total - held - seen) };
}

/**
 * Marks every face-up copy of `tileId` in `root` except `source` with
 * `.tile--match`; clears every earlier mark first. `null` just clears.
 * @returns {number} how many tiles were marked
 */
export function setMatchHighlight(root, tileId, source = null) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  for (const el of root.querySelectorAll('.tile--match')) el.classList.remove('tile--match');
  if (!tileId) return 0;
  let n = 0;
  for (const el of _facesUp(root, tileId)) {
    if (el === source) continue;
    el.classList.add('tile--match');
    n++;
  }
  return n;
}

/** The text shown over a tile in your hand. */
export function copiesLabel({ held, seen, left }) {
  return `${held} held · ${seen} seen · ${left} left`;
}

/**
 * Delegated hover / focus handling on `root` (the table container, which
 * survives every re-render). Re-renders replace the tile elements, so
 * GameScreen calls refresh() after each one to re-apply the current mark.
 * @param {Element} root
 * @returns {{ refresh(): void, clear(): void, uninstall(): void, current(): string|null }}
 */
export function installTileHover(root) {
  if (!root || typeof root.addEventListener !== 'function') throw new TypeError('[TableHighlights] installTileHover needs an element.');
  let currentId = null;
  let source = null;

  const tileOf = (target) => (target && typeof target.closest === 'function' ? target.closest(FACE_UP) : null);
  const show = (el) => {
    currentId = el.dataset.tileId;
    source = el;
    setMatchHighlight(root, currentId, el);
    if (_inHand(el) && !_single(currentId)) {
      el.dataset.copies = copiesLabel(countCopies(root, currentId));
      el.classList.add('tile--counting');
    }
  };
  const clear = () => {
    if (source) { delete source.dataset.copies; source.classList.remove('tile--counting'); }
    currentId = null;
    source = null;
    setMatchHighlight(root, null);
  };
  const onOver = (e) => {
    const el = tileOf(e.target);
    if (el === source) return;
    if (el) { clear(); show(el); } else if (currentId) clear();
  };
  const onOut = (e) => {
    if (!source) return;
    const to = tileOf(e.relatedTarget);
    if (to !== source) clear();
  };

  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('focusin', onOver);
  root.addEventListener('focusout', onOut);

  return {
    current: () => currentId,
    clear,
    /**
     * Re-applies the mark after a re-render. The hovered element was replaced
     * by an identical one (same tile instance, same place — the pointer is
     * still over it), so the mark follows that instance; if the tile is gone
     * (you just discarded it) the mark is cleared.
     */
    refresh() {
      if (!currentId) return;
      if (source && typeof root.contains === 'function' && root.contains(source)) { setMatchHighlight(root, currentId, source); return; }
      const instance = source?.dataset?.instanceId;
      const again = instance ? [...root.querySelectorAll(FACE_UP)].find((el) => el.dataset.instanceId === instance) : null;
      if (!again) { source = null; clear(); return; }
      source = null;
      show(again);
    },
    uninstall() {
      clear();
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerout', onOut);
      root.removeEventListener('focusin', onOver);
      root.removeEventListener('focusout', onOut);
    },
  };
}
