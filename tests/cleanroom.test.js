/**
 * Clean-room verification of Afterlight.
 *
 * harness/cleanroom-sim.js was written from rules/AFTERLIGHT_RULES.md and the
 * renderPosition() text format only, before the engine source was read. Here it
 * must agree with engine/afterlight-engine.js at every ply of thousands of games:
 * at each ply the simulator receives ONLY the parsed renderPosition() text (plus
 * its own repetition history kept since the start of the game), applies the same
 * move, and must predict the engine's next rendered position and result.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createGame, legalMoves, applyMove, positionKey, chooseMove } from '../engine/afterlight-engine.js';
import { renderPosition, renderLegalMoves, repetitionNote } from '../harness/render.js';
import { cellName, parseMoveText } from '../harness/notation.js';
import * as sim from '../harness/cleanroom-sim.js';

const RANDOM_GAMES = 3000;
const EASY_GAMES = 2000;
// Rulebook: "In this league, a game that reaches 200 turns without a result is also
// a draw." The engine has no such rule; the league's match runner stops at 200.
const LEAGUE_TURN_LIMIT = 200;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toText = move => (move === null ? sim.PASS : cellName(move));
const sorted = list => [...list].sort();

const randomPlayer = (state, rng) => {
  const moves = legalMoves(state);
  return moves[Math.floor(rng() * moves.length)];
};
const easyPlayer = state => chooseMove(state, { difficulty: 'easy' });

/** The result the league records: the engine's winner, plus the 200-turn cap. */
function leagueResult(state) {
  if (state.winner === 0 || state.winner === 1) return { outcome: state.winner === 0 ? 'amber' : 'blue', reason: 'five' };
  if (state.winner === 'draw') {
    const fourAll = state.scores[0] === 4 && state.scores[1] === 4;
    return { outcome: 'draw', reason: fourAll ? 'four-all' : 'repetition' };
  }
  return state.ply >= LEAGUE_TURN_LIMIT ? { outcome: 'draw', reason: 'turn-limit' } : null;
}

function parseLegalLine(text) {
  const match = /^(.*), or PASS$/.exec(text);
  assert.ok(match, `renderLegalMoves() text has an unexpected shape: ${text}`);
  return [...match[1].split(', '), sim.PASS];
}

function shownRepetitions(note) {
  if (note === '') return 0;
  const match = /has now occurred (\d+) times/.exec(note);
  assert.ok(match, `unexpected repetition note: ${note}`);
  return Number(match[1]);
}

function expectSame(context, what, cleanRoom, engine) {
  if (isDeepStrictEqual(cleanRoom, engine)) return;
  const where = typeof context === 'function' ? context() : context;
  assert.fail(`${where}: ${what} disagree\n  clean-room: ${JSON.stringify(cleanRoom)}\n  engine:     ${JSON.stringify(engine)}`);
}

function newStats() {
  return {
    games: 0, plies: 0, outcomes: {}, longest: 0,
    bounces: 0, doubleDepartures: 0, multiCollections: 0, overflowWins: 0,
    sharedCellPositions: 0, repeatedPositions: 0, engineIgnoresTurnCap: 0,
  };
}

function tally(stats, predicted, observed) {
  stats.plies += 1;
  stats.bounces += predicted.events.bounces;
  stats.doubleDepartures += predicted.events.doubleDepartures;
  if (predicted.collected.amber + predicted.collected.blue >= 2) stats.multiCollections += 1;
  if (new Set(observed.sparks.map(s => s.cell)).size < observed.sparks.length) stats.sharedCellPositions += 1;
  if (sim.occurrences(predicted) >= 2) stats.repeatedPositions += 1;
}

function finish(stats, predicted, next) {
  stats.games += 1;
  const key = `${predicted.result.outcome}/${predicted.result.reason}`;
  stats.outcomes[key] = (stats.outcomes[key] || 0) + 1;
  stats.longest = Math.max(stats.longest, predicted.ply);
  if (Math.max(predicted.scores.amber, predicted.scores.blue) > sim.WIN_SCORE) stats.overflowWins += 1;
  if (predicted.result.reason === 'turn-limit' && next.winner === null && legalMoves(next).length > 0) {
    stats.engineIgnoresTurnCap += 1;
  }
}

/** Plays one engine game, checking the clean-room prediction at every ply. */
function playCheckedGame({ seed, players, stats, start = createGame() }) {
  const rng = mulberry32(seed);
  let state = start;
  let observed = sim.parseRenderedPosition(renderPosition(state));
  let history = sim.startGame(observed).history;
  expectSame(`seed ${seed}, start`, 'occurrences of the start position', 1, state.repetitions[positionKey(state)]);
  for (;;) {
    const context = `seed ${seed}, turn ${state.ply + 1}`;
    const game = sim.resumeGame(observed, history);
    const mine = sorted(sim.legalMoves(game));
    expectSame(context, 'legal moves', mine, sorted(legalMoves(state).map(toText)));
    expectSame(context, 'renderLegalMoves() text', sorted(parseLegalLine(renderLegalMoves(state))), mine);
    const seen = sim.occurrences(game);
    expectSame(context, 'repetition note count', seen >= 2 ? seen : 0, shownRepetitions(repetitionNote(state)));

    const move = players[state.turn](state, rng);
    const text = toText(move);
    expectSame(context, 'move notation round trip', parseMoveText(text), move);
    const next = applyMove(state, move).state;
    const predicted = sim.applyTurn(game, text);
    observed = sim.parseRenderedPosition(renderPosition(next));
    const step = () => `${context} (${game.toMove} plays ${text})\n${renderPosition(state)}\n`;
    expectSame(step, 'next position', sim.snapshot(predicted), sim.snapshot(observed));
    expectSame(step, 'occurrences of the new position', sim.occurrences(predicted), next.repetitions[positionKey(next)]);
    expectSame(step, 'result', predicted.result && { ...predicted.result }, leagueResult(next));
    tally(stats, predicted, observed);
    if (predicted.result) {
      finish(stats, predicted, next);
      return { predicted, next };
    }
    state = next;
    history = predicted.history;
  }
}

function report(t, label, stats) {
  t.diagnostic(`${label}: ${stats.games} games, ${stats.plies} plies checked, longest ${stats.longest} turns`);
  t.diagnostic(`${label} outcomes: ${JSON.stringify(stats.outcomes)}`);
  t.diagnostic(
    `${label} coverage: bounces ${stats.bounces}, same-cell double departures ${stats.doubleDepartures}, ` +
      `multi-collection advances ${stats.multiCollections}, winning scores above 5 ${stats.overflowWins}, ` +
      `positions with shared cells ${stats.sharedCellPositions}, repeated positions ${stats.repeatedPositions}, ` +
      `turn-cap games the engine alone would continue ${stats.engineIgnoresTurnCap}`,
  );
}

test('rulebook: the track description and the heading table describe the same switches', () => {
  for (const glyph of sim.GLYPHS) {
    for (const entered of sim.HEADINGS) {
      assert.equal(sim.HEADING_TABLE[glyph][sim.OPPOSITE[entered]], sim.TRACKS[glyph][entered], `${glyph} from ${entered}`);
    }
  }
});

test('rendering: the start parses cleanly and is half-turn symmetric as the rulebook claims', () => {
  const start = sim.parseRenderedPosition(renderPosition(createGame()));
  assert.equal(start.sparks.length, 8);
  assert.deepEqual({ ...start.scores }, { amber: 0, blue: 0 });
  assert.equal(start.ply, 0);
  assert.equal(start.toMove, 'amber');
  const rotate = cell => {
    const { row, col } = sim.cellCoords(cell);
    return sim.cellName(sim.SIZE - 1 - row, sim.SIZE - 1 - col);
  };
  for (const cell of sim.CELLS) assert.equal(start.switches[rotate(cell)], start.switches[cell], `switch ${cell}`);
  const turned = start.sparks.map(s => `${rotate(s.cell)}:${sim.OPPOSITE[s.heading]}`);
  assert.deepEqual(sorted(turned), sorted(start.sparks.map(s => `${s.cell}:${s.heading}`)));
});

test(`${RANDOM_GAMES} random-vs-random games agree with the engine at every ply`, t => {
  const stats = newStats();
  for (let i = 0; i < RANDOM_GAMES; i++) {
    playCheckedGame({ seed: 1_000_000 + i, players: [randomPlayer, randomPlayer], stats });
  }
  assert.equal(stats.games, RANDOM_GAMES);
  report(t, 'random-vs-random', stats);
});

// Random play never reaches a third repetition or 200 turns, so two constructed
// positions exercise those rules. C3 '/', D3 '\', D4 '/', C4 '\' form a closed loop:
// a spark in C3 that entered from the south circles C3 -> D3 -> D4 -> C4 -> C3.
// Both players flip back the loop switch the spark just left, so it never escapes.
const LOOP = ['C3', 'D3', 'D4', 'C4'].map(parseMoveText);

function loopPosition(ply) {
  const tiles = new Array(36).fill(0);
  tiles[parseMoveText('C3')] = 1;
  tiles[parseMoveText('D4')] = 1;
  const state = { tiles, sparks: [{ id: 0, row: 2, col: 2, entry: 2 }], scores: [4, 3], turn: ply % 2, ply, winner: null, repetitions: {} };
  state.repetitions[positionKey(state)] = 1;
  return state;
}

const LOOP_TILES = loopPosition(0).tiles;
const restorer = state => {
  const occupied = new Set(state.sparks.map(s => s.row * 6 + s.col));
  return LOOP.find(index => state.tiles[index] !== LOOP_TILES[index] && !occupied.has(index)) ?? null;
};

test('targeted: a spark held on a closed loop ends in a third-repetition draw on turn 9', t => {
  const stats = newStats();
  const { predicted, next } = playCheckedGame({ seed: 3, players: [restorer, restorer], stats, start: loopPosition(100) });
  assert.deepEqual({ ...predicted.result }, { outcome: 'draw', reason: 'repetition' });
  assert.equal(next.winner, 'draw');
  assert.equal(predicted.ply, 109);
  report(t, 'repetition scenario', stats);
});

test('targeted: the league draw at 200 turns (the engine itself would play on)', t => {
  const stats = newStats();
  const { predicted, next } = playCheckedGame({ seed: 4, players: [restorer, restorer], stats, start: loopPosition(196) });
  assert.deepEqual({ ...predicted.result }, { outcome: 'draw', reason: 'turn-limit' });
  assert.equal(predicted.ply, LEAGUE_TURN_LIMIT);
  assert.equal(next.winner, null);
  assert.ok(legalMoves(next).length > 0);
  report(t, 'turn-cap scenario', stats);
});

test(`${EASY_GAMES} easy-bot-vs-random games agree with the engine at every ply`, t => {
  const stats = newStats();
  for (let i = 0; i < EASY_GAMES; i++) {
    const players = i % 2 === 0 ? [easyPlayer, randomPlayer] : [randomPlayer, easyPlayer];
    playCheckedGame({ seed: 2_000_000 + i, players, stats });
  }
  assert.equal(stats.games, EASY_GAMES);
  report(t, 'easy-vs-random', stats);
});
