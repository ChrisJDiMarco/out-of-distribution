// Vendored from ~/Projects/afterlight/src/engine.js (sha256 d1c89dd6efc111c4…) on 2026-09-26.
// Do not edit: the league's rules must match the shipped Afterlight game exactly.
/** Afterlight's deterministic rules. Ports: north 0, east 1, south 2, west 3. */
const SIZE = 6;
const PAIRS = [[1, 0, 3, 2], [3, 2, 1, 0]];
const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];
const TERMINAL = 1_000_000;

export function exitFor(tile, entry) {
  if ((tile !== 0 && tile !== 1) || !Number.isInteger(entry) || entry < 0 || entry > 3) {
    throw new RangeError('A switch must be 0 or 1 and its entry must be a port from 0 to 3.');
  }
  return PAIRS[tile][entry];
}

/** Neutral sparks are interchangeable; sorting makes array order irrelevant. */
export function positionKey(state) {
  const sparks = state.sparks.map(spark => `${spark.row * SIZE + spark.col}:${spark.entry}`).sort();
  return `${state.tiles.join('')}|${sparks.join(',')}|${state.scores.join(',')}|${state.turn}`;
}

function freezeState(state) {
  Object.freeze(state.tiles);
  for (const spark of state.sparks) Object.freeze(spark);
  Object.freeze(state.sparks);
  Object.freeze(state.scores);
  Object.freeze(state.repetitions);
  return Object.freeze(state);
}

export function createGame() {
  // Every tile and spark has a 180-degree partner. Neither collector is favored
  // by geometry; alternating first player is still recommended in a match.
  const half = [0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1];
  const points = [[1, 1, 0], [1, 3, 3], [2, 1, 1], [2, 4, 0]];
  const sparks = points.flatMap(([row, col, entry], index) => [
    { id: index * 2, row, col, entry },
    { id: index * 2 + 1, row: 5 - row, col: 5 - col, entry: (entry + 2) % 4 },
  ]);
  const state = {
    tiles: [...half, ...half.toReversed()],
    sparks,
    scores: [0, 0],
    turn: 0,
    ply: 0,
    winner: null,
    repetitions: {},
  };
  state.repetitions[positionKey(state)] = 1;
  return freezeState(state);
}

export function legalMoves(state) {
  if (state.winner !== null) return [];
  const occupied = new Set(state.sparks.map(spark => spark.row * SIZE + spark.col));
  const moves = [];
  for (let index = 0; index < SIZE * SIZE; index++) if (!occupied.has(index)) moves.push(index);
  moves.push(null);
  return moves;
}

function validateMove(state, move) {
  if (state.winner !== null) throw new Error('This game is over. Start a new game to continue.');
  if (move === null) return;
  if (!Number.isInteger(move) || move < 0 || move >= SIZE * SIZE) {
    throw new RangeError('Choose a tile from 0 to 35, or null to pass.');
  }
  if (state.sparks.some(spark => spark.row * SIZE + spark.col === move)) {
    throw new Error('Occupied switches cannot be flipped.');
  }
}

// Search uses the same transition as public play, without allocating animation
// records or freezing its private snapshots. No object from the input is changed.
function transition(before, move, withEvents = false) {
  const tiles = before.tiles.slice();
  const scores = before.scores.slice();
  const sparks = [];
  const events = [];
  const parity = new Uint8Array(SIZE * SIZE);
  if (move !== null) tiles[move] ^= 1;
  for (const spark of before.sparks) {
    const index = spark.row * SIZE + spark.col;
    const exit = PAIRS[tiles[index]][spark.entry];
    parity[index] ^= 1;
    let row = spark.row + DR[exit];
    const col = spark.col + DC[exit];
    let entry = (exit + 2) % 4;
    let reflected = false;
    let score = null;
    let to = null;
    if (col < 0 || col >= SIZE) {
      score = col < 0 ? 0 : 1;
      scores[score]++;
    } else {
      if (row < 0 || row >= SIZE) {
        row = spark.row;
        entry = exit;
        reflected = true;
      }
      to = { row, col, entry };
      sparks.push({ id: spark.id, ...to });
    }
    if (withEvents) {
      const from = Object.freeze({ row: spark.row, col: spark.col, entry: spark.entry });
      events.push(Object.freeze({ id: spark.id, from, exit, to: to && Object.freeze(to), score, reflected }));
    }
  }
  for (let index = 0; index < tiles.length; index++) tiles[index] ^= parity[index];
  let winner = scores[0] >= 5 ? 0 : scores[1] >= 5 ? 1 : scores[0] === 4 && scores[1] === 4 ? 'draw' : null;
  const state = {
    tiles, sparks, scores, turn: 1 - before.turn, ply: before.ply + 1,
    winner, repetitions: { ...before.repetitions },
  };
  const key = positionKey(state);
  state.repetitions[key] = (state.repetitions[key] || 0) + 1;
  if (winner === null && state.repetitions[key] >= 3) winner = 'draw';
  state.winner = winner;
  return { state, events };
}

export function applyMove(state, move) {
  validateMove(state, move);
  const result = transition(state, move, true);
  return Object.freeze({ state: freezeState(result.state), events: Object.freeze(result.events) });
}

function evaluate(state, side) {
  if (state.winner !== null) return state.winner === 'draw' ? 0 : state.winner === side ? TERMINAL : -TERMINAL;
  let value = (state.scores[1] - state.scores[0]) * 1200;
  // Short passive trajectories estimate the ownership of neutral light. Each
  // spark's estimate flips its own visited switches; shared visits are only
  // approximated here, never in actual rules or searched continuations.
  for (const spark of state.sparks) {
    let { row, col, entry } = spark;
    let visited = 0n;
    let captured = false;
    for (let step = 0; step < 8; step++) {
      const index = row * SIZE + col;
      const bit = 1n << BigInt(index);
      const tile = state.tiles[index] ^ ((visited & bit) === 0n ? 0 : 1);
      const exit = PAIRS[tile][entry];
      visited ^= bit;
      const nextRow = row + DR[exit];
      col += DC[exit];
      if (col < 0 || col >= SIZE) {
        value += (col < 0 ? -1 : 1) * (220 - step * 15);
        captured = true;
        break;
      }
      if (nextRow < 0 || nextRow >= SIZE) entry = exit;
      else { row = nextRow; entry = (exit + 2) % 4; }
    }
    if (!captured) value += (col - 2.5) * 8;
  }
  return side === 1 ? value : -value;
}

/** Local iterative alpha-beta search, bounded by nodes and a short time budget. */
export function chooseMove(state, { depth, difficulty = 'normal' } = {}) {
  if (state.winner !== null) return null;
  const targetDepth = Math.max(1, Math.min(4, Number.isFinite(depth) ? Math.floor(depth) : difficulty === 'easy' ? 1 : difficulty === 'hard' ? 3 : 2));
  const side = state.turn;
  const clock = () => globalThis.performance?.now() ?? Date.now();
  const deadline = clock() + 260;
  const budget = { nodes: 0, exhausted: false };
  const rootMoves = legalMoves(state);
  let bestMove = rootMoves[rootMoves.length - 1];

  function search(current, remaining, alpha, beta) {
    budget.nodes++;
    if (budget.nodes > 7000 || (budget.nodes % 32 === 0 && clock() >= deadline)) {
      budget.exhausted = true;
      return 0;
    }
    if (remaining === 0 || current.winner !== null) return evaluate(current, side);
    const maximizing = current.turn === side;
    const children = legalMoves(current).map(move => {
      const child = transition(current, move).state;
      return { child, value: evaluate(child, side) };
    });
    children.sort((a, b) => maximizing ? b.value - a.value : a.value - b.value);
    let best = maximizing ? -Infinity : Infinity;
    for (const { child } of children) {
      const value = search(child, remaining - 1, alpha, beta);
      if (budget.exhausted) return 0;
      if (maximizing) { best = Math.max(best, value); alpha = Math.max(alpha, best); }
      else { best = Math.min(best, value); beta = Math.min(beta, best); }
      if (beta <= alpha) break;
    }
    return best;
  }

  let candidates = rootMoves.map(move => {
    const child = transition(state, move).state;
    return { move, child, value: evaluate(child, side) };
  });
  // Stable tie order prefers passing over an irrelevant board change.
  candidates.sort((a, b) => b.value - a.value || (a.move === null ? -1 : b.move === null ? 1 : a.move - b.move));
  bestMove = candidates[0].move;
  for (let iteration = 1; iteration <= targetDepth; iteration++) {
    let iterationMove = bestMove;
    let best = -Infinity;
    const ranked = [];
    for (const candidate of candidates) {
      const value = search(candidate.child, iteration - 1, best, Infinity);
      if (budget.exhausted) break;
      ranked.push({ ...candidate, value });
      if (value > best) { best = value; iterationMove = candidate.move; }
    }
    if (budget.exhausted) break;
    bestMove = iterationMove;
    candidates = ranked.sort((a, b) => b.value - a.value);
    if (best >= TERMINAL) break;
  }
  return bestMove;
}
