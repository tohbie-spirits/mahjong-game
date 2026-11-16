# Contributing

How to run, test and change the game. Read [architecture.md](architecture.md) first for how the pieces fit; each source file's header comment documents that file.

## Running it

No install and no build — plain ES modules, HTML and CSS, no dependencies. Serve the folder over HTTP (modules don't load from `file://`):

```bash
python3 -m http.server 8000      # or: npm run serve
# open http://localhost:8000/
```

Reload after an edit. The game keeps its settings, save, statistics and leaderboard in `localStorage` under `mahjong:…`; clear them from the browser's dev tools (Application → Local Storage) to start fresh.

## Tests

### Node suites

```bash
node tests/run-all.mjs            # every suite, each in its own process (~20 min: AI benchmarks, the regression matrix)
node tests/run-all.mjs --fast     # skips the slow suites (listed in SLOW in run-all.mjs) — a couple of minutes
node tests/core/gameFlow.test.mjs # any one suite
```

Suites live next to what they test: `tests/core`, `tests/rules`, `tests/ai`, `tests/persistence`, `tests/audio`, `tests/ui` (and `tests/ui/components`). They use the tiny harness in `tests/_helpers/harness.mjs`:

```js
import { section, sectionAsync, assert, assertThrows, summary } from '../_helpers/harness.mjs';
section('1. Something', () => {
  assert(1 + 1 === 2, 'arithmetic still works');
  assertThrows(() => JSON.parse('{'), SyntaxError, 'bad JSON is refused');
});
summary(); // prints the totals; exits 1 on any failure
```

Other helpers:

- `tests/_helpers/tiles.mjs` — `hand('123d 456b 789c 111d EE')` builds a hand from shorthand (`d` dots, `b` bamboo, `c` characters; `E S W N` winds; `R G H` red, green and white dragons).
- `tests/_helpers/fakeDom.mjs` — `installFakeDom()`: a small DOM for UI tests in Node (elements, classes, attributes, events, `querySelector`, `cloneNode`).
- `tests/_helpers/fakeAudio.mjs` — a recording Web Audio context.
- `tests/_helpers/aiBenchmark.mjs` — duplicate-format AI-only games with invariant checks (also behind `node tools/ai-benchmark.mjs`).

Rig a specific table rather than hoping a random deal produces it: build a `GameManager`, reset each player's hand, give it a `WallManager` with the tiles you want drawn, and `forceSetTurn` (see `tests/core/humanClaims.test.mjs` or `tests/ai/hintAdvisor.test.mjs`). Count your tiles — 13 in a waiting hand, 14 for the seat about to discard; most first failures of a new rig are a hand one tile short.

Add a new slow suite's name to `SLOW` in `tests/run-all.mjs`.

### The browser smoke test

Drives the real game in Chrome with Playwright — boot, every screen, whole games through the UI, saves, prompts, accessibility, responsive layouts, performance — and fails on any page or console error:

```bash
pip install playwright           # once; it uses your installed Chrome (/usr/bin/google-chrome)
python3 -m http.server 8765 &
python3 tests/browser/smoke.py http://localhost:8765 /tmp/shots   # screenshots go to /tmp/shots
```

It speeds timers up (an init script), so a full run takes a few minutes. When a check fails, its screenshot and the printed values usually say why; re-run just that part by copying the section into a scratch script.

### Generated docs

`docs/rules-reference.md` is generated from the in-game rules reference (which reads the engines' scoring tables):

```bash
node tools/build-docs.mjs          # rewrite it
node tools/build-docs.mjs --check  # exit 1 if it is out of date (tests/core/docs.test.mjs does the same)
```

Change the text in `src/rules/<ruleset>/<Ruleset>Reference.js`, never in the generated file.

## Conventions

- **Plain modern JavaScript**, ES modules, no dependencies, no build. Browser APIs only in `src/ui`, `src/audio` and `src/main.js`.
- **The core never waits for the shell.** Game logic (`core`, `rules`, `ai`) is synchronous and DOM-free; it reports results, and the UI animates them. Animations always resolve (never reject) so an effect can't break the game. The import rules in [architecture.md](architecture.md#dependency-rules-enforced-by-tests) are checked by `tests/core/crossRuleset.test.mjs`.
- **Every file starts with a header comment**: what it is, how it's used, and the decisions behind it, with the task that made them ("Task 118: …"). Exported functions get JSDoc. Write comments for the next reader, not as a changelog — when behaviour changes, update the header rather than appending a contradiction.
- **Validate inputs at module boundaries** and throw `TypeError` / `RangeError` with the module name (`[GameManager] …`); tests check these.
- **Determinism**: anything random takes an injectable `random` / `seed`, so games replay exactly in tests (`tests/core/regressionMatrix.test.mjs` checks it).
- **Accessibility**: every control has a name, dialogs trap focus and close on Escape, new game events reach the announcer, text keeps WCAG AA contrast in both themes (`tests/ui/accessibility.test.mjs` measures the theme tokens).
- **Performance**: no work per frame; long sessions must not grow the DOM or listeners (the smoke test checks after several games). Profile before optimizing — the AI's shanten search and the tile SVGs were the real hotspots (Task 119).

## Common changes

### A new ruleset

1. `src/rules/<name>/<Name>Rules.js` implementing `RuleEngineInterface.js` (+ hand analysis, scoring, terminology; a turn flow via `createTurnFlow(gm)` if it needs per-hand state like riichi sticks or flowers).
2. `<Name>Reference.js` for the in-game rules, then `node tools/build-docs.mjs`.
3. AI adaptation in `src/ai/<Name>AIHelpers.js` (the only AI file allowed to import the ruleset).
4. Register the engine in `main.js` (`RULE_ENGINE_FACTORIES`), a `RULESET_ID` / label in `utils/constants.js`.
5. Tests: the engine's own suites, plus add it to `tests/core/crossRuleset.test.mjs` and `tests/core/regressionMatrix.test.mjs`.

### A new AI tier

Implement `AIStrategyInterface.js` (`chooseDiscard`, `chooseClaim`, `chooseWinDeclaration`; `chooseRiichi` / `chooseAbortiveDraw` where relevant), register it in `StrategyRegistry.js`, and measure it with `node tools/ai-benchmark.mjs --lineup <yours>,basic,<yours>,basic`.

### A new setting

Add the key, default and validator in `persistence/SettingsManager.js`, a row in `ui/components/SettingsMenu.js`, apply it in `main.js`, and update the tests that pin the settings list (`tests/persistence/persistenceCore.test.mjs`, `tests/audio/audioManager.test.mjs`, `tests/ui/components/soundControls.test.mjs`).

### A new sound

A recipe in `audio/SoundLibrary.js`; trigger it from an event in `audio/GameSoundBridge.js` (or directly from the UI for interface sounds).

## Before you hand a change over

1. `node tests/run-all.mjs --fast` (and the full run if you touched the AI, the engine or a ruleset).
2. The browser smoke test.
3. `node tools/build-docs.mjs --check` if you touched a ruleset.
4. The project plan (`../mahjong-project-plan.md`): the task marked ✓ COMPLETE in the roadmap, its manifest entry (what changed, what was tested, what was found), new files in the folder structure, Known Issues, and the NEXT TASK line.
