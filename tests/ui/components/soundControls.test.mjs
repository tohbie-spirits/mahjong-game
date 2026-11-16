/**
 * soundControls.test.mjs — Task 110 (and Task 111's fullscreen button):
 * src/ui/components/AppToolbar.js and the Sound group of SettingsMenu.js, on
 * the fake DOM with the real SettingsManager and AudioManager.
 *
 * Sections:
 *   1. The toolbar's Sound button — state, click toggles, aria-pressed, icon + label, follows outside changes
 *   2. Keyboard — M mutes / unmutes, F fullscreen; ignored while typing or with modifiers
 *   3. The Fullscreen button — only when supported; reflects the state
 *   4. SettingsMenu — Volume / Sound effects / Music sliders + Mute write through to settings and AudioManager
 *   5. SettingsMenu — the Fullscreen row (only when supported)
 *   6. destroy — listeners removed
 *
 * Run: node tests/ui/components/soundControls.test.mjs
 */
import { section, sectionAsync, assert, summary } from '../../_helpers/harness.mjs';
import { installFakeDom } from '../../_helpers/fakeDom.mjs';

const { document, fire } = installFakeDom();
const { renderAppToolbar, ICONS } = await import('../../../src/ui/components/AppToolbar.js');
const { renderSettingsMenu } = await import('../../../src/ui/components/SettingsMenu.js');
const { StorageManager } = await import('../../../src/persistence/StorageManager.js');
const { SettingsManager, SETTING_KEYS } = await import('../../../src/persistence/SettingsManager.js');
const { AudioManager } = await import('../../../src/audio/AudioManager.js');

function settingsManager() {
  const store = new Map();
  const backend = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
  return new SettingsManager(new StorageManager({ storage: backend }));
}
function soundFor(audio, settings) {
  return { isMuted: () => audio.isMuted(), setMuted: (m) => { settings.set('muted', m); audio.setMuted(m); }, subscribe: (fn) => audio.onChange(fn) };
}
const host = () => { const d = document.createElement('div'); document.body.appendChild(d); return d; };
const paths = (btn) => btn.querySelectorAll('path').map((p) => p.getAttribute('d')).join('|');
const key = (k, extra = {}) => document.dispatchEvent({ type: 'keydown', key: k, target: document.body, preventDefault() { this.defaultPrevented = true; }, ...extra });

// ---------------------------------------------------------------------------
section('1. The Sound button', () => {
  const settings = settingsManager();
  const audio = new AudioManager({ AudioContextClass: null });
  const bar = renderAppToolbar(host(), { sound: soundFor(audio, settings), doc: document });
  const btn = bar.element.querySelector('.app-toolbar-btn--sound');
  assert(bar.element.classList.contains('app-toolbar') && bar.element.getAttribute('role') === 'toolbar', 'a toolbar');
  assert(btn && btn.getAttribute('aria-pressed') === 'false' && btn.querySelector('.app-toolbar-label').textContent === 'Sound on' && btn.title === 'Mute (M)', 'sound on: not pressed, labelled, the shortcut in its title');
  assert(paths(btn) === ICONS.soundOn.join('|'), 'the speaker-with-waves icon');
  btn.click();
  assert(audio.isMuted() && settings.get('muted') === true, 'click → muted, and the setting is saved');
  assert(btn.getAttribute('aria-pressed') === 'true' && paths(btn) === ICONS.soundOff.join('|') && btn.title === 'Unmute (M)', 'pressed, crossed-out speaker, "Unmute"');
  btn.click();
  assert(!audio.isMuted() && settings.get('muted') === false && btn.getAttribute('aria-pressed') === 'false', 'click again → sound on');
  audio.setMuted(true); // e.g. from the Settings screen
  assert(btn.getAttribute('aria-pressed') === 'true', 'follows changes made elsewhere (AudioManager#onChange)');
  // Regression (found by the browser smoke): the first pointerdown unlocks audio, which notifies the
  // toolbar; rebuilding the icon between pointerdown and click made Chrome drop that first click.
  const svg = btn.querySelector('svg'); const path0 = btn.querySelector('path');
  audio.setVolume(0.5); // a notification that changes nothing the button shows
  assert(btn.querySelector('svg') === svg && btn.querySelector('path') === path0, 'a notification that changes nothing leaves the button\'s elements untouched');
  btn.click();
  assert(btn.querySelector('svg') === svg && paths(btn) === ICONS.soundOn.join('|'), 'a real change updates the icon in place (same element, new paths)');
  bar.destroy();
});

// ---------------------------------------------------------------------------
section('2. Keyboard', () => {
  const settings = settingsManager();
  const audio = new AudioManager({ AudioContextClass: null });
  let fsToggles = 0;
  const fs = { isSupported: () => true, isActive: () => fsToggles % 2 === 1, toggle: () => { fsToggles++; } };
  const bar = renderAppToolbar(host(), { sound: soundFor(audio, settings), fullscreen: fs, doc: document });
  key('m');
  assert(audio.isMuted(), 'M mutes');
  key('M');
  assert(!audio.isMuted(), 'M (with Shift / caps) unmutes');
  key('f');
  assert(fsToggles === 1, 'F toggles fullscreen');
  const input = document.createElement('input'); input.type = 'text';
  key('m', { target: input });
  assert(!audio.isMuted(), 'ignored while typing in a text field');
  const range = document.createElement('input'); range.type = 'range';
  key('m', { target: range });
  assert(audio.isMuted(), '…but not on a slider (no text there)');
  key('m', { ctrlKey: true });
  assert(audio.isMuted(), 'Ctrl+M / Cmd+M are left to the browser');
  key('m', { defaultPrevented: true });
  assert(audio.isMuted(), 'a key another handler already took is ignored');
  bar.destroy();
  key('m');
  assert(audio.isMuted(), 'after destroy the shortcut is gone');
});

// ---------------------------------------------------------------------------
await sectionAsync('3. The Fullscreen button', async () => {
  let active = false; const listeners = new Set();
  const fs = { isSupported: () => true, isActive: () => active, toggle: () => { active = !active; listeners.forEach((f) => f()); return Promise.resolve(); }, subscribe: (f) => { listeners.add(f); return () => listeners.delete(f); } };
  const bar = renderAppToolbar(host(), { fullscreen: fs, doc: document });
  const btn = bar.element.querySelector('.app-toolbar-btn--fullscreen');
  assert(btn && bar.element.querySelector('.app-toolbar-btn--sound') === null, 'only the controls that were given');
  assert(btn.getAttribute('aria-pressed') === 'false' && btn.title === 'Fullscreen (F)' && paths(btn) === ICONS.enterFullscreen.join('|'), 'enter-fullscreen state');
  btn.click();
  await Promise.resolve(); await Promise.resolve();
  assert(active && btn.getAttribute('aria-pressed') === 'true' && btn.title === 'Exit fullscreen (F)' && paths(btn) === ICONS.exitFullscreen.join('|'), 'active → the exit icon');
  active = false; listeners.forEach((f) => f()); // Esc pressed: the browser left fullscreen
  assert(btn.getAttribute('aria-pressed') === 'false', 'follows the browser leaving fullscreen (Esc)');
  bar.destroy();
  assert(listeners.size === 0, 'destroy unsubscribes');
  const bar2 = renderAppToolbar(host(), { fullscreen: { isSupported: () => false, isActive: () => false, toggle() {} }, doc: document });
  assert(bar2.element.querySelector('.app-toolbar-btn--fullscreen') === null, 'unsupported (iPhone Safari) → no Fullscreen button');
  bar2.destroy();
});

// ---------------------------------------------------------------------------
section('4. SettingsMenu — Sound', () => {
  const settings = settingsManager();
  const audio = new AudioManager({ AudioContextClass: null });
  const changes = [];
  const box = host();
  renderSettingsMenu(box, settings, { onSettingChange: (k, v) => { changes.push([k, v]); audio.syncWithSettings(settings); }, onBack: () => {} });
  const ids = box.querySelectorAll('input').filter((i) => i.type === 'range').map((i) => i.id);
  assert(ids.join() === 'settings-volume,settings-sfx-volume,settings-music-volume', `three sliders: master (same id as before), effects, music (${ids})`);
  const labels = box.querySelectorAll('.settings-row-label').map((l) => l.textContent);
  assert(labels.join('|') === 'Theme|Animations|Hints|Volume|Sound effects|Music|Mute all', `rows ${labels.join(' · ')}`);
  assert(box.querySelector('.settings-group-title').textContent === 'Sound', 'a Sound heading');
  const sfx = box.querySelector('#settings-sfx-volume');
  assert(sfx.value === '0.8' && sfx.getAttribute('aria-valuetext') === '80%', 'effects slider starts at the default 80%');
  sfx.value = '0.25'; fire(sfx, 'input');
  const readout = sfx.parent.querySelector('.settings-volume-readout');
  assert(settings.get('sfxVolume') === 0.25 && audio.getSfxVolume() === 0.25 && readout.textContent === '25%' && sfx.getAttribute('aria-valuenow') === '0.25', 'moving it writes the setting, the readout and the audio level');
  const mus = box.querySelector('#settings-music-volume');
  mus.value = '0'; fire(mus, 'change');
  assert(settings.get('musicVolume') === 0 && audio.getMusicVolume() === 0, 'music to 0');
  const mute = box.querySelector('.settings-row--mute .settings-toggle-checkbox');
  mute.checked = true; fire(mute, 'change');
  assert(settings.get('muted') === true && audio.isMuted() && box.querySelector('.settings-row--mute .settings-toggle-status').textContent === 'Muted', 'Mute all');
  assert(changes.map((c) => c[0]).join() === 'sfxVolume,musicVolume,muted', 'onSettingChange reports each key');
  const anim = box.querySelector('.settings-row--animations .settings-toggle-checkbox');
  anim.checked = false; fire(anim, 'change');
  assert(settings.get(SETTING_KEYS.ANIMATIONS_ENABLED) === false, 'the Animations toggle still works');
  const box2 = host();
  renderSettingsMenu(box2, settings, {});
  assert(box2.querySelector('.settings-row--mute .settings-toggle-checkbox').checked === true && box2.querySelector('#settings-music-volume').value === '0', 'reopened: shows the saved values');
});

// ---------------------------------------------------------------------------
await sectionAsync('5. SettingsMenu — Fullscreen', async () => {
  const settings = settingsManager();
  let active = false;
  const box = host();
  renderSettingsMenu(box, settings, { fullscreen: { isSupported: () => true, isActive: () => active, toggle: () => { active = !active; return Promise.resolve(); } } });
  const cb = box.querySelector('.settings-row--fullscreen .settings-toggle-checkbox');
  assert(cb && cb.checked === false, 'a Fullscreen row when supported');
  cb.checked = true; fire(cb, 'change');
  await Promise.resolve(); await Promise.resolve();
  assert(active && cb.checked && box.querySelector('.settings-row--fullscreen .settings-toggle-status').textContent === 'On', 'switching it enters fullscreen');
  assert(Object.keys(settings.getAll()).every((k) => k !== 'fullscreen'), 'fullscreen is not a stored setting (the browser owns it)');
  const box2 = host();
  renderSettingsMenu(box2, settings, { fullscreen: { isSupported: () => false, isActive: () => false, toggle() {} } });
  assert(box2.querySelector('.settings-row--fullscreen') === null, 'unsupported → no row');
});

// ---------------------------------------------------------------------------
section('6. destroy', () => {
  const audio = new AudioManager({ AudioContextClass: null });
  const before = document._listeners.get('keydown')?.size ?? 0;
  const bar = renderAppToolbar(host(), { sound: soundFor(audio, settingsManager()), doc: document });
  assert((document._listeners.get('keydown')?.size ?? 0) === before + 1, 'one keydown listener while mounted');
  bar.destroy();
  assert((document._listeners.get('keydown')?.size ?? 0) === before && bar.element.children.length === 0, 'destroy removes it and empties the toolbar');
});

summary();
