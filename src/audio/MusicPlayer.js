/**
 * MusicPlayer.js — Task 110: background music, generated live.
 *
 * Like the effects (SoundLibrary.js), the music is synthesised — no files.
 * Each TRACK is a small generative composition in the major pentatonic
 * (C D E G A, the same palette as the effects): a slow four-chord loop of
 * bass + soft pad, and a plucked, zither-like melody that wanders the scale
 * with seeded randomness — it never repeats exactly, it never clashes.
 *
 *   menu   60 bpm, sparse — pads, bass, an occasional bell
 *   table  76 bpm, a little busier — the pluck melody over the loop
 *
 * SCHEDULING — the classic Web Audio look-ahead: a timer wakes every
 * `tickMs` and schedules every note due in the next `lookahead` seconds on
 * the audio clock (sample-accurate, immune to timer jitter). Notes go into a
 * per-track gain → AudioManager's music bus, so the Music volume and Mute
 * (Settings, the in-game sound button) apply instantly. Switching tracks
 * cross-fades. While audio is locked (no gesture yet), muted or at music
 * volume 0, nothing is scheduled — the timer just keeps the place.
 *
 *   const music = new MusicPlayer({ audio });
 *   music.play('menu');  music.play('table');  music.stop();
 *
 * Timers and randomness are injectable (Node tests drive it with a fake
 * clock and the recording fake AudioContext).
 */

import { midiToHz } from './SoundLibrary.js';

/** Bar-by-bar chords: bass note + pad notes (MIDI), all from C major pentatonic. */
const LOOP = [
  { bass: 36, pad: [60, 64, 67] },   // C
  { bass: 45, pad: [57, 60, 64] },   // A minor colour
  { bass: 38, pad: [62, 67, 69] },   // D sus
  { bass: 43, pad: [55, 62, 67] },   // G sus
];
const PENTA = [0, 2, 4, 7, 9];
/** Melody range: pentatonic notes from G4 to C7. */
export const MELODY_NOTES = (() => {
  const out = [];
  for (let oct = 4; oct <= 7; oct++) for (const d of PENTA) { const m = 12 * (oct + 1) + d; if (m >= 67 && m <= 96) out.push(m); }
  return out;
})();

export const MUSIC_TRACKS = Object.freeze({
  menu: Object.freeze({ bpm: 60, stepsPerBar: 8, melodyChance: 0.18, bellEvery: 2, padLevel: 0.09, bassLevel: 0.12, pluckLevel: 0.07 }),
  table: Object.freeze({ bpm: 76, stepsPerBar: 8, melodyChance: 0.42, bellEvery: 4, padLevel: 0.07, bassLevel: 0.11, pluckLevel: 0.075 }),
});

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * The notes of one step, as data (what the player schedules) — exported so the
 * composition can be tested without any audio.
 * @returns {{ kind: 'bass'|'pad'|'pluck'|'bell', midi: number, at: number, dur: number, level: number }[]}
 *   `at` in seconds from the step's start
 */
export function composeStep(track, step, state, random) {
  const spb = track.stepsPerBar;
  const stepDur = 60 / track.bpm / 2; // eighth notes
  const bar = Math.floor(step / spb);
  const pos = step % spb;
  const chord = LOOP[bar % LOOP.length];
  const notes = [];
  if (pos === 0) {
    notes.push({ kind: 'bass', midi: chord.bass, at: 0, dur: stepDur * spb * 0.95, level: track.bassLevel });
    for (const m of chord.pad) notes.push({ kind: 'pad', midi: m, at: 0, dur: stepDur * spb, level: track.padLevel });
    if (bar % track.bellEvery === track.bellEvery - 1) notes.push({ kind: 'bell', midi: 84 + PENTA[Math.floor(random() * PENTA.length)], at: stepDur * 4, dur: 2.2, level: 0.05 });
  }
  if (pos === 4) notes.push({ kind: 'bass', midi: chord.bass + 7 <= 50 ? chord.bass + 7 : chord.bass - 5, at: 0, dur: stepDur * 3.5, level: track.bassLevel * 0.6 });
  // Melody: stronger on the beat, a random walk over the scale, leaning on chord tones.
  const chance = track.melodyChance * (pos % 2 === 0 ? 1.25 : 0.7);
  if (random() < chance) {
    const i0 = state.melodyIndex ?? Math.floor(MELODY_NOTES.length / 3);
    let i = Math.max(0, Math.min(MELODY_NOTES.length - 1, i0 + Math.round((random() - 0.5) * 4)));
    if (pos === 0) {
      const tones = chord.pad.map((m) => m % 12);
      const near = MELODY_NOTES.map((m, k) => ({ m, k })).filter((x) => tones.includes(x.m % 12)).sort((a, b) => Math.abs(a.k - i) - Math.abs(b.k - i))[0];
      if (near) i = near.k;
    }
    if (i > MELODY_NOTES.length - 3) i -= 2; // stay out of the top
    state.melodyIndex = i;
    notes.push({ kind: 'pluck', midi: MELODY_NOTES[i], at: 0, dur: stepDur * 2.5, level: track.pluckLevel });
    if (random() < 0.12 && i > 0) notes.push({ kind: 'pluck', midi: MELODY_NOTES[i - 1], at: stepDur * 0.5, dur: stepDur * 1.5, level: track.pluckLevel * 0.7 }); // a grace note
  }
  return notes;
}

/** Schedules one note (voice) into `out`. @private */
function voice(ctx, out, note, when) {
  const end = when + note.dur;
  const g = ctx.createGain();
  g.connect(out);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(midiToHz(note.midi), when);
  switch (note.kind) {
    case 'pad': {
      osc.type = 'sine';
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.setValueAtTime(midiToHz(note.midi), when);
      o2.detune.setValueAtTime(7, when);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, when);
      f.Q.setValueAtTime(0.5, when);
      osc.connect(f); o2.connect(f); f.connect(g);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(note.level, when + Math.min(1.2, note.dur * 0.35));
      g.gain.setValueAtTime(note.level, end - Math.min(1, note.dur * 0.3));
      g.gain.linearRampToValueAtTime(0.0001, end);
      o2.start(when); o2.stop(end + 0.05);
      break;
    }
    case 'bass':
      osc.type = 'triangle';
      osc.connect(g);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(note.level, when + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      break;
    case 'bell':
      osc.type = 'sine';
      osc.connect(g);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(note.level, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      break;
    default: { // pluck: a zither-like attack — slightly sharp, then settles
      osc.type = 'triangle';
      osc.detune.setValueAtTime(25, when);
      osc.detune.linearRampToValueAtTime(0, when + 0.06);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(3200, when);
      f.frequency.exponentialRampToValueAtTime(900, end);
      f.Q.setValueAtTime(0.7, when);
      osc.connect(f); f.connect(g);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(note.level, when + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
    }
  }
  osc.start(when);
  osc.stop(end + 0.05);
}

export class MusicPlayer {
  /**
   * @param {Object} options
   * @param {import('./AudioManager.js').AudioManager} options.audio
   * @param {Object} [options.tracks=MUSIC_TRACKS]
   * @param {number} [options.lookahead=0.35] seconds scheduled ahead
   * @param {number} [options.tickMs=100]
   * @param {number} [options.fadeIn=1.5] / [options.fadeOut=1] seconds
   * @param {number} [options.seed]
   * @param {Function} [options.setInterval] / [options.clearInterval]
   */
  constructor({ audio, tracks = MUSIC_TRACKS, lookahead = 0.35, tickMs = 100, fadeIn = 1.5, fadeOut = 1, seed = 20261116, setInterval: si, clearInterval: ci } = {}) {
    if (!audio || typeof audio.getContext !== 'function' || typeof audio.getMusicBus !== 'function') throw new TypeError('[MusicPlayer] needs an AudioManager.');
    this._audio = audio;
    this._tracks = tracks;
    this._lookahead = lookahead;
    this._tickMs = tickMs;
    this._fadeIn = fadeIn;
    this._fadeOut = fadeOut;
    this._random = seeded(seed);
    this._si = si ?? ((fn, ms) => setInterval(fn, ms));
    this._ci = ci ?? ((id) => clearInterval(id));
    this._name = null;
    this._timer = null;
    this._cur = null;      // { ctx, gain, nextTime, step, state }
    this._scheduled = 0;   // notes scheduled (tests / smoke)
  }

  /** The track playing (or waiting to play), or null. */
  getTrack() { return this._name; }
  getTrackNames() { return Object.keys(this._tracks); }
  /** Notes scheduled so far. */
  getScheduledCount() { return this._scheduled; }
  isRunning() { return this._timer !== null; }

  /** Starts `name` (cross-fading from the current track). The same track again is a no-op. */
  play(name) {
    if (!this._tracks[name]) throw new RangeError(`[MusicPlayer] unknown track "${name}".`);
    if (this._name === name) return;
    this._fadeOutCurrent();
    this._name = name;
    if (this._timer === null) this._timer = this._si(() => this.tick(), this._tickMs);
    this.tick();
  }

  /** Fades out and stops. */
  stop() {
    this._fadeOutCurrent();
    this._name = null;
    if (this._timer !== null) { this._ci(this._timer); this._timer = null; }
  }

  /** One scheduler pass (the timer calls it; tests call it directly). */
  tick() {
    if (!this._name) return;
    const audio = this._audio;
    const ctx = audio.getContext();
    if (!ctx || !(typeof audio.isUnlocked === 'function' ? audio.isUnlocked() : ctx.state === 'running')) return;
    const bus = audio.getMusicBus();
    if (!bus) return;
    // A new context (destroyed and unlocked again) — start over on it.
    if (this._cur && this._cur.ctx !== ctx) this._cur = null;
    if (!this._cur) this._start(ctx, bus);
    const cur = this._cur;
    const track = this._tracks[this._name];
    const stepDur = 60 / track.bpm / 2;
    const silent = (typeof audio.isMuted === 'function' && audio.isMuted()) || (typeof audio.getMusicVolume === 'function' && audio.getMusicVolume() === 0);
    if (cur.nextTime < ctx.currentTime) {
      // Fell behind (page was hidden, a long stall): jump to now instead of a burst of notes.
      const missed = Math.ceil((ctx.currentTime - cur.nextTime) / stepDur);
      cur.step += missed;
      cur.nextTime += missed * stepDur;
    }
    while (cur.nextTime < ctx.currentTime + this._lookahead) {
      if (!silent) {
        for (const note of composeStep(track, cur.step, cur.state, this._random)) {
          try { voice(ctx, cur.gain, note, cur.nextTime + note.at); this._scheduled++; } catch { /* a voice can't stop the music */ }
        }
      }
      cur.step++;
      cur.nextTime += stepDur;
    }
  }

  /** Stops the timer and drops the context (AudioManager#destroy). */
  destroy() { this.stop(); this._cur = null; }

  /** @private */
  _start(ctx, bus) {
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(1, t + this._fadeIn);
    gain.connect(bus);
    this._cur = { ctx, gain, nextTime: t + 0.1, step: 0, state: {} };
  }

  /** @private */
  _fadeOutCurrent() {
    const cur = this._cur;
    this._cur = null;
    if (!cur) return;
    try {
      const t = cur.ctx.currentTime;
      const g = cur.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.0001, t + this._fadeOut);
      setTimeout(() => { try { cur.gain.disconnect(); } catch { /* ignore */ } }, (this._fadeOut + 0.3) * 1000 + this._lookahead * 1000);
    } catch { /* ignore */ }
  }
}
