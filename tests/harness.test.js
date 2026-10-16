import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyMove, legalMoves } from '../engine/afterlight-engine.js';
import { parseMoveText, cellName } from '../harness/notation.js';
import { parseDecision, extractJson, buildPrompt, repetitionEndingMoves } from '../harness/prompt.js';
import { playMatch, resultOf } from '../harness/match.js';
import { makePlayer } from '../harness/players.js';

test('cell names round-trip for all 36 cells', () => {
  for (let i = 0; i < 36; i++) assert.equal(parseMoveText(cellName(i)), i);
  assert.equal(cellName(0), 'A1');
  assert.equal(cellName(35), 'F6');
  assert.equal(parseMoveText('pass'), null);
  assert.equal(parseMoveText(' c4 '), 20);
  assert.equal(parseMoveText('G1'), undefined);
  assert.equal(parseMoveText(7), undefined);
});

test('parseDecision accepts plain, fenced and object replies', () => {
  const state = createGame();
  assert.deepEqual(parseDecision('{"move":"A1","commentary":"hi"}', state), { ok: true, move: 0, commentary: 'hi' });
  assert.equal(parseDecision('Sure!\n```json\n{"move": "PASS", "commentary": "wait"}\n```', state).move, null);
  assert.equal(parseDecision({ move: 'f6', commentary: '' }, state).move, 35);
});

test('parseDecision rejects occupied cells and junk with a reason', () => {
  const state = createGame();
  const occupied = parseDecision('{"move":"B2","commentary":"x"}', state);
  assert.equal(occupied.ok, false);
  assert.match(occupied.error, /holds a spark/);
  assert.equal(parseDecision('no json here', state).ok, false);
  assert.match(parseDecision('{"move":"Z9","commentary":"x"}', state).error, /not a cell/);
  assert.equal(extractJson('{"a": 1}').a, 1);
});

test('the opening prompt names the side, lists 28 cells plus PASS, and has no history note', () => {
  const prompt = buildPrompt({ state: createGame(), lastPly: null });
  assert.match(prompt, /You are AMBER/);
  const legal = /Legal moves: (.*)\./.exec(prompt)[1].split(', ');
  assert.equal(legal.length, legalMoves(createGame()).length);
  assert.doesNotMatch(prompt, /History note/);
  const retry = buildPrompt({ state: createGame(), lastPly: null, previousErrors: ['B2 holds a spark, so it cannot be flipped.'] });
  assert.match(retry, /previous reply was rejected: B2 holds a spark/);
});

test('repetitionEndingMoves finds moves that recreate a position for the third time', () => {
  // Shuttle the same two flips until a position has been seen twice, then check the list.
  let state = createGame();
  let found = [];
  for (let i = 0; i < 200 && state.winner === null; i++) {
    found = repetitionEndingMoves(state);
    if (found.length) break;
    state = applyMove(state, null).state;
  }
  for (const move of found) {
    const next = applyMove(state, move).state;
    assert.equal(next.winner, 'draw');
  }
});

test('a bot-vs-random match plays to a recorded result', async () => {
  const record = await playMatch({ id: 'test', amber: makePlayer('bot-normal'), blue: makePlayer('random') });
  assert.equal(record.status, 'finished');
  assert.ok(['amber', 'blue', 'draw'].includes(record.result.winner));
  assert.equal(record.plies.length, record.result.plies);
  let state = createGame();
  for (const ply of record.plies) state = applyMove(state, ply.move).state;
  assert.deepEqual(resultOf(state).scores, record.result.scores);
});
