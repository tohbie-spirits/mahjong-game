/**
 * musicPlayer.test.mjs — Task 110: src/audio/MusicPlayer.js (generative
 * background music) on a real AudioManager over the recording fake
 * AudioContext, driven by a fake clock.
 *
 * Sections:
 *   1. Composition — every note in C major pentatonic; bass + pad on each bar; the melody's range; deterministic per seed
 *   2. Look-ahead scheduling — notes are scheduled just ahead of the audio clock, never behind it
 *   3. Waiting — nothing before unlock; starts on the first tick after it
 *   4. Silence costs nothing — muted / music volume 0 → no notes scheduled, the place is kept
 *   5. Tracks — the table is busier than the menu; switching cross-fades; same track = no-op; stop
 *   6. Catching up — after the page was hidden, no burst of missed notes; a new context restarts cleanly
 *
 * Run: node tests/audio/musicPlayer.test.mjs
 */
import { section, sectionAsync, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { makeFakeAudio, reaches } from '../_helpers/fakeAudio.mjs';

const { AudioManager } = await import('../../src/audio/AudioManager.js');
const { MusicPlayer, MUSIC_TRACKS, composeStep, MELODY_NOTES } = await import('../../src/audio/MusicPlayer.js');

const PENTA = new Set([0, 2, 4, 7, 9]);
const seeded = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
function timers() {
  const t = { fns: new Map(), next: 1 };
  t.set = (fn) => { const id = t.next++; t.fns.set(id, fn); return id; };
  t.clear = (id) => t.fns.delete(id);
  return t;
}
async function setup(opts = {}) {
  const { FakeAudioContext, contexts } = makeFakeAudio();
  const audio = new AudioManager({ AudioContextClass: FakeAudioContext, ...opts.audio });
  const tm = timers();
  const music = new MusicPlayer({ audio, setInterval: tm.set, clearInterval: tm.clear, seed: 7, fadeOut: 0.01, ...opts.music });
  return { audio, music, tm, contexts };
}
const oscs = (ctx) => ctx.nodes.filter((n) => n.kind === 'osc');

// ---------------------------------------------------------------------------
section('1. Composition', () => {
  for (const [name, track] of Object.entries(MUSIC_TRACKS)) {
    const r = seeded(1);
    const state = {};
    const notes = [];
    for (let step = 0; step < 64; step++) notes.push(...composeStep(track, step, state, r).map((n) => ({ ...n, step })));
    assert(notes.every((n) => PENTA.has(n.midi % 12)), `${name}: every note is in C major pentatonic (${notes.length} notes in 8 bars)`);
    const bars = [...Array(8).keys()];
    assert(bars.every((b) => notes.some((n) => n.step === b * 8 && n.kind === 'bass') && notes.filter((n) => n.step === b * 8 && n.kind === 'pad').length === 3), `${name}: every bar opens with bass + a three-note pad`);
    const plucks = notes.filter((n) => n.kind === 'pluck');
    assert(plucks.length > 0 && plucks.every((n) => n.midi >= 67 && n.midi <= 96), `${name}: the melody stays in its range (${plucks.length} plucks)`);
    assert(notes.every((n) => n.dur > 0 && n.level > 0 && n.level < 0.2 && n.at >= 0), `${name}: positive durations, quiet levels (background music)`);
    const leaps = plucks.slice(1).map((n, i) => Math.abs(MELODY_NOTES.indexOf(n.midi) - MELODY_NOTES.indexOf(plucks[i].midi)));
    assert(leaps.filter((l) => l <= 3).length / Math.max(1, leaps.length) > 0.7, `${name}: the melody mostly moves by step (a walk, not jumps)`);
  }
  const a = []; const b = [];
  const ra = seeded(5); const rb = seeded(5); const sa = {}; const sb = {};
  for (let s = 0; s < 32; s++) { a.push(...composeStep(MUSIC_TRACKS.table, s, sa, ra)); b.push(...composeStep(MUSIC_TRACKS.table, s, sb, rb)); }
  assert(JSON.stringify(a) === JSON.stringify(b), 'the same seed composes the same music');
  const rc = seeded(6); const sc = {}; const c = [];
  for (let s = 0; s < 32; s++) c.push(...composeStep(MUSIC_TRACKS.table, s, sc, rc));
  assert(JSON.stringify(a) !== JSON.stringify(c), 'another seed, another melody');
});

// ---------------------------------------------------------------------------
await sectionAsync('2. Look-ahead scheduling', async () => {
  const { audio, music, tm, contexts } = await setup();
  await audio.unlock();
  const ctx = contexts[0];
  music.play('table');
  assert(music.isRunning() && tm.fns.size === 1 && music.getTrack() === 'table', 'play starts one timer');
  const first = music.getScheduledCount();
  assert(first > 0, `the first tick schedules the opening notes (${first})`);
  const starts = () => oscs(ctx).map((o) => o.startedAt);
  assert(starts().every((t) => t >= ctx.currentTime && t <= ctx.currentTime + 0.35 + 0.1 + 2), 'nothing scheduled in the past; only the look-ahead window');
  for (let i = 0; i < 100; i++) { ctx.currentTime += 0.1; [...tm.fns.values()][0](); }
  const all = oscs(ctx);
  assert(all.length > first && all.every((o) => o.stoppedAt !== null && o.stoppedAt > o.startedAt), `10 s of music: ${all.length} oscillators, every one stopped after it starts (released)`);
  assert(Math.max(...all.map((o) => o.startedAt)) <= ctx.currentTime + 0.35 + 2.5, 'never scheduled far ahead (switching tracks stays responsive)');
  assert(all.every((o) => reaches(o, audio.getMusicBus())), 'every note goes through the music bus (Music volume / Mute apply)');
  const midi = all.map((o) => Math.round(69 + 12 * Math.log2(o.frequency.events[0].v / 440)));
  assert(midi.every((m) => PENTA.has(((m % 12) + 12) % 12)), 'what reaches the oscillators is still pentatonic');
});

// ---------------------------------------------------------------------------
await sectionAsync('3. Waiting for unlock', async () => {
  const { audio, music, tm, contexts } = await setup();
  music.play('menu');
  [...tm.fns.values()][0]();
  assert(contexts.length === 0 && music.getScheduledCount() === 0 && music.getTrack() === 'menu', 'before the first gesture: nothing created, nothing scheduled — the track waits');
  await audio.unlock();
  [...tm.fns.values()][0]();
  assert(music.getScheduledCount() > 0, 'the first tick after unlock starts the music');
  const fade = contexts[0].nodes.find((n) => n.kind === 'gain' && n.outputs.includes(audio.getMusicBus()));
  assert(fade && fade.gain.events.some((e) => e.kind === 'linear' && e.v === 1 && e.t > 1), 'it fades in');
});

// ---------------------------------------------------------------------------
await sectionAsync('4. Silence costs nothing', async () => {
  const { audio, music, tm, contexts } = await setup({ audio: { muted: true } });
  await audio.unlock();
  const ctx = contexts[0];
  music.play('table');
  for (let i = 0; i < 30; i++) { ctx.currentTime += 0.1; [...tm.fns.values()][0](); }
  assert(music.getScheduledCount() === 0, 'muted → no notes scheduled at all');
  audio.setMuted(false);
  for (let i = 0; i < 10; i++) { ctx.currentTime += 0.1; [...tm.fns.values()][0](); }
  assert(music.getScheduledCount() > 0, 'unmuted → music resumes');
  const n = music.getScheduledCount();
  audio.setMusicVolume(0);
  for (let i = 0; i < 30; i++) { ctx.currentTime += 0.1; [...tm.fns.values()][0](); }
  assert(music.getScheduledCount() === n, 'music volume 0 → nothing scheduled either');
  audio.setMusicVolume(0.5);
  for (let i = 0; i < 20; i++) { ctx.currentTime += 0.1; [...tm.fns.values()][0](); }
  assert(music.getScheduledCount() > n, 'and back');
});

// ---------------------------------------------------------------------------
await sectionAsync('5. Tracks', async () => {
  const count = async (track) => {
    const { audio, music, tm, contexts } = await setup();
    await audio.unlock();
    const ctx = contexts[0];
    music.play(track);
    for (let i = 0; i < 300; i++) { ctx.currentTime += 0.1; [...tm.fns.values()][0](); }
    return music.getScheduledCount();
  };
  const menu = await count('menu'); const table = await count('table');
  assert(table > menu * 1.3, `the table track is busier than the menu track (30 s: ${table} vs ${menu} notes)`);

  const { audio, music, tm, contexts } = await setup();
  await audio.unlock();
  const ctx = contexts[0];
  music.play('menu');
  const gainOf = () => ctx.nodes.filter((n) => n.kind === 'gain' && n.outputs.includes(audio.getMusicBus()));
  ctx.currentTime += 3; [...tm.fns.values()][0]();
  music.play('menu');
  assert(gainOf().length === 1, 'the same track again → no restart');
  music.play('table');
  const gains = gainOf();
  assert(gains.length === 2 && music.getTrack() === 'table', 'switching makes a new track gain');
  assert(gains[0].gain.events.some((e) => e.kind === 'linear' && e.v === 0.0001 && e.t > ctx.currentTime), '…and fades the old one out (cross-fade)');
  assert(tm.fns.size === 1, 'one timer, still');
  music.stop();
  assert(!music.isRunning() && tm.fns.size === 0 && music.getTrack() === null, 'stop: the timer is cleared');
  assert(gains[1].gain.events.some((e) => e.kind === 'linear' && e.v === 0.0001), 'stop fades out');
  assertThrows(() => music.play('disco'), RangeError, 'an unknown track throws');
  assertThrows(() => new MusicPlayer({}), TypeError, 'needs an AudioManager');
});

// ---------------------------------------------------------------------------
await sectionAsync('6. Catching up', async () => {
  const { audio, music, tm, contexts } = await setup();
  await audio.unlock();
  const ctx = contexts[0];
  music.play('table');
  for (let i = 0; i < 10; i++) { ctx.currentTime += 0.1; [...tm.fns.values()][0](); }
  const before = oscs(ctx).length;
  ctx.currentTime += 60; // a minute without ticks (tab in the background, timers throttled)
  [...tm.fns.values()][0]();
  const fresh = oscs(ctx).slice(before);
  assert(fresh.length < 25 && fresh.every((o) => o.startedAt >= ctx.currentTime), `no burst of missed notes — only the look-ahead window from now (${fresh.length} new)`);
  audio.destroy();
  await audio.unlock();
  const ctx2 = contexts[1];
  [...tm.fns.values()][0]();
  assert(ctx2 && oscs(ctx2).length > 0 && ctx2.nodes.some((n) => n.kind === 'gain' && n.outputs.includes(audio.getMusicBus())), 'a new audio context → the music restarts on it');
  music.destroy();
});

summary();
