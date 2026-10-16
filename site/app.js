import DATA from './data.js';
import { createGame, applyMove, legalMoves, chooseMove } from './engine.js';
import { explainMove } from './commentary.js';
import { buildPrompt, parseDecision } from './prompt-core.js';

// ---------- Basics ----------
const $ = sel => document.querySelector(sel);
const COLS = 'ABCDEF';
const SIDE = ['Amber', 'Blue'];
const MAX_PLIES = 200;
const cellName = i => `${COLS[i % 6]}${Math.floor(i / 6) + 1}`;
const moveName = m => (m === null ? 'PASS' : cellName(m));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const secs = ms => `${Math.max(1, Math.round(ms / 1000))} s`;
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

// ---------- Players ----------
// Seats a visitor can fill in Battle. Claude seats run on the viewer's own Claude account.
const SEATS = [
  { id: 'claude-complex', kind: 'claude', tier: 'complex', label: 'Your Claude · deep', short: 'Claude · deep', group: 'Your Claude' },
  { id: 'claude-default', kind: 'claude', tier: 'default', label: 'Your Claude · standard', short: 'Claude · standard', group: 'Your Claude' },
  { id: 'claude-quick', kind: 'claude', tier: 'quick', label: 'Your Claude · quick', short: 'Claude · quick', group: 'Your Claude' },
  { id: 'bot-hard', kind: 'bot', level: 'hard', label: 'Afterlight bot · hard', short: 'Bot · hard', group: 'Afterlight bot' },
  { id: 'bot-normal', kind: 'bot', level: 'normal', label: 'Afterlight bot · normal', short: 'Bot · normal', group: 'Afterlight bot' },
  { id: 'bot-easy', kind: 'bot', level: 'easy', label: 'Afterlight bot · easy', short: 'Bot · easy', group: 'Afterlight bot' },
  { id: 'human', kind: 'human', label: 'You', short: 'You', group: 'People' },
];
const TIER_NAMES = { complex: 'deep', default: 'standard', quick: 'quick' };
const SEAT = new Map(SEATS.map(s => [s.id, s]));
const PLAYERS = new Map(DATA.players.map(p => [p.id, p]));
const SHORT = { 'claude-opus-5-5': 'Opus 5.5', 'claude-fable-5-1': 'Fable 5.1', 'claude-sonnet-5': 'Sonnet 5', 'gpt-6-astra': 'GPT-6 Astra', random: 'Random' };
const label = id => PLAYERS.get(id)?.label ?? SEAT.get(id)?.label ?? id;
const short = id => SHORT[id] ?? SEAT.get(id)?.short ?? label(id);
const isModel = id => PLAYERS.get(id)?.kind === 'model' || SEAT.get(id)?.kind === 'claude';
const playerOf = (match, side) => (side === 0 ? match.players.amber.id : match.players.blue.id);
const MATCHES = DATA.matches;

function resultOfState(state) {
  if (state.winner === 0 || state.winner === 1) return { winner: state.winner === 0 ? 'amber' : 'blue', scores: [...state.scores], reason: 'five', plies: state.ply };
  const reason = state.winner === 'draw' ? (state.scores.every(s => s === 4) ? 'four-all' : 'repetition') : 'turn-cap';
  return { winner: 'draw', scores: [...state.scores], reason, plies: state.ply };
}

function resultLine(match) {
  const r = match.result;
  const reason = { five: 'first to 5', 'four-all': 'four-all draw', repetition: 'draw by repetition', 'turn-cap': 'draw at the turn cap' }[r.reason] ?? r.reason;
  if (r.winner === 'draw') return `Draw ${r.scores.join('–')} · ${reason} · ${r.plies} turns`;
  const w = r.winner === 'amber' ? 0 : 1;
  return `${short(playerOf(match, w))} wins ${r.scores[w]}–${r.scores[1 - w]} · ${r.plies} turns`;
}

// ---------- Scene ----------
let scene = null;
const stage = $('#stage');
const fitDistance = () => Math.min(1.3, Math.max(0.8, 1 / (stage.clientWidth / Math.max(1, stage.clientHeight))));

async function bootScene() {
  try {
    const { createScene } = await import('./scene.js');
    let distance = fitDistance();
    scene = createScene(stage, { onTile: index => onTile(index), onHover: () => {}, distance });
    const canvas = stage.querySelector('canvas');
    if (matchMedia('(pointer: coarse)').matches && canvas) canvas.style.touchAction = 'pan-y';
    // Let the mouse wheel scroll the page instead of zooming the board.
    stage.addEventListener('wheel', e => e.stopPropagation(), { capture: true });
    scene.setReducedMotion(reduced());
    // Keep both collectors in frame when the window changes shape.
    new ResizeObserver(() => {
      const next = fitDistance();
      if (Math.abs(next - distance) > 0.04) { distance = next; scene.setDistance(next); }
    }).observe(stage);
  } catch (error) {
    const note = document.createElement('div');
    note.className = 'nogl';
    note.textContent = 'The 3D board needs WebGL, which this browser has turned off.';
    stage.append(note);
    console.warn('Board unavailable:', error);
  }
}

// ---------- Shared views: a recorded league game or the live battle ----------
// A view is { match, states, results }: the plies plus every position they pass through.
function plyText(view, i) {
  const ply = view.match.plies[i];
  const id = playerOf(view.match, ply.s);
  if (ply.f) return { model: false, text: 'Its replies were invalid, so a random legal move was played for it.' };
  if (isModel(id) && ply.c) return { model: true, text: ply.c };
  return { model: false, text: explainMove(view.states[i], ply.m, view.results[i]).summary };
}

function setCaption(view, i, intro) {
  const cap = $('#caption'), who = $('#cap-who'), said = $('#cap-said');
  cap.classList.remove('s0', 's1');
  if (i === null || i < 0) {
    who.innerHTML = intro ?? `<b>${esc(label(view.match.players.amber.id))}</b> vs <b>${esc(label(view.match.players.blue.id))}</b>`;
    said.textContent = '';
    return;
  }
  const ply = view.match.plies[i];
  const id = playerOf(view.match, ply.s);
  const action = ply.m === null ? 'passes' : `flips ${cellName(ply.m)}`;
  const served = ply.tier && SEAT.get(id)?.tier !== ply.tier ? ` · ran on ${TIER_NAMES[ply.tier]}` : '';
  cap.classList.add(`s${ply.s}`);
  who.innerHTML = `<b>${esc(short(id))}</b> · ${action}${isModel(id) ? ` · thought ${secs(ply.t)}` : ''}${served}`;
  // Only the AI players speak in the caption; the bot's factual notes live in the Moves list.
  const { model, text } = plyText(view, i);
  said.textContent = model || ply.f ? `${model ? '“' : ''}${text}${model ? '”' : ''}` : '';
}

function renderRail(view, subtitle) {
  const { match } = view;
  $('#rail-title').textContent = `${short(match.players.amber.id)} v ${short(match.players.blue.id)}`;
  $('#rail-sub').textContent = subtitle;
  $('#plies').innerHTML = match.plies.map((ply, i) => {
    const id = playerOf(match, ply.s);
    const before = view.states[i].scores, after = view.states[i + 1].scores;
    const goals = [0, 1].filter(s => after[s] > before[s]).map(s => `<span class="chip goal">+${after[s] - before[s]} ${SIDE[s]}</span>`).join('');
    const { model, text } = plyText(view, i);
    return `<li class="ply s${ply.s}" data-i="${i}" tabindex="0" aria-label="Turn ${i + 1}: ${esc(label(id))}, ${moveName(ply.m)}">
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
      <div class="head"><span class="chip side">${SIDE[ply.s]}</span><span>${esc(short(id))}</span><span class="mv">${ply.m === null ? 'passes' : cellName(ply.m)}</span>${isModel(id) ? `<span>${secs(ply.t)}</span>` : ''}${goals}${ply.f ? '<span class="chip fum">fumble</span>' : ''}</div>
      <p class="txt ${model ? '' : 'note'}">${esc(text)}</p></li>`;
  }).join('');
}

function markRail(currentIndex, playedCount) {
  document.querySelectorAll('#plies .ply').forEach((el, i) => {
    el.classList.toggle('now', i === currentIndex);
    el.classList.toggle('future', i >= playedCount);
  });
  if (currentIndex >= 0) scrollRailTo(currentIndex);
}

function scrollRailTo(i) {
  const list = $('#plies');
  const el = list.querySelector(`[data-i="${i}"]`);
  if (!el || $('#moves').hidden) return;
  const top = el.offsetTop - list.offsetTop - list.clientHeight / 2 + el.clientHeight / 2;
  list.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
}

function toggleMoves(open = $('#moves').hidden) {
  $('#moves').hidden = !open;
  for (const id of ['#btn-moves', '#btn-moves-live']) $(id).setAttribute('aria-pressed', String(open));
  if (!open) return;
  if (mode === 'watch' && watch.index > 0) scrollRailTo(watch.index - 1);
  if (mode === 'battle' && battle.match) scrollRailTo(battle.match.plies.length - 1);
}

function renderScorebug(state, nameA, nameB, clock) {
  $('#name-a').textContent = nameA;
  $('#name-b').textContent = nameB;
  $('#pts-a').textContent = state.scores[0];
  $('#pts-b').textContent = state.scores[1];
  $('#turn-v').textContent = clock;
  $('#team-a').classList.toggle('turn', state.winner === null && state.turn === 0);
  $('#team-b').classList.toggle('turn', state.winner === null && state.turn === 1);
}

// ---------- Watch: the league's recorded games ----------
const watch = { match: null, states: [], results: [], index: 0, playing: false, speed: 1, token: 0 };

function loadMatch(match) {
  stopPlayback();
  watch.match = match;
  watch.states = [createGame()];
  watch.results = [];
  for (const ply of match.plies) {
    const result = applyMove(watch.states.at(-1), ply.m);
    watch.results.push(result);
    watch.states.push(result.state);
  }
  $('#match-select').value = match.id;
  const modelPlies = match.plies.map((p, i) => ({ ...p, i })).filter(p => isModel(playerOf(match, p.s)));
  const slowest = modelPlies.reduce((best, p) => (!best || p.t > best.t ? p : best), null);
  renderRail(watch, slowest ? `${resultLine(match)} · longest think ${secs(slowest.t)} on turn ${slowest.i + 1}` : resultLine(match));
  renderTicks();
  setIndex(0);
}

function setIndex(index) {
  watch.index = Math.max(0, Math.min(index, watch.match.plies.length));
  if (mode === 'watch') scene?.setState(watch.states[watch.index]);
  updateWatchUI();
}

function updateWatchUI() {
  if (mode !== 'watch' || !watch.match) return;
  const { match } = watch;
  renderScorebug(watch.states[watch.index], short(match.players.amber.id), short(match.players.blue.id), watch.index === match.plies.length ? 'FINAL' : String(watch.index));
  markRail(watch.index - 1, watch.index);
  document.querySelectorAll('#ticks .tick').forEach((el, i) => {
    el.classList.toggle('done', i < watch.index);
    el.classList.toggle('now', i === watch.index - 1);
  });
  setCaption(watch, watch.index > 0 ? watch.index - 1 : null);
  $('#big-play').hidden = watch.playing || watch.index > 0;
  $('#btn-play').setAttribute('aria-label', watch.playing ? 'Pause' : 'Play');
  $('#play-icon').innerHTML = watch.playing ? '<path d="M3 2h4v12H3zM9 2h4v12H9z"/>' : '<path d="M4 2l10 6-10 6z"/>';
}

// Model turns are drawn taller the longer the model thought, so the timeline shows where it struggled.
function renderTicks() {
  const { match } = watch;
  const longest = Math.max(1, ...match.plies.filter(p => isModel(playerOf(match, p.s))).map(p => p.t));
  $('#ticks').innerHTML = match.plies.map((ply, i) => {
    const goal = watch.states[i + 1].scores.some((s, k) => s > watch.states[i].scores[k]);
    const model = isModel(playerOf(match, ply.s));
    const height = model ? Math.round(9 + 25 * Math.sqrt(ply.t / longest)) : 9;
    return `<button type="button" class="tick s${ply.s}${goal ? ' goal' : ''}${ply.f ? ' fumble' : ''}" style="height:${height}px" data-i="${i}" aria-label="Turn ${i + 1}: ${esc(short(playerOf(match, ply.s)))} ${moveName(ply.m)}${model ? `, thought ${secs(ply.t)}` : ''}${goal ? ', collection' : ''}"></button>`;
  }).join('');
}

function stopPlayback() { watch.playing = false; watch.token++; if (mode === 'watch') $('#thinking').hidden = true; }

function setPlaying(on) {
  if (on && watch.index >= watch.match.plies.length) setIndex(0);
  watch.playing = on;
  if (on) runPlayback(++watch.token); else stopPlayback();
  updateWatchUI();
}

async function showReplayThinking(ply, token) {
  const id = playerOf(watch.match, ply.s);
  if (!isModel(id) || reduced()) return;
  const pill = $('#thinking');
  pill.className = `thinking s${ply.s}`;
  $('#thinking-text').textContent = `${short(id)} is thinking · took ${secs(ply.t)}`;
  pill.hidden = false;
  await sleep((650 + Math.min(1500, ply.t / 45)) / watch.speed);
  if (token === watch.token) pill.hidden = true;
}

async function stepForward(token) {
  const i = watch.index;
  const ply = watch.match.plies[i];
  if (!ply) return;
  await showReplayThinking(ply, token);
  if (token !== watch.token) return;
  if (scene && !reduced()) await scene.animateMove(watch.states[i], watch.results[i], ply.m, { duration: 1250 / watch.speed });
  if (token !== watch.token) return;
  setIndex(i + 1);
}

async function runPlayback(token) {
  while (token === watch.token && watch.playing && watch.index < watch.match.plies.length) {
    await stepForward(token);
    if (token !== watch.token) return;
    const ply = watch.match.plies[watch.index - 1];
    const words = isModel(playerOf(watch.match, ply.s)) && ply.c ? ply.c.length : 40;
    await sleep(Math.min(4200, 600 + words * 17) / watch.speed);
  }
  if (token === watch.token) { watch.playing = false; updateWatchUI(); }
}

function manualStep(delta) {
  stopPlayback();
  if (delta > 0 && watch.index < watch.match.plies.length) stepForward(watch.token).then(updateWatchUI);
  else setIndex(watch.index + delta);
  updateWatchUI();
}

// ---------- Battle: live games with the visitor's players ----------
let sampleFn = null;
let claudeState = 'checking'; // checking | ready | unavailable | blocked
const sampleReady = (async () => {
  try { sampleFn = (await window.claude?.use?.('sample')) ?? null; } catch { sampleFn = null; }
  claudeState = sampleFn ? 'ready' : 'unavailable';
  refreshSeatOptions();
})();

const battle = {
  status: 'setup', // setup | running | paused | over
  match: null, states: [createGame()], results: [],
  token: 0, ctl: null, selected: null, humanBusy: false, note: '',
};
const seatOf = side => SEAT.get(playerOf(battle.match, side));
const claudeUsable = () => claudeState === 'ready' || claudeState === 'checking';

function refreshSeatOptions() {
  for (const side of [0, 1]) {
    const select = $(`#seat-${side}`);
    const current = select.value || store.get(`ood-seat-${side}`, side === 0 ? 'claude-complex' : 'bot-normal');
    const groups = [...new Set(SEATS.map(s => s.group))];
    select.innerHTML = groups.map(group => `<optgroup label="${esc(group)}">${SEATS.filter(s => s.group === group)
      .map(s => `<option value="${s.id}"${s.kind === 'claude' && !claudeUsable() ? ' disabled' : ''}>${esc(s.label)}</option>`).join('')}</optgroup>`).join('');
    const pick = SEAT.get(current)?.kind === 'claude' && !claudeUsable() ? (side === 0 ? 'human' : 'bot-normal') : current;
    select.value = SEAT.has(pick) ? pick : 'bot-normal';
  }
  updateSetupNote();
}

function updateSetupNote() {
  const usesClaude = [0, 1].some(side => SEAT.get($(`#seat-${side}`).value)?.kind === 'claude');
  const note = $('#setup-note');
  if (claudeState === 'unavailable') note.textContent = 'To connect your Claude, open this page on claude.ai while signed in.';
  else if (claudeState === 'blocked') note.textContent = 'Claude access was declined for this page, so Claude can’t play here. Reload to be asked again.';
  else note.textContent = usesClaude ? 'Claude players run on your own Claude account, about 15 moves each per game. The first move asks your permission.' : 'Tap an empty switch to preview it, then tap it again to flip it.';
}

function showSetup(resultText = '') {
  $('#setup').hidden = mode !== 'battle';
  $('#setup-result').hidden = !resultText;
  $('#setup-result').textContent = resultText;
  $('#btn-begin').textContent = resultText ? 'Play again' : 'Start the battle';
}

async function startBattle() {
  const seats = [$('#seat-0').value, $('#seat-1').value];
  seats.forEach((id, side) => store.set(`ood-seat-${side}`, id));
  if (seats.some(id => SEAT.get(id).kind === 'claude')) {
    await sampleReady;
    if (!sampleFn || claudeState === 'blocked') { refreshSeatOptions(); return; }
  }
  battle.ctl?.abort();
  battle.token++;
  battle.match = { id: 'live', players: { amber: { id: seats[0] }, blue: { id: seats[1] } }, plies: [], result: null };
  battle.states = [createGame()];
  battle.results = [];
  battle.selected = null;
  battle.note = '';
  battle.status = 'running';
  $('#setup').hidden = true;
  scene?.setSelection(null);
  scene?.setState(battle.states[0]);
  renderBattle();
  runBattle(battle.token);
}

async function runBattle(token) {
  while (token === battle.token && battle.status === 'running') {
    const state = battle.states.at(-1);
    if (state.winner !== null || state.ply >= MAX_PLIES) { endBattle(); return; }
    const seat = seatOf(state.turn);
    if (seat.kind === 'human') { renderBattle(); return; } // a tap continues the game
    renderBattle();
    let decision;
    try {
      decision = seat.kind === 'bot' ? await botMove(seat, state) : await claudeMove(seat, state, token);
    } catch (error) {
      if (token === battle.token) handleClaudeError(error);
      return;
    }
    if (token !== battle.token || battle.status !== 'running') return;
    await playLive(decision, token);
    if (token !== battle.token) return;
    await sleep(decision.c ? Math.min(3200, 700 + decision.c.length * 12) : 450);
  }
}

async function botMove(seat, state) {
  await sleep(reduced() ? 0 : 350);
  return { move: chooseMove(state, { difficulty: seat.level }), c: null, t: 0, f: 0 };
}

let thinkTimer = null;
function showLiveThinking(side, id, started) {
  const pill = $('#thinking');
  pill.className = `thinking s${side}`;
  pill.hidden = false;
  const tick = () => { $('#thinking-text').textContent = `${short(id)} is thinking · ${Math.round((performance.now() - started) / 1000)} s`; };
  tick();
  clearInterval(thinkTimer);
  thinkTimer = setInterval(tick, 1000);
}
function hideLiveThinking() { clearInterval(thinkTimer); thinkTimer = null; $('#thinking').hidden = true; }

// One Claude move: the league's exact prompt, answered on the viewer's account.
// A bad reply gets one corrective re-ask; a second bad reply becomes a random legal move.
async function claudeMove(seat, state, token) {
  const last = battle.match.plies.at(-1);
  const lastPly = last ? { side: last.s === 0 ? 'amber' : 'blue', move: last.m } : null;
  const errors = [];
  const started = performance.now();
  let tier = null;
  showLiveThinking(state.turn, seat.id, started);
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (token !== battle.token) throw { code: 'cancelled' };
      battle.ctl = new AbortController();
      const prompt = `${DATA.meta.systemPrompt}\n\n${buildPrompt({ rules: DATA.meta.rules, state, lastPly, previousErrors: errors })}`;
      let reply;
      try {
        const res = await sampleFn(prompt, { modelTier: seat.tier, signal: battle.ctl.signal, cache: false });
        reply = res.text;
        tier = res.modelTierApplied ?? tier;
      } catch (error) {
        if (error?.code === 'refused' || error?.code === 'empty_completion') { errors.push('It gave no usable answer.'); continue; }
        throw error;
      }
      const decision = parseDecision(reply, state);
      if (decision.ok) return { move: decision.move, c: decision.commentary, t: performance.now() - started, f: 0, tier };
      errors.push(decision.error);
    }
  } finally {
    hideLiveThinking();
  }
  const legal = legalMoves(state);
  return { move: legal[Math.floor(Math.random() * legal.length)], c: null, t: performance.now() - started, f: 1, tier };
}

const CLAUDE_ERRORS = {
  not_granted: 'Claude access was declined, so Claude can’t play in this view. Pick another player.',
  sampling_disabled: 'Claude isn’t available for this account here. Pick another player.',
  rate_limited: 'Claude hit a usage or rate limit. Wait a little, then press Resume.',
  session_expired: 'Your Claude sign-in expired. Sign in again, then press Resume.',
  upstream_error: 'Claude didn’t answer that time. Press Resume to ask again.',
};
const PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);

function handleClaudeError(error) {
  hideLiveThinking();
  const code = error?.code || 'upstream_error';
  if (code === 'cancelled') return;
  battle.token++;
  if (PERMANENT.has(code)) {
    claudeState = 'blocked';
    battle.status = 'over';
    refreshSeatOptions();
    renderBattle();
    showSetup(CLAUDE_ERRORS[code] || CLAUDE_ERRORS.sampling_disabled);
    return;
  }
  battle.status = 'paused';
  battle.note = CLAUDE_ERRORS[code] || CLAUDE_ERRORS.upstream_error;
  renderBattle();
}

async function playLive(decision, token) {
  const before = battle.states.at(-1);
  const result = applyMove(before, decision.move);
  if (scene && !reduced() && mode === 'battle') await scene.animateMove(before, result, decision.move, { duration: 1100 });
  if (token !== battle.token) { if (mode === 'battle') scene?.setState(battle.states.at(-1)); return; }
  battle.results.push(result);
  battle.states.push(result.state);
  battle.match.plies.push({ s: before.turn, m: decision.move, c: decision.c ?? null, t: decision.t ?? 0, f: decision.f ?? 0, tier: decision.tier ?? null });
  if (mode === 'battle') scene?.setState(result.state);
  renderBattle();
}

function onTile(index) {
  if (mode !== 'battle' || battle.status !== 'running' || battle.humanBusy) return;
  const state = battle.states.at(-1);
  if (state.winner !== null || seatOf(state.turn).kind !== 'human') return;
  if (!legalMoves(state).includes(index)) { setBattleStatus(`${cellName(index)} holds a spark, so it’s locked.`); return; }
  if (battle.selected === index) { commitHuman(index); return; }
  battle.selected = index;
  scene?.setSelection(index);
  scene?.setPreview(applyMove(state, index));
  renderBattle();
}

async function commitHuman(move) {
  const state = battle.states.at(-1);
  if (battle.humanBusy || battle.status !== 'running' || seatOf(state.turn).kind !== 'human') return;
  const token = battle.token;
  battle.humanBusy = true;
  battle.selected = null;
  scene?.setSelection(null);
  await playLive({ move, c: null, t: 0, f: 0 }, token);
  battle.humanBusy = false;
  if (token === battle.token) runBattle(token);
}

function pauseBattle() {
  if (battle.status !== 'running') return;
  battle.status = 'paused';
  battle.note = 'Paused.';
  battle.token++;
  battle.ctl?.abort();
  hideLiveThinking();
  scene?.setState(battle.states.at(-1));
  renderBattle();
}

function resumeBattle() {
  if (battle.status !== 'paused') return;
  battle.status = 'running';
  battle.note = '';
  scene?.setState(battle.states.at(-1));
  renderBattle();
  runBattle(++battle.token);
}

function endBattle() {
  battle.status = 'over';
  battle.match.result = resultOfState(battle.states.at(-1));
  renderBattle();
  showSetup(resultLine(battle.match));
}

function newBattle() {
  battle.token++;
  battle.ctl?.abort();
  hideLiveThinking();
  battle.status = 'setup';
  battle.match = null;
  battle.states = [createGame()];
  battle.results = [];
  battle.selected = null;
  scene?.setSelection(null);
  scene?.setState(battle.states[0]);
  renderBattle();
  showSetup();
}

function setBattleStatus(text) { $('#battle-status').textContent = text; }

function battleStatusText() {
  if (battle.status === 'setup') return 'Pick who plays each side, then start.';
  if (battle.status === 'paused') return battle.note || 'Paused.';
  if (battle.status === 'over') return resultLine(battle.match);
  const state = battle.states.at(-1);
  const seat = seatOf(state.turn);
  if (seat.kind === 'human') {
    return battle.selected === null ? `Your move as ${SIDE[state.turn]}. Tap an empty switch to preview it.` : `Tap ${cellName(battle.selected)} again, or press Flip.`;
  }
  return `${seat.short} is ${seat.kind === 'claude' ? 'thinking' : 'moving'}…`;
}

function renderBattle() {
  if (mode !== 'battle') return;
  const state = battle.states.at(-1);
  const live = battle.match;
  const names = live ? [short(live.players.amber.id), short(live.players.blue.id)] : [short($('#seat-0').value), short($('#seat-1').value)];
  renderScorebug(state, names[0], names[1], battle.status === 'over' ? 'FINAL' : String(state.ply));
  const humanTurn = battle.status === 'running' && state.winner === null && live && seatOf(state.turn).kind === 'human' && !battle.humanBusy;
  $('#btn-flip').hidden = !humanTurn;
  $('#btn-pass').hidden = !humanTurn;
  $('#btn-flip').disabled = battle.selected === null;
  $('#btn-flip').textContent = battle.selected === null ? 'Flip' : `Flip ${cellName(battle.selected)}`;
  $('#btn-pause').hidden = !['running', 'paused'].includes(battle.status);
  $('#btn-pause').textContent = battle.status === 'paused' ? 'Resume' : 'Pause';
  $('#btn-new').hidden = battle.status === 'setup';
  $('#btn-moves-live').hidden = !live || !live.plies.length;
  setBattleStatus(battleStatusText());
  if (live) {
    const view = { match: live, states: battle.states, results: battle.results };
    renderRail(view, battle.status === 'over' ? resultLine(live) : `${live.plies.length} turns so far`);
    markRail(live.plies.length - 1, live.plies.length);
    setCaption(view, live.plies.length - 1, `<b>${esc(label(live.players.amber.id))}</b> vs <b>${esc(label(live.players.blue.id))}</b>`);
  } else {
    setCaption(null, null, '<b>Battle</b> · pick your players');
  }
}

// ---------- Modes ----------
let mode = 'battle';

function setMode(next) {
  if (next === mode) return;
  if (mode === 'battle' && battle.status === 'running') pauseBattle();
  if (mode === 'watch') stopPlayback();
  mode = next;
  const battling = mode === 'battle';
  $('#mode-battle').setAttribute('aria-pressed', String(battling));
  $('#mode-watch').setAttribute('aria-pressed', String(!battling));
  $('#match-select').hidden = battling;
  $('#watch-controls').hidden = battling;
  $('#battlebar').hidden = !battling;
  $('#big-play').hidden = true;
  $('#thinking').hidden = true;
  toggleMoves(false);
  scene?.setSelection(null);
  if (battling) {
    scene?.setState(battle.states.at(-1));
    $('#setup').hidden = !['setup', 'over'].includes(battle.status);
    renderBattle();
  } else {
    $('#setup').hidden = true;
    if (!watch.match && MATCHES.length) loadMatch(featuredMatch());
    else if (watch.match) setIndex(watch.index);
  }
}

// ---------- About drawer ----------
function playerStats() {
  const stats = new Map(DATA.players.map(p => [p.id, { id: p.id, g: 0, w: 0, d: 0, l: 0, think: [], tokens: [], fumbles: 0 }]));
  for (const m of MATCHES) {
    for (const side of [0, 1]) {
      const id = playerOf(m, side), s = stats.get(id);
      if (!s) continue;
      s.g++;
      const res = m.result.winner;
      if (res === 'draw') s.d++; else if ((res === 'amber') === (side === 0)) s.w++; else s.l++;
      for (const ply of m.plies.filter(p => p.s === side)) {
        if (ply.f) s.fumbles++;
        if (isModel(id)) { s.think.push(ply.t); if (ply.o) s.tokens.push(ply.o); }
      }
    }
  }
  return [...stats.values()];
}

const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function renderStandings() {
  const rows = playerStats().sort((a, b) => {
    const pa = a.g ? (a.w + a.d / 2) / a.g : -1, pb = b.g ? (b.w + b.d / 2) / b.g : -1;
    return pb - pa || b.g - a.g;
  });
  const body = rows.map(s => {
    const p = PLAYERS.get(s.id);
    const kind = p.kind === 'model' ? `${p.vendor === 'anthropic' ? 'Anthropic' : 'OpenAI'} · effort ${p.effort}` : p.kind === 'bot' ? 'Afterlight search bot' : 'Uniform random';
    if (p.pending) {
      return `<tr><td><div class="pname">${esc(p.label)}</div><div class="ptype">${esc(kind)}</div></td><td colspan="8"><span class="pill upcoming">Next up</span> <span class="ptype">${esc(p.pending)}</span></td></tr>`;
    }
    const pts = s.w + s.d / 2, pct = s.g ? pts / s.g : 0;
    const think = avg(s.think), tokens = avg(s.tokens);
    return `<tr>
      <td><div class="pname">${esc(p.label)}</div><div class="ptype">${esc(kind)}</div></td>
      <td class="num">${s.g}</td><td class="num">${s.w}</td><td class="num">${s.d}</td><td class="num">${s.l}</td>
      <td class="num">${pts % 1 ? pts.toFixed(1) : pts}<span class="pts-bar" aria-hidden="true"><i style="width:${Math.round(pct * 100)}%"></i></span></td>
      <td class="num">${think ? secs(think) : '–'}</td>
      <td class="num">${tokens ? Math.round(tokens).toLocaleString('en-US') : '–'}</td>
      <td class="num">${p.kind === 'model' ? s.fumbles : '–'}</td></tr>`;
  }).join('');
  $('#standings-table').innerHTML = `<thead><tr><th>Player</th><th class="num">Games</th><th class="num">Won</th><th class="num">Drawn</th><th class="num">Lost</th><th class="num">Points</th><th class="num">Think</th><th class="num">Tokens</th><th class="num">Fumbles</th></tr></thead><tbody>${body}</tbody>`;
}

function renderLadder() {
  const cal = DATA.calibration;
  if (!cal) { $('#bot-note').textContent = 'Bot calibration has not been run yet.'; return; }
  const levels = ['random', 'easy', 'normal', 'hard'];
  const cell = (a, b) => {
    let w = 0, d = 0, l = 0;
    for (const p of cal.pairs) {
      if (p.amber === a && p.blue === b) { w += p.amberWins; d += p.draws; l += p.blueWins; }
      if (p.amber === b && p.blue === a) { w += p.blueWins; d += p.draws; l += p.amberWins; }
    }
    return `<span class="wdl">${w}–<span class="d">${d}</span>–<span class="l">${l}</span></span>`;
  };
  const games = cal.pairs.reduce((s, p) => s + p.amberWins + p.blueWins + p.draws, 0);
  const randomWins = cal.pairs.reduce((s, p) => s + (p.amber === 'random' ? p.amberWins : 0) + (p.blue === 'random' ? p.blueWins : 0), 0);
  $('#bot-note').textContent = `The Afterlight bot is the game's own computer opponent: an alpha-beta search about 90 lines long that looks two turns ahead on normal and three on hard. Across ${games} bot-vs-bot games from randomized openings, random play won ${randomWins}, and hard was no stronger than normal. Each cell reads won–drawn–lost for the row player.`;
  const head = `<thead><tr><th>Row vs column</th>${levels.map(l => `<th class="num">${l}</th>`).join('')}</tr></thead>`;
  const body = levels.map(a => `<tr><td class="pname" style="font-size:15px">${a}</td>${levels.map(b => `<td class="num">${a === b ? '–' : cell(a, b)}</td>`).join('')}</tr>`).join('');
  $('#ladder-table').innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderMatchLists() {
  $('#match-cards').innerHTML = MATCHES.map(m => {
    const [a, b] = m.result.scores;
    const win = m.result.winner;
    return `<button type="button" class="mcard" data-id="${esc(m.id)}">
      <div class="row"><span class="side a"><i></i><span class="${win === 'amber' ? 'won' : ''}">${esc(short(m.players.amber.id))}</span></span><span class="score">${a}</span></div>
      <div class="row"><span class="side b"><i></i><span class="${win === 'blue' ? 'won' : ''}">${esc(short(m.players.blue.id))}</span></span><span class="score">${b}</span></div>
      <div class="meta"><span>${win === 'draw' ? 'Draw' : `${esc(short(playerOf(m, win === 'amber' ? 0 : 1)))} won`}</span><span>${m.round === 'pilot' ? '<span class="tag">Pilot</span> ' : ''}${m.result.plies} turns</span></div></button>`;
  }).join('');
  $('#match-select').innerHTML = MATCHES.map(m => `<option value="${esc(m.id)}">${m.round === 'pilot' ? 'Pilot · ' : ''}${esc(short(m.players.amber.id))} v ${esc(short(m.players.blue.id))} · ${m.result.scores.join('–')}</option>`).join('');
}

// Just enough Markdown for the rulebook: headings, lists, tables, bold and code.
function markdown(md) {
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,3} /.test(line)) { const level = line.match(/^#+/)[0].length; out.push(`<h${level}>${inline(line.replace(/^#+ /, ''))}</h${level}>`); i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++].trim());
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const [head, , ...rest] = rows;
      out.push(`<div class="table-wrap"><table><thead><tr>${cells(head).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*(-|\d+\.) /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items = [];
      while (i < lines.length && /^\s*(-|\d+\.) /.test(lines[i])) items.push(lines[i++].replace(/^\s*(-|\d+\.) /, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (line.trim()) { const para = []; while (i < lines.length && lines[i].trim() && !/^(#|\s*\||\s*(-|\d+\.) )/.test(lines[i])) para.push(lines[i++]); out.push(`<p>${inline(para.join(' '))}</p>`); continue; }
    i++;
  }
  return out.join('\n');
}

function renderAbout() {
  const words = DATA.meta.rules.split(/\s+/).length;
  const facts = [['Invented', 'Sep 5, 2026'], ['Board', '6 × 6 switches'], ['Sparks', '8'], ['To win', 'first to 5'], ['Rulebook', `${words.toLocaleString('en-US')} words`], ['Models see', 'text only']];
  $('#facts').innerHTML = facts.map(([k, v]) => `<span class="fact">${k} <b>${v}</b></span>`).join('');
  const models = playerStats().filter(s => isModel(s.id) && s.g).sort((a, b) => b.g - a.g);
  if (models.length) {
    const lead = models[0];
    const box = $('#headline');
    box.hidden = false;
    box.innerHTML = `<span class="k">League results so far</span><span class="v">${esc(label(lead.id))}: ${lead.w} won, ${lead.d} drawn, ${lead.l} lost</span><span class="n">${esc(DATA.players.filter(p => p.pending).map(p => `${p.label}: ${p.pending}`).join(' '))}</span>`;
  }
  $('#rules').innerHTML = markdown(DATA.meta.rules.replace(/\n {2}\|/g, '\n|'));
  $('#example-prompt').textContent = `SYSTEM\n${DATA.meta.systemPrompt}\n\nUSER\n${DATA.meta.examplePrompt}`;
  const cr = DATA.meta.cleanroom;
  const items = [
    ['Battle uses the same prompt', 'When your Claude plays in Battle, it gets exactly the rulebook, position text and legal-move list the league models get, on your own Claude account. A bad reply gets one corrected re-ask, then a random legal move marked as a fumble.'],
    ['Same prompt, no tools', 'Every league move is a fresh call containing the full rulebook, the position as text and the list of legal moves. The only memory between turns is a one-line note of the last move. The models cannot run code, search the web or read files.'],
    ['How the league models run', 'Claude runs through Claude Code: <code>claude -p --restricted --tools "" --effort high</code>. GPT-6 Astra runs through Codex: <code>codex exec</code> with the shell, browser and every other tool feature switched off and reasoning effort set to high. Both answer in the same JSON shape.'],
    MATCHES.some(m => m.round === 'pilot') ? ['The pilot game', 'The first league game was a pilot on an earlier prompt that lacked two clarifications: the note that a spark\'s next step turns 90 degrees, and the list of moves that would end the game by repetition. The rules and engine were identical, so it counts in the standings.'] : null,
    ['Mistakes cost a turn', 'In the league, an unreadable or illegal reply is sent back with the reason, up to twice. A third failure plays a random legal move for the model, marked as a fumble in red on the timeline.'],
    cr ? ['The rulebook is checked', `An agent that never saw the engine rebuilt Afterlight from this rulebook and the exact position text the models get. Across ${cr.games.toLocaleString('en-US')} games and ${cr.plies.toLocaleString('en-US')} turns, its predictions matched the real engine every time.`] : null,
    ['Pinned versions', `Engine <code>sha256 ${DATA.meta.engineSha}</code> and rulebook <code>sha256 ${DATA.meta.rulesSha}</code>. Every match record stores both, and the page leaves out any game played on a different version.`],
  ].filter(Boolean);
  $('#method').innerHTML = items.map(([h, p]) => `<div class="item"><h3>${h}</h3><p>${p}</p></div>`).join('');
  $('#foot-hash').textContent = `engine ${DATA.meta.engineSha} · rules ${DATA.meta.rulesSha} · data ${DATA.meta.generatedAt.slice(0, 10)}`;
}

function featuredMatch() {
  const withModels = MATCHES.filter(m => isModel(m.players.amber.id) || isModel(m.players.blue.id));
  const both = withModels.filter(m => isModel(m.players.amber.id) && isModel(m.players.blue.id));
  return both.at(-1) || withModels.at(-1) || MATCHES.at(-1);
}

// ---------- Wiring ----------
function wire() {
  const info = $('#info');
  $('#btn-info').addEventListener('click', () => { if (typeof info.showModal === 'function') info.showModal(); else info.setAttribute('open', ''); });
  $('#info-close').addEventListener('click', () => info.close());
  info.addEventListener('click', e => { if (e.target === info) info.close(); });
  // Watch
  $('#big-play').addEventListener('click', () => setPlaying(true));
  $('#btn-play').addEventListener('click', () => setPlaying(!watch.playing));
  $('#btn-prev').addEventListener('click', () => manualStep(-1));
  $('#btn-next').addEventListener('click', () => manualStep(1));
  $('#btn-start').addEventListener('click', () => { stopPlayback(); setIndex(0); });
  const speeds = [1, 2, 4];
  $('#btn-speed').addEventListener('click', e => { watch.speed = speeds[(speeds.indexOf(watch.speed) + 1) % speeds.length]; e.currentTarget.textContent = `${watch.speed}×`; });
  $('#ticks').addEventListener('click', e => { const t = e.target.closest('.tick'); if (t) { stopPlayback(); setIndex(Number(t.dataset.i) + 1); } });
  $('#match-select').addEventListener('change', e => loadMatch(MATCHES.find(m => m.id === e.target.value)));
  $('#match-cards').addEventListener('click', e => {
    const card = e.target.closest('.mcard'); if (!card) return;
    info.close(); setMode('watch'); loadMatch(MATCHES.find(m => m.id === card.dataset.id));
  });
  // Moves panel (both modes); in Watch a row jumps the replay there
  $('#btn-moves').addEventListener('click', () => toggleMoves());
  $('#btn-moves-live').addEventListener('click', () => toggleMoves());
  $('#moves-close').addEventListener('click', () => toggleMoves(false));
  const jump = li => { if (mode !== 'watch') return; stopPlayback(); setIndex(Number(li.dataset.i) + 1); };
  $('#plies').addEventListener('click', e => { const li = e.target.closest('.ply'); if (li) jump(li); });
  $('#plies').addEventListener('keydown', e => { const li = e.target.closest('.ply'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); jump(li); } });
  // Battle
  $('#mode-battle').addEventListener('click', () => setMode('battle'));
  $('#mode-watch').addEventListener('click', () => setMode('watch'));
  $('#btn-to-watch').addEventListener('click', () => setMode('watch'));
  $('#btn-begin').addEventListener('click', startBattle);
  for (const side of [0, 1]) $(`#seat-${side}`).addEventListener('change', () => { updateSetupNote(); renderBattle(); });
  $('#btn-swap').addEventListener('click', () => {
    const a = $('#seat-0').value, b = $('#seat-1').value;
    $('#seat-0').value = b; $('#seat-1').value = a;
    updateSetupNote(); renderBattle();
  });
  $('#btn-flip').addEventListener('click', () => { if (battle.selected !== null) commitHuman(battle.selected); });
  $('#btn-pass').addEventListener('click', () => commitHuman(null));
  $('#btn-pause').addEventListener('click', () => (battle.status === 'paused' ? resumeBattle() : pauseBattle()));
  $('#btn-new').addEventListener('click', newBattle);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#moves').hidden) { toggleMoves(false); return; }
    if (mode !== 'watch' || info.open || e.target.closest('input, select, textarea, button, [tabindex], a')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); manualStep(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); manualStep(-1); }
    if (e.key === ' ') { e.preventDefault(); setPlaying(!watch.playing); }
  });
}

async function main() {
  renderAbout();
  renderStandings();
  renderLadder();
  renderMatchLists();
  refreshSeatOptions();
  wire();
  await bootScene();
  scene?.setState(battle.states[0]);
  renderBattle();
  showSetup();
}

main();
