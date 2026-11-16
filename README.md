# Mahjong

An offline, single-player Mahjong game for the browser. Three rulesets —
Hong Kong, Riichi and Chinese Official — each for 3 or 4 players against
Basic or Advanced AI opponents (pick them in the New Game wizard). See
`../mahjong-project-plan.md` for the roadmap.

No build step and no dependencies: plain ES modules, HTML and CSS.

## Play

Serve the folder over HTTP (ES modules don't load from `file://`) and open it:

```bash
python3 -m http.server 8000      # or: npm run serve
# then open http://localhost:8000/
```

Settings, statistics, the leaderboard and an auto-save of the current game
are kept in the browser's localStorage.

New to mahjong? **How to Play** on the main menu is a short interactive
walkthrough, and **Rule Reference** lists the rules and every scoring pattern
of all three rulesets (also reachable in a game from Pause → Rules).

Controls: click a tile to discard it — or Tab to your hand, choose with the
arrow keys and press Enter; hover a tile to see its other copies on the table.
When an opponent discards a tile you can call (Chow / Pung / Kong — Chi / Pon /
Kan in Riichi), the game stops and asks; **Pass** or **Esc** declines. A winning
discard is taken for you automatically. Switching to another tab pauses the game.
**Hint** (or **H**) suggests a discard and explains why (Settings → Hints to
hide it); **P** / **Esc** pause, and the pause menu lists every key. Screen
readers hear what happens at the table through a live region. The buttons at the top right toggle sound
(**M**) and fullscreen (**F**); volumes for effects and music are in
Settings. All sound and music are synthesised in the browser — there are
no audio files. The layout adapts to phones (portrait and landscape),
tablets and desktops.

## Tests

```bash
node tests/run-all.mjs           # every suite (≈20 minutes: AI benchmarks, the regression matrix)
node tests/run-all.mjs --fast    # skips the slow suites (a couple of minutes)
node tests/core/gameFlow.test.mjs   # any single suite
```

AI benchmark (Task 80) — AI-only hands in duplicate format (every wall
played in each seat rotation), with per-agent stats and 95% confidence
intervals:

```bash
node tools/ai-benchmark.mjs                                  # Advanced vs Basic, 2v2, 100 walls
node tools/ai-benchmark.mjs --lineup advanced,basic,basic --seeds 200 --min-fan 3
node tools/ai-benchmark.mjs --help                           # agents incl. ablations
```

Browser end-to-end check (needs Python Playwright and Chrome):

```bash
python3 -m http.server 8765 &
python3 tests/browser/smoke.py http://localhost:8765 /tmp/shots
```

## Documentation

- [docs/architecture.md](docs/architecture.md) — how the code fits together: layers, the dependency rules, the GameManager, rule engines, AI, persistence, UI, a turn end to end
- [docs/rules-reference.md](docs/rules-reference.md) — the three rulesets as this game plays them, every scoring pattern with its value (generated from the engines: `node tools/build-docs.mjs`)
- [docs/contributing.md](docs/contributing.md) — running, testing (Node suites and the browser smoke test), conventions, adding a ruleset / AI tier / setting / sound

## Layout

- `src/core/` — tiles, wall, hands, turns, claims, wins, draws, GameManager
- `src/rules/hongkong/` — Hong Kong legal actions, win structure, fan scoring
- `src/ai/` — AI contract and manager; `basic/` and `advanced/` strategies;
  `StrategyRegistry.js` lists the selectable difficulty tiers and builds the
  AIManager for a table (one strategy per tier its seats use)
- `src/persistence/` — versioned localStorage: settings, statistics, leaderboard, save game
- `src/rules/riichi/`, `src/rules/chineseOfficial/` — the other two rulesets
- `src/audio/` — AudioManager, the synthesised SoundLibrary and MusicPlayer,
  and GameSoundBridge (game events → sounds)
- `src/ui/` — table renderers, animations (AnimationEngine, TableAnimations,
  WinReveal), dialogs and screen components
- `styles/` — theme tokens, table layout, tiles, one stylesheet per component;
  `interactions.css` (hover / press feedback) and `responsive.css` (breakpoints) load last
- `tests/` — Node test suites (no dependencies) and the browser smoke test;
  `tests/_helpers/aiBenchmark.mjs` is the AI benchmark engine
- `tools/ai-benchmark.mjs` — command-line front end for the benchmark
- `tools/build-docs.mjs` — generates `docs/rules-reference.md`
- `docs/` — architecture, rules reference, contributing

## Status

All three rulesets are playable for 3 or 4 players against Basic or Advanced
AI, with hints, a tutorial, the rules reference, sound, animation, keyboard
and screen-reader support. The roadmap (`../mahjong-project-plan.md`) has the
history of every task — including the rebuild of Tasks 1–68 from the plan
after the original files were lost — and the next task.
