# Architecture

An offline browser Mahjong game: plain ES modules, no framework, no build step, no network. `index.html` loads `src/main.js`; everything else is imported from there. This page explains how the pieces fit; each source file's header comment documents that file in detail.

## The big picture

```
                         index.html  ─┐
                                      ▼
                               src/main.js            composition root: builds everything, routes screens
            ┌───────────────┬─────────┴──────┬──────────────────┬───────────────┐
            ▼               ▼                ▼                  ▼               ▼
        src/ui/*        src/core/*       src/rules/*         src/ai/*      src/persistence/*
   screens, renderers   GameManager,    Hong Kong, Riichi,   Basic and      localStorage:
   animation, audio*    turns, wall,    Chinese Official     Advanced AI,   settings, save,
   accessibility        claims, events  rule engines         hints          stats, leaderboard
                                                                            (* audio: src/audio/*)
```

The plan's rule is **a core and a decorative shell**: the game logic (`core`, `rules`, `ai`) never touches the DOM, timers or audio, and never waits for an animation. The shell (`ui`, `audio`) renders what the core reports and calls the core when the player acts. You can play a whole game in Node with no DOM at all — that is how most of the tests run.

## Dependency rules (enforced by tests)

`tests/core/crossRuleset.test.mjs` reads every import in `src/` and fails when one of these breaks:

| Code in | May not import |
|---|---|
| `src/rules/<ruleset>/` | another ruleset |
| `src/core/`, `src/ui/`, `src/persistence/`, `src/utils/` | any ruleset (only `rules/RuleEngineInterface.js`) |
| `src/ai/` | a ruleset — except from the adaptation helpers, `RiichiAIHelpers.js` and `ChineseOfficialAIHelpers.js` |
| `src/core/`, `src/rules/`, `src/ai/`, `src/persistence/`, `src/utils/` | `src/ui/` or `src/audio/` (the logic never depends on its shell) |
| `src/main.js` | — it is the composition root, the one place that wires rulesets, AI tiers and screens together |

So the UI never knows which ruleset is being played except through what the engine itself reports (`getTerminology()`, scores, legal actions) and through data `main.js` hands it (the rules reference, the score format).

## Core: `src/core/`

- **`GameManager.js`** — one session (several hands) at one table. It owns the players, the wall, the turn manager and the optional turn flow, and exposes the whole game as method calls: `performDraw()`, `performDiscard(tile)`, `declareKong(action)`, `declareTsumo()`, `declareRiichi(tile)`, `declareAbortiveDraw()`, `playAITurn()`, `settleRound()`, `startNextHand()`, `getDecisionContext(seat)`. Each call returns a plain result object (`{ type: 'discarded', claim, winners, … }`); nothing is asynchronous.
- **Calls on a discard.** After a discard every other seat reacts (Win > Kong = Pon > Chi, then seat order — `TurnInterruptionResolver.js`). AI seats decide through their strategy. The human seat is given a legal Ron automatically; for Chi / Pon / Kong, when `setHumanClaimPrompts(true)` is on (the game screen turns it on), a discard the human could call stops with `{ type: 'awaiting-claim', options }`, and `resolveHumanClaim(action | pass)` finishes it (Task 118).
- **`TurnManager.js`** — whose turn and which phase (`AWAITING_DRAW`, `AWAITING_DISCARD`, round over).
- **`WallManager.js`, `Tile.js`, `Hand.js`, `PlayerManager.js`, `DiscardPile.js`** — the table's data. Every physical tile has a stable `instanceId` (`dots-5#2`); its face is its `id` (`dots-5`).
- **`RoundProgression.js`** — dealer rotation and round wind between hands.
- **`EventBus.js`** — `game:hand-started`, `game:tile-drawn`, `game:tile-discarded`, `game:claim`, `game:riichi`, `game:bonus-tile`, `game:round-over`, `game:round-settled`. Nothing in the game logic listens: they drive sounds (`audio/GameSoundBridge.js`) and the screen-reader announcer (`ui/GameAnnouncer.js`).

## Rules: `src/rules/`

A rule engine implements `RuleEngineInterface.js`:

| Method | Purpose |
|---|---|
| `getRulesetId()`, `getDisplayName()` | `'hong_kong'` / `'riichi'` / `'chinese_official'` and its label |
| `getTileSetOptions()` | which tiles, dead-wall size |
| `getLegalActions(state, player)` | after your draw (`kind: 'self'`) or on someone's discard (`kind: 'discard'`): WIN / KONG / PON / CHI / RIICHI / ABORTIVE_DRAW / DISCARD (with `allowedTiles` when restricted) |
| `checkWin(hand)`, `scoreHand(hand, context)` | shape, and value (`{ fan / points, meetsMinimum, breakdown }`) |
| `getTerminology()` | the ruleset's words (Chow / Chi, Kong / Kan, fan / han / points…) |
| `createTurnFlow(gm)` *(optional)* | ruleset-specific state the GameManager calls at fixed hooks — Riichi (riichi sticks, furiten, ippatsu, dora, abortive draws, its own settlement) and Chinese Official (flowers set aside and replaced, one winner per discard) |

Each ruleset folder holds the engine, its hand analysis, scoring, terminology, an optional turn flow, and a **reference module** (`…Reference.js`) — the rules text shown in-game, built from the engine's own scoring tables. `docs/rules-reference.md` is generated from those modules (`node tools/build-docs.mjs`).

## AI: `src/ai/`

- **`AIStrategyInterface.js`** — `chooseDiscard`, `chooseClaim`, `chooseWinDeclaration` (+ `chooseRiichi`, `chooseAbortiveDraw` where a ruleset has them). The GameManager passes each decision an *AI context*: only what that seat may see (its hand, every discard and exposed meld, winds, wall count).
- **`basic/BasicStrategy.js`** — simple heuristics.
- **`advanced/`** — `AdvancedStrategy.js` on top of `HandEfficiencyEvaluator.js` (shanten / useful tiles; computed suit by suit and memoized since Task 119), `HandValuePlanner.js` (will the finished hand score enough?), and `DefensivePlayEvaluator.js` (push / balance / fold against threatening opponents).
- **`StrategyRegistry.js`** — which tiers exist and how a table's AI manager is built from each seat's difficulty.
- **`HintAdvisor.js`** — the player's Hint button: the Advanced AI's own choice for the human seat, explained (waits checked by the rule engine, value routes, furiten / riichi notes, calls on discards). `ui/hintText.js` turns it into sentences.

## Persistence: `src/persistence/`

Everything is in `localStorage` under the `mahjong:` prefix, one namespace per manager (`StorageManager.namespace(name)` → `mahjong:<name>:<key>`), each with a schema version:

| Namespace | Manager | Holds |
|---|---|---|
| `settings` | `SettingsManager` | theme, animations, volumes, mute, hints |
| `savegame` | `SaveGameManager` + `GameSnapshot` | one mid-game save — written at each hand start and after each of your discards; restored by Continue |
| `statistics` | `StatisticsManager` | hands / games played and won, streaks, fan |
| `leaderboard` | `LeaderboardManager` | top scores and records per ruleset |
| `tutorial` | (main.js) | tutorial progress |

Without `localStorage` (private mode, tests) a `MemoryStorage` stands in.

## UI: `src/ui/`

- **Screens** (`ui/components/`): main menu → rule selection → player count → difficulty → `GameScreen` → score screen per hand → end-game screen; plus Settings, Statistics, Leaderboard, Rules reference and Tutorial. `main.js` routes between them; each returns `{ destroy() }` and cleans up its listeners.
- **`GameScreen.js`** drives a game: it renders the table through the renderers (`HandRenderer`, `DiscardPileRenderer`, `WallRenderer`, `TurnIndicatorRenderer`, `TableInfoRenderer`), runs AI turns on a timer through `playAITurn()`, and shows prompts (`dialogs/ClaimPromptDialog.js`) for your own Kong / win / riichi choices and for calls on others' discards. It pauses when the tab is hidden.
- **Animation** — `AnimationEngine.js` (Web Animations API; every call resolves, never rejects, so the game can't be broken by an effect; off with the Animations setting or the OS reduce-motion preference; skips while the page is hidden and caps concurrent animations). `TableAnimations.js`, `WinReveal.js`, `TableHighlights.js` build the effects on it.
- **Accessibility** — `Announcer.js` + `GameAnnouncer.js` (live regions narrate the table), `FocusTrap.js` (dialogs keep focus), roving tab-index in your hand, keyboard shortcuts (P / Esc pause, H hint, arrows and Enter in the hand), WCAG AA contrast in both themes.
- **`TileRenderer.js`** draws tiles as inline SVG (each face built once, then cloned).

## Audio: `src/audio/`

All sound is synthesised with the Web Audio API — no files. `AudioManager` (buses, volume, voice limit), `SoundLibrary` (effect recipes), `MusicPlayer` (generative background music), `GameSoundBridge` (game events → sounds, timed to land with the animations). Audio starts on the first click (browser autoplay rules) and suspends while the tab is hidden.

## Styles: `styles/`

`reset.css`, two themes (`theme-dark.css`, `theme-light.css`, as CSS custom properties on `body[data-theme]`), `layout.css` (the table grid), `tile.css`, `animations.css`, `interactions.css`, `responsive.css` (phones, tablets, landscape), and one file per component in `styles/components/`.

## A turn, end to end

1. `GameScreen` sees it is AI seat 2's turn and, after the turn delay, calls `gameManager.playAITurn()`.
2. The GameManager draws for seat 2 (`game:tile-drawn`), asks seat 2's strategy whether to win or Kong, then which tile to discard, and calls `performDiscard`.
3. The discard is placed (`game:tile-discarded` → the clack sound and "AI 2 discards 5 of Dots" for screen readers). Each other seat reacts; if the human could Pon and no AI call outranks it, the call returns `awaiting-claim`.
4. `GameScreen` redraws the table, flies the tile into seat 2's pile, and shows "AI 2 discards 5 of Dots — Pung / Pass". You pick; `resolveHumanClaim()` finishes the discard (`game:claim`), and it is your turn to discard.
5. When a hand ends, `settleRound()` moves the points, the score screen shows them, the save is updated, and `startNextHand()` deals the next one — until the session ends and statistics and the leaderboard record the game.

## Testing

See [contributing.md](contributing.md#tests). In short: `node tests/run-all.mjs` runs ~60 Node suites (rules, engine, AI, persistence, UI on a fake DOM, a regression matrix of every ruleset × player count × AI line-up); `tests/browser/smoke.py` drives the real game in Chrome (~150 checks).
