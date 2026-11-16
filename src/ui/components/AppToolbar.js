/**
 * AppToolbar.js — Tasks 110–111: the small always-there controls at the top
 * right of every screen (menus and the table alike): Sound on / off and
 * (Task 111) Fullscreen. It lives OUTSIDE #app-root, so screen changes never
 * clear it; main.js mounts it once.
 *
 *   const bar = renderAppToolbar(container, {
 *     sound: { isMuted(), setMuted(muted), subscribe?(fn) → unsubscribe },
 *     fullscreen: { isSupported(), isActive(), toggle(), subscribe?(fn) → unsubscribe },   // optional
 *     doc,                                                                               // keyboard shortcuts target
 *   });
 *   bar.update(); bar.destroy();
 *
 * Buttons are toggle buttons (aria-pressed) with an icon and a visually
 * hidden label; their titles name the keyboard shortcuts — M (mute) and
 * F (fullscreen) — which work anywhere except while typing in a field.
 * The fullscreen button is left out when the browser can't do it (iPhone
 * Safari has no element fullscreen).
 */
import { h, assertContainer } from './_screenKit.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A 24×24 stroke icon from path data. */
function icon(paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'app-toolbar-icon');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

export const ICONS = Object.freeze({
  soundOn: ['M4 9v6h4l5 4V5L8 9H4z', 'M16 8.5a5 5 0 0 1 0 7', 'M18.5 6a8.5 8.5 0 0 1 0 12'],
  soundOff: ['M4 9v6h4l5 4V5L8 9H4z', 'M16.5 9.5l5 5', 'M21.5 9.5l-5 5'],
  enterFullscreen: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  exitFullscreen: ['M9 4v5H4', 'M15 4v5h5', 'M9 20v-5H4', 'M15 20v-5h5'],
});

/** True when a key press is meant for a text field, not for us. */
function typing(target) {
  const tag = target?.tagName?.toUpperCase?.();
  return tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(String(target.type).toLowerCase())
    || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true;
}

export function renderAppToolbar(container, { sound = null, fullscreen = null, doc = typeof document !== 'undefined' ? document : null } = {}) {
  assertContainer(container, 'AppToolbar');
  container.innerHTML = '';
  container.classList.add('app-toolbar');
  container.setAttribute('role', 'toolbar');
  container.setAttribute('aria-label', 'Sound and display');
  const subs = [];
  let soundBtn = null;
  let fsBtn = null;

  if (sound) {
    soundBtn = h('button', 'app-toolbar-btn app-toolbar-btn--sound');
    soundBtn.type = 'button';
    soundBtn.addEventListener('click', () => { sound.setMuted(!sound.isMuted()); update(); });
    container.appendChild(soundBtn);
    if (typeof sound.subscribe === 'function') subs.push(sound.subscribe(() => update()));
  }
  if (fullscreen && fullscreen.isSupported()) {
    fsBtn = h('button', 'app-toolbar-btn app-toolbar-btn--fullscreen');
    fsBtn.type = 'button';
    fsBtn.addEventListener('click', () => { Promise.resolve(fullscreen.toggle()).then(update, update); });
    container.appendChild(fsBtn);
    if (typeof fullscreen.subscribe === 'function') subs.push(fullscreen.subscribe(() => update()));
  }

  /**
   * Updates a button IN PLACE, and only when its state changed. Rebuilding its
   * children on every notification once swallowed the first click: the first
   * pointerdown unlocks audio, AudioManager notifies, and replacing the icon
   * between pointerdown and click made Chrome drop the click (the pressed
   * element was gone). The icon also ignores the pointer (app-toolbar.css).
   */
  function setButton(btn, { pressed, iconPaths, label, title }) {
    const key = `${pressed}|${label}`;
    if (btn.dataset.state === key) return;
    btn.dataset.state = key;
    let svg = btn.querySelector('.app-toolbar-icon');
    let lab = btn.querySelector('.app-toolbar-label');
    if (!svg) { svg = icon([]); btn.appendChild(svg); }
    if (!lab) { lab = h('span', 'app-toolbar-label', ''); btn.appendChild(lab); }
    const paths = svg.querySelectorAll('path');
    iconPaths.forEach((d, i) => {
      let p = paths[i];
      if (!p) { p = document.createElementNS(SVG_NS, 'path'); svg.appendChild(p); }
      p.setAttribute('d', d);
    });
    for (let i = iconPaths.length; i < paths.length; i++) paths[i].remove();
    lab.textContent = label;
    btn.setAttribute('aria-pressed', String(pressed));
    btn.title = title;
  }

  function update() {
    if (soundBtn) {
      const muted = !!sound.isMuted();
      setButton(soundBtn, { pressed: muted, iconPaths: muted ? ICONS.soundOff : ICONS.soundOn, label: muted ? 'Sound off' : 'Sound on', title: `${muted ? 'Unmute' : 'Mute'} (M)` });
    }
    if (fsBtn) {
      const on = !!fullscreen.isActive();
      setButton(fsBtn, { pressed: on, iconPaths: on ? ICONS.exitFullscreen : ICONS.enterFullscreen, label: on ? 'Exit fullscreen' : 'Fullscreen', title: `${on ? 'Exit fullscreen' : 'Fullscreen'} (F)` });
    }
  }

  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    const k = String(e.key).toLowerCase();
    if (k === 'm' && soundBtn) { e.preventDefault?.(); soundBtn.click(); }
    else if (k === 'f' && fsBtn) { e.preventDefault?.(); fsBtn.click(); }
  };
  doc?.addEventListener?.('keydown', onKey);

  update();
  return {
    element: container,
    update,
    destroy() {
      doc?.removeEventListener?.('keydown', onKey);
      for (const off of subs) { try { off?.(); } catch { /* ignore */ } }
      container.innerHTML = '';
    },
  };
}
