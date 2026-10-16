import { readFileSync } from 'node:fs';
import { buildPrompt as buildWithRules } from './prompt-core.js';

export { PROMPT_VERSION, SYSTEM_PROMPT, OUTPUT_SCHEMA, repetitionEndingMoves, extractJson, parseDecision } from './prompt-core.js';

export const RULES = readFileSync(new URL('../rules/AFTERLIGHT_RULES.md', import.meta.url), 'utf8').trim();

export function buildPrompt(args) {
  return buildWithRules({ rules: RULES, ...args });
}
