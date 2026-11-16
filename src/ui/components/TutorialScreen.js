/**
 * TutorialScreen.js — Task 113: the interactive walkthrough ("How to Play").
 *
 *   const tut = renderTutorialScreen(container, {
 *     checkHand(hand) → boolean,               // is this hand complete? (main.js: the Hong Kong engine)
 *     scoreHand(hand, context) → { fan, meetsMinimum, breakdown },   // its value
 *     steps,                                   // default TUTORIAL_STEPS (src/ui/tutorial/TutorialSteps.js)
 *     initialStep, completed,                  // resume: step index, exercise ids already done
 *     onProgress({ step, completed }),         // after every move / solved exercise
 *     onFinish({ completed }),                 // the last step's buttons
 *     onPlay(), onRuleReference(), onExit(),
 *   });
 *   tut.goTo(i); tut.next(); tut.back(); tut.current(); tut.destroy();
 *
 * One step at a time: title, explanation, example hands drawn by
 * TileRenderer, and on most steps an exercise. The exercises that are about
 * the RULES (does this tile complete the hand? which discard leaves it ready?
 * may this hand win?) are judged by the real rule engine through checkHand /
 * scoreHand — the UI never imports a ruleset, and the tutorial can't teach
 * something the game disagrees with. Feedback explains, for right and wrong
 * answers alike; "Show answer" is always there; Next is never blocked.
 *
 * Tiles in exercises are buttons (Tab / Enter / Space); the feedback line is
 * an aria-live region; step dots let you jump around.
 */
import { h, button, assertContainer } from './_screenKit.js';
import { createTileElement } from '../TileRenderer.js';
import { Tile } from '../../core/Tile.js';
import { Hand } from '../../core/Hand.js';
import { TUTORIAL_STEPS, makeTiles, waitsOf, describeFaces, describeChow } from '../tutorial/TutorialSteps.js';

const labelOf = (faceId) => Tile.fromId(faceId, `${faceId}#label`).label;

export function renderTutorialScreen(container, options = {}) {
  assertContainer(container, 'TutorialScreen');
  const steps = Array.isArray(options.steps) && options.steps.length ? options.steps : TUTORIAL_STEPS;
  const checkHand = typeof options.checkHand === 'function' ? options.checkHand : null;
  const scoreHand = typeof options.scoreHand === 'function' ? options.scoreHand : null;
  const needsEngine = steps.some((s) => ['complete', 'discard', 'can-win'].includes(s.exercise?.kind));
  if (needsEngine && (!checkHand || !scoreHand)) throw new TypeError('[TutorialScreen] checkHand and scoreHand are required (the rule engine judges the exercises).');

  const completed = new Set(Array.isArray(options.completed) ? options.completed : []);
  let index = Number.isInteger(options.initialStep) ? Math.max(0, Math.min(steps.length - 1, options.initialStep)) : 0;
  let seq = 0;
  const isCompleteIds = (ids) => !!checkHand(new Hand(makeTiles(Tile, ids, `c${++seq}-`)));

  container.innerHTML = '';
  container.classList.add('tutorial-screen');
  const root = h('div', 'tutorial');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'How to play');

  const head = h('header', 'tutorial-head');
  const progress = h('p', 'tutorial-progress');
  const exit = button('tutorial-exit', 'Back to Menu', () => options.onExit?.());
  head.append(progress, exit);
  root.appendChild(head);

  const dots = h('nav', 'tutorial-dots');
  dots.setAttribute('aria-label', 'Tutorial steps');
  const dotButtons = steps.map((s, i) => {
    const d = button('tutorial-dot', '', () => goTo(i));
    d.setAttribute('aria-label', `Step ${i + 1}: ${s.title}`);
    dots.appendChild(d);
    return d;
  });
  root.appendChild(dots);

  const card = h('article', 'tutorial-card');
  card.tabIndex = -1;
  root.appendChild(card);

  const nav = h('div', 'tutorial-nav');
  const backBtn = button('tutorial-btn tutorial-btn--secondary', 'Back', () => back());
  const nextBtn = button('tutorial-btn tutorial-btn--primary', 'Next', () => next());
  nav.append(backBtn, nextBtn);
  root.appendChild(nav);
  container.appendChild(root);

  render();
  return { goTo, next, back, current: () => index, completed: () => [...completed], element: root, destroy() { container.innerHTML = ''; } };

  // ---------------------------------------------------------------------
  function goTo(i, { focus = true } = {}) {
    if (!Number.isInteger(i) || i < 0 || i >= steps.length || i === index) return;
    index = i;
    render();
    report();
    if (focus) { try { card.focus({ preventScroll: true }); } catch { /* headless */ } }
    try { root.scrollIntoView?.({ block: 'start' }); } catch { /* ignore */ }
  }
  function next() { goTo(index + 1); }
  function back() { goTo(index - 1); }
  function report() { options.onProgress?.({ step: index, completed: [...completed] }); }
  function solved(id) { if (!completed.has(id)) { completed.add(id); report(); } renderDots(); }

  function renderDots() {
    dotButtons.forEach((d, i) => {
      d.classList.toggle('tutorial-dot--current', i === index);
      const ex = steps[i].exercise;
      d.classList.toggle('tutorial-dot--done', ex ? completed.has(ex.id) : i < index);
      if (i === index) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
    });
  }

  function render() {
    const step = steps[index];
    progress.textContent = `Step ${index + 1} of ${steps.length}`;
    renderDots();
    card.innerHTML = '';
    card.dataset.step = step.id;
    card.appendChild(h('h1', 'tutorial-title', step.title));
    for (const p of step.paragraphs ?? []) card.appendChild(h('p', 'tutorial-text', p));
    for (const show of step.show ?? []) card.appendChild(renderGroups(show));
    if (step.list) {
      const ul = h('ul', 'tutorial-list');
      for (const item of step.list) ul.appendChild(h('li', '', item));
      card.appendChild(ul);
    }
    if (step.exercise) card.appendChild(renderExercise(step.exercise));
    if (step.finish) card.appendChild(renderFinish());
    backBtn.disabled = index === 0;
    nextBtn.hidden = index === steps.length - 1;
  }

  function renderGroups({ caption, groups }) {
    const fig = h('figure', 'tutorial-example');
    const row = h('div', 'tutorial-groups');
    groups.forEach((g, gi) => {
      const grp = h('div', 'tutorial-group');
      g.forEach((id, i) => grp.appendChild(createTileElement(Tile.fromId(id, `${id}#ex${gi}-${i}`), { size: 'sm' })));
      row.appendChild(grp);
    });
    fig.appendChild(row);
    if (caption) fig.appendChild(h('figcaption', 'tutorial-caption', caption));
    return fig;
  }

  /** A row of clickable tiles (buttons). */
  function tileButtons(ids, onPick, { tag = 't' } = {}) {
    const row = h('div', 'tutorial-tiles');
    ids.forEach((id, i) => {
      const el = createTileElement(Tile.fromId(id, `${id}#${tag}${i}`));
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', labelOf(id));
      el.classList.add('tutorial-tile');
      const pick = () => onPick(id, i, el);
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); pick(); } });
      row.appendChild(el);
    });
    return row;
  }

  function renderExercise(ex) {
    const box = h('section', `tutorial-exercise tutorial-exercise--${ex.kind}`);
    box.dataset.exercise = ex.id;
    box.appendChild(h('h2', 'tutorial-exercise-title', completed.has(ex.id) ? 'Try it ✓' : 'Try it'));
    box.appendChild(h('p', 'tutorial-prompt', ex.prompt));
    const feedback = h('p', 'tutorial-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    const say = (text, kind) => {
      feedback.textContent = text;
      feedback.className = `tutorial-feedback${kind ? ` tutorial-feedback--${kind}` : ''}`;
      if (kind === 'right') { box.querySelector('.tutorial-exercise-title').textContent = 'Try it ✓'; solved(ex.id); }
    };
    const actions = h('div', 'tutorial-exercise-actions');

    if (ex.kind === 'name-tiles') {
      const seen = new Set();
      box.appendChild(tileButtons(ex.tiles, (id, i, el) => {
        seen.add(id);
        box.querySelectorAll('.tutorial-tile--picked').forEach((t) => t.classList.remove('tutorial-tile--picked'));
        el.classList.add('tutorial-tile--picked');
        const left = Math.max(0, ex.need - seen.size);
        say(`${labelOf(id)}.${left ? ` ${left} more to go.` : ' Well done — you know your tiles.'}`, left ? null : 'right');
      }));
    } else if (ex.kind === 'pick-set') {
      const picked = [];
      const row = tileButtons(ex.tiles, (id, i, el) => {
        const at = picked.findIndex((p) => p.i === i);
        if (at >= 0) { picked.splice(at, 1); el.classList.remove('tutorial-tile--picked'); el.setAttribute('aria-pressed', 'false'); }
        else if (picked.length < ex.size) { picked.push({ id, i }); el.classList.add('tutorial-tile--picked'); el.setAttribute('aria-pressed', 'true'); }
        check.disabled = picked.length !== ex.size;
        say('', null);
      });
      row.querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-pressed', 'false'));
      box.appendChild(row);
      const check = button('tutorial-btn tutorial-btn--primary tutorial-check', 'Check', () => {
        const ids = picked.map((p) => p.id);
        if (ex.check(ids)) say(`Yes — ${describeChow(ids)} is a Chow.`, 'right');
        else say(ex.explain(ids), 'wrong');
      });
      check.disabled = true;
      actions.append(check, button('tutorial-btn tutorial-btn--ghost tutorial-show', 'Show answer', () => {
        const want = [...ex.answer];
        row.querySelectorAll('.tile').forEach((t, i) => {
          const k = want.indexOf(ex.tiles[i]);
          const on = k >= 0;
          if (on) want.splice(k, 1);
          t.classList.toggle('tutorial-tile--picked', on);
          t.setAttribute('aria-pressed', String(on));
        });
        picked.splice(0, picked.length, ...ex.answer.map((id) => ({ id, i: ex.tiles.indexOf(id) })));
        say(`For example ${describeChow(ex.answer)}: three in a row in one suit.`, null);
      }));
    } else if (ex.kind === 'complete') {
      box.appendChild(renderGroups({ caption: 'Your 13 tiles', groups: [ex.hand] }));
      box.appendChild(h('p', 'tutorial-subprompt', 'Choose the 14th tile:'));
      const waits = waitsOf(ex.hand, isCompleteIds);
      box.appendChild(tileButtons(ex.options, (id, i, el) => {
        box.querySelectorAll('.tutorial-tile--picked').forEach((t) => t.classList.remove('tutorial-tile--picked'));
        el.classList.add('tutorial-tile--picked');
        if (isCompleteIds([...ex.hand, id])) say(`Right — ${labelOf(id)} turns 6-7 into a Chow: four sets and a pair. (${describeFaces(waits, labelOf)} would both work.)`, 'right');
        else say(`${labelOf(id)} doesn’t complete it. Look at the two Characters that aren’t in a set yet.`, 'wrong');
      }, { tag: 'opt' }));
      actions.append(button('tutorial-btn tutorial-btn--ghost tutorial-show', 'Show answer', () => say(`The hand is waiting on ${describeFaces(waits, labelOf)}.`, null)));
    } else if (ex.kind === 'discard') {
      const results = ex.hand.map((_, i) => waitsOf(ex.hand.filter((__, j) => j !== i), isCompleteIds));
      const most = Math.max(...results.map((w) => w.length));
      box.appendChild(tileButtons(ex.hand, (id, i, el) => {
        box.querySelectorAll('.tutorial-tile--picked').forEach((t) => t.classList.remove('tutorial-tile--picked'));
        el.classList.add('tutorial-tile--picked');
        const w = results[i];
        if (!w.length) say(`Without ${labelOf(id)} you aren’t ready yet — it belongs to a set (or nearly one).`, 'wrong');
        else if (w.length === most) say(`Best choice. Now you’re ready, waiting on ${describeFaces(w, labelOf)}.`, 'right');
        else {
          const best = ex.hand[results.findIndex((r) => r.length === most)];
          say(`That works — you’re ready, waiting on ${describeFaces(w, labelOf)}. Discarding ${labelOf(best)} would wait on ${most} kinds of tile instead.`, 'right');
        }
      }, { tag: 'h' }));
      actions.append(button('tutorial-btn tutorial-btn--ghost tutorial-show', 'Show answer', () => {
        const i = results.findIndex((r) => r.length === most);
        say(`Discard ${labelOf(ex.hand[i])}: the rest wait on ${describeFaces(results[i], labelOf)}.`, null);
      }));
    } else if (ex.kind === 'can-win') {
      box.appendChild(renderGroups({ caption: 'Complete — won on a discard', groups: [ex.hand] }));
      const score = scoreHand(new Hand(makeTiles(Tile, ex.hand, `s${++seq}-`)), ex.context ?? {});
      const minimum = score?.minimumFan ?? 3;
      const lines = (score?.breakdown ?? []).map((b) => `${b.name} ${b.fan}`).join(' + ') || 'no pattern';
      const verdict = `${lines} = ${score?.fan ?? 0} fan; ${minimum} needed.`;
      const yes = button('tutorial-btn tutorial-btn--secondary tutorial-answer', 'Yes, it can win', () => say(score?.meetsMinimum ? `Right. ${verdict}` : `Not quite: ${verdict} It’s complete but not worth enough.`, score?.meetsMinimum ? 'right' : 'wrong'));
      const no = button('tutorial-btn tutorial-btn--secondary tutorial-answer', 'No, not enough', () => say(!score?.meetsMinimum ? `Right — ${verdict} A Pung of dragons or one suit throughout would add enough.` : `Actually it can: ${verdict}`, !score?.meetsMinimum ? 'right' : 'wrong'));
      actions.append(yes, no);
    } else if (ex.kind === 'choice') {
      const list = h('div', 'tutorial-choices');
      list.setAttribute('role', 'group');
      ex.choices.forEach((c, i) => list.appendChild(button('tutorial-btn tutorial-btn--secondary tutorial-answer', c, () => {
        list.querySelectorAll('.tutorial-answer').forEach((b, j) => b.classList.toggle('tutorial-answer--picked', j === i));
        say(i === ex.answer ? `Right. ${ex.explanation}` : `Not quite. ${ex.explanation}`, i === ex.answer ? 'right' : 'wrong');
      })));
      box.appendChild(list);
    }

    if (actions.children.length) box.appendChild(actions);
    box.appendChild(feedback);
    return box;
  }

  function renderFinish() {
    const exercises = steps.filter((s) => s.exercise).map((s) => s.exercise.id);
    const done = exercises.filter((id) => completed.has(id)).length;
    const box = h('section', 'tutorial-finish');
    box.appendChild(h('p', 'tutorial-score', `You solved ${done} of ${exercises.length} exercises.`));
    const row = h('div', 'tutorial-finish-actions');
    const finish = (fn) => () => { options.onFinish?.({ completed: [...completed] }); fn?.(); };
    if (typeof options.onPlay === 'function') row.appendChild(button('tutorial-btn tutorial-btn--primary', 'Play a practice game', finish(options.onPlay)));
    if (typeof options.onRuleReference === 'function') row.appendChild(button('tutorial-btn tutorial-btn--secondary', 'Open the Rule Reference', finish(options.onRuleReference)));
    row.appendChild(button('tutorial-btn tutorial-btn--secondary', 'Back to Menu', finish(options.onExit)));
    box.appendChild(row);
    return box;
  }
}
