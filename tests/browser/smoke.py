"""Browser smoke test for the rebuilt Mahjong game (real Chrome via Playwright)."""
import json, sys, time
from playwright.sync_api import sync_playwright

# Task 106: a Hong Kong table where you (seat 0, dealer) draw the winning tile.
RIG_HK_TSUMO = """async () => {
  const [{ GameManager }, { WallManager }, { EventBus }, { Tile }, { HongKongRules }, { AIManager }, { BasicStrategy }, { renderGameScreen }, C, { AnimationEngine }, { AudioManager }] = await Promise.all([
    import('/src/core/GameManager.js'), import('/src/core/WallManager.js'), import('/src/core/EventBus.js'), import('/src/core/Tile.js'),
    import('/src/rules/hongkong/HongKongRules.js'), import('/src/ai/AIManager.js'), import('/src/ai/basic/BasicStrategy.js'),
    import('/src/ui/components/GameScreen.js'), import('/src/utils/constants.js'), import('/src/ui/AnimationEngine.js'), import('/src/audio/AudioManager.js')]);
  let n = 0;
  const t = (id) => Tile.fromId(id, `${id}#rig${++n}`);
  const S = { d: 'dots', b: 'bamboo', c: 'characters' }; const H = { E: 'wind-east', S: 'wind-south', W: 'wind-west', N: 'wind-north', R: 'dragon-red', G: 'dragon-green', H: 'dragon-white' };
  const tl = (spec) => spec.split(' ').flatMap((part) => (H[part[0]] ? [...part].map((ch) => t(H[ch])) : [...part.slice(0, -1)].map((d) => t(`${S[part.at(-1)]}-${d}`))));
  const cfg = [0, 1, 2, 3].map((i) => ({ seatIndex: i, displayName: i ? `AI ${i}` : 'You', seatKind: i ? C.SEAT_KIND.AI : C.SEAT_KIND.HUMAN, aiDifficulty: i ? 'basic' : null }));
  const gm = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: cfg, aiManager: new AIManager({ strategies: [new BasicStrategy({ random: () => 0.5 })] }), eventBus: new EventBus(), seed: 1, dealerIndex: 0 });
  const hands = ['111d 222d 333d 777d 5d', '258b 258c 369b 369c E', '147b 147c 9b 9c SWN', '6b 6c 8b 8c 4b 4c RGH 7c'];
  gm.getPlayers().forEach((p, i) => { p.resetForNewHand(); for (const x of tl(hands[i])) p.addTileToHand(x); });
  gm._wall = new WallManager([...tl('5d 1b 1c 2b 2c 3b 3c 5b 5c 7b 7c 9d 8d 6d 4d 4d 4d'), ...tl('E S W N')]);
  gm.getTurnManager().forceSetTurn(0, C.TURN_PHASE.AWAITING_DRAW);
  document.getElementById('app-root').hidden = true;
  const host = document.createElement('div'); host.id = 'rig-root'; document.body.appendChild(host);
  const audio = new AudioManager(); await audio.unlock();
  renderGameScreen(host, gm, { humanSeatIndex: 0, aiTurnDelayMs: 40, animationEngine: new AnimationEngine(), audio });
  window.__rig = gm;
}"""

BASE = sys.argv[1]
OUT = sys.argv[2]
results = []
def check(cond, msg):
    results.append((bool(cond), msg))
    print(("  ✓ " if cond else "  ✗ FAIL: ") + msg, flush=True)

# Task 103: records, for every overlay card that appears, how many animations it started.
WATCH_ANIMS = """
(() => { window.__overlayAnims = [];
  // Tasks 104-105: tiles that started a flight when they appeared.
  window.__tileAnims = { discard: 0, draw: 0, ghost: 0, flower: 0 };
  const moving = (el) => typeof el.getAnimations === 'function' && el.getAnimations().length > 0;
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType !== 1 || !n.matches) continue;
    if (n.matches('.claim-prompt, .score-screen, .pause-menu'))
      window.__overlayAnims.push({ cls: n.className, n: typeof n.getAnimations === 'function' ? n.getAnimations().length : -1 });
    // Task 106: the winning-hand reveal — tiles animating when the card appears, confetti.
    if (n.matches('.score-screen') && n.querySelector('.winning-hand')) {
      const tiles = [...n.querySelectorAll('.winning-hand .tile')];
      (window.__reveals = window.__reveals || []).push({ tiles: tiles.length, moving: tiles.filter(moving).length,
        rows: [...n.querySelectorAll('.score-screen-fan tr')].filter(moving).length, burst: n.querySelectorAll('.win-burst-particle').length });
    }
    if (n.matches('.tile-ghost')) { if (moving(n)) window.__tileAnims.ghost++; continue; }
    const tiles = n.matches('.tile') ? [n] : [...n.querySelectorAll('.tile')];
    for (const t of tiles) {
      if (!moving(t)) continue;
      if (t.closest('.table-info-flowers')) window.__tileAnims.flower++;
      else if (t.closest('.table-center-discard')) window.__tileAnims.discard++;
      else if (t.closest('.table-seat--bottom .hand-concealed')) window.__tileAnims.draw++;
    }
  } }).observe(document, { childList: true, subtree: true }); })();
"""

# Tasks 108-110: counts the Web Audio nodes the game creates (no audio is inspected — only that sounds are made).
AUDIO_SPY = """
(() => { window.__audioSpy = { contexts: 0, nodes: 0 };
  const C = window.AudioContext; if (!C) return;
  window.AudioContext = class extends C { constructor(...a) { super(...a); window.__audioSpy.contexts++; window.__audioCtx = this; } };
  for (const m of ['createOscillator', 'createBufferSource']) { const f = BaseAudioContext.prototype[m];
    BaseAudioContext.prototype[m] = function () { window.__audioSpy.nodes++; return f.call(this); }; } })();
"""

SPEEDUP = """
(() => { const st = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) => st(fn, Math.max(0, (ms || 0) / 40), ...a);
  // Tasks 104-105: animations run at the same 40x speed, so waiting for a tile to land doesn't stretch the run.
  const an = Element.prototype.animate;
  Element.prototype.animate = function (kf, o) {
    if (o && typeof o === 'object') o = { ...o, duration: (o.duration || 0) / 40, delay: (o.delay || 0) / 40 };
    return an.call(this, kf, o);
  }; })();
"""

def pass_calls(pg):
    """Task 118: a prompt (a call on a discard, or your own Kong / riichi choice) covers the table — pass it first."""
    for _ in range(20):
        pr = pg.locator('.claim-prompt')
        if not pr.count(): return
        try: pg.locator('.claim-prompt-btn--pass').click(timeout=2000)
        except Exception: pass
        pg.wait_for_timeout(30)

def play_hand(page, max_steps=600, probe=None):
    """Plays the human seat until a round-over panel appears. Returns the panel title.
    `probe(page)` (optional) runs before every step — used to watch the table."""
    for _ in range(max_steps):
        if probe: probe(page)
        if page.locator('.score-screen').count():
            return page.locator('.score-screen-title').inner_text()
        prompt = page.locator('.claim-prompt')
        if prompt.count():
            win = page.locator('.claim-prompt-btn--win')
            (win.first if win.count() else page.locator('.claim-prompt-btn--pass')).click()
            continue
        tiles = page.locator('.table-seat--bottom .hand-concealed .tile--discardable')
        if tiles.count():
            # A prompt may appear between the checks above and this click (after Next Hand,
            # the redraw can offer a Kong / Riichi) — then look again rather than wait behind it.
            try: tiles.nth(tiles.count() - 1).click(timeout=2000)
            except Exception: pass
            continue
        page.wait_for_timeout(20)
    return None

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1280, 'height': 860})
    ctx.add_init_script(SPEEDUP)
    ctx.add_init_script(WATCH_ANIMS)
    ctx.add_init_script(AUDIO_SPY)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type in ('error',) else None)

    print('▸ Boot + main menu')
    page.goto(f'{BASE}/index.html')
    page.wait_for_selector('.main-menu')
    labels = page.locator('.main-menu-item').all_inner_texts()
    check(labels[:1] == ['New Game'] and 'Settings' in labels and 'Statistics' in labels and 'Leaderboard' in labels, f'menu items {labels}')
    check('Continue' not in labels, 'no Continue on a fresh profile')
    check(page.locator('#app-toolbar .app-toolbar-btn').count() == 2, 'Tasks 110-111: the Sound and Fullscreen buttons are on the main menu')
    check(page.evaluate('window.__audioSpy.contexts') == 0, 'Task 108: no audio context before the first user gesture (autoplay rules)')
    page.screenshot(path=f'{OUT}/01-main-menu.png')

    print('▸ Settings')
    page.click('text=Settings')
    page.wait_for_selector('.settings-menu')
    page.click('.settings-radio-label:has-text("Light")')
    check(page.evaluate('document.body.dataset.theme') == 'light', 'theme switches to light immediately')
    page.screenshot(path=f'{OUT}/02-settings-light.png')
    page.click('.settings-radio-label:has-text("Dark")')
    page.click('text=Done')
    page.wait_for_selector('.main-menu')

    print('▸ New game wizard')
    page.click('text=New Game')
    page.wait_for_selector('.rule-selection')
    disabled = page.locator('.rule-selection-card[disabled]').count()
    check(disabled == 0, 'Task 102: all three rulesets selectable (none Coming Soon)')
    page.click('.rule-selection-card[data-value="hong_kong"]')
    page.wait_for_selector('.player-count-selection')
    page.click('.player-count-selection-card[data-value="4"]')
    page.wait_for_selector('.difficulty-selection')
    page.click('.difficulty-selection-card[data-value="basic"]')
    page.wait_for_selector('.game-screen .table')
    page.wait_for_selector('.table-seat--bottom .tile--discardable')
    n_tiles = page.locator('.table-seat--bottom .hand-concealed .tile').count()
    check(page.locator('.table-seat').count() == 4, 'four seats on the table')
    check(n_tiles == 14, f'human dealer has drawn to 14 tiles ({n_tiles})')
    check(page.locator('.table-seat--top .tile--back').count() == 13, 'opponent hands are face-down placeholders')
    check(page.locator('.table-seat--top [data-tile-id]').count() == 0, 'no opponent tile identity in the DOM')
    check(page.locator('.seat-label-dealer').count() == 1, 'one Dealer badge')
    page.screenshot(path=f'{OUT}/03-table-start.png')

    print('▸ Discard + autosave + Continue')
    nodes0 = page.evaluate('window.__audioSpy.nodes')
    page.locator('.table-seat--bottom .hand-concealed .tile--discardable').last.click()
    page.wait_for_timeout(300)
    check(page.evaluate('window.__audioSpy.contexts') == 1 and page.evaluate('window.__audioCtx.state') == 'running', 'Task 108: the first click unlocked audio (one running context)')
    check(page.evaluate('window.__audioSpy.nodes') > nodes0, f"Task 109: the discard and the opponents' turns make sounds ({page.evaluate('window.__audioSpy.nodes') - nodes0} sources)")
    # Task 107: hovering a hand tile marks its copies on the table and shows the count.
    page.wait_for_selector('.table-seat--bottom .tile--discardable')
    tip = None
    for i in range(page.locator('.table-seat--bottom .hand-concealed .tile').count()):
        t = page.locator('.table-seat--bottom .hand-concealed .tile').nth(i)
        t.hover(); page.wait_for_timeout(30)
        tip = t.get_attribute('data-copies')
        if tip and page.locator('.tile--match').count(): break
    import re
    check(tip is not None and re.fullmatch(r'\d held · \d seen · \d left', tip), f'Task 107: hovering a hand tile shows its copies ("{tip}"; {page.locator(".tile--match").count()} marked on the table)')
    page.mouse.move(5, 300); page.wait_for_timeout(30)
    check(page.locator('.tile--match').count() == 0 and page.locator('.tile--counting').count() == 0, 'Task 107: moving away clears the marks')
    page.screenshot(path=f'{OUT}/04-table-after-discard.png')
    has_save = page.evaluate("localStorage.getItem('mahjong:savegame:slot') !== null")
    check(has_save, 'autosave written after a human discard')
    page.goto(f'{BASE}/index.html')
    page.wait_for_selector('.main-menu')
    labels = page.locator('.main-menu-item').all_inner_texts()
    check(labels[0] == 'Continue', 'Continue offered after reload')
    page.click('text=Continue')
    page.wait_for_selector('.game-screen .table')
    page.wait_for_timeout(300)
    total = sum(page.locator(f'.table-center-discard[data-seat-index="{i}"] .tile').count() for i in range(4))
    check(total >= 1, f'restored table shows the earlier discards ({total})')

    print('▸ Pause / resume')
    pass_calls(page); page.click('.game-screen-pause')
    page.wait_for_selector('.pause-menu')
    btns = page.locator('.pause-menu-btn').all_inner_texts()
    check([b.upper() for b in btns] == ['RESUME', 'RULES', 'RESTART GAME', 'QUIT TO MENU'], f'pause menu buttons {btns}')
    # Task 114: Pause → Rules shows this game's rules (Hong Kong), Back returns to the pause card.
    page.click('.pause-menu-btn:has-text("Rules")')
    page.wait_for_selector('.game-screen-overlay .rule-reference--embedded')
    check(page.locator('.game-screen-overlay .rule-reference-ruleset').inner_text().startswith('Hong Kong') and page.locator('.game-screen-overlay [role="tab"]').count() == 0, 'Task 114: Pause → Rules shows the rules of the game being played')
    page.click('.game-screen-overlay .rule-reference-back')
    page.wait_for_selector('.pause-menu')
    check(page.locator('.rule-reference').count() == 0, 'Back returns to the pause menu')
    pause_anim = page.evaluate('window.__overlayAnims.filter((a) => a.cls.includes("pause-menu")).pop()')
    check(pause_anim and pause_anim['n'] >= 1, f'Task 103: the pause card pops in (animations started: {pause_anim})')
    page.click('.pause-menu-btn--primary')
    check(page.locator('.pause-menu').count() == 0, 'resume closes the pause menu')

    print('▸ Play a full session through the UI')
    hands = 0; titles = []
    shot_score = False
    for _ in range(40):  # the engine caps a session at 32 hands (draws keep the dealer in Hong Kong)
        t = play_hand(page)
        if t is None: break
        titles.append(t); hands += 1
        if not shot_score:
            page.screenshot(path=f'{OUT}/05-score-screen.png'); shot_score = True
        nxt = page.locator('.score-screen-btn:has-text("Next Hand")')
        if nxt.count():
            nxt.click(); page.wait_for_timeout(50); continue
        page.locator('.score-screen-btn:has-text("See Final Results")').click()
        break
    check(hands >= 1, f'{hands} hands completed: {titles}')
    ta = page.evaluate('window.__tileAnims')
    check(ta['discard'] > 0 and ta['draw'] > 0 and ta['ghost'] > 0, f'Tasks 104-105: discards fly into the piles, your draws fly in from the wall, opponents\' draws show a flying tile ({ta})')
    page.wait_for_timeout(600)
    check(page.locator('.tile-ghost').count() == 0, 'no flying stand-in tiles are left behind')
    rv = page.evaluate('window.__reveals || []')
    if rv:
        check(all(r['moving'] == r['tiles'] and r['rows'] > 0 for r in rv), f'Task 106: every win card reveals its hand tile by tile and its score lines ({rv[:3]})')
    else:
        print('    (no win this session — the reveal is checked on the rigged Tsumo below)')
    page.wait_for_selector('.end-game-screen', timeout=10000)
    check(page.locator('.end-game-screen-standing-row').count() == 4, 'end-game standings for 4 players')
    page.screenshot(path=f'{OUT}/06-end-game.png')
    stats = page.evaluate("JSON.parse(localStorage.getItem('mahjong:statistics:gamesPlayed'))")
    entries = page.evaluate("JSON.parse(localStorage.getItem('mahjong:leaderboard:entries'))")
    check(stats == 1, f'statistics recorded one finished game ({stats})')
    check(isinstance(entries, list) and len(entries) == 1 and entries[0].get('handsPlayed', 0) >= 1, f'leaderboard entry with handsPlayed ({entries})')
    check(page.evaluate("localStorage.getItem('mahjong:savegame:slot')") is None, 'save slot cleared after the game ends')

    print('▸ Statistics + leaderboard screens')
    page.click('text=Return to Menu')
    page.wait_for_selector('.main-menu')
    page.click('text=Leaderboard')
    page.wait_for_selector('.leaderboard-screen')
    check(page.locator('.leaderboard-screen-row').count() == 1, 'leaderboard lists the finished game')
    page.screenshot(path=f'{OUT}/07-leaderboard.png')
    page.click('.leaderboard-screen-btn--primary')
    page.wait_for_selector('.main-menu')
    page.click('text=Statistics')
    page.wait_for_selector('.statistics-screen')
    page.click('text=Back')

    print('▸ 3-player game smoke')
    page.click('text=New Game'); page.click('.rule-selection-card[data-value="hong_kong"]')
    page.click('.player-count-selection-card[data-value="3"]'); page.click('.difficulty-selection-card[data-value="basic"]')
    page.wait_for_selector('.game-screen .table')
    check(page.locator('.table-seat').count() == 3, 'three seats')
    t = play_hand(page)
    check(t is not None, f'3-player hand completes ({t})')
    page.screenshot(path=f'{OUT}/08-three-player.png')

    print('▸ Advanced difficulty (Task 79)')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.click('text=New Game'); page.click('.rule-selection-card[data-value="hong_kong"]')
    page.click('.player-count-selection-card[data-value="4"]')
    page.wait_for_selector('.difficulty-selection')
    adv = page.locator('.difficulty-selection-card[data-value="advanced"]')
    check(adv.count() == 1 and not adv.is_disabled(), 'Advanced card is selectable')
    check(page.locator('.difficulty-selection-card-badge').count() == 0, 'no Coming Soon badge on the difficulty screen')
    page.screenshot(path=f'{OUT}/08b-difficulty-advanced.png')
    adv.click()
    page.wait_for_selector('.table-seat--bottom .tile--discardable')
    page.locator('.table-seat--bottom .hand-concealed .tile--discardable').last.click()
    page.wait_for_timeout(300)
    saved = page.evaluate("JSON.parse(localStorage.getItem('mahjong:savegame:slot'))")
    snap = saved.get('data', saved) if isinstance(saved, dict) else {}
    ai_tiers = sorted({p.get('aiDifficulty') for p in snap.get('players', []) if p.get('seatKind') == 'ai'})
    check(snap.get('difficulty') == 'advanced' and ai_tiers == ['advanced'], f'save records Advanced for the session and every AI seat ({snap.get("difficulty")}, {ai_tiers})')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.click('text=Continue'); page.wait_for_selector('.game-screen .table')
    # Quit (no reload) so the session remembers the restored game's tier.
    pass_calls(page); page.click('.game-screen-pause'); page.wait_for_selector('.pause-menu')
    page.click('.pause-menu-btn:has-text("Quit")'); page.wait_for_selector('.main-menu')
    page.click('text=New Game'); page.click('.rule-selection-card[data-value="hong_kong"]')
    page.click('.player-count-selection-card[data-value="4"]'); page.wait_for_selector('.difficulty-selection')
    check(page.locator('.difficulty-selection-card--selected[data-value="advanced"]').count() == 1, 'the tier of the restored game is pre-selected next time')
    page.click('text=Back'); page.click('text=Back'); page.click('text=Back')
    page.wait_for_selector('.main-menu')
    if 'Continue' in page.locator('.main-menu-item').all_inner_texts():
        page.click('text=Continue')
    else:
        page.click('text=New Game'); page.click('.rule-selection-card[data-value="hong_kong"]')
        page.click('.player-count-selection-card[data-value="4"]'); page.click('.difficulty-selection-card[data-value="advanced"]')
    page.wait_for_selector('.game-screen .table')
    t = play_hand(page)
    check(t is not None, f'Advanced game plays a hand to the end ({t})')
    page.screenshot(path=f'{OUT}/08c-advanced-hand.png')

    # ── Task 102: Riichi and Chinese Official through the real UI ────────────
    def new_game(pg, ruleset, players, tier='basic'):
        pg.goto(f'{BASE}/index.html'); pg.wait_for_selector('.main-menu')
        if pg.locator('text=Continue').count():
            pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_selector('.main-menu')
        pg.click('text=New Game'); pg.click(f'.rule-selection-card[data-value="{ruleset}"]')
        pg.click(f'.player-count-selection-card[data-value="{players}"]'); pg.click(f'.difficulty-selection-card[data-value="{tier}"]')
        pg.wait_for_selector('.game-screen .table')

    def score_text(pg):
        return pg.locator('.score-screen').inner_text()

    print('▸ Riichi (4 players)')
    new_game(page, 'riichi', 4)
    page.wait_for_selector('.table-info-row--dora')
    check(page.locator('.table-info-row--dora .tile').count() == 1, 'the dora indicator is shown on the table')
    check(page.locator('.table-seat').count() == 4, 'four seats')
    page.screenshot(path=f'{OUT}/11-riichi-table.png')
    seen = {'riichi_prompt': False}
    def watch_riichi(pg):
        if pg.locator('.claim-prompt-btn--riichi').count(): seen['riichi_prompt'] = True
    titles = []
    for _ in range(3):
        t = play_hand(page, probe=watch_riichi)
        titles.append(t)
        txt = score_text(page)
        check(t is not None and 'undefined' not in txt and 'NaN' not in txt, f'Riichi round over: "{t}", no undefined / NaN on the panel')
        if 'Win' in (t or ''):
            check(' han' in txt and 'fan' not in txt, 'a Riichi win is scored in han (+ fu), never "fan"')
        page.screenshot(path=f'{OUT}/12-riichi-score.png')
        nxt = page.locator('.score-screen-btn:has-text("Next Hand")')
        if not nxt.count(): break
        nxt.click(); page.wait_for_timeout(50)
    check(len(titles) >= 1, f'Riichi hands played: {titles}')

    print('▸ Riichi: the human declares riichi (rigged hand, real GameScreen)')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.evaluate("""async () => {
      const [{ GameManager }, { WallManager }, { EventBus }, { Tile }, { RiichiRules }, { AIManager }, { BasicStrategy }, { renderGameScreen }, C] = await Promise.all([
        import('/src/core/GameManager.js'), import('/src/core/WallManager.js'), import('/src/core/EventBus.js'), import('/src/core/Tile.js'),
        import('/src/rules/riichi/RiichiRules.js'), import('/src/ai/AIManager.js'), import('/src/ai/basic/BasicStrategy.js'),
        import('/src/ui/components/GameScreen.js'), import('/src/utils/constants.js')]);
      let n = 0;
      const t = (id) => Tile.fromId(id, `${id}#rig${++n}`);
      const S = { d: 'dots', b: 'bamboo', c: 'characters' }; const H = { E: 'wind-east', S: 'wind-south', W: 'wind-west', N: 'wind-north', R: 'dragon-red', G: 'dragon-green', H: 'dragon-white' };
      const tl = (spec) => spec.split(' ').flatMap((part) => (H[part[0]] ? [...part].map((ch) => t(H[ch])) : [...part.slice(0, -1)].map((d) => t(`${S[part.at(-1)]}-${d}`))));
      const cfg = [0, 1, 2, 3].map((i) => ({ seatIndex: i, displayName: i ? `AI ${i}` : 'You', seatKind: i ? C.SEAT_KIND.AI : C.SEAT_KIND.HUMAN, aiDifficulty: i ? 'basic' : null }));
      const gm = new GameManager({ ruleEngine: new RiichiRules(), playerConfigs: cfg, aiManager: new AIManager({ strategies: [new BasicStrategy({ random: () => 0.5 })] }), eventBus: new EventBus(), seed: 1, dealerIndex: 0 });
      const hands = ['123d 456d 789d 55b 6b E', '258d 258b 258c ESW R', '369d 369b 369c NGH 1d', '147d 147b 147c ES 5c 8c'];
      gm.getPlayers().forEach((p, i) => { p.resetForNewHand(); for (const x of tl(hands[i])) p.addTileToHand(x); });
      const wall = new WallManager([...tl('7b 2c 2c 2c 3c 3c 3c 3c 4c 4c 4c 4c 6c 6c 6c 6c 7c 7c 7c 7c'), ...tl('1b 1b 1b 1b'), t('characters-9'), ...tl('1c 1c 1c 1c 9c 9c 9c 9c 9c')]);
      wall.reserveDeadWall(14);
      gm._wall = wall;
      gm.getTurnFlow().onHandStart();
      gm.getTurnManager().forceSetTurn(0, C.TURN_PHASE.AWAITING_DRAW);
      document.getElementById('app-root').hidden = true;
      const host = document.createElement('div'); host.id = 'rig-root'; document.body.appendChild(host);
      const { HintAdvisor } = await import('/src/ai/HintAdvisor.js');
      const adv = new HintAdvisor();
      const hints = { isEnabled: () => true, discard: (g, s, c) => adv.discardHint(g.getPlayer(s), c ?? g.getDecisionContext(s)), action: (g, s, a) => adv.actionHint(g.getPlayer(s), a, g.getDecisionContext(s)) };
      renderGameScreen(host, gm, { humanSeatIndex: 0, aiTurnDelayMs: 40, hints });
      window.__rig = gm;
    }""")
    page.wait_for_selector('#rig-root .claim-prompt-btn--riichi')
    page.click('#rig-root .claim-prompt-btn--hint')
    sug = page.locator('#rig-root .claim-prompt-btn--suggested').inner_text()
    ph = page.locator('#rig-root .claim-prompt-hint').inner_text()
    check(sug.startswith('Riichi') and 'Declare riichi' in ph and 'waiting on' in ph, f'Task 117: the prompt\'s Hint suggests riichi, the discard and the waits ("{ph[:90]}")')
    check(page.locator('#rig-root .claim-prompt-btn--riichi').inner_text().startswith('Riichi'), 'the draw offers Riichi')
    page.click('#rig-root .claim-prompt-btn--riichi')
    page.wait_for_selector('#rig-root .tile--locked')
    status = page.locator('#rig-root .game-screen-status').inner_text()
    enabled = page.locator('#rig-root .table-seat--bottom .hand-concealed .tile--discardable')
    locked = page.locator('#rig-root .table-seat--bottom .hand-concealed .tile--locked')
    check('Riichi' in status and enabled.count() >= 1 and locked.count() >= 1 and enabled.count() + locked.count() == 14, f'after choosing Riichi only tenpai-keeping discards are clickable ({enabled.count()} enabled, {locked.count()} locked; status "{status}")')
    page.screenshot(path=f'{OUT}/11b-riichi-declare.png')
    enabled.first.click()
    page.wait_for_selector('#rig-root .table-info-row--riichi')
    check('You' in page.locator('#rig-root .table-info-row--riichi').inner_text() and page.evaluate('window.__rig.getTurnFlow().isRiichi(0)'), 'riichi declared: the table shows it, the flow has it')
    page.wait_for_function("document.querySelectorAll('#rig-root .table-seat--bottom .hand-concealed .tile--discardable').length > 0 || !!document.querySelector('#rig-root .score-screen')", timeout=20000)
    if page.locator('#rig-root .score-screen').count():
        print('    (hand ended: ' + json.dumps(page.evaluate('JSON.stringify(window.__rig.getLastOutcome(), (k, v) => (k === "hand" || k === "score" || k === "breakdown") ? undefined : v)')) + ')')
    if not page.locator('#rig-root .score-screen').count():
        e2 = page.locator('#rig-root .table-seat--bottom .hand-concealed .tile--discardable').count()
        l2 = page.locator('#rig-root .table-seat--bottom .hand-concealed .tile--locked').count()
        check(e2 == 1 and l2 == 13, f'next turn in riichi: only the drawn tile can be discarded ({e2} enabled, {l2} locked)')
        page.click('#rig-root .game-screen-hint')
        lockh = page.locator('#rig-root .game-screen-hint-panel').inner_text()
        check('in riichi' in lockh and page.locator('#rig-root .tile--hinted.tile--discardable').count() == 1, f'Task 117: in riichi the hint explains the lock and marks the drawn tile ("{lockh.splitlines()[-1][:80]}")')
        page.locator('#rig-root .table-seat--bottom .hand-concealed .tile--locked').first.click(force=True)  # aria-disabled: Playwright won't click it, a user can
        page.wait_for_timeout(30)
        flash = page.locator('#rig-root .game-screen-status').inner_text()
        check('riichi' in flash.lower() and page.locator('#rig-root .game-screen-status--flash').count() == 1, f'Task 107: clicking a locked tile says why ("{flash}")')
        page.screenshot(path=f'{OUT}/11c-riichi-locked.png')
    check(page.evaluate('window.__rig.getPlayer(0).score') == 24000, 'the riichi stick (1000) was paid')
    you = page.locator('#rig-root .seat-label:has-text("You")').inner_text()
    check('24000' in you, f'the seat label shows the score after the stick ({you!r})')

    print('▸ Riichi (3 players): save + Continue')
    new_game(page, 'riichi', 3)
    check(page.locator('.table-seat').count() == 3, 'three seats')
    page.locator('.table-seat--bottom .hand-concealed .tile--discardable').last.click()
    page.wait_for_timeout(300)
    wall_before = page.locator('.wall-indicator').inner_text()
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.click('text=Continue'); page.wait_for_selector('.game-screen .table')
    check(page.locator('.table-seat').count() == 3 and page.locator('.table-info-row--dora .tile').count() >= 1, 'the 3-player Riichi save restores with three seats and its dora')
    t = play_hand(page)
    txt = score_text(page) if t else ''
    check(t is not None and 'undefined' not in txt, f'the restored 3-player Riichi hand plays to the end ("{t}")')
    page.screenshot(path=f'{OUT}/13-riichi-3p-restored.png')

    print('▸ Chinese Official (3 players)')
    new_game(page, 'chinese_official', 3)
    flowers = {'seen': False}
    def watch_flowers(pg):
        if pg.locator('.table-info-row--flowers .tile').count(): flowers['seen'] = True
    titles = []
    for _ in range(3):
        t = play_hand(page, probe=watch_flowers)
        titles.append(t)
        txt = score_text(page)
        check(t is not None and 'undefined' not in txt and 'NaN' not in txt, f'Chinese Official round over: "{t}", no undefined / NaN')
        if 'Win' in (t or ''):
            check(' pts' in txt and ' fan' not in txt, 'a Chinese Official win is scored in points')
        page.screenshot(path=f'{OUT}/14-mcr-score.png')
        nxt = page.locator('.score-screen-btn:has-text("Next Hand")')
        if not nxt.count(): break
        nxt.click(); page.wait_for_timeout(50)
    check(flowers['seen'], 'flowers set aside are shown on the table')
    check(page.evaluate('window.__tileAnims.flower') > 0, f"Task 105: new flowers pop in on the table ({page.evaluate('window.__tileAnims.flower')})")
    check(page.locator('.table-seat--bottom .hand-concealed svg[data-face^="flower"], .table-seat--bottom .hand-concealed svg[data-face^="season"]').count() == 0, 'no flower left in the hand')

    print('▸ Leaderboard tabs')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.click('text=Leaderboard'); page.wait_for_selector('.leaderboard-screen')
    tabs = page.locator('.leaderboard-screen-tab').all_inner_texts()
    check(len(tabs) >= 3, f'one leaderboard tab per ruleset ({tabs})')
    page.click('.leaderboard-screen-btn--primary')

    print('▸ Animations setting + reduced motion (Task 103)')
    def pause_anims(pg):
        pass_calls(pg); pg.click('.game-screen-pause'); pg.wait_for_selector('.pause-menu')
        a = pg.evaluate('window.__overlayAnims.filter((x) => x.cls.includes("pause-menu")).pop()')
        pg.click('.pause-menu-btn:has-text("Quit")'); pg.wait_for_selector('.main-menu')
        return a['n'] if a else None
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.evaluate('localStorage.clear()'); page.reload(); page.wait_for_selector('.main-menu')
    page.click('text=Settings'); page.wait_for_selector('.settings-menu')
    page.click('.settings-row--animations .settings-toggle'); page.click('text=Done'); page.wait_for_selector('.main-menu')
    new_game(page, 'hong_kong', 4)
    page.evaluate('window.__tileAnims = { discard: 0, draw: 0, ghost: 0, flower: 0 }')
    for _ in range(6):
        page.locator('.table-seat--bottom .hand-concealed .tile--discardable').last.click(); page.wait_for_timeout(150)
        if page.locator('.score-screen, .claim-prompt').count(): break
    ta = page.evaluate('window.__tileAnims')
    check(ta == {'discard': 0, 'draw': 0, 'ghost': 0, 'flower': 0} and page.locator('.tile-ghost').count() == 0, f'Animations off → tiles don\'t fly ({ta})')
    check(page.evaluate('document.body.dataset.motion') == 'off', 'Task 107: Animations off also stills CSS transitions (body[data-motion="off"])')
    if page.locator('.claim-prompt').count(): page.locator('.claim-prompt-btn--pass').click()
    if page.locator('.score-screen').count():
        page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu'); new_game(page, 'hong_kong', 4)
    check(pause_anims(page) == 0, 'Animations switched off in Settings → the pause card appears without animating')
    page.reload(); page.wait_for_selector('.main-menu')
    new_game(page, 'hong_kong', 4)
    check(pause_anims(page) == 0, '…and the setting survives a reload')
    page.click('text=Settings'); page.wait_for_selector('.settings-menu')
    page.click('.settings-row--animations .settings-toggle'); page.click('text=Done'); page.wait_for_selector('.main-menu')
    new_game(page, 'hong_kong', 4)
    check(pause_anims(page) >= 1, 'switched back on → it animates again')
    rm = browser.new_context(viewport={'width': 1280, 'height': 860}, reduced_motion='reduce')
    rm.add_init_script(SPEEDUP); rm.add_init_script(WATCH_ANIMS)
    rp = rm.new_page(); rp.on('pageerror', lambda e: errors.append(f'reduced-motion pageerror: {e}'))
    new_game(rp, 'hong_kong', 4)
    check(pause_anims(rp) == 0, 'OS "reduce motion" → no animation even with the setting on')
    rm.close()

    print('▸ Task 106: you win — the reveal and the confetti (rigged Tsumo, real GameScreen)')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.click('.app-toolbar-btn--sound'); page.click('.app-toolbar-btn--sound')  # a gesture: unlocks audio
    page.evaluate(RIG_HK_TSUMO)
    page.wait_for_selector('#rig-root .claim-prompt-btn--win')
    nodes0 = page.evaluate('window.__audioSpy.nodes')
    page.click('#rig-root .claim-prompt-btn--win')
    page.wait_for_selector('#rig-root .score-screen')
    rv = page.evaluate('window.__reveals.at(-1)')
    check(rv and rv['tiles'] == 14 and rv['moving'] == 14 and rv['rows'] >= 3, f'the 14 tiles flip in one by one, the score lines follow ({rv})')
    check(rv and rv['burst'] == 18, f'confetti when YOU win ({rv and rv["burst"]} pieces)')
    check(page.evaluate('window.__audioSpy.nodes') - nodes0 >= 10, 'Task 109: the win fanfare plays')
    page.wait_for_timeout(800)
    check(page.locator('#rig-root .win-burst').count() == 0, 'the confetti is cleared once it lands')
    page.screenshot(path=f'{OUT}/15-win-reveal.png')

    print('▸ Tasks 108-110: sound controls')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.click('text=Settings'); page.wait_for_selector('.settings-menu')
    rows = page.locator('.settings-row-label').all_inner_texts()
    check(all(x in rows for x in ['Volume', 'Sound effects', 'Music', 'Mute all']), f'Settings has the Sound group ({rows})')
    page.locator('#settings-music-volume').fill('0.6')
    check(page.evaluate("JSON.parse(localStorage.getItem('mahjong:settings:musicVolume'))") == 0.6, 'the Music slider is saved')
    page.click('text=Done'); page.wait_for_selector('.main-menu')
    new_game(page, 'hong_kong', 4)
    page.wait_for_timeout(400)
    check(page.evaluate('window.__audioSpy.nodes') > 0, 'Task 110: background music plays at the table')
    page.keyboard.press('m')
    check(page.get_attribute('.app-toolbar-btn--sound', 'aria-pressed') == 'true' and page.evaluate("JSON.parse(localStorage.getItem('mahjong:settings:muted'))") is True, 'M mutes (the button shows it, the setting is saved)')
    page.wait_for_timeout(300)
    n0 = page.evaluate('window.__audioSpy.nodes')
    for _ in range(3):
        t = page.locator('.table-seat--bottom .hand-concealed .tile--discardable')
        if not t.count() or page.locator('.score-screen, .claim-prompt').count(): break
        t.last.click(); page.wait_for_timeout(250)
    check(page.evaluate('window.__audioSpy.nodes') == n0, 'muted → no new sounds or music notes at all')
    page.click('.app-toolbar-btn--sound')
    check(page.get_attribute('.app-toolbar-btn--sound', 'aria-pressed') == 'false', 'the Sound button unmutes')
    tb = page.evaluate("(() => { const q = document.querySelector('.game-screen-quit').getBoundingClientRect(), t = document.querySelector('#app-toolbar').getBoundingClientRect(); return q.right <= t.left; })()")
    check(tb, 'the table\'s Quit button sits clear of the toolbar')

    print('▸ Task 113: How to Play')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.evaluate('localStorage.clear()'); page.reload(); page.wait_for_selector('.main-menu')
    labels = page.locator('.main-menu-item').all_inner_texts()
    check('How to Play' in labels and 'Rule Reference' in labels, f'the menu offers How to Play and Rule Reference ({labels})')
    page.click('text=How to Play'); page.wait_for_selector('.tutorial-card')
    nxt = lambda: page.click('.tutorial-nav .tutorial-btn--primary')
    fb = lambda: page.locator('.tutorial-feedback').inner_text()
    nxt()
    for i in (0, 4, 8): page.locator('.tutorial-tile').nth(i).click()
    check('Well done' in fb(), 'tiles: tap three, learn their names')
    nxt()
    for t in ('dots-3', 'dots-4', 'dots-5'): page.locator(f'.tutorial-tile[data-tile-id="{t}"]').first.click()
    page.click('.tutorial-check')
    check(fb() == 'Yes — 3-4-5 of Dots is a Chow.', f'sets: build a Chow ("{fb()}")')
    nxt(); page.locator('.tutorial-tile[data-tile-id="characters-8"]').click()
    check(fb().startswith('Right'), 'the 14th tile — judged by the real Hong Kong engine')
    nxt(); page.locator('.tutorial-tile[data-tile-id="wind-north"]').click()
    check(fb().startswith('Best choice') and '1 of Bamboo or 4 of Bamboo' in fb(), f'discard: the best tile, with its waits ("{fb()}")')
    page.screenshot(path=f'{OUT}/17-tutorial.png')
    page.reload(); page.wait_for_selector('.main-menu'); page.click('text=How to Play'); page.wait_for_selector('.tutorial-card')
    check(page.locator('.tutorial-progress').inner_text().lower() == 'step 5 of 9', f'leaving and coming back resumes at the same step ({page.locator(".tutorial-progress").inner_text()})')
    nxt(); page.click('text=Either a Chow or a Pung'); nxt(); page.click('text=No, not enough')
    check(fb().startswith('Right') and '2 fan; 3 needed' in fb(), 'scoring: the engine\'s breakdown explains why a complete hand can\'t win')
    nxt(); nxt()
    check(page.locator('.tutorial-score').inner_text() == 'You solved 6 of 6 exercises.', 'the last step counts the exercises solved')
    page.click('text=Play a practice game'); page.wait_for_selector('.game-screen .table')
    check(page.locator('.table-seat').count() == 4 and page.evaluate("JSON.parse(localStorage.getItem('mahjong:tutorial:finished'))") is True, 'Play a practice game → a 4-player Hong Kong table; the tutorial is marked finished')

    print('▸ Task 114: Rule Reference')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.click('text=Rule Reference'); page.wait_for_selector('.rule-reference')
    check(page.locator('.rule-reference-tab').count() == 3, 'a tab per ruleset')
    page.click('.rule-reference-tab[data-value="riichi"]')
    check(page.locator('.rule-reference-ruleset').inner_text().startswith('Riichi') and page.locator('.rule-reference-row[data-id="pinfu"]').count() == 1, 'Riichi: its yaku table')
    page.keyboard.press('ArrowRight')
    check(page.locator('.rule-reference-tab--selected').inner_text() == 'Chinese Official', 'arrow keys move between ruleset tabs')
    page.fill('.rule-reference-search-input', 'flush')
    cnt = page.locator('.rule-reference-search-count').inner_text()
    check(cnt.endswith('of 81') and page.locator('.rule-reference-row[data-id="full-flush"]').count() == 1, f'filtering the 81 fans ({cnt})')
    page.screenshot(path=f'{OUT}/18-rule-reference.png')
    page.click('.rule-reference-index-link[data-target="glossary"]')
    check(page.locator('.rule-reference-glossary-list dt').count() >= 8, 'the glossary')
    page.click('.rule-reference-back'); page.wait_for_selector('.main-menu')

    print('▸ Task 115: accessibility')
    AUDIT = """() => {
      const bad = [];
      const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || el.textContent || el.title || '').trim();
      for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], a[href]')) if (!el.closest('[hidden]') && !name(el)) bad.push('unnamed ' + el.tagName + '.' + el.className);
      for (const el of document.querySelectorAll('[role="img"]')) if (!el.getAttribute('aria-label')) bad.push('img without label .' + el.className);
      for (const el of document.querySelectorAll('input, select, textarea')) {
        const lab = el.id && document.querySelector(`label[for="${el.id}"]`) || el.closest('label') || el.getAttribute('aria-label');
        if (!lab) bad.push('unlabelled input #' + el.id);
      }
      for (const el of document.querySelectorAll('[tabindex]')) if (Number(el.getAttribute('tabindex')) > 0) bad.push('positive tabindex');
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      if (dup.length) bad.push('duplicate ids ' + dup.slice(0, 3));
      return bad.slice(0, 6); }"""
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    page.evaluate('localStorage.clear()'); page.reload(); page.wait_for_selector('.main-menu')
    screens = {}
    screens['menu'] = page.evaluate(AUDIT)
    for label, sel in [('New Game', '.rule-selection'), ('Settings', '.settings-menu'), ('Statistics', '.statistics-screen'), ('How to Play', '.tutorial-card'), ('Rule Reference', '.rule-reference')]:
        page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu'); page.click(f'text={label}'); page.wait_for_selector(sel)
        screens[label] = page.evaluate(AUDIT)
        if label == 'Settings': page.click('text=Done')
    check(all(not v for v in screens.values()), f'every screen: buttons named, images labelled, inputs labelled, no positive tabindex, no duplicate ids ({ {k: v for k, v in screens.items() if v} })')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    focused = page.evaluate('document.activeElement.textContent')
    page.keyboard.press('Enter'); page.wait_for_selector('.rule-selection')
    check(focused == 'New Game' and page.evaluate("document.activeElement.closest('.rule-selection') !== null"), f'keyboard: the menu starts on "{focused}"; Enter opens the next screen and focus lands in it')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    new_game(page, 'hong_kong', 4)
    page.wait_for_selector('.table-seat--bottom .tile--discardable')
    stops = page.evaluate("document.querySelectorAll('.table-seat--bottom .hand-concealed [tabindex=\"0\"]').length")
    check(stops == 1, f'your hand is one Tab stop ({stops})')
    page.focus('.table-seat--bottom .hand-concealed [tabindex="0"]')
    page.keyboard.press('Home')
    first = page.evaluate("[document.activeElement.dataset.instanceId, document.activeElement.getAttribute('aria-label')]")
    page.keyboard.press('ArrowRight')
    second = page.evaluate("[document.activeElement.dataset.instanceId, document.activeElement.getAttribute('aria-label')]")
    check(first[0] and second[0] and first[0] != second[0] and first[1].startswith('Discard'), f'arrow keys move between tiles ("{first[1]}" → "{second[1]}")')
    played = 0; escaped = 0
    for _ in range(8):
        if played >= 4: break
        # Task 118: a call on an opponent's discard — Escape passes it, and focus must come back to the hand.
        if page.locator('.claim-prompt').count() and 'discards' in page.locator('.claim-prompt-title').inner_text():
            page.keyboard.press('Escape'); escaped += 1
            try: page.wait_for_function("document.activeElement && document.activeElement.classList.contains('tile--discardable') || !!document.querySelector('.score-screen, .claim-prompt')", timeout=20000)
            except Exception: break
            continue
        if page.locator('.score-screen, .claim-prompt').count(): break
        page.keyboard.press('Enter'); played += 1
        try: page.wait_for_function("document.activeElement && document.activeElement.classList.contains('tile--discardable') || !!document.querySelector('.score-screen, .claim-prompt')", timeout=20000)
        except Exception: break
    focus_ok = page.evaluate("document.activeElement.classList.contains('tile--discardable') || !!document.querySelector('.score-screen, .claim-prompt')")
    check(played >= 2 and focus_ok, f'played {played} turns with Enter alone ({escaped} call offers passed with Escape) — after the opponents\' turns focus is back in your hand')
    said = page.evaluate("[...document.querySelectorAll('.announcer')].map((e) => e.textContent).join(' | ')")
    check(re.search(r'(discards?|draw) .+\.', said or '') is not None, f'the live region narrates the table ("{said[:90]}")')
    if not page.locator('.score-screen, .claim-prompt').count():
        page.keyboard.press('p'); page.wait_for_selector('.pause-menu')
        inside = page.evaluate("document.activeElement.closest('.pause-menu') !== null")
        for _ in range(8): page.keyboard.press('Tab')
        still = page.evaluate("document.activeElement.closest('.pause-menu') !== null")
        check(inside and still and page.locator('.pause-menu-keys kbd').count() >= 6, 'P pauses; focus is in the pause card and Tab stays inside it; the keys are listed')
        page.keyboard.press('Escape')
        check(page.locator('.pause-menu').count() == 0 and page.evaluate("document.activeElement.classList.contains('tile--discardable')"), 'Escape resumes, and focus returns to your hand')

    print('▸ Task 118: the regression matrix through the UI')
    for rs in ['hong_kong', 'riichi', 'chinese_official']:
        for pc in [4, 3]:
            for tier in ['basic', 'advanced']:
                new_game(page, rs, pc, tier)
                seats = page.locator('.table-seat').count()
                t = play_hand(page, max_steps=2500)
                check(seats == pc and t is not None and 'Round Over' in t, f'{rs} {pc}P {tier}: a whole hand through the real UI → "{t}"')

    print('▸ Task 118: calling a discard (Chi / Pon / Kong)')
    def play_until_call(pg, max_steps=3000):
        for _ in range(max_steps):
            if pg.locator('.score-screen').count():
                pg.locator('.score-screen button').first.click(); continue
            if pg.locator('.claim-prompt').count():
                if 'discards' in pg.locator('.claim-prompt-title').inner_text(): return True
                w = pg.locator('.claim-prompt-btn--win')
                (w.first if w.count() else pg.locator('.claim-prompt-btn--pass')).click(); continue
            tl_ = pg.locator('.table-seat--bottom .hand-concealed .tile--discardable')
            if tl_.count():
                try: tl_.nth(tl_.count() - 1).click(timeout=1500)
                except Exception: pass
                continue
            pg.wait_for_timeout(15)
        return False
    new_game(page, 'hong_kong', 4)
    got = play_until_call(page)
    title = page.locator('.claim-prompt-title').inner_text() if got else ''
    calls = page.locator('.claim-prompt-btn--pon, .claim-prompt-btn--chi, .claim-prompt-btn--kong')
    labels = calls.all_inner_texts() if got else []
    check(got and title.startswith('AI') and ' discards ' in title and calls.count() >= 1 and all(l.split()[0] in ('Pung', 'Chow', 'Kong') for l in labels), f'an opponent\'s discard you can call stops for you: "{title}" → {labels} (Hong Kong words)')
    page.screenshot(path=f'{OUT}/20-call.png')
    page.click('.claim-prompt-btn--hint')
    hint_txt = page.locator('.claim-prompt-hint').inner_text()
    focus_in = page.evaluate("!!document.activeElement.closest('.claim-prompt')")
    check(page.locator('.claim-prompt-btn--suggested').count() == 1 and ('Call ' in hint_txt or 'Pass on' in hint_txt) and focus_in, f'Hint suggests a call or a pass, focus stays in the prompt ("{hint_txt.splitlines()[0]}")')
    melds = page.locator('.table-seat--bottom .hand-meld').count()
    n_before = page.locator('.table-seat--bottom .hand-concealed .tile').count()
    calls.first.click(); page.wait_for_timeout(200)
    disc = page.locator('.table-seat--bottom .hand-concealed .tile--discardable').count()
    check(page.locator('.table-seat--bottom .hand-meld').count() == melds + 1 and disc >= 1 and page.locator('.claim-prompt').count() == 0, f'the call lands: a new meld, and it\'s your discard ({n_before} → {page.locator(".table-seat--bottom .hand-concealed .tile").count()} tiles in hand)')
    page.locator('.table-seat--bottom .hand-concealed .tile--discardable').first.click()
    got2 = play_until_call(page)
    t2 = page.locator('.claim-prompt-title').inner_text() if got2 else ''
    page.keyboard.press('Escape'); page.wait_for_timeout(120)
    after = page.locator('.claim-prompt-title').inner_text() if page.locator('.claim-prompt').count() else ''
    check(got2 and after != t2 or (got2 and page.locator('.claim-prompt').count() == 0), f'Escape passes on a call ("{t2}")')

    print('▸ Task 119: performance')
    new_game(page, 'hong_kong', 4)
    page.wait_for_selector('.table-seat--bottom .tile--discardable')
    page.locator('.table-seat--bottom .tile--discardable').last.click()
    pass_calls(page)
    page.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(150)
    paused = page.locator('.pause-menu').count() == 1 or page.locator('.claim-prompt').count() == 1
    page.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'))")
    check(paused, 'switching away from the tab pauses the game (or leaves a waiting prompt as it is)')
    if page.locator('.pause-menu').count():
        page.click('.pause-menu-btn--primary'); page.wait_for_selector('.pause-menu', state='detached')
    check(page.locator('.pause-menu').count() == 0, 'Resume continues')
    # Memory: several games through an in-page driver (no test-harness handles keep old screens alive).
    DRIVE = r"""(spec) => new Promise((resolve) => {
      const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)], click = (el) => el && el.click();
      const [rs, n, tier] = spec.split(':'); let stage = 0, hands = 0;
      const tick = () => {
        if (stage === 0) { click(qa('.main-menu-item').find((b) => b.textContent.includes('New Game'))); stage = 1; return setTimeout(tick, 30); }
        if (stage === 1) { const c = q(`.rule-selection-card[data-value="${rs}"]`); if (c) { click(c); stage = 2; } return setTimeout(tick, 30); }
        if (stage === 2) { const c = q(`.player-count-selection-card[data-value="${n}"]`); if (c) { click(c); stage = 3; } return setTimeout(tick, 30); }
        if (stage === 3) { const c = q(`.difficulty-selection-card[data-value="${tier}"]`); if (c) { click(c); stage = 4; } return setTimeout(tick, 30); }
        if (q('.pause-menu')) { click(qa('.pause-menu-btn').find((b) => /quit/i.test(b.textContent))); return setTimeout(() => resolve(hands), 200); }
        if (hands >= 1 && !q('.claim-prompt') && !q('.score-screen') && q('.game-screen-pause')) { click(q('.game-screen-pause')); return setTimeout(tick, 60); }
        if (q('.score-screen')) { hands++; click(q('.score-screen button')); return setTimeout(tick, 20); }
        if (q('.claim-prompt')) { click(q('.claim-prompt-btn--win') || q('.claim-prompt-btn--pass')); return setTimeout(tick, 20); }
        const t = qa('.table-seat--bottom .hand-concealed .tile--discardable'); if (t.length) { click(t[t.length - 1]); return setTimeout(tick, 20); }
        setTimeout(tick, 15);
      };
      tick();
    })"""
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu'); page.evaluate('localStorage.removeItem("mahjong:savegame:slot")'); page.reload(); page.wait_for_selector('.main-menu')
    cdp = ctx.new_cdp_session(page)
    def dom_nodes():
        page.wait_for_timeout(300)
        for _ in range(3): cdp.send('HeapProfiler.collectGarbage')
        return cdp.send('Memory.getDOMCounters')['nodes']
    menu_nodes = dom_nodes()
    page.evaluate(DRIVE, 'hong_kong:4:basic')  # warm-up: builds the tile templates (one drawing per face, kept on purpose)
    base_nodes = dom_nodes()
    page.evaluate("window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask' })")
    for spec in ['riichi:4:advanced', 'hong_kong:4:advanced', 'chinese_official:3:advanced', 'hong_kong:3:basic']:
        page.evaluate(DRIVE, spec)
    after_nodes = dom_nodes()
    lts = page.evaluate('window.__lt')
    check(base_nodes - menu_nodes < 600 and after_nodes <= base_nodes + 60, f'four more games played and quit: no DOM left behind ({base_nodes} → {after_nodes} nodes; the menu alone {menu_nodes}, + the tile templates)')
    check(max(lts or [0]) < 250, f'no long stall during Advanced hands ({len(lts)} tasks over 50 ms, worst {max(lts or [0])} ms)')

    print('▸ Tasks 116-117: hints')
    page.goto(f'{BASE}/index.html'); page.wait_for_selector('.main-menu')
    new_game(page, 'hong_kong', 4)
    page.wait_for_selector('.table-seat--bottom .tile--discardable')
    check(page.locator('.game-screen-hint').is_visible() and not page.locator('.game-screen-hint').is_disabled(), 'a Hint button on your turn')
    page.click('.game-screen-hint'); page.wait_for_selector('.game-screen-hint-panel:not([hidden])')
    txt = page.locator('.game-screen-hint-panel').inner_text()
    hinted = page.locator('.tile--hinted')
    check(hinted.count() == 1 and 'tile--discardable' in (hinted.get_attribute('class') or '') and ('Discard' in txt or 'Play safe' in txt), f'the suggested tile is marked and the panel explains ("{" ".join(txt.split())[:110]}")')
    check('undefined' not in txt and 'NaN' not in txt, 'no undefined / NaN in the advice')
    page.screenshot(path=f'{OUT}/19-hint.png')
    hinted.click(); page.wait_for_timeout(200)
    check(page.locator('.game-screen-hint-panel').is_hidden() and page.locator('.tile--hinted').count() == 0, 'discarding clears the hint')
    pass_calls(page); page.click('.game-screen-pause'); page.wait_for_selector('.pause-menu'); page.click('.pause-menu-btn:has-text("Quit")'); page.wait_for_selector('.main-menu')
    page.click('text=Settings'); page.wait_for_selector('.settings-menu')
    page.click('.settings-row--hints .settings-toggle'); page.click('text=Done'); page.wait_for_selector('.main-menu')
    new_game(page, 'hong_kong', 4)
    page.wait_for_selector('.table-seat--bottom .tile--discardable')
    page.keyboard.press('h'); page.wait_for_timeout(150)
    check(page.locator('.game-screen-hint').is_hidden() and page.locator('.game-screen-hint-panel').is_hidden(), 'Settings → Hints off: no button, and H does nothing')
    page.evaluate("localStorage.removeItem('mahjong:settings:hints')")
    new_game(page, 'chinese_official', 4)
    page.wait_for_selector('.table-seat--bottom .tile--discardable', timeout=20000)
    page.keyboard.press('h'); page.wait_for_selector('.game-screen-hint-panel:not([hidden])')
    ctxt = page.locator('.game-screen-hint-panel').inner_text()
    check('Discard' in ctxt and 'undefined' not in ctxt, f'Chinese Official: H gives a hint ("{" ".join(ctxt.split())[:110]}")')

    print('▸ Task 111: fullscreen')
    page.click('.app-toolbar-btn--fullscreen'); page.wait_for_timeout(300)
    check(page.evaluate('!!document.fullscreenElement') and page.evaluate("document.documentElement.hasAttribute('data-fullscreen')") and page.get_attribute('.app-toolbar-btn--fullscreen', 'aria-pressed') == 'true', 'the Fullscreen button puts the page fullscreen')
    page.keyboard.press('f'); page.wait_for_timeout(300)
    check(not page.evaluate('!!document.fullscreenElement') and page.get_attribute('.app-toolbar-btn--fullscreen', 'aria-pressed') == 'false', 'F leaves fullscreen; the button follows')

    print('▸ Task 112: responsive layout')
    LAYOUT = """() => {
      const vw = innerWidth, vh = innerHeight, r = (el) => el.getBoundingClientRect();
      const vis = (el) => el && getComputedStyle(el).display !== 'none' && r(el).width > 0;
      const hand = [...document.querySelectorAll('.table-seat--bottom .hand-concealed .tile')].map(r);
      const items = [];
      for (const s of ['.game-screen-pause', '.game-screen-quit', '.game-screen-hint']) { const el = document.querySelector(s); if (vis(el)) items.push([s, r(el)]); }
      document.querySelectorAll('#app-toolbar .app-toolbar-btn').forEach((el, i) => items.push(['tool' + i, r(el)]));
      document.querySelectorAll('.table-seat').forEach((seat, i) => {
        const l = seat.querySelector('.seat-label'); if (vis(l)) items.push(['label' + i, r(l)]);
        seat.querySelectorAll('.hand-concealed, .hand-meld').forEach((h) => { if (vis(h)) items.push(['seat' + i, r(h)]); }); });
      document.querySelectorAll('.table-center-discard').forEach((d, i) => d.querySelectorAll('.tile').forEach((t) => items.push(['pile' + i, r(t)])));
      const w = document.querySelector('.wall-indicator'); if (vis(w)) items.push(['wall', r(w)]);
      const hit = (a, b) => a.left + 1 < b.right - 1 && b.left + 1 < a.right - 1 && a.top + 1 < b.bottom - 1 && b.top + 1 < a.bottom - 1;
      const bad = new Set();
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const [a, ra] = items[i], [b, rb] = items[j];
        if (a === b || (a.startsWith('seat') && b.startsWith('seat') && a === b)) continue;
        if (hit(ra, rb)) bad.add(a + '×' + b); }
      return { layoutW: vw, sideways: document.scrollingElement.scrollWidth - vw,
        offscreen: hand.filter((b) => b.left < 0 || b.right > vw + 0.5).length, minTile: Math.min(...hand.map((b) => b.width)), overlaps: [...bad] }; }"""
    for (w, h, label) in [(360, 640, 'small phone'), (390, 844, 'phone'), (844, 390, 'phone landscape'), (768, 1024, 'tablet'), (1024, 768, 'tablet landscape'), (1920, 1080, 'desktop')]:
        touch = w < 900
        m = browser.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch)
        m.add_init_script(SPEEDUP)
        mp = m.new_page(); mp.on('pageerror', lambda e: errors.append(f'{label} pageerror: {e}'))
        mp.goto(f'{BASE}/index.html'); mp.wait_for_selector('.main-menu')
        menu_side = mp.evaluate('document.scrollingElement.scrollWidth - innerWidth')
        mp.click('text=New Game'); mp.click('.rule-selection-card[data-value="hong_kong"]')
        mp.click('.player-count-selection-card[data-value="4"]'); mp.click('.difficulty-selection-card[data-value="basic"]')
        mp.wait_for_selector('.table-seat--bottom .tile--discardable')
        for _ in range(10):
            t = mp.locator('.table-seat--bottom .hand-concealed .tile--discardable')
            if not t.count(): break
            t.last.click()
            try: mp.wait_for_selector('.table-seat--bottom .tile--discardable, .claim-prompt, .score-screen', timeout=15000)
            except Exception: break
            pass_calls(mp)  # Task 118: a call offer comes mid-animation (the discard still flying) — pass it and keep going
            if not mp.locator('.table-seat--bottom .tile--discardable').count():
                try: mp.wait_for_selector('.table-seat--bottom .tile--discardable, .claim-prompt, .score-screen', timeout=15000)
                except Exception: break
            if mp.locator('.claim-prompt, .score-screen').count(): break
            mp.wait_for_timeout(60)
        mp.wait_for_timeout(250)  # let any flight land before measuring
        lay = mp.evaluate(LAYOUT)
        check(lay['layoutW'] == w and lay['sideways'] <= 0 and menu_side <= 0, f'{label} {w}×{h}: no sideways scrolling (menu or table)')
        check(lay['offscreen'] == 0 and lay['minTile'] >= 30, f'{label}: every hand tile on screen, at least 30 px wide ({lay["minTile"]:.0f})')
        check(not lay['overlaps'], f'{label}: no seat, pile, label or control overlapping another ({lay["overlaps"][:4]})')
        mp.screenshot(path=f'{OUT}/16-{label.replace(" ", "-")}.png')
        m.close()

    real_errors = [e for e in errors if 'favicon' not in e]
    check(not real_errors, f'no page errors / console errors ({real_errors[:5]})')
    browser.close()

failed = [m for ok, m in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
