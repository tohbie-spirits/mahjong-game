/**
 * GameSoundBridge.js — Task 109: sound effects for a game in progress.
 *
 * The plan's design (§1 "a lightweight internal event bus … so animations /
 * audio can hook into game events without polluting game logic"): this module
 * listens to the GameManager's EventBus and plays SoundLibrary effects through
 * an AudioManager. The core never knows audio exists; the bridge never imports
 * core code — it only knows the event names and payloads GameManager emits:
 *
 *   game:tile-drawn     { seatIndex, isReplacement }  → 'draw' (your draws only)
 *   game:tile-discarded { seatIndex, tile }           → 'discard' (yours) / 'discard-soft' (panned)
 *   game:claim          { seatIndex, type }           → 'claim-chi' | 'claim-pon' | 'claim-kong'
 *   game:riichi         { seatIndex }                 → 'riichi'
 *   game:bonus-tile     { seatIndex, tile }           → 'flower'
 *   game:round-over     { outcome }                   → 'win' (you won) | 'win-other' | 'draw-game'
 *
 * TIMING — sounds land with the animations (Tasks 104–105): a discard's clack
 * is scheduled for when the tile reaches the pile (after the opponent's draw
 * flight when they drew this turn), and a claim / Ron follows that clack.
 * `timing()` returns the flight times while animations run, or null when they
 * are off (then everything sounds at once). Delays are scheduled on the
 * audio clock (AudioManager#play's `delay`), never with timers.
 *
 * PANNING — opponents' sounds come from their side of the table: the player
 * on your right is panned right, on your left left, across the table centred.
 *
 *   const bridge = connectGameSounds(gameManager.getEventBus(), audio, { humanSeatIndex, playerCount, timing });
 *   bridge.disconnect();
 */

export const CLAIM_SOUNDS = Object.freeze({ chi: 'claim-chi', pon: 'claim-pon', kong: 'claim-kong' });
const SIDE_PAN = 0.55;

/**
 * Stereo position of `seatIndex` as seen from the human's seat.
 * @returns {number} −1 … 1
 */
export function seatPan(seatIndex, humanSeatIndex, playerCount) {
  if (!Number.isInteger(seatIndex) || !Number.isInteger(humanSeatIndex) || !(playerCount >= 2)) return 0;
  const rel = (((seatIndex - humanSeatIndex) % playerCount) + playerCount) % playerCount;
  if (rel === 0) return 0;
  if (playerCount === 4) return rel === 1 ? SIDE_PAN : rel === 3 ? -SIDE_PAN : 0;
  if (playerCount === 3) return rel === 1 ? SIDE_PAN : -SIDE_PAN;
  return 0;
}

/**
 * @param {{ on: function(string, function): function }} eventBus GameManager#getEventBus()
 * @param {{ play: function(string, Object): Object }} audio an AudioManager
 * @param {Object} options
 * @param {number} options.humanSeatIndex
 * @param {number} options.playerCount
 * @param {function(): ({drawMs: number, discardMs: number}|null)} [options.timing] flight times while animations run
 * @param {function(): number} [options.now] ms clock (tests)
 * @returns {{ disconnect(): void, isConnected(): boolean }}
 */
export function connectGameSounds(eventBus, audio, { humanSeatIndex, playerCount, timing = () => null, now = () => Date.now() } = {}) {
  if (!eventBus || typeof eventBus.on !== 'function') throw new TypeError('[GameSoundBridge] eventBus must have on().');
  if (!audio || typeof audio.play !== 'function') throw new TypeError('[GameSoundBridge] audio must have play().');
  if (!Number.isInteger(humanSeatIndex) || !Number.isInteger(playerCount)) throw new TypeError('[GameSoundBridge] humanSeatIndex and playerCount are required.');

  let lastDraw = null;      // { seat, at } — did this seat draw in this same turn?
  let lastDiscard = null;   // { at, delay } — when its clack will sound
  const SAME_TURN_MS = 50;  // a draw and a discard in one synchronous AI turn

  const pan = (seat) => seatPan(seat, humanSeatIndex, playerCount);
  const flights = () => { try { return timing() ?? null; } catch { return null; } };
  const play = (name, opts) => { try { return audio.play(name, opts); } catch { return null; } };
  /** Seconds until the most recent discard lands (0 when it already has / there is none). */
  const afterDiscard = () => (lastDiscard && now() - lastDiscard.at < SAME_TURN_MS ? lastDiscard.delay : 0);

  const handlers = {
    'game:tile-drawn': ({ seatIndex } = {}) => {
      lastDraw = { seat: seatIndex, at: now() };
      if (seatIndex === humanSeatIndex) play('draw', {});
    },
    'game:tile-discarded': ({ seatIndex } = {}) => {
      const f = flights();
      const drewThisTurn = lastDraw && lastDraw.seat === seatIndex && now() - lastDraw.at < SAME_TURN_MS;
      const delayMs = f ? f.discardMs + (drewThisTurn && seatIndex !== humanSeatIndex ? f.drawMs : 0) : 0;
      lastDiscard = { at: now(), delay: delayMs / 1000 };
      if (seatIndex === humanSeatIndex) play('discard', { delay: delayMs / 1000 });
      else play('discard-soft', { delay: delayMs / 1000, pan: pan(seatIndex), volume: 0.85 });
    },
    'game:claim': ({ seatIndex, type } = {}) => {
      const name = CLAIM_SOUNDS[type];
      if (!name) return;
      play(name, { delay: afterDiscard() + (afterDiscard() ? 0.06 : 0), pan: pan(seatIndex) });
    },
    'game:riichi': ({ seatIndex } = {}) => {
      play('riichi', { pan: pan(seatIndex), volume: seatIndex === humanSeatIndex ? 1 : 0.8 });
    },
    'game:bonus-tile': ({ seatIndex } = {}) => {
      play('flower', { pan: pan(seatIndex), volume: seatIndex === humanSeatIndex ? 0.9 : 0.5 });
    },
    'game:round-over': ({ outcome } = {}) => {
      if (!outcome) return;
      const delay = afterDiscard() ? afterDiscard() + 0.08 : 0;
      if (outcome.type === 'win') {
        const youWon = Array.isArray(outcome.winners) && outcome.winners.some((w) => w.seatIndex === humanSeatIndex);
        play(youWon ? 'win' : 'win-other', { delay });
      } else {
        play('draw-game', { delay });
      }
    },
  };

  const offs = Object.entries(handlers).map(([event, fn]) => eventBus.on(event, fn));
  let connected = true;
  return {
    isConnected: () => connected,
    disconnect() {
      if (!connected) return;
      connected = false;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
    },
  };
}
