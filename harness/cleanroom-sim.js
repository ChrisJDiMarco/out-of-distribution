/**
 * Clean-room Afterlight simulator and renderPosition() parser.
 *
 * Written ONLY from rules/AFTERLIGHT_RULES.md and the text format produced by
 * harness/render.js renderPosition(state). It imports nothing (not the engine,
 * not render.js, not notation.js), so it cannot inherit engine behaviour.
 *
 * Representation
 *   - Cells are named A1..F6: columns A-F run west -> east, rows 1-6 run
 *     north -> south (A1 = north-west corner, F6 = south-east corner).
 *   - switches: { A1: '\\' | '/', ... } for all 36 cells.
 *   - sparks: [{ cell, heading }]. The side a spark entered through is always
 *     the side opposite its heading ("A spark that entered through the north
 *     side is heading south").
 *   - scores: { amber, blue }; ply = turns played; toMove derived from ply.
 *
 * Rulebook ambiguities and the literal reading chosen here
 *   A1 Repetition. "If the same position occurs for the third time, the game is
 *      a draw." The starting position counts as its first occurrence (it occurs
 *      when the game begins), even though checks run "after every advance".
 *   A2 Score overflow. Each collected spark scores 1 point, so several sparks
 *      collected in the winning advance can push a score past 5 (4 -> 6).
 *      Scores are never capped.
 *   A3 Turn cap. "a game that reaches 200 turns without a result is also a
 *      draw": after the 200th turn's advance, if no other rule ended the game,
 *      it is a draw. A win produced by that same advance stands.
 *   A4 The final advance is completed in full (moves, collections, flips)
 *      before the game is checked, so a finished position includes its flips.
 *   A5 The turn counter is not part of a "position"; the player to move is.
 *   A6 renderPosition() does not say who moves next. It is derived from
 *      "Turns played so far" plus "Amber takes the first turn": even -> Amber.
 *   A7 Pass is always legal, even when flips are available. A finished game
 *      has no legal moves.
 *   A8 The 4-4 rule is read literally as the score being exactly 4-4.
 */

export const SIZE = 6;
export const COLUMNS = 'ABCDEF';
export const HEADINGS = Object.freeze(['north', 'east', 'south', 'west']);
export const PASS = 'PASS';
export const WIN_SCORE = 5;
export const DRAW_SCORE = 4;
export const REPETITION_DRAW = 3;
export const TURN_LIMIT = 200;

const BACKSLASH = '\\';
const SLASH = '/';
export const GLYPHS = Object.freeze([BACKSLASH, SLASH]);

export const OPPOSITE = Object.freeze({ north: 'south', south: 'north', east: 'west', west: 'east' });

// "\ joins the cell's north side with its east side, and its south side with its west side."
// "/ joins the cell's north side with its west side, and its south side with its east side."
// Map: side a spark entered through -> side it leaves through.
export const TRACKS = Object.freeze({
  [BACKSLASH]: Object.freeze({ north: 'east', east: 'north', south: 'west', west: 'south' }),
  [SLASH]: Object.freeze({ north: 'west', west: 'north', south: 'east', east: 'south' }),
});

// The rulebook's table, kept separately so the tests can check the two
// descriptions agree: heading into the cell -> heading on leaving.
export const HEADING_TABLE = Object.freeze({
  [BACKSLASH]: Object.freeze({ south: 'east', north: 'west', east: 'south', west: 'north' }),
  [SLASH]: Object.freeze({ south: 'west', north: 'east', east: 'north', west: 'south' }),
});

const STEP = Object.freeze({ north: [-1, 0], east: [0, 1], south: [1, 0], west: [0, -1] });

export const cellName = (row, col) => `${COLUMNS[col]}${row + 1}`;
export const CELLS = Object.freeze(
  Array.from({ length: SIZE * SIZE }, (_, i) => cellName(Math.floor(i / SIZE), i % SIZE)),
);
const CELL_ORDER = new Map(CELLS.map((name, i) => [name, i]));

export function cellCoords(name) {
  const index = CELL_ORDER.get(name);
  if (index === undefined) throw new Error(`not a cell: ${name}`);
  return { row: Math.floor(index / SIZE), col: index % SIZE };
}

export const sideToMove = ply => (ply % 2 === 0 ? 'amber' : 'blue');
const toggle = glyph => (glyph === BACKSLASH ? SLASH : BACKSLASH);

const compareSparks = (a, b) =>
  CELL_ORDER.get(a.cell) - CELL_ORDER.get(b.cell) || HEADINGS.indexOf(a.heading) - HEADINGS.indexOf(b.heading);

const canonicalSparks = sparks =>
  Object.freeze(sparks.map(s => Object.freeze({ cell: s.cell, heading: s.heading })).sort(compareSparks));

/** A position = switches, every spark's cell and heading, the score, the player to move. */
export function positionKey({ switches, sparks, scores, toMove }) {
  const board = CELLS.map(cell => (switches[cell] === BACKSLASH ? 'b' : 's')).join('');
  const lights = canonicalSparks(sparks).map(s => `${s.cell}${s.heading[0]}`).join(',');
  return `${board}|${lights}|${scores.amber}-${scores.blue}|${toMove}`;
}

function makePosition({ switches, sparks, scores, ply }) {
  return {
    switches: Object.freeze({ ...switches }),
    sparks: canonicalSparks(sparks),
    scores: Object.freeze({ amber: scores.amber, blue: scores.blue }),
    ply,
    toMove: sideToMove(ply),
  };
}

/** Start a game at a position; that position is its own first occurrence (A1). */
export function startGame(position) {
  const base = makePosition(position);
  return Object.freeze({ ...base, result: null, history: new Map([[positionKey(base), 1]]) });
}

/**
 * Continue a game from a (re-parsed) position whose occurrence is already
 * counted in `history` (the history returned by the previous applyTurn).
 */
export function resumeGame(position, history) {
  const base = makePosition(position);
  if (!history.get(positionKey(base))) throw new Error('resumeGame: position missing from its history');
  return Object.freeze({ ...base, result: null, history });
}

export function legalMoves(game) {
  if (game.result) return [];
  const occupied = new Set(game.sparks.map(s => s.cell));
  return [...CELLS.filter(cell => !occupied.has(cell)), PASS];
}

function flipForMove(game, move) {
  if (move === PASS) return game.switches;
  cellCoords(move);
  if (game.sparks.some(s => s.cell === move)) throw new Error(`illegal flip ${move}: the cell holds a spark`);
  return Object.freeze({ ...game.switches, [move]: toggle(game.switches[move]) });
}

/** One simultaneous advance. Every spark reads the switch before any flip. */
export function advance(switches, sparks) {
  const moved = [];
  const departures = new Map();
  const collected = { amber: 0, blue: 0 };
  let bounces = 0;
  for (const spark of sparks) {
    const { row, col } = cellCoords(spark.cell);
    const exit = TRACKS[switches[spark.cell]][OPPOSITE[spark.heading]];
    departures.set(spark.cell, (departures.get(spark.cell) || 0) + 1);
    const [dRow, dCol] = STEP[exit];
    const nextRow = row + dRow;
    const nextCol = col + dCol;
    if (nextCol < 0) {
      collected.amber += 1; // west edge: Amber's collector
    } else if (nextCol >= SIZE) {
      collected.blue += 1; // east edge: Blue's collector
    } else if (nextRow < 0 || nextRow >= SIZE) {
      // Wall: stays, now entered through the wall side, heading reversed.
      bounces += 1;
      moved.push({ cell: spark.cell, heading: OPPOSITE[exit] });
    } else {
      moved.push({ cell: cellName(nextRow, nextCol), heading: exit });
    }
  }
  // Flips count per departing spark (collected and bounced sparks included).
  const flipped = Object.fromEntries(
    CELLS.map(cell => [cell, (departures.get(cell) || 0) % 2 === 1 ? toggle(switches[cell]) : switches[cell]]),
  );
  const doubleDepartures = [...departures.values()].filter(n => n >= 2).length;
  return {
    switches: Object.freeze(flipped),
    sparks: canonicalSparks(moved),
    collected: Object.freeze(collected),
    events: Object.freeze({ bounces, doubleDepartures }),
  };
}

function judge({ scores, ply }, occurrences) {
  if (scores.amber >= WIN_SCORE) return Object.freeze({ outcome: 'amber', reason: 'five' });
  if (scores.blue >= WIN_SCORE) return Object.freeze({ outcome: 'blue', reason: 'five' });
  if (scores.amber === DRAW_SCORE && scores.blue === DRAW_SCORE) return Object.freeze({ outcome: 'draw', reason: 'four-all' });
  if (occurrences >= REPETITION_DRAW) return Object.freeze({ outcome: 'draw', reason: 'repetition' });
  if (ply >= TURN_LIMIT) return Object.freeze({ outcome: 'draw', reason: 'turn-limit' });
  return null;
}

/** Apply one turn: optional flip of an empty cell (or PASS), then the advance, then the checks. */
export function applyTurn(game, move) {
  if (game.result) throw new Error('the game is already over');
  const afterFlip = flipForMove(game, move);
  const { switches, sparks, collected, events } = advance(afterFlip, game.sparks);
  const next = makePosition({
    switches,
    sparks,
    scores: { amber: game.scores.amber + collected.amber, blue: game.scores.blue + collected.blue },
    ply: game.ply + 1,
  });
  const key = positionKey(next);
  // Scores never fall and are part of a position, so after a collection no
  // earlier position can recur: starting a fresh history is equivalent.
  const prior = collected.amber + collected.blue > 0 ? new Map() : game.history;
  const history = new Map(prior).set(key, (prior.get(key) || 0) + 1);
  return Object.freeze({ ...next, history, result: judge(next, history.get(key)), collected, events });
}

/** How many times the game's current position has occurred so far (including now). */
export const occurrences = game => game.history.get(positionKey(game)) || 0;

// ---------------------------------------------------------------------------
// Parser for the exact text returned by renderPosition(state).
// ---------------------------------------------------------------------------

const SCORE_LINE =
  /^Score: Amber (\d+), Blue (\d+)\. Sparks still on the board: (\d+)\. Turns played so far: (\d+)\.$/;
const SWITCH_LEGEND =
  /^Switches \((\\|\/) joins (\w+) with (\w+) and (\w+) with (\w+); (\\|\/) joins (\w+) with (\w+) and (\w+) with (\w+)\):$/;
const SPARK_LEGEND = 'Sparks (arrow = heading, the direction the spark was travelling when it entered its cell; on the next advance the switch in that cell turns it 90 degrees. A digit means that many sparks share the cell):';
const SPARK_LINE =
  /^- ([A-F][1-6]): heading (north|east|south|west) \(it entered this cell through its (north|east|south|west) side\)$/;
const ARROW_HEADING = Object.freeze({ '^': 'north', '>': 'east', v: 'south', '<': 'west' });

function fail(message) {
  throw new Error(`renderPosition text: ${message}`);
}

function legendTracks(match) {
  const tracks = {};
  for (const [glyph, a, b, c, d] of [match.slice(1, 6), match.slice(6, 11)]) {
    tracks[glyph] = { [a]: b, [b]: a, [c]: d, [d]: c };
  }
  return tracks;
}

function checkLegend(line) {
  const match = SWITCH_LEGEND.exec(line) || fail(`unexpected switch legend: ${line}`);
  const fromLegend = legendTracks(match);
  for (const glyph of GLYPHS) {
    for (const side of HEADINGS) {
      if (fromLegend[glyph]?.[side] !== TRACKS[glyph][side]) {
        fail(`switch legend contradicts the rulebook for ${glyph} entered from ${side}`);
      }
    }
  }
}

function parseGrid(header, rows, isAllowed, label) {
  const positions = [...COLUMNS].map(letter => header.indexOf(letter));
  const ordered = positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]));
  if (!ordered || header.replace(/[A-F]/g, ' ').trim() !== '') fail(`${label}: bad column header "${header}"`);
  return rows.map((line, r) => {
    const rowLabel = line.slice(0, positions[0]).trim();
    if (rowLabel !== String(r + 1)) fail(`${label}: expected row label ${r + 1}, got "${line}"`);
    if (line.length !== positions[SIZE - 1] + 1) fail(`${label}: row ${r + 1} has the wrong width: "${line}"`);
    for (let i = positions[0]; i < line.length; i++) {
      if (!positions.includes(i) && line[i] !== ' ') fail(`${label}: row ${r + 1} is misaligned: "${line}"`);
    }
    return positions.map(p => {
      const ch = line[p];
      if (!isAllowed(ch)) fail(`${label}: unexpected symbol "${ch}" in row ${r + 1}`);
      return ch;
    });
  });
}

function parseSparkList(lines) {
  if (lines.length === 1 && lines[0] === '- none') return [];
  return lines.map(line => {
    const match = SPARK_LINE.exec(line) || fail(`bad spark list line: "${line}"`);
    const [, cell, heading, entered] = match;
    if (OPPOSITE[heading] !== entered) fail(`spark at ${cell} heads ${heading} but entered through its ${entered} side`);
    return { cell, heading };
  });
}

function crossCheckSparkMap(map, sparks) {
  CELLS.forEach((cell, i) => {
    const symbol = map[Math.floor(i / SIZE)][i % SIZE];
    const here = sparks.filter(s => s.cell === cell);
    const expected = here.length === 0 ? '.' : here.length === 1 ? null : String(here.length);
    if (expected === null) {
      if (ARROW_HEADING[symbol] !== here[0].heading) fail(`spark map shows "${symbol}" at ${cell}, list says ${here[0].heading}`);
    } else if (symbol !== expected) {
      fail(`spark map shows "${symbol}" at ${cell}, list has ${here.length} spark(s)`);
    }
  });
}

/** Parse renderPosition(state) text back into { switches, sparks, scores, ply, toMove }. */
export function parseRenderedPosition(text) {
  const lines = text.split('\n');
  const at = (i, expected) => {
    if (lines[i] === undefined) fail(`text ends early at line ${i + 1}`);
    if (expected !== undefined && lines[i] !== expected) fail(`line ${i + 1} should be "${expected}", got "${lines[i]}"`);
    return lines[i];
  };
  const score = SCORE_LINE.exec(at(0)) || fail(`bad score line: "${lines[0]}"`);
  at(1, '');
  checkLegend(at(2));
  const switchGrid = parseGrid(at(3), [4, 5, 6, 7, 8, 9].map(i => at(i)), ch => GLYPHS.includes(ch), 'switch grid');
  at(10, '');
  at(11, SPARK_LEGEND);
  const sparkMap = parseGrid(
    at(12),
    [13, 14, 15, 16, 17, 18].map(i => at(i)),
    ch => ch === '.' || ch in ARROW_HEADING || /^[2-8]$/.test(ch),
    'spark map',
  );
  at(19, '');
  at(20, 'Spark list:');
  const sparks = parseSparkList(lines.slice(21));
  crossCheckSparkMap(sparkMap, sparks);
  const sparkCount = Number(score[3]);
  if (sparkCount !== sparks.length) fail(`score line says ${sparkCount} sparks, list has ${sparks.length}`);
  const switches = Object.fromEntries(CELLS.map((cell, i) => [cell, switchGrid[Math.floor(i / SIZE)][i % SIZE]]));
  return makePosition({
    switches,
    sparks,
    scores: { amber: Number(score[1]), blue: Number(score[2]) },
    ply: Number(score[4]),
  });
}

/** Plain, comparable snapshot of a position (for assertions and diffs). */
export function snapshot(position) {
  return {
    switches: CELLS.map(cell => position.switches[cell]).join(''),
    sparks: canonicalSparks(position.sparks).map(s => `${s.cell}:${s.heading}`),
    scores: `${position.scores.amber}-${position.scores.blue}`,
    ply: position.ply,
    toMove: position.toMove,
  };
}
