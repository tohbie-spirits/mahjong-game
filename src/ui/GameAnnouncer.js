/**
 * GameAnnouncer.js — Task 115: what happens at the table, in words, for
 * screen-reader users. Like the sound bridge (Task 109) it listens to the
 * GameManager's EventBus and imports no core code:
 *
 *   game:tile-drawn      yours → "You draw 3 of Bamboo." (the tile comes from `drawnTile()`)
 *   game:tile-discarded  "AI 2 discards 5 of Dots." / "You discard …"
 *   game:claim           "AI 1 calls Pung." (with the ruleset's word: Pon / Pung …)
 *   game:riichi          "AI 3 declares riichi."
 *   game:bonus-tile      "You set aside Flower 1."
 *   game:round-over      the result, assertively: "You win by self-draw!" / "AI 1 wins on your discard." / "Draw game."
 *
 * Opponents' draws are not announced (their discard follows at once and says
 * enough). `terms` maps chi / pon / kong to the ruleset's own words.
 *
 *   const off = connectGameAnnouncer(gameManager.getEventBus(), announcer, { players, humanSeatIndex, drawnTile, terms });
 *   off.disconnect();
 */

const CLAIM_WORD = { chi: 'Chow', pon: 'Pung', kong: 'Kong' };

export function connectGameAnnouncer(eventBus, announcer, { players, humanSeatIndex, drawnTile = () => null, terms = {} } = {}) {
  if (!eventBus || typeof eventBus.on !== 'function') throw new TypeError('[GameAnnouncer] eventBus must have on().');
  if (!announcer || typeof announcer.announce !== 'function') throw new TypeError('[GameAnnouncer] announcer must have announce().');
  if (!Array.isArray(players) || !Number.isInteger(humanSeatIndex)) throw new TypeError('[GameAnnouncer] players and humanSeatIndex are required.');
  const name = (seat) => (seat === humanSeatIndex ? 'You' : players[seat]?.displayName ?? `Seat ${seat + 1}`);
  const verb = (seat, you, other) => (seat === humanSeatIndex ? you : other);
  const label = (tile) => tile?.label ?? 'a tile';
  const say = (text, opts) => { try { announcer.announce(text, opts); } catch { /* never breaks the game */ } };
  const word = (type) => terms[type] ?? CLAIM_WORD[type] ?? type;

  const handlers = {
    'game:tile-drawn': ({ seatIndex, isReplacement } = {}) => {
      if (seatIndex !== humanSeatIndex) return;
      let tile = null;
      try { tile = drawnTile(); } catch { /* ignore */ }
      say(`You draw ${label(tile)}${isReplacement ? ' (replacement)' : ''}.`);
    },
    'game:tile-discarded': ({ seatIndex, tile } = {}) => say(`${name(seatIndex)} ${verb(seatIndex, 'discard', 'discards')} ${label(tile)}.`),
    'game:claim': ({ seatIndex, type } = {}) => {
      if (!(type in CLAIM_WORD)) return;
      say(`${name(seatIndex)} ${verb(seatIndex, 'call', 'calls')} ${word(type)}.`);
    },
    'game:riichi': ({ seatIndex } = {}) => say(`${name(seatIndex)} ${verb(seatIndex, 'declare', 'declares')} riichi.`),
    'game:bonus-tile': ({ seatIndex, tile } = {}) => say(`${name(seatIndex)} ${verb(seatIndex, 'set', 'sets')} aside ${label(tile)}.`),
    'game:round-over': ({ outcome } = {}) => say(describeOutcome(outcome, { name, humanSeatIndex }), { assertive: true }),
  };
  const offs = Object.entries(handlers).map(([e, fn]) => eventBus.on(e, fn));
  let connected = true;
  return {
    isConnected: () => connected,
    disconnect() { if (!connected) return; connected = false; offs.forEach((off) => { try { off(); } catch { /* ignore */ } }); },
  };
}

/** One sentence for a hand's result. */
export function describeOutcome(outcome, { name, humanSeatIndex }) {
  if (!outcome) return 'The hand is over.';
  if (outcome.type === 'win') {
    const parts = (outcome.winners ?? []).map((w) => {
      const who = name(w.seatIndex);
      const you = w.seatIndex === humanSeatIndex;
      if (w.winType === 'self') return `${who} ${you ? 'win' : 'wins'} by self-draw${you ? '!' : '.'}`;
      const from = w.calledFrom === humanSeatIndex ? 'your discard' : Number.isInteger(w.calledFrom) ? `${name(w.calledFrom)}’s discard` : 'a discard';
      return `${who} ${you ? 'win' : 'wins'} on ${from}${you ? '!' : '.'}`;
    });
    return parts.length ? parts.join(' ') : 'The hand is won.';
  }
  if (outcome.type === 'abortive') return 'Abortive draw — the hand is replayed.';
  return 'Draw game — the wall is empty.';
}
