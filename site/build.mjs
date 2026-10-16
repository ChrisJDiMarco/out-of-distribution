// Assembles site/dist (the files that get published) and site/preview (the same page
// wrapped in a skeleton like the one the artifact host adds, for local checks).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const harness = join(here, '..', 'harness');
const dist = join(here, 'dist');
const preview = join(here, 'preview');
const MODULES = ['app.js', 'scene.js', 'commentary.js', 'data.js'];
// The site builds prompts with the same code the league uses, so Claude seats read identical text.
const SHARED = ['notation.js', 'render.js', 'prompt-core.js'];

for (const dir of [dist, preview]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }

const fragment = readFileSync(join(here, 'index.html'), 'utf8');

// Preview only: a stand-in for the claude.ai viewer's `sample`, which answers with a random legal
// move after a short pause. It is never published.
const MOCK = `<script>
window.claude = { use: async name => name !== 'sample' ? null : Object.assign(async (input, opts = {}) => {
  await new Promise((resolve, reject) => { const t = setTimeout(resolve, 1200); opts.signal?.addEventListener('abort', () => { clearTimeout(t); reject({ code: 'cancelled', message: 'cancelled' }); }); });
  const legal = (/Legal moves: (.*)\\.\\n/.exec(input)?.[1] || 'PASS').replace(', or PASS', ', PASS').split(', ');
  const move = legal[Math.floor(Math.random() * legal.length)];
  return { text: JSON.stringify({ move, commentary: 'Preview stand-in for Claude: ' + move + ' chosen at random.' }), truncated: false, modelTierApplied: opts.modelTier || 'default' };
}, { json: async () => ({}), limits: async () => ({ maxPromptBytes: 65536 }) }) };
</script>`;

const skeleton = page => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif;background:#f8f8f6}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
${MOCK}
${page}
</body></html>`;

writeFileSync(join(dist, 'index.html'), fragment);
writeFileSync(join(preview, 'index.html'), skeleton(fragment));
for (const dir of [dist, preview]) {
  for (const file of MODULES) copyFileSync(join(here, file), join(dir, file));
  copyFileSync(join(here, '..', 'engine', 'afterlight-engine.js'), join(dir, 'engine.js'));
  for (const file of SHARED) {
    const source = readFileSync(join(harness, file), 'utf8').replaceAll('../engine/afterlight-engine.js', './engine.js');
    writeFileSync(join(dir, file), source);
  }
}
console.log(`built ${dist} and ${preview}`);
