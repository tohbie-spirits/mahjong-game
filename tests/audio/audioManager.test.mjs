/**
 * audioManager.test.mjs — Task 108: src/audio/AudioManager.js and
 * src/audio/SoundLibrary.js against a recording fake AudioContext
 * (tests/_helpers/fakeAudio.mjs). What is heard is checked by ear in the
 * browser; this checks everything that can be checked without speakers.
 *
 * Sections:
 *   1. The library — every recipe schedules sound only within [when, when + duration], reaches its output, stops every source
 *   2. Before unlock — nothing plays ('locked'); unsupported / failing Web Audio
 *   3. unlock — one context, resumed, the bus graph master ← sfx / music → destination
 *   4. play — per-play gain, stereo pan, delay on the audio clock; unknown names throw
 *   5. Levels — volume / sfx / music / mute glide the bus gains; validation; onChange
 *   6. Guards — muted / zero volume skip; throttling; the voice limit; a failing recipe
 *   7. Settings — syncWithSettings with the real SettingsManager (new keys, defaults, old saves)
 *   8. Lifecycle — suspend / resume / destroy; stats
 *
 * Run: node tests/audio/audioManager.test.mjs
 */
import { section, sectionAsync, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { makeFakeAudio, reaches } from '../_helpers/fakeAudio.mjs';

const { AudioManager, DEFAULT_SFX_VOLUME, DEFAULT_MUSIC_VOLUME } = await import('../../src/audio/AudioManager.js');
const { SOUND_LIBRARY, getSoundNames, SOUND_DESCRIPTIONS, noiseBuffer, midiToHz } = await import('../../src/audio/SoundLibrary.js');
const { StorageManager } = await import('../../src/persistence/StorageManager.js');
const { SettingsManager, SETTING_KEYS, DEFAULTS } = await import('../../src/persistence/SettingsManager.js');

// ---------------------------------------------------------------------------
section('1. The library', () => {
  const names = getSoundNames();
  const expected = ['discard', 'discard-soft', 'draw', 'claim-chi', 'claim-pon', 'claim-kong', 'riichi', 'flower', 'win', 'win-other', 'draw-game', 'turn', 'locked', 'ui-click'];
  assert(expected.every((n) => names.includes(n)), `the effects the game needs exist (${names.length} sounds)`);
  assert(names.every((n) => typeof SOUND_DESCRIPTIONS[n] === 'string'), 'every sound is described');
  assert(Object.isFrozen(SOUND_LIBRARY), 'the library is frozen');
  for (const name of names) {
    const { FakeAudioContext } = makeFakeAudio({ startState: 'running' });
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const when = 2;
    let duration;
    try { duration = SOUND_LIBRARY[name](ctx, out, { when, volume: 1, detune: 0, random: () => 0.5 }); } catch (e) { assert(false, `${name}: threw ${e.message}`); continue; }
    const sources = ctx.sources();
    const params = ctx.nodes.flatMap((n) => Object.values(n).filter((v) => v && Array.isArray(v.events)));
    const times = params.flatMap((p) => p.events.map((e) => e.t));
    const ok = Number.isFinite(duration) && duration > 0 && duration < 3
      && sources.length > 0
      && sources.every((s) => s.startedAt >= when && s.stoppedAt !== null && s.stoppedAt <= when + duration + 0.05)
      && sources.every((s) => reaches(s, out))
      && times.every((t) => t >= when && t <= when + duration + 0.05);
    assert(ok, `${name}: ${sources.length} sources, all within [when, when + ${duration?.toFixed(2)} s], every source stopped and reaching the output`);
  }
  const { FakeAudioContext } = makeFakeAudio();
  const ctx = new FakeAudioContext();
  assert(noiseBuffer(ctx) === noiseBuffer(ctx) && noiseBuffer(ctx).length === ctx.sampleRate, 'one second of noise, cached per context');
  const data = noiseBuffer(ctx).getChannelData(0);
  assert(Math.max(...data) <= 1 && Math.min(...data) >= -1 && new Set(data.slice(0, 100)).size > 90, 'noise in [−1, 1], not constant');
  assert(Math.abs(midiToHz(69) - 440) < 1e-9 && Math.abs(midiToHz(81) - 880) < 1e-9, 'midiToHz');
  // The tile clack varies a little each time (random), so repeated discards don't sound mechanical.
  const freqs = [0, 1].map((r) => { const c = new FakeAudioContext(); SOUND_LIBRARY.discard(c, c.createGain(), { when: 0, random: () => r }); return c.nodes.find((n) => n.kind === 'filter').frequency.events[0].v; });
  assert(freqs[0] !== freqs[1], `the clack's pitch varies with the random source (${freqs.map((f) => f.toFixed(0))})`);
});

// ---------------------------------------------------------------------------
await sectionAsync('2. Before unlock', async () => {
  const { FakeAudioContext, contexts } = makeFakeAudio();
  const a = new AudioManager({ AudioContextClass: FakeAudioContext });
  assert(a.isSupported() && !a.isUnlocked() && contexts.length === 0, 'supported, locked, no context created yet (autoplay rules)');
  const r = a.play('discard');
  assert(r.skipped && r.reason === 'locked' && contexts.length === 0, 'play before unlock → skipped "locked", still no context');
  const none = new AudioManager({ AudioContextClass: null });
  assert(!none.isSupported() && none.play('discard').reason === 'unsupported' && (await none.unlock()) === false, 'no Web Audio → unsupported; unlock resolves false');
  const { FakeAudioContext: Broken } = makeFakeAudio({ failConstruct: true });
  const warn = console.warn; console.warn = () => {};
  const b = new AudioManager({ AudioContextClass: Broken });
  const ok = await b.unlock();
  console.warn = warn;
  assert(ok === false && !b.isSupported() && b.play('draw').reason === 'unsupported', 'a context that fails to start → unsupported from then on, never throws');
});

// ---------------------------------------------------------------------------
await sectionAsync('3. unlock', async () => {
  const { FakeAudioContext, contexts } = makeFakeAudio();
  const a = new AudioManager({ AudioContextClass: FakeAudioContext, volume: 0.9, sfxVolume: 0.7, musicVolume: 0.2 });
  const ok = await a.unlock();
  const ctx = contexts[0];
  assert(ok && a.isUnlocked() && contexts.length === 1 && ctx.resumeCalls === 1, 'unlock creates the context and resumes it');
  await a.unlock();
  assert(contexts.length === 1, 'unlocking again reuses the context');
  const music = a.getMusicBus();
  const master = ctx.destination && ctx.nodes.find((n) => n.kind === 'gain' && n.outputs.includes(ctx.destination));
  const sfx = ctx.nodes.find((n) => n.kind === 'gain' && n !== music && n.outputs.includes(master));
  assert(master && master.gain.value === 0.9 && sfx.gain.value === 0.7 && music.gain.value === 0.2, 'master (volume) → speakers; sfx (0.7) and music (0.2) buses → master');
  assert(music.outputs.includes(master), 'the music bus feeds the master');
});

// ---------------------------------------------------------------------------
await sectionAsync('4. play', async () => {
  const { FakeAudioContext, contexts } = makeFakeAudio();
  const a = new AudioManager({ AudioContextClass: FakeAudioContext, random: () => 0.5 });
  await a.unlock();
  const ctx = contexts[0];
  ctx.currentTime = 10;
  const before = ctx.nodes.length;
  const r = a.play('discard', { volume: 0.5 });
  assert(r.played && r.duration > 0 && ctx.nodes.length > before, `played (${r.duration.toFixed(3)} s)`);
  const fresh = ctx.nodes.slice(before);
  const perPlay = fresh[0];
  const sfx = ctx.nodes.find((n) => n.kind === 'gain' && n.outputs.length && n !== a.getMusicBus() && n.outputs[0].outputs.includes(ctx.destination));
  assert(perPlay.kind === 'gain' && perPlay.gain.value === 0.5 && perPlay.outputs[0] === sfx, 'a per-play gain at the requested volume, into the sfx bus');
  assert(fresh.filter((n) => n.startedAt !== undefined && n.startedAt !== null).every((s) => s.startedAt >= 10 && reaches(s, ctx.destination)), 'its sources start now and reach the speakers');
  const b0 = ctx.nodes.length;
  a.play('draw', { pan: -0.6, delay: 0.25 });
  const pan = ctx.nodes.slice(b0).find((n) => n.kind === 'panner');
  assert(pan && pan.pan.value === -0.6 && pan.outputs[0] === sfx, 'pan → a stereo panner between the play gain and the bus');
  assert(ctx.nodes.slice(b0).filter((n) => n.startedAt != null).every((s) => s.startedAt >= 10.25), 'delay schedules on the audio clock (lands with an animation)');
  const b1 = ctx.nodes.length;
  a.play('flower', { pan: 5 });
  assert(ctx.nodes.slice(b1).find((n) => n.kind === 'panner').pan.value === 1, 'pan is clamped to [−1, 1]');
  assertThrows(() => a.play('nope'), RangeError, 'an unknown sound name throws (a programming error)');
  const noPan = new AudioManager({ AudioContextClass: class extends FakeAudioContext { constructor() { super(); this.createStereoPanner = undefined; } } });
  await noPan.unlock();
  assert(noPan.play('draw', { pan: 0.5 }).played, 'no StereoPannerNode (old Safari) → plays centred');
});

// ---------------------------------------------------------------------------
await sectionAsync('5. Levels', async () => {
  const { FakeAudioContext, contexts } = makeFakeAudio();
  const a = new AudioManager({ AudioContextClass: FakeAudioContext });
  const seen = [];
  const off = a.onChange((s) => seen.push(s));
  await a.unlock();
  const ctx = contexts[0];
  const master = ctx.nodes.find((n) => n.kind === 'gain' && n.outputs.includes(ctx.destination));
  a.setVolume(0.4);
  assert(master.gain.value === 0.4 && master.gain.events.some((e) => e.kind === 'target'), 'setVolume glides the master gain (setTargetAtTime — no click)');
  a.setMuted(true);
  assert(master.gain.value === 0 && a.isMuted() && a.getVolume() === 0.4, 'mute → master 0, the volume is kept');
  assert(a.toggleMute() === false && master.gain.value === 0.4, 'toggleMute → back to the volume');
  a.setSfxVolume(0.25); a.setMusicVolume(0.6);
  assert(a.getSfxVolume() === 0.25 && a.getMusicBus().gain.value === 0.6, 'sfx / music levels');
  assertThrows(() => a.setVolume(1.5), RangeError, 'volume > 1 throws');
  assertThrows(() => a.setMusicVolume(NaN), RangeError, 'NaN throws');
  assertThrows(() => a.setMuted('yes'), TypeError, 'setMuted needs a boolean');
  assertThrows(() => new AudioManager({ volume: -1, AudioContextClass: null }), RangeError, 'a bad level in the constructor throws');
  assert(seen.length >= 5 && seen.at(-1).musicVolume === 0.6 && seen.at(-1).unlocked === true, `onChange reports every change (${seen.length})`);
  off();
  const count = seen.length;
  a.setVolume(1);
  assert(seen.length === count, 'unsubscribed listeners hear nothing more');
  a.onChange(() => { throw new Error('bad listener'); });
  a.setVolume(0.5);
  assert(a.getVolume() === 0.5, 'a throwing listener can’t break audio');
  const pre = new AudioManager({ AudioContextClass: FakeAudioContext, muted: true, volume: 0.3 });
  pre.setVolume(0.6);
  await pre.unlock();
  const m2 = contexts.at(-1).nodes.find((n) => n.kind === 'gain' && n.outputs.includes(contexts.at(-1).destination));
  assert(m2.gain.value === 0, 'levels set before unlock are applied when the graph is built (muted → 0)');
});

// ---------------------------------------------------------------------------
await sectionAsync('6. Guards', async () => {
  const { FakeAudioContext, contexts } = makeFakeAudio();
  let clock = 0;
  const a = new AudioManager({ AudioContextClass: FakeAudioContext, now: () => clock, maxVoices: 3 });
  await a.unlock();
  const ctx = contexts[0];
  a.setMuted(true);
  const n0 = ctx.nodes.length;
  assert(a.play('win').reason === 'muted' && ctx.nodes.length === n0, 'muted → skipped without building any node');
  a.setMuted(false); a.setSfxVolume(0);
  assert(a.play('win').reason === 'muted', 'effects volume 0 → skipped');
  a.setSfxVolume(1);
  assert(a.play('turn', { volume: 0 }).reason === 'muted', 'a per-play volume of 0 → skipped');
  assert(a.play('discard').played && a.play('discard').reason === 'throttled', 'the same sound twice in one instant → the second is dropped');
  clock = 100;
  assert(a.play('discard').played, '…but plays again after the gap');
  assert(a.play('discard', { delay: 0.2 }).played, 'a delayed play is never throttled (several discards may land in sequence)');
  assert(a.play('win').reason === 'busy', 'more than maxVoices ringing at once → "busy"');
  ctx.currentTime = 5;
  assert(a.play('win').played, 'once they have finished, sounds play again');
  const bad = new AudioManager({ AudioContextClass: FakeAudioContext, library: { boom: () => { throw new Error('recipe bug'); } } });
  await bad.unlock();
  assert(bad.play('boom').reason === 'error', 'a recipe that throws → skipped "error", never thrown to the game');
});

// ---------------------------------------------------------------------------
section('7. Settings', () => {
  const store = new Map();
  const backend = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
  let settings;
  try { settings = new SettingsManager(new StorageManager({ storage: backend })); } catch { settings = new SettingsManager(new StorageManager(backend)); }
  assert(SETTING_KEYS.SFX_VOLUME === 'sfxVolume' && SETTING_KEYS.MUSIC_VOLUME === 'musicVolume' && SETTING_KEYS.MUTED === 'muted', 'new setting keys');
  assert(DEFAULTS.sfxVolume === DEFAULT_SFX_VOLUME && DEFAULTS.musicVolume === DEFAULT_MUSIC_VOLUME && DEFAULTS.muted === false, 'settings defaults match the audio defaults');
  assert(settings.get('muted') === false && settings.get('sfxVolume') === 0.8, 'a profile without them (an old save) reads the defaults');
  assertThrows(() => settings.set('musicVolume', 2), TypeError, 'invalid values are refused');
  settings.set('volume', 0.5); settings.set('sfxVolume', 0.3); settings.set('musicVolume', 0.1); settings.set('muted', true);
  const a = new AudioManager({ AudioContextClass: null });
  a.syncWithSettings(settings);
  assert(a.getVolume() === 0.5 && a.getSfxVolume() === 0.3 && a.getMusicVolume() === 0.1 && a.isMuted(), 'syncWithSettings reads all four');
  a.syncWithSettings({ get: (k) => { if (k === 'muted') throw new TypeError('unknown'); return k === 'volume' ? 'loud' : undefined; } });
  assert(a.getVolume() === 0.5 && a.isMuted(), 'unknown or invalid values are ignored');
  assertThrows(() => a.syncWithSettings(null), TypeError, 'needs a settings manager');
  assert(Object.keys(settings.getAll()).length === 7, 'getAll lists the seven settings (Task 116 added hints)');
});

// ---------------------------------------------------------------------------
await sectionAsync('8. Lifecycle', async () => {
  const { FakeAudioContext, contexts } = makeFakeAudio();
  const a = new AudioManager({ AudioContextClass: FakeAudioContext });
  assert((await a.resume()) === false && contexts.length === 0, 'resume before any unlock does nothing (no gesture yet)');
  await a.unlock();
  await a.suspend();
  assert(!a.isUnlocked() && a.play('draw').reason === 'locked', 'suspended (page hidden) → silent');
  assert((await a.resume()) === true && a.isUnlocked(), 'resume');
  a.play('draw');
  const st = a.getStats();
  assert(st.played === 1 && st.skipped.locked === 1, `stats ${JSON.stringify(st)}`);
  a.destroy();
  assert(contexts[0].closed && !a.isUnlocked() && a.getMusicBus() === null, 'destroy closes the context');
  await a.unlock();
  assert(contexts.length === 2 && a.isUnlocked(), 'and a new unlock starts a fresh one');
});

summary();
