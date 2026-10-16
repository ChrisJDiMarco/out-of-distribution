// End-to-end check of the site in headless Chromium against the local preview build
// (which swaps the claude.ai viewer's `sample` for a stand-in that picks random legal moves).
// Usage: node tests/e2e-site.mjs [url]   (default http://localhost:8934/)
import { chromium } from '/Users/chrisdimarco/Projects/afterlight/node_modules/playwright-core/index.mjs';

const URL = process.argv[2] || 'http://localhost:8934/';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// Use the cached headless shell so no browser download is needed.
const executablePath = process.env.OOD_CHROME || '/Users/chrisdimarco/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function open({ reducedMotion = 'no-preference' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 }, reducedMotion });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('#seat-0 option[value="claude-complex"]')?.disabled, null, { timeout: 15000 });
  return page;
}

async function seats(page, a, b) {
  await page.selectOption('#seat-0', a);
  await page.selectOption('#seat-1', b);
  await page.click('#btn-begin');
}

try {
  // 1. Bot vs bot plays to the end card (reduced motion keeps it quick).
  {
    const page = await open({ reducedMotion: 'reduce' });
    await seats(page, 'bot-hard', 'bot-easy');
    await page.waitForSelector('#setup-result:not([hidden])', { timeout: 180000 });
    const result = await page.textContent('#setup-result');
    const clock = await page.textContent('#turn-v');
    check('bot vs bot reaches a result card', /wins|Draw/.test(result), result.trim());
    check('scorebug shows FINAL at the end', clock.trim() === 'FINAL', clock.trim());
    check('end card offers Play again', (await page.textContent('#btn-begin')).trim() === 'Play again');
    await page.click('#btn-moves-live');
    const rows = await page.locator('#plies .ply').count();
    check('moves panel lists every turn of the live game', rows > 5, `${rows} rows`);
    await page.close();
  }

  // 2. Claude (stand-in) vs bot with animations: moves land, captions quote Claude, pause/resume work.
  {
    const page = await open();
    await seats(page, 'claude-quick', 'bot-normal');
    await page.waitForFunction(() => Number(document.querySelector('#turn-v').textContent) >= 3, null, { timeout: 60000 });
    const quote = await page.evaluate(() => [...document.querySelectorAll('#plies .ply.s0 .txt')].map(n => n.textContent).find(Boolean) || '');
    check('Claude seat moves and its words reach the moves list', quote.includes('Preview stand-in'), quote.slice(0, 60));
    await page.click('#btn-pause');
    check('pause shows Resume', (await page.textContent('#btn-pause')).trim() === 'Resume');
    const pausedAt = await page.textContent('#turn-v');
    await page.waitForTimeout(3000);
    check('paused game does not advance', (await page.textContent('#turn-v')) === pausedAt, `turn ${pausedAt}`);
    await page.click('#btn-pause');
    await page.waitForFunction(t => document.querySelector('#turn-v').textContent !== t, pausedAt, { timeout: 30000 });
    check('resume continues the game', true);
    await page.close();
  }

  // 3. You vs bot: the human's turn shows Pass, and passing hands the move to the bot.
  {
    const page = await open({ reducedMotion: 'reduce' });
    await seats(page, 'human', 'bot-normal');
    await page.waitForSelector('#btn-pass:not([hidden])', { timeout: 10000 });
    check('human turn shows Pass and Flip', await page.isVisible('#btn-flip'));
    await page.click('#btn-pass');
    await page.waitForFunction(() => Number(document.querySelector('#turn-v').textContent) >= 2, null, { timeout: 15000 });
    check('after a pass the bot replies and it is the human turn again', await page.isVisible('#btn-pass'));
    await page.close();
  }

  // 4. Watch mode replays the recorded league game.
  {
    const page = await open();
    await page.click('#mode-watch');
    await page.waitForSelector('#big-play:not([hidden])');
    await page.click('#big-play');
    await page.waitForFunction(() => Number(document.querySelector('#turn-v').textContent) >= 1, null, { timeout: 20000 });
    const who = await page.textContent('#cap-who');
    check('watch replays the league game with captions', /flips|passes/i.test(who), who.trim().slice(0, 50));
    check('battle controls hide in watch mode', !(await page.isVisible('#battlebar')));
    await page.click('#mode-battle');
    check('switching back shows the battle bar', await page.isVisible('#battlebar'));
    await page.close();
  }
} catch (error) {
  check('run completed', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
}

check('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
