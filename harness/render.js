import { positionKey, legalMoves } from '../engine/afterlight-engine.js';
import { SIZE, COLUMNS, SIDE_LABELS, DIRECTIONS, ARROWS, SWITCH_GLYPHS, cellName, headingOf, moveName } from './notation.js';

const HEADER = `      ${[...COLUMNS].map(c => c.padEnd(3)).join(' ').trimEnd()}`;

function grid(cellText) {
  const rows = [HEADER];
  for (let row = 0; row < SIZE; row++) {
    const cells = [];
    for (let col = 0; col < SIZE; col++) cells.push(cellText(row * SIZE + col).padEnd(3));
    rows.push(`  ${row + 1}   ${cells.join(' ').trimEnd()}`);
  }
  return rows.join('\n');
}

function sparksByCell(state) {
  const map = new Map();
  for (const spark of state.sparks) {
    const index = spark.row * SIZE + spark.col;
    map.set(index, [...(map.get(index) || []), spark]);
  }
  return map;
}

/** The position exactly as a player needs it: switches, sparks, score and turn. */
export function renderPosition(state) {
  const byCell = sparksByCell(state);
  const switches = grid(index => SWITCH_GLYPHS[state.tiles[index]]);
  const sparkMap = grid(index => {
    const here = byCell.get(index);
    if (!here) return '.';
    return here.length === 1 ? ARROWS[headingOf(here[0].entry)] : String(here.length);
  });
  const sparkList = [...state.sparks]
    .sort((a, b) => a.row * SIZE + a.col - (b.row * SIZE + b.col) || a.entry - b.entry)
    .map(spark => `- ${cellName(spark.row * SIZE + spark.col)}: heading ${DIRECTIONS[headingOf(spark.entry)]} (it entered this cell through its ${DIRECTIONS[spark.entry]} side)`)
    .join('\n');
  return [
    `Score: Amber ${state.scores[0]}, Blue ${state.scores[1]}. Sparks still on the board: ${state.sparks.length}. Turns played so far: ${state.ply}.`,
    '',
    'Switches (\\ joins north with east and south with west; / joins north with west and south with east):',
    switches,
    '',
    'Sparks (arrow = heading, the direction the spark was travelling when it entered its cell; on the next advance the switch in that cell turns it 90 degrees. A digit means that many sparks share the cell):',
    sparkMap,
    '',
    'Spark list:',
    sparkList || '- none',
  ].join('\n');
}

export function renderLegalMoves(state) {
  const cells = legalMoves(state).filter(move => move !== null).map(cellName);
  return `${cells.join(', ')}, or PASS`;
}

export function repetitionNote(state) {
  const seen = state.repetitions[positionKey(state)] || 0;
  return seen >= 2
    ? `Warning: this exact position (switches, sparks, score and player to move) has now occurred ${seen} times. If it occurs a third time, the game ends in a draw.`
    : '';
}

export function describeLastMove(lastPly) {
  if (!lastPly) return 'This is the first turn of the game.';
  const who = SIDE_LABELS[lastPly.side === 'amber' ? 0 : 1];
  return lastPly.move === null ? `Last turn: ${who} passed.` : `Last turn: ${who} flipped ${moveName(lastPly.move)}.`;
}
