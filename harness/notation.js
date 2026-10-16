// Shared coordinates. They match the labels painted on the Afterlight board:
// columns A-F run west to east, rows 1-6 run north to south.
export const SIZE = 6;
export const COLUMNS = 'ABCDEF';
export const SIDES = Object.freeze(['amber', 'blue']);
export const SIDE_LABELS = Object.freeze(['Amber', 'Blue']);
export const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);
export const ARROWS = Object.freeze(['^', '>', 'v', '<']);
export const SWITCH_GLYPHS = Object.freeze(['\\', '/']);

export const cellName = index => `${COLUMNS[index % SIZE]}${Math.floor(index / SIZE) + 1}`;
export const moveName = move => (move === null ? 'PASS' : cellName(move));

/** A spark stores the port it entered through; its heading is the opposite side. */
export const headingOf = entry => (entry + 2) % 4;

/** Returns a cell index, null for a pass, or undefined when the text is not a move. */
export function parseMoveText(text) {
  if (typeof text !== 'string') return undefined;
  const cleaned = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned === 'PASS') return null;
  const match = /^([A-F])([1-6])$/.exec(cleaned);
  if (!match) return undefined;
  return (Number(match[2]) - 1) * SIZE + COLUMNS.indexOf(match[1]);
}
