import { applyMove } from './engine.js';

const names = ['Amber', 'Blue'];
const tileName = index => `${String.fromCharCode(65 + index % 6)}${Math.floor(index / 6) + 1}`;
const count = n => `${n === 1 ? 'one spark' : `${n} sparks`}`;
const finish = state => state.winner === 'draw'
  ? (state.scores.every(score => score === 4) ? 'Four each. The light is shared, and the game is a draw.' : 'The position has repeated three times. The game is a draw.')
  : `${names[state.winner]} reaches ${state.scores[state.winner]} and wins.`;

/** Public move facts and a one-advance comparison, never the AI's private reasoning. */
export function explainMove(before, move, result) {
  const state = result.state;
  const side = before.turn;
  const actor = names[side];
  const other = names[1 - side];
  if (before.winner !== null) {
    return { title: 'The light settles', summary: 'The game is complete.', insight: 'Start a new game to watch another match.', consequence: finish(before), tag: 'FINALE' };
  }

  const arrivals = move === null ? 0 : state.sparks.filter(spark => spark.row * 6 + spark.col === move).length;
  const gained = state.scores.map((score, index) => score - before.scores[index]);
  let title = move === null ? ['Let it run', 'A turn of patience'][before.ply % 2] : `A turn at ${tileName(move)}`;
  let summary = move === null
    ? `${actor} passes. Every spark still advances, and the switches they leave still turn.`
    : arrivals
      ? `${actor} turns ${tileName(move)} to redirect ${count(arrivals)} arriving there on this advance.`
      : `${actor} turns the empty junction at ${tileName(move)} before letting the light advance.`;
  let insight = move === null
    ? 'Passing keeps the current routes in place for this advance. Timing can matter as much as turning a switch.'
    : arrivals
      ? `The turn changes their next exit. Once they arrive, the occupied junction is locked against ${other}'s reply.`
      : 'No spark reaches this junction yet. This is preparation; it changes no route on the current advance.';
  let tag = move === null ? 'WAITING' : arrivals ? 'TIMING' : 'PREPARATION';
  let consequence = gained.some(Boolean)
    ? `${gained.map((amount, index) => amount ? `${names[index]} collects ${count(amount)}` : '').filter(Boolean).join('; ')}. Those exits were already set before this move.`
    : `${state.sparks.length} sparks remain in motion. The score stays ${state.scores[0]}–${state.scores[1]}.`;
  if (gained.some(Boolean)) tag = 'COLLECTION';

  // All legal replies leave currently occupied switches untouched. Their next
  // exits and collections are therefore fixed, regardless of the reply chosen.
  if (state.winner === null) {
    const next = applyMove(state, null).state;
    const secured = next.scores[side] - state.scores[side];
    if (secured) {
      insight = `${actor} is guaranteed to collect ${count(secured)} on the next advance: ${other} cannot turn the occupied departure junctions.`;
      tag = 'COLLECTION';
    }
    if (move !== null && arrivals) {
      const passed = applyMove(before, null).state;
      if (passed.winner === null) {
        const unchanged = applyMove(passed, null).state;
        const denied = unchanged.scores[1 - side] - next.scores[1 - side];
        if (denied > 0) {
          insight = `Compared with passing, this turn prevents ${other} from collecting ${count(denied)} on the next advance. The occupied junction cannot be turned back on the reply.`;
          tag = 'INTERCEPTION';
        }
      }
    }
    if (typeof next.winner === 'number') {
      insight = `${names[next.winner]} will reach ${next.scores[next.winner]} on the next advance. No legal reply can change those occupied departure junctions.`;
      title = 'The finish is secured';
    } else if (next.scores.every(score => score === 4)) {
      insight = 'The next advance will make it four each. No legal reply can prevent the draw.';
      title = 'An even finish ahead';
    }
  } else {
    consequence = finish(state);
    insight = 'This advance closes the game.';
    title = state.winner === 'draw' ? 'Shared light' : `${names[state.winner]} takes the light`;
    tag = 'FINALE';
  }
  return { title, summary, insight, consequence, tag };
}
