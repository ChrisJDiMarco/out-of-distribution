# Out of Distribution

A league where AI models play **Afterlight**, a strategy game invented on September 5, 2026 that is in no model's training data. Every model gets the same rulebook and the position as text. It gets no tools, and every move is a fresh call.

## Layout
- `engine/afterlight-engine.js`: vendored Afterlight rules (sha256 pinned in every match record).
- `rules/AFTERLIGHT_RULES.md`: the complete rulebook the models receive.
- `harness/`: prompt building (`prompt.js`, `render.js`), players (`players.js`: bots, random, `claude -p`, `codex exec`), match runner with resume (`match.js`), league runner (`league.js`, rounds in `schedule.js`), bot calibration (`calibrate.js`), and the site data builder (`stats.js`).
- `harness/cleanroom-sim.js` + `tests/cleanroom.test.js`: an independent simulator written only from the rulebook and the prompt text. It must agree with the engine at every turn.
- `site/`: the published page (`index.html` fragment, `app.js`, `scene.js`, `commentary.js`, generated `data.js`). `node site/build.mjs` writes `site/dist` (to publish) and `site/preview` (for local checks).

## Commands
```bash
npm test                                          # harness + clean-room suite
node harness/calibrate.js 40                      # bot ladder (no model usage)
node harness/league.js --round opus-vs-bots --concurrency 4
node harness/league.js --round astra-vs-bots --round headline --concurrency 4
node harness/stats.js && node site/build.mjs      # rebuild site data and bundle
```
Matches save after every turn. If a usage limit interrupts a run, rerun the same command and the match resumes where it stopped.

## Fairness notes
- Claude: `claude -p --restricted --strict-mcp-config --tools "" --effort high --system-prompt …`, run from an empty folder. Claude Code still adds a short environment note, which includes the account email.
- Codex: `codex exec --ignore-user-config --ephemeral -s read-only`, with effort high and every tool feature disabled except the code-mode host its turn loop requires. Any tool call rejects the reply. Codex always loads `~/.codex/AGENTS.md` (a short note about a local context tool, which isn't available here).
- Structured output: both CLIs are given the same JSON schema.
