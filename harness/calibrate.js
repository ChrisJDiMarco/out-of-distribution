#!/usr/bin/env node
// Bot ladder: every bot level plays every other from randomized two-turn openings,
// once with each side moving first. Costs no model usage.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, applyMove, legalMoves, chooseMove } from '../engine/afterlight-engine.js';
import { mulberry32 } from './players.js';
import { resultOf, MAX_PLIES } from './match.js';

const ROOT = new URL('..', import.meta.url).pathname;
const LEVELS = ['random', 'easy', 'normal', 'hard'];
const GAMES_PER_ORDER = Number(process.argv[2] || 40);

function pick(level, state, rng) {
  if (level === 'random') { const moves = legalMoves(state); return moves[Math.floor(rng() * moves.length)]; }
  return chooseMove(state, { difficulty: level });
}

function play(amber, blue, seed) {
  const rng = mulberry32(seed);
  let state = createGame();
  for (let i = 0; i < 2; i++) { const moves = legalMoves(state); state = applyMove(state, moves[Math.floor(rng() * moves.length)]).state; }
  while (state.winner === null && state.ply < MAX_PLIES) state = applyMove(state, pick(state.turn === 0 ? amber : blue, state, rng)).state;
  return resultOf(state);
}

const pairs = [];
const started = Date.now();
for (const a of LEVELS) for (const b of LEVELS) {
  if (a === b) continue;
  const tally = { amber: a, blue: b, amberWins: 0, blueWins: 0, draws: 0, reasons: {}, plies: [] };
  for (let g = 0; g < GAMES_PER_ORDER; g++) {
    const r = play(a, b, 1000 * LEVELS.indexOf(a) + 100 * LEVELS.indexOf(b) + g + 1);
    if (r.winner === 'amber') tally.amberWins++; else if (r.winner === 'blue') tally.blueWins++; else tally.draws++;
    tally.reasons[r.reason] = (tally.reasons[r.reason] || 0) + 1;
    tally.plies.push(r.plies);
  }
  pairs.push(tally);
  console.log(`${a.padEnd(6)} (Amber) vs ${b.padEnd(6)}: ${tally.amberWins}-${tally.draws}-${tally.blueWins}  avg turns ${(tally.plies.reduce((s, x) => s + x, 0) / tally.plies.length).toFixed(1)}  ${JSON.stringify(tally.reasons)}`);
}

// Mirror matches from the true starting position (no random opening), for reference.
const mirrors = LEVELS.filter(l => l !== 'random').map(level => {
  let state = createGame();
  while (state.winner === null && state.ply < MAX_PLIES) state = applyMove(state, chooseMove(state, { difficulty: level })).state;
  return { level, ...resultOf(state) };
});

mkdirSync(join(ROOT, 'data', 'calibration'), { recursive: true });
const out = { createdAt: new Date().toISOString(), gamesPerOrder: GAMES_PER_ORDER, openingRandomTurns: 2, levels: LEVELS, pairs, mirrors, seconds: Math.round((Date.now() - started) / 1000) };
writeFileSync(join(ROOT, 'data', 'calibration', 'ladder.json'), JSON.stringify(out, null, 1));
console.log('mirrors:', JSON.stringify(mirrors));
console.log(`done in ${out.seconds}s`);
