/**
 * AudioManager.js — Task 108: the audio foundation (sound effects now; the
 * music bus is used by Task 110's MusicPlayer).
 *
 * One Web Audio graph for the app:
 *
 *   recipe nodes → per-play gain (+ stereo pan) ─┐
 *                                                ├→ sfx bus ─┐
 *   music player (Task 110) ─────────────────────┴→ music bus ┴→ master → speakers
 *
 *   master = volume (the Settings "Volume", Task 62) — 0 while muted
 *   sfx bus = sfxVolume, music bus = musicVolume (Task 110's sliders)
 *
 * Like AnimationEngine (Task 103) it is a decorative service: game logic never
 * waits on it and nothing here can break the game loop — play() never throws
 * for runtime reasons (no Web Audio, not yet unlocked, muted, too many
 * voices, a recipe error); it returns why it didn't play. Only programmer
 * errors (an unknown sound name, a bad volume) throw.
 *
 * AUTOPLAY — browsers only let audio start after a user gesture. The context
 * is created lazily by unlock(), which main.js calls from the first
 * pointerdown / keydown; until then play() returns { skipped, reason:
 * 'locked' }. suspend() / resume() follow page visibility (main.js).
 *
 *   const audio = new AudioManager({ volume, sfxVolume, musicVolume, muted });
 *   await audio.unlock();                       // from a user gesture
 *   audio.play('discard', { pan: -0.5, delay: 0.23, volume: 0.8 });
 *   audio.setMuted(true); audio.toggleMute(); audio.syncWithSettings(settings);
 *
 * Everything browser-specific is injectable (AudioContextClass, now) so the
 * manager is unit-tested in Node against a recording fake context.
 */

import { SOUND_LIBRARY } from './SoundLibrary.js';

export const DEFAULT_SFX_VOLUME = 0.8;
export const DEFAULT_MUSIC_VOLUME = 0.35;

const checkLevel = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new RangeError(`[AudioManager] ${name} must be a number from 0 to 1.`);
  return v;
};

export class AudioManager {
  /**
   * @param {Object} [options]
   * @param {Function|null} [options.AudioContextClass] defaults to window.AudioContext / webkitAudioContext
   * @param {Object} [options.library=SOUND_LIBRARY] name → recipe
   * @param {number} [options.volume=1]       master (Settings → Volume)
   * @param {number} [options.sfxVolume]      effects bus
   * @param {number} [options.musicVolume]    music bus
   * @param {boolean} [options.muted=false]
   * @param {number} [options.minGapMs=35]    the same sound again within this gap is dropped
   * @param {number} [options.maxVoices=24]   sounds still ringing at once
   * @param {function(): number} [options.random]
   * @param {function(): number} [options.now] ms clock for throttling
   */
  constructor({
    AudioContextClass,
    library = SOUND_LIBRARY,
    volume = 1,
    sfxVolume = DEFAULT_SFX_VOLUME,
    musicVolume = DEFAULT_MUSIC_VOLUME,
    muted = false,
    minGapMs = 35,
    maxVoices = 24,
    random = Math.random,
    now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  } = {}) {
    this._Ctx = AudioContextClass !== undefined
      ? AudioContextClass
      : (typeof window !== 'undefined' ? (window.AudioContext ?? window.webkitAudioContext ?? null) : null);
    if (!library || typeof library !== 'object') throw new TypeError('[AudioManager] library must be an object of recipes.');
    this._library = library;
    this._volume = checkLevel(volume, 'volume');
    this._sfx = checkLevel(sfxVolume, 'sfxVolume');
    this._music = checkLevel(musicVolume, 'musicVolume');
    if (typeof muted !== 'boolean') throw new TypeError('[AudioManager] muted must be a boolean.');
    this._muted = muted;
    this._minGapMs = minGapMs;
    this._maxVoices = maxVoices;
    this._random = random;
    this._now = now;
    this._ctx = null;
    this._failed = false;
    this._lastPlayed = new Map();
    this._voices = [];               // end times (context seconds) of sounds still ringing
    this._listeners = new Set();
    this._stats = { played: 0, skipped: {} };
  }

  // ── State ────────────────────────────────────────────────────────────────
  /** Web Audio exists in this browser (and creating a context hasn't failed). */
  isSupported() { return !!this._Ctx && !this._failed; }
  /** The context exists and is running — sounds will be heard. */
  isUnlocked() { return !!this._ctx && this._ctx.state === 'running'; }
  getContext() { return this._ctx; }
  getVolume() { return this._volume; }
  getSfxVolume() { return this._sfx; }
  getMusicVolume() { return this._music; }
  isMuted() { return this._muted; }
  /** { played, skipped: { reason: count } } — for tests and the browser smoke. */
  getStats() { return { played: this._stats.played, skipped: { ...this._stats.skipped } }; }
  /** The music bus (Task 110's MusicPlayer connects here); null before unlock. */
  getMusicBus() { return this._musicBus ?? null; }

  /** Notified with (state) after any volume / mute / unlock change. Returns an unsubscribe. */
  onChange(fn) {
    if (typeof fn !== 'function') throw new TypeError('[AudioManager] onChange needs a function.');
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  // ── Levels ───────────────────────────────────────────────────────────────
  setVolume(v) { this._volume = checkLevel(v, 'volume'); this._applyLevels(); }
  setSfxVolume(v) { this._sfx = checkLevel(v, 'sfxVolume'); this._applyLevels(); }
  setMusicVolume(v) { this._music = checkLevel(v, 'musicVolume'); this._applyLevels(); }
  setMuted(m) {
    if (typeof m !== 'boolean') throw new TypeError('[AudioManager] setMuted needs a boolean.');
    this._muted = m;
    this._applyLevels();
  }
  toggleMute() { this.setMuted(!this._muted); return this._muted; }

  /**
   * Reads volume / sfxVolume / musicVolume / muted from a SettingsManager-like
   * object (get(key)); keys it doesn't know are left alone.
   */
  syncWithSettings(settings) {
    if (!settings || typeof settings.get !== 'function') throw new TypeError('[AudioManager] syncWithSettings needs a settings manager.');
    const read = (key) => { try { return settings.get(key); } catch { return undefined; } };
    const lv = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
    const v = read('volume'); if (lv(v)) this._volume = v;
    const s = read('sfxVolume'); if (lv(s)) this._sfx = s;
    const m = read('musicVolume'); if (lv(m)) this._music = m;
    const mu = read('muted'); if (typeof mu === 'boolean') this._muted = mu;
    this._applyLevels();
  }

  // ── Context lifecycle ────────────────────────────────────────────────────
  /**
   * Creates (once) and resumes the audio context. Call from a user gesture.
   * @returns {Promise<boolean>} whether audio is running
   */
  unlock() {
    if (!this.isSupported()) return Promise.resolve(false);
    if (!this._ctx) {
      try {
        this._ctx = new this._Ctx();
        this._buildGraph();
      } catch (e) {
        this._failed = true;
        this._ctx = null;
        console.warn('[AudioManager] Web Audio could not start:', e);
        return Promise.resolve(false);
      }
    }
    const ctx = this._ctx;
    if (ctx.state === 'running') { this._emit(); return Promise.resolve(true); }
    let p;
    try { p = ctx.resume?.(); } catch { p = null; }
    return Promise.resolve(p).then(() => { this._emit(); return ctx.state === 'running'; }, () => false);
  }

  /** Pauses all audio (the page is hidden). */
  suspend() {
    try { return Promise.resolve(this._ctx?.suspend?.()).then(() => true, () => false); } catch { return Promise.resolve(false); }
  }

  /** Resumes after suspend() — only if the user had already unlocked audio. */
  resume() {
    if (!this._ctx) return Promise.resolve(false);
    return this.unlock();
  }

  /** Closes the context; the manager can be unlocked again afterwards. */
  destroy() {
    const ctx = this._ctx;
    this._ctx = null;
    this._sfxBus = this._musicBus = this._master = null;
    this._voices = [];
    try { ctx?.close?.(); } catch { /* ignore */ }
  }

  // ── Playing ──────────────────────────────────────────────────────────────
  /**
   * Plays a sound effect.
   * @param {string} name a SoundLibrary name
   * @param {{ volume?: number, pan?: number, delay?: number, detune?: number }} [options]
   *   volume 0–1 (× the buses), pan −1 (left) … 1 (right), delay in seconds
   *   (scheduled on the audio clock — e.g. to land with an animation), detune in cents
   * @returns {{ played: true, duration: number } | { skipped: true, reason: string }}
   */
  play(name, { volume = 1, pan = 0, delay = 0, detune = 0 } = {}) {
    const recipe = this._library[name];
    if (typeof recipe !== 'function') throw new RangeError(`[AudioManager] unknown sound "${name}".`);
    if (!this.isSupported()) return this._skip('unsupported');
    if (!this.isUnlocked()) return this._skip('locked');
    if (this._muted || this._volume === 0 || this._sfx === 0 || volume <= 0) return this._skip('muted');
    const t = this._now();
    const last = this._lastPlayed.get(name);
    if (last !== undefined && t - last < this._minGapMs && delay === 0) return this._skip('throttled');
    const ctx = this._ctx;
    const when = ctx.currentTime + Math.max(0, Number(delay) || 0);
    this._voices = this._voices.filter((end) => end > ctx.currentTime);
    if (this._voices.length >= this._maxVoices) return this._skip('busy');

    let chainHead;
    try {
      const g = ctx.createGain();
      g.gain.value = Math.min(1, Math.max(0, volume));
      chainHead = g;
      if (pan && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p);
        p.connect(this._sfxBus);
      } else {
        g.connect(this._sfxBus);
      }
      const duration = recipe(ctx, g, { when, volume: 1, detune, random: this._random });
      const length = Number.isFinite(duration) && duration > 0 ? duration : 0.1;
      this._voices.push(when + length);
      this._lastPlayed.set(name, t);
      this._stats.played++;
      return { played: true, duration: length };
    } catch (e) {
      try { chainHead?.disconnect?.(); } catch { /* ignore */ }
      return this._skip('error');
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────
  /** @private */
  _buildGraph() {
    const ctx = this._ctx;
    this._master = ctx.createGain();
    this._sfxBus = ctx.createGain();
    this._musicBus = ctx.createGain();
    this._sfxBus.connect(this._master);
    this._musicBus.connect(this._master);
    this._master.connect(ctx.destination);
    this._master.gain.value = this._muted ? 0 : this._volume;
    this._sfxBus.gain.value = this._sfx;
    this._musicBus.gain.value = this._music;
  }

  /** @private — glides the bus gains to the current levels (no clicks). */
  _applyLevels() {
    if (this._ctx && this._master) {
      const t = this._ctx.currentTime;
      const set = (param, v) => {
        try { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, 0.02); } catch { param.value = v; }
      };
      set(this._master.gain, this._muted ? 0 : this._volume);
      set(this._sfxBus.gain, this._sfx);
      set(this._musicBus.gain, this._music);
    }
    this._emit();
  }

  /** @private */
  _emit() {
    const state = { volume: this._volume, sfxVolume: this._sfx, musicVolume: this._music, muted: this._muted, unlocked: this.isUnlocked() };
    for (const fn of [...this._listeners]) { try { fn(state); } catch { /* a listener can't break audio */ } }
  }

  /** @private */
  _skip(reason) {
    this._stats.skipped[reason] = (this._stats.skipped[reason] ?? 0) + 1;
    return { skipped: true, reason };
  }
}
