import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, rmSync } from 'node:fs';
import { createGame, applyMove } from '../engine/afterlight-engine.js';
import { SIDES, moveName } from './notation.js';
import { FatalPlayerError } from './players.js';
import { RULES, PROMPT_VERSION } from './prompt.js';

export const MAX_PLIES = 200;

const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 12);
export const ENGINE_SHA = sha(readFileSync(new URL('../engine/afterlight-engine.js', import.meta.url), 'utf8'));
export const RULES_SHA = sha(RULES);

function saveAtomic(file, data) {
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1));
  renameSync(`${file}.tmp`, file);
}

export function resultOf(state) {
  if (state.winner === 0 || state.winner === 1) return { winner: SIDES[state.winner], scores: [...state.scores], reason: 'five', plies: state.ply };
  if (state.winner === 'draw') {
    const reason = state.scores[0] === 4 && state.scores[1] === 4 ? 'four-all' : 'repetition';
    return { winner: 'draw', scores: [...state.scores], reason, plies: state.ply };
  }
  return { winner: 'draw', scores: [...state.scores], reason: 'turn-cap', plies: state.ply };
}

const describe = player => ({ id: player.id, label: player.label, kind: player.kind, vendor: player.vendor ?? null, model: player.model ?? null, effort: player.effort ?? null });

/** Plays (or resumes) one game and writes the record after every turn. */
export async function playMatch(options) {
  if (!options.file) return playMatchUnlocked(options);
  // A lock file stops two runs from playing the same match at once.
  const lock = `${options.file}.lock`;
  let fd;
  try { fd = openSync(lock, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`${options.id} is already being played (delete ${lock} if no run is active).`);
    throw error;
  }
  try { return await playMatchUnlocked(options); } finally { closeSync(fd); rmSync(lock, { force: true }); }
}

async function playMatchUnlocked({ id, amber, blue, file, round = null, log = () => {}, openingPlies = [] }) {
  let state = createGame();
  let record;
  if (file && existsSync(file)) {
    record = JSON.parse(readFileSync(file, 'utf8'));
    if (record.status === 'finished') return record;
    if (record.engine !== ENGINE_SHA || record.rules !== RULES_SHA) throw new Error(`${id} was started with different rules or engine; refusing to resume.`);
    for (const ply of record.plies) state = applyMove(state, ply.move).state;
    record.status = 'in_progress';
    delete record.pausedReason;
    log(`${id}: resuming at turn ${state.ply}`);
  } else {
    record = {
      id, round, game: 'afterlight', engine: ENGINE_SHA, rules: RULES_SHA, prompt: PROMPT_VERSION,
      createdAt: new Date().toISOString(), updatedAt: null,
      players: { amber: describe(amber), blue: describe(blue) },
      status: 'in_progress', result: null, plies: [],
    };
  }
  const save = () => { if (file) { record.updatedAt = new Date().toISOString(); saveAtomic(file, record); } };
  save();

  while (state.winner === null && state.ply < MAX_PLIES) {
    const side = state.turn;
    const player = side === 0 ? amber : blue;
    const forced = openingPlies[state.ply];
    let decision;
    if (forced !== undefined) {
      decision = { move: forced, commentary: null, attempts: 1, fumble: false, errors: [], opening: true };
    } else {
      try {
        decision = await player.decide(state, { matchId: id, lastPly: record.plies.at(-1) ?? null, log });
      } catch (error) {
        if (error instanceof FatalPlayerError) {
          record.status = 'paused';
          record.pausedReason = error.message;
          save();
        }
        throw error;
      }
    }
    const { state: next } = applyMove(state, decision.move);
    const latencyMs = decision.calls ? decision.calls.reduce((sum, c) => sum + (c.latencyMs || 0), 0) : (decision.latencyMs ?? 0);
    record.plies.push({
      ply: state.ply, side: SIDES[side], player: player.id, move: decision.move, cell: moveName(decision.move),
      commentary: decision.commentary ?? null, attempts: decision.attempts, fumble: decision.fumble,
      opening: decision.opening || undefined, errors: decision.errors?.length ? decision.errors : undefined,
      latencyMs, calls: decision.calls, scoresAfter: [...next.scores],
    });
    state = next;
    save();
    if (player.kind === 'model') {
      log(`${id} t${state.ply} ${player.label} ${moveName(decision.move)}${decision.fumble ? ' (FUMBLE)' : ''} ${Math.round(latencyMs / 1000)}s  ${state.scores.join('-')}  "${(decision.commentary || '').slice(0, 90)}"`);
    }
  }
  record.status = 'finished';
  record.result = resultOf(state);
  save();
  log(`${id}: finished ${record.result.winner} ${record.result.scores.join('-')} (${record.result.reason}, ${record.result.plies} turns)`);
  return record;
}
