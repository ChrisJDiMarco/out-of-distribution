// Pure prompt building and reply parsing, shared by the league harness and the website.
import { legalMoves, applyMove } from '../engine/afterlight-engine.js';
import { SIDE_LABELS, parseMoveText, moveName } from './notation.js';
import { renderPosition, renderLegalMoves, repetitionNote, describeLastMove } from './render.js';

// v1: pilot game. v2: arrow legend explains the 90-degree turn; repetition-ending moves are listed.
export const PROMPT_VERSION = 2;

/** Players have no memory between turns, so the prompt names moves that would end the game by repetition. */
export function repetitionEndingMoves(state) {
  return legalMoves(state).filter(move => {
    const next = applyMove(state, move).state;
    return next.winner === 'draw' && !(next.scores[0] === 4 && next.scores[1] === 4);
  });
}

// Identical for every model. It names the task and nothing about the league or opponents.
export const SYSTEM_PROMPT = [
  'You are playing Afterlight, a two-player strategy game, in a real match.',
  'You receive the complete rules and the current position. Choose the best legal move for your side.',
  'You have no tools. Work it out yourself; take as much thinking as you need.',
  'Reply with only the JSON object requested.',
].join(' ');

export const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    move: { type: 'string', description: 'A cell such as C4 to flip that switch, or PASS.' },
    commentary: { type: 'string', description: 'One or two sentences for spectators explaining the idea behind the move, at most 240 characters.' },
  },
  required: ['move', 'commentary'],
  additionalProperties: false,
});

const COMMENTARY_LIMIT = 240;

export function buildPrompt({ rules, state, lastPly, previousErrors = [] }) {
  const side = state.turn;
  const me = SIDE_LABELS[side];
  const edge = side === 0 ? 'WEST edge (left of column A)' : 'EAST edge (right of column F)';
  const retry = previousErrors.length
    ? `\n\nYour previous reply was rejected: ${previousErrors.at(-1)} Choose again from the legal moves listed above.`
    : '';
  const repeat = repetitionNote(state);
  const ending = repetitionEndingMoves(state);
  const endingNote = ending.length
    ? `History note: ${ending.map(moveName).join(', ')} would repeat an earlier position for the third time, which ends the game immediately as a draw.`
    : '';
  return [
    '# Rules',
    rules,
    '',
    '# Your match',
    `You are ${me.toUpperCase()}. You collect sparks that leave across the ${edge}. It is your turn.`,
    describeLastMove(lastPly),
    '',
    '# Current position',
    renderPosition(state),
    ...(repeat ? ['', repeat] : []),
    '',
    '# Your move',
    `Legal moves: ${renderLegalMoves(state)}.`,
    ...(endingNote ? [endingNote] : []),
    'Reply with JSON only, exactly in this shape:',
    '{"move": "<a cell such as C4, or PASS>", "commentary": "<one or two sentences for spectators explaining your idea, at most 240 characters>"}',
  ].join('\n') + retry;
}

/** Pulls the first JSON object out of a reply, tolerating code fences and stray prose. */
export function extractJson(text) {
  if (text && typeof text === 'object') return text;
  if (typeof text !== 'string') return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* try the next candidate */ }
  }
  return null;
}

/** Validates a reply against the live position. Never throws. */
export function parseDecision(reply, state) {
  const data = extractJson(reply);
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'It was not the JSON object requested.' };
  }
  const move = parseMoveText(data.move);
  if (move === undefined) {
    return { ok: false, error: `"${String(data.move).slice(0, 40)}" is not a cell like C4 or PASS.` };
  }
  const legal = legalMoves(state);
  if (!legal.includes(move)) {
    return { ok: false, error: `${moveName(move)} holds a spark, so it cannot be flipped.` };
  }
  const commentary = typeof data.commentary === 'string'
    ? data.commentary.trim().replace(/\s+/g, ' ').slice(0, COMMENTARY_LIMIT * 2)
    : '';
  return { ok: true, move, commentary };
}
