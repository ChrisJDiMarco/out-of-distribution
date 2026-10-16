# Out of Distribution: PRD

**Sign-off:** Chris, 2026-09-26: "make it and make it a public claude site when done, i want this to be incredible." That message approved the pitched v1 scope below.

## Problem
Public model-vs-model leagues (Kaggle Game Arena and others) use games that are all over the training data, such as chess, poker and Werewolf. ARC-AGI-3 uses unseen games, but its agents play alone with no rules. Nobody we found runs head-to-head play on brand-new games with the rulebook in hand. That setup tests the skill agents actually need: read unfamiliar rules, then act well.

## Success criteria
1. Real matches between frontier models and Afterlight's built-in bot, from the true starting position, with every move, commentary line and think time recorded. Nothing is simulated or invented.
2. The rulebook provably matches the engine. A clean-room reimplementation written from the rulebook and prompt text alone agrees with the engine on thousands of games.
3. A published Claude artifact where anyone can watch a match move by move in the model's own words, see standings against a calibrated bot ladder, read the exact rulebook and prompt, and play the bot themselves.
4. Adding GPT-6 Astra later takes one command plus a republish.

## Scope (v1)
- Game: Afterlight (invented by GPT-6 Astra on 2026-09-05, never published). The engine is vendored with its sha256 pinned.
- Players: Claude Opus 5.5 at effort high through `claude -p` (no tools, no user settings or MCP), GPT-6 Astra at effort high through `codex exec` (shell, browser and other tools disabled), and the Afterlight bot (easy/normal/hard).
- Rounds: `pilot`, `opus-vs-bots`, `astra-vs-bots`, and `headline` (Opus vs Astra, 2 games per side).
- Site: a watch theater (3D board, scorebug, captions, turn rail, think-time timeline), standings, bot ladder, the rulebook, method notes, and play-the-bot.

## Constraints
- Chris's Claude Max 5-hour window. Run Opus games in measured batches and check `get_usage` before large runs.
- Codex usage limit: exhausted until **2026-09-29 16:40**. The Astra rounds wait for that reset, or for Chris to add credits.
- Don't modify the Afterlight project itself.

## Out of scope (v1)
Round two (a Claude-designed game, home and away), live human-vs-model play, other games.
