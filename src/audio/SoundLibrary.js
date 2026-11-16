/**
 * SoundLibrary.js — Task 108: every sound effect in the game, SYNTHESISED with
 * the Web Audio API. The plan deferred sound files ("asset sourcing /
 * licensing is a separate concern"); synthesis needs no files at all, so the
 * game stays fully offline and licence-free. A file-based sound can be added
 * later as one more recipe (decode an ArrayBuffer, play a buffer source) —
 * nothing outside this file would change.
 *
 * A RECIPE is `(ctx, out, { when, volume, detune, random }) → seconds`: it
 * builds short-lived nodes, connects them to `out` (AudioManager's effects
 * bus, through a per-play gain / panner), schedules everything at or after
 * `when` (AudioContext time) and returns how long the sound lasts. Recipes
 * never start anything before `when` and stop every source they start, so
 * nodes are released as soon as the sound ends.
 *
 *   SOUND_LIBRARY        name → recipe (frozen)
 *   getSoundNames()      the names
 *   SOUND_DESCRIPTIONS   name → what it is for (docs / tests)
 *
 * Pitches: mahjong's own palette — a major pentatonic (C D E G A) for
 * everything melodic, so effects and music (Task 110) never clash.
 */

/** Note number → Hz (A4 = 69 = 440 Hz). */
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

const NOISE = new WeakMap();
/** One second of white noise per context (cached). Deterministic, so tests can compare. */
export function noiseBuffer(ctx) {
  let buf = NOISE.get(ctx);
  if (buf) return buf;
  const length = Math.max(1, Math.floor(ctx.sampleRate || 44100));
  buf = ctx.createBuffer(1, length, ctx.sampleRate || 44100);
  const data = buf.getChannelData(0);
  let s = 0x2545f491;
  for (let i = 0; i < length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; data[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
  NOISE.set(ctx, buf);
  return buf;
}

/** A gain envelope: 0 → peak in `attack`, then an exponential fall over `decay`. */
function envelope(ctx, when, { attack = 0.003, peak = 1, decay = 0.1 } = {}) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return g;
}

/** An oscillator note through an envelope. Returns its end time. */
function tone(ctx, out, { when, freq, type = 'sine', attack = 0.004, decay = 0.2, peak = 0.3, glideTo = null, glideTime = 0.08, detune = 0 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, when + glideTime);
  if (detune) osc.detune.setValueAtTime(detune, when);
  const env = envelope(ctx, when, { attack, peak, decay });
  osc.connect(env);
  env.connect(out);
  const end = when + attack + decay + 0.02;
  osc.start(when);
  osc.stop(end);
  return end;
}

/** A filtered noise burst (the body of every tile sound). Returns its end time. */
function noise(ctx, out, { when, filter = 'bandpass', freq = 1800, q = 1, attack = 0.001, decay = 0.05, peak = 0.5, sweepTo = null }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, when);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, when + attack + decay);
  f.Q.setValueAtTime(q, when);
  const env = envelope(ctx, when, { attack, peak, decay });
  src.connect(f);
  f.connect(env);
  env.connect(out);
  const end = when + attack + decay + 0.02;
  src.start(when, 0);
  src.stop(end);
  return end;
}

/** Bakelite tile on felt: a sharp click, a woody knock and a soft thump. */
function tileClack(ctx, out, { when, volume = 1, detune = 0, random = Math.random }, { soft = false } = {}) {
  const v = volume * (soft ? 0.55 : 1);
  const shift = 2 ** (((random() - 0.5) * 120 + detune) / 1200); // ±60 cents of natural variation
  const ends = [
    noise(ctx, out, { when, freq: 3400 * shift, q: 2.5, decay: 0.018, peak: 0.55 * v }),
    noise(ctx, out, { when: when + 0.002, freq: 1500 * shift, q: 1.4, decay: 0.06, peak: 0.7 * v }),
    tone(ctx, out, { when, freq: (soft ? 150 : 180) * shift, type: 'triangle', decay: 0.07, peak: 0.35 * v }),
  ];
  return Math.max(...ends) - when;
}

const RECIPES = {
  /** Your discard landing in the pile. */
  discard: (ctx, out, o) => tileClack(ctx, out, o),
  /** An opponent's discard (softer; panned to their side by the caller). */
  'discard-soft': (ctx, out, o) => tileClack(ctx, out, o, { soft: true }),
  /** Drawing a tile: a short slide off the wall. */
  draw: (ctx, out, { when, volume = 1 }) => {
    const a = noise(ctx, out, { when, filter: 'lowpass', freq: 500, sweepTo: 2200, q: 0.8, attack: 0.03, decay: 0.08, peak: 0.42 * volume });
    const b = noise(ctx, out, { when: when + 0.1, freq: 2400, q: 2, decay: 0.02, peak: 0.35 * volume });
    return Math.max(a, b) - when;
  },
  /** Chi — a quick rising pair of wood-block notes. */
  'claim-chi': (ctx, out, { when, volume = 1 }) => {
    tone(ctx, out, { when, freq: midiToHz(76), type: 'triangle', decay: 0.12, peak: 0.32 * volume });
    return tone(ctx, out, { when: when + 0.09, freq: midiToHz(81), type: 'triangle', decay: 0.18, peak: 0.32 * volume }) - when;
  },
  /** Pon — a wider, firmer pair. */
  'claim-pon': (ctx, out, { when, volume = 1 }) => {
    tone(ctx, out, { when, freq: midiToHz(72), type: 'square', decay: 0.09, peak: 0.12 * volume });
    tone(ctx, out, { when, freq: midiToHz(72), type: 'triangle', decay: 0.14, peak: 0.3 * volume });
    return tone(ctx, out, { when: when + 0.1, freq: midiToHz(79), type: 'triangle', decay: 0.22, peak: 0.34 * volume }) - when;
  },
  /** Kong — three notes, the last one ringing. */
  'claim-kong': (ctx, out, { when, volume = 1 }) => {
    tone(ctx, out, { when, freq: midiToHz(67), type: 'triangle', decay: 0.12, peak: 0.3 * volume });
    tone(ctx, out, { when: when + 0.09, freq: midiToHz(72), type: 'triangle', decay: 0.12, peak: 0.3 * volume });
    return tone(ctx, out, { when: when + 0.18, freq: midiToHz(79), type: 'triangle', decay: 0.4, peak: 0.34 * volume }) - when;
  },
  /** Riichi — the 1000-point stick laid down, then a rising tone. */
  riichi: (ctx, out, o) => {
    const { when, volume = 1 } = o;
    tileClack(ctx, out, { ...o, volume: volume * 0.8, detune: 700 });
    return tone(ctx, out, { when: when + 0.05, freq: midiToHz(69), glideTo: midiToHz(81), glideTime: 0.25, type: 'sine', attack: 0.02, decay: 0.45, peak: 0.28 * volume }) - when;
  },
  /** A flower or season set aside: a small bell. */
  flower: (ctx, out, { when, volume = 1 }) => {
    tone(ctx, out, { when, freq: midiToHz(91), type: 'sine', decay: 0.5, peak: 0.16 * volume });
    return tone(ctx, out, { when: when + 0.06, freq: midiToHz(96), type: 'sine', decay: 0.6, peak: 0.12 * volume }) - when;
  },
  /** YOU won: a bright pentatonic run up to a held chord. */
  win: (ctx, out, { when, volume = 1 }) => {
    const run = [60, 62, 64, 67, 69, 72];
    run.forEach((m, i) => tone(ctx, out, { when: when + i * 0.075, freq: midiToHz(m + 12), type: 'triangle', decay: 0.25, peak: 0.22 * volume }));
    const t = when + run.length * 0.075;
    let end = t;
    for (const m of [72, 76, 79, 84]) end = Math.max(end, tone(ctx, out, { when: t, freq: midiToHz(m), type: 'sine', attack: 0.02, decay: 1.1, peak: 0.13 * volume }));
    end = Math.max(end, tone(ctx, out, { when: t, freq: midiToHz(48), type: 'triangle', attack: 0.01, decay: 0.9, peak: 0.25 * volume }));
    return end - when;
  },
  /** Someone else won: a short two-note cadence. */
  'win-other': (ctx, out, { when, volume = 1 }) => {
    tone(ctx, out, { when, freq: midiToHz(67), type: 'triangle', decay: 0.25, peak: 0.22 * volume });
    return tone(ctx, out, { when: when + 0.16, freq: midiToHz(72), type: 'sine', attack: 0.01, decay: 0.6, peak: 0.2 * volume }) - when;
  },
  /** The hand ended without a winner (wall exhausted, abortive draw). */
  'draw-game': (ctx, out, { when, volume = 1 }) => {
    let end = when;
    [67, 64, 60].forEach((m, i) => { end = tone(ctx, out, { when: when + i * 0.18, freq: midiToHz(m), type: 'sine', attack: 0.01, decay: i === 2 ? 0.7 : 0.25, peak: 0.2 * volume }); });
    return end - when;
  },
  /** It is your turn to discard. */
  turn: (ctx, out, { when, volume = 1 }) => tone(ctx, out, { when, freq: midiToHz(84), type: 'sine', decay: 0.12, peak: 0.08 * volume }) - when,
  /** A tile that can't be discarded right now was clicked. */
  locked: (ctx, out, { when, volume = 1 }) => {
    tone(ctx, out, { when, freq: 140, type: 'square', decay: 0.08, peak: 0.07 * volume });
    return tone(ctx, out, { when: when + 0.09, freq: 120, type: 'square', decay: 0.1, peak: 0.07 * volume }) - when;
  },
  /** A button press anywhere in the UI. */
  'ui-click': (ctx, out, { when, volume = 1 }) => noise(ctx, out, { when, freq: 2600, q: 3, decay: 0.014, peak: 0.6 * volume }) - when,
};

export const SOUND_LIBRARY = Object.freeze({ ...RECIPES });

export const SOUND_DESCRIPTIONS = Object.freeze({
  discard: 'your discard lands', 'discard-soft': 'an opponent’s discard lands', draw: 'you draw a tile',
  'claim-chi': 'a Chi is called', 'claim-pon': 'a Pon is called', 'claim-kong': 'a Kong is declared or called',
  riichi: 'riichi is declared', flower: 'a flower / season is set aside', win: 'you win the hand',
  'win-other': 'another player wins', 'draw-game': 'the hand ends without a winner', turn: 'your turn to discard',
  locked: 'a locked tile was clicked', 'ui-click': 'a button is pressed',
});

export function getSoundNames() { return Object.keys(SOUND_LIBRARY); }
