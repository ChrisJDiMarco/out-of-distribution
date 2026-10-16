// Records a ~30 s portrait trailer of the site: title cards plus real footage of a league game
// and the Battle screen. Frames come from Chrome's screencast (every repaint, full quality) and are
// encoded to a constant-frame-rate H.264 MP4 with ffmpeg.
// Usage: node media/trailer.mjs   (needs the preview server on :8934)
import { chromium } from '/Users/chrisdimarco/Projects/afterlight/node_modules/playwright-core/index.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SITE_URL = 'http://localhost:8934/';
const HERE = new URL('.', import.meta.url).pathname;
const FRAMES = join(HERE, 'frames');
const OUT = join(HERE, 'out-of-distribution-trailer.mp4');
const EXE = '/Users/chrisdimarco/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const FEATURED = 'r1--bot-hard--vs--claude-opus-5-5--1'; // Opus (Blue) beats the hard bot 5-2
const START_INDEX = 9; // show the last four turns: Opus sets up the win in its own words

const TRAILER_CSS = `
  #tcard { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; opacity: 0; transition: opacity .35s ease; pointer-events: none;
    background: radial-gradient(120% 80% at 50% 38%, #10202f 0%, #070d15 70%); }
  #tcard.on { opacity: 1; }
  #tcard .inner { width: 86%; display: grid; gap: 16px; }
  #tcard .eyebrow { font: 500 12px/1 "IBM Plex Mono", monospace; letter-spacing: .16em; text-transform: uppercase; color: #93a3b3; display: flex; gap: 10px; align-items: center; }
  #tcard .eyebrow::before { content: ""; width: 28px; height: 2px; background: linear-gradient(90deg, #f0b769, #8dd4ed); border-radius: 2px; }
  #tcard h1 { font: 900 46px/.94 "Big Shoulders Display", sans-serif; text-transform: uppercase; color: #e8eef3; margin: 0; letter-spacing: .005em; }
  #tcard h1 .a { color: #f0b769; } #tcard h1 .b { color: #8dd4ed; }
  #tcard p { font: 400 18px/1.4 "Hanken Grotesk", sans-serif; color: #cfd9e2; margin: 0; }
  #tlabel { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 50; font: 500 11px/1 "IBM Plex Mono", monospace; letter-spacing: .12em;
    text-transform: uppercase; color: #e8eef3; background: rgba(7, 13, 21, .88); border: 1px solid #1f2f3f; border-radius: 999px; padding: 9px 14px; opacity: 0; transition: opacity .3s ease; white-space: nowrap; }
  #tlabel.on { opacity: 1; }
  .caption .said { font-size: 16.5px !important; }
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 540, height: 675 }, deviceScaleFactor: 2 });
  await page.goto(SITE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('#seat-0 option[value="claude-complex"]')?.disabled, null, { timeout: 15000 });
  await page.addStyleTag({ content: TRAILER_CSS });
  await page.evaluate(() => {
    const card = document.createElement('div');
    card.id = 'tcard';
    card.innerHTML = '<div class="inner"><div class="eyebrow">Out of Distribution</div><h1></h1><p></p></div>';
    document.body.append(card);
    const label = document.createElement('div');
    label.id = 'tlabel';
    document.querySelector('.stage-wrap').append(label);
  });

  const card = (title, sub) => page.evaluate(([t, s]) => {
    const el = document.querySelector('#tcard');
    el.querySelector('h1').innerHTML = t;
    el.querySelector('p').textContent = s;
    el.classList.add('on');
  }, [title, sub]);
  const hideCard = () => page.evaluate(() => document.querySelector('#tcard').classList.remove('on'));
  const label = text => page.evaluate(t => { const el = document.querySelector('#tlabel'); el.textContent = t; el.classList.toggle('on', Boolean(t)); }, text);

  // Start capturing every repaint.
  const client = await page.context().newCDPSession(page);
  const frames = [];
  client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = join(FRAMES, `${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    await client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  // Scene 1-2: the premise.
  await card('GPT-6 Astra invented <span class="a">a board game</span>', 'It was never published, so no AI has ever trained on it.');
  await sleep(450);
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1350, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  await sleep(3100);
  await card('Then Claude Opus 5.5 <span class="b">had to play it</span>', 'No tools. Just the rulebook and the board, as text.');
  // Behind the card: load the featured game near its end, at 2x.
  await page.click('#mode-watch');
  await page.selectOption('#match-select', FEATURED);
  await page.click('#btn-speed');
  await page.click(`#ticks .tick[data-i="${START_INDEX - 1}"]`);
  await sleep(3100);

  // Scene 3: real footage.
  await hideCard();
  await label('A real game · Opus 5.5 plays Blue');
  await sleep(1500);
  for (const hold of [4300, 1700, 4300, 2300]) {
    await page.click('#btn-next');
    await sleep(hold);
  }
  await label('');

  // Scene 4: the result.
  await card('Opus 5.5 vs <span class="a">a 90-line bot</span>', '1 win · 2 draws · 2 losses. It lost to 90 lines of JavaScript twice.');
  await sleep(700);
  await page.click('#mode-battle');
  await page.selectOption('#seat-0', 'claude-complex');
  await page.selectOption('#seat-1', 'bot-normal');
  await sleep(3000);

  // Scene 5: Battle.
  await hideCard();
  await label('Now bring your own Claude');
  await sleep(3600);
  await label('');

  // Scene 6: end card.
  await card('Connect your Claude. <span class="a">Battle it.</span>', 'Out of Distribution · link in the post');
  await sleep(3200);

  await client.send('Page.stopScreencast');
  await browser.close();

  // Constant 30 fps from the variable-rate screencast, trimmed to the moment capture began.
  const kept = frames.filter(f => f.t >= t0 - 0.05);
  const lines = [];
  kept.forEach((f, i) => {
    const next = kept[i + 1]?.t ?? f.t + 0.5;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${kept.at(-1).file}'`);
  const list = join(FRAMES, 'list.txt');
  writeFileSync(list, lines.join('\n'));
  const total = kept.at(-1).t - kept[0].t + 0.5;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=30,scale=1080:1350:flags=lanczos,fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.6).toFixed(2)}:d=0.6,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', OUT]);
  console.log(`frames captured: ${frames.length}, used: ${kept.length}, length ≈ ${total.toFixed(1)} s`);
  console.log(OUT);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
