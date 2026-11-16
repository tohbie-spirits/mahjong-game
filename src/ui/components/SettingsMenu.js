/**
 * SettingsMenu.js — renderSettingsMenu(container, settingsManager, options)
 * (Task 63): Theme radios, Volume slider with % readout, Animations toggle.
 * Every change writes through immediately (settingsManager.set) and then
 * calls options.onSettingChange(key, value). "Done" only with options.onBack.
 * REBUILT (after Task 77).
 *
 * Task 110: a "Sound" group — Volume (the master level, unchanged id
 * `settings-volume`), Sound effects and Music sliders, and a Mute toggle.
 * The sliders and toggles share one builder each. Order: Theme, Animations,
 * then the sound group.
 * Task 111: options.fullscreen ({ isSupported(), isActive(), toggle() }) adds
 * a Fullscreen row (not a stored setting — the browser owns that state).
 */
import { h, button, assertContainer } from './_screenKit.js';
import { SETTING_KEYS } from '../../persistence/SettingsManager.js';
import { THEME } from '../../utils/constants.js';

export function renderSettingsMenu(container, settingsManager, options = {}) {
  assertContainer(container, 'SettingsMenu');
  if (!settingsManager || ['get', 'set', 'reset'].some((m) => typeof settingsManager[m] !== 'function')) {
    throw new TypeError('[SettingsMenu] settingsManager must be a SettingsManager.');
  }
  const changed = (key, value) => {
    settingsManager.set(key, value);
    options.onSettingChange?.(key, value);
  };
  container.innerHTML = '';
  const card = h('div', 'settings-menu');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Settings');
  card.appendChild(h('h1', 'settings-menu-title', 'Settings'));

  // Theme
  const themeRow = h('div', 'settings-row settings-row--theme');
  themeRow.appendChild(h('span', 'settings-row-label', 'Theme'));
  const group = h('div', 'settings-radio-group');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Theme');
  const current = settingsManager.get(SETTING_KEYS.THEME);
  for (const [value, label] of [[THEME.DARK, 'Dark'], [THEME.LIGHT, 'Light']]) {
    const l = h('label', 'settings-radio-label');
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'settings-theme'; input.value = value; input.checked = current === value;
    input.addEventListener('change', () => { if (input.checked) changed(SETTING_KEYS.THEME, value); });
    l.append(input, document.createTextNode(` ${label}`));
    group.appendChild(l);
  }
  themeRow.appendChild(group);
  card.appendChild(themeRow);

  // Animations
  card.appendChild(_toggleRow({ key: SETTING_KEYS.ANIMATIONS_ENABLED, label: 'Animations', on: 'Enabled', off: 'Disabled', modifier: 'animations', settingsManager, changed }));

  // Task 116: Hints (the in-game Hint button)
  card.appendChild(_toggleRow({ key: SETTING_KEYS.HINTS, label: 'Hints', on: 'Shown', off: 'Hidden', modifier: 'hints', settingsManager, changed }));

  // Task 111: Fullscreen (when the browser supports it)
  const fs = options.fullscreen;
  if (fs && typeof fs.isSupported === 'function' && fs.isSupported()) {
    card.appendChild(_toggleRow({
      label: 'Fullscreen', on: 'On', off: 'Off', modifier: 'fullscreen',
      read: () => !!fs.isActive(),
      write: (cb, status) => { Promise.resolve(fs.toggle()).then(() => { cb.checked = !!fs.isActive(); status.textContent = cb.checked ? 'On' : 'Off'; }, () => { cb.checked = !!fs.isActive(); }); },
    }));
  }

  // Task 110: Sound
  card.appendChild(h('h2', 'settings-group-title', 'Sound'));
  card.appendChild(_sliderRow({ key: SETTING_KEYS.VOLUME, id: 'settings-volume', label: 'Volume', modifier: 'volume', settingsManager, changed }));
  card.appendChild(_sliderRow({ key: SETTING_KEYS.SFX_VOLUME, id: 'settings-sfx-volume', label: 'Sound effects', modifier: 'sfx', settingsManager, changed }));
  card.appendChild(_sliderRow({ key: SETTING_KEYS.MUSIC_VOLUME, id: 'settings-music-volume', label: 'Music', modifier: 'music', settingsManager, changed }));
  card.appendChild(_toggleRow({ key: SETTING_KEYS.MUTED, label: 'Mute all', on: 'Muted', off: 'Off', modifier: 'mute', settingsManager, changed }));

  if (typeof options.onBack === 'function') card.appendChild(button('settings-menu-done', 'Done', () => options.onBack()));
  container.appendChild(card);
  return card;
}

/** A 0–1 slider with a % readout, written through on every move. @private */
function _sliderRow({ key, id, label, modifier, settingsManager, changed }) {
  const row = h('div', `settings-row settings-row--${modifier}`);
  const lab = h('label', 'settings-row-label', label);
  lab.htmlFor = id;
  const slider = document.createElement('input');
  slider.type = 'range'; slider.id = id; slider.className = 'settings-volume-slider';
  slider.min = '0'; slider.max = '1'; slider.step = '0.05';
  const v0 = settingsManager.get(key);
  slider.value = String(v0);
  slider.setAttribute('aria-valuenow', String(v0));
  slider.setAttribute('aria-valuetext', `${Math.round(v0 * 100)}%`);
  const readout = h('span', 'settings-volume-readout', `${Math.round(v0 * 100)}%`);
  const onInput = () => {
    const v = Number(slider.value);
    readout.textContent = `${Math.round(v * 100)}%`;
    slider.setAttribute('aria-valuenow', String(v));
    slider.setAttribute('aria-valuetext', `${Math.round(v * 100)}%`);
    changed(key, v);
  };
  slider.addEventListener('input', onInput);
  slider.addEventListener('change', onInput);
  const ctl = h('div', 'settings-volume');
  ctl.append(slider, readout);
  row.append(lab, ctl);
  return row;
}

/**
 * An on / off switch. Either a stored setting (key + settingsManager) or a
 * custom read() / write(checkbox, statusEl) pair (Fullscreen). @private
 */
function _toggleRow({ key, label, on, off, modifier, settingsManager, changed, read, write }) {
  const row = h('div', `settings-row settings-row--${modifier}`);
  row.appendChild(h('span', 'settings-row-label', label));
  const toggle = h('label', 'settings-toggle');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.className = 'settings-toggle-checkbox';
  cb.checked = read ? read() : settingsManager.get(key);
  cb.setAttribute('aria-label', label);
  const track = h('span', 'settings-toggle-track');
  const status = h('span', 'settings-toggle-status', cb.checked ? on : off);
  cb.addEventListener('change', () => {
    status.textContent = cb.checked ? on : off;
    if (write) write(cb, status);
    else changed(key, cb.checked);
  });
  toggle.append(cb, track, status);
  row.appendChild(toggle);
  return row;
}
