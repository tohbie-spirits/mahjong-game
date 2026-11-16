/**
 * MainMenu.js
 *
 * renderMainMenu(container, options) — the first screen (Task 52). Items
 * appear only for the callbacks supplied: onContinue, onNewGame, onSettings,
 * onStatistics, onLeaderboard, onHowToPlay, onRuleReference. Continue
 * outranks New Game as the single primary action. At least one callback is
 * required. Adds `main-menu` to the container (the router resets it).
 *
 * REBUILT (after Task 77); `onLeaderboard` added during the rebuild.
 */

import { h, button, assertContainer } from './_screenKit.js';

const ITEMS = Object.freeze([
  ['onContinue', 'Continue'],
  ['onNewGame', 'New Game'],
  ['onSettings', 'Settings'],
  ['onStatistics', 'Statistics'],
  ['onLeaderboard', 'Leaderboard'],
  ['onHowToPlay', 'How to Play'],
  ['onRuleReference', 'Rule Reference'],
]);

export function renderMainMenu(container, options = {}) {
  assertContainer(container, 'MainMenu');
  const present = ITEMS.filter(([key]) => typeof options[key] === 'function');
  if (present.length === 0) throw new TypeError('[MainMenu] at least one menu callback is required.');
  container.innerHTML = '';
  container.classList.add('main-menu');

  const header = h('header', 'main-menu-header');
  header.appendChild(h('div', 'main-menu-emblem', '麻'));
  header.appendChild(h('h1', 'main-menu-title', options.title ?? 'Mahjong'));
  if (options.tagline) header.appendChild(h('p', 'main-menu-tagline', options.tagline));
  container.appendChild(header);

  const nav = h('nav', 'main-menu-items');
  nav.setAttribute('aria-label', 'Main menu');
  const primaryKey = typeof options.onContinue === 'function' ? 'onContinue' : typeof options.onNewGame === 'function' ? 'onNewGame' : null;
  for (const [key, label] of present) {
    const cls = `main-menu-item${key === primaryKey ? ' main-menu-item--primary' : ''}`;
    const b = button(cls, label, () => options[key]());
    b.dataset.action = key;
    nav.appendChild(b);
  }
  container.appendChild(nav);
  if (options.version) container.appendChild(h('footer', 'main-menu-version', `v${options.version}`));
  try { nav.querySelector('.main-menu-item--primary, .main-menu-item')?.focus(); } catch { /* headless */ }
  return container;
}
