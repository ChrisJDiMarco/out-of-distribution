import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chooseMove, legalMoves } from '../engine/afterlight-engine.js';
import { buildPrompt, parseDecision, SYSTEM_PROMPT, OUTPUT_SCHEMA } from './prompt.js';

// Models run from an empty folder so no project instructions or files are in reach.
export const SANDBOX = join(tmpdir(), 'ood-play');
mkdirSync(SANDBOX, { recursive: true });

const MAX_ATTEMPTS = 3;
const CALL_TIMEOUT_MS = 25 * 60 * 1000;
const TRANSIENT_RETRIES = 3;

/** Stops the whole league: retrying cannot help (usage cap, missing login). */
export class FatalPlayerError extends Error {
  constructor(message, { vendor, resetsAt = null } = {}) { super(message); this.name = 'FatalPlayerError'; this.vendor = vendor; this.resetsAt = resetsAt; }
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text) {
  let h = 2166136261;
  for (const ch of text) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const randomLegal = (state, rng) => { const moves = legalMoves(state); return moves[Math.floor(rng() * moves.length)]; };

// ---------- Deterministic players ----------

function botPlayer(difficulty) {
  return {
    id: `bot-${difficulty}`,
    label: `Afterlight bot (${difficulty})`,
    kind: 'bot',
    async decide(state) {
      const started = Date.now();
      return { move: chooseMove(state, { difficulty }), commentary: null, attempts: 1, fumble: false, errors: [], latencyMs: Date.now() - started };
    },
  };
}

function randomPlayer() {
  return {
    id: 'random',
    label: 'Random mover',
    kind: 'random',
    async decide(state, { matchId }) {
      const rng = mulberry32(hashSeed(`${matchId}:${state.ply}`));
      return { move: randomLegal(state, rng), commentary: null, attempts: 1, fumble: false, errors: [], latencyMs: 0 };
    },
  };
}

// ---------- CLI plumbing ----------

function run(command, args, { input, env, timeoutMs = CALL_TIMEOUT_MS }) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: SANDBOX, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.end(input);
  });
}

// Account caps only. Plain rate limits ("rate limit reached", 429) are transient and retried.
const USAGE_LIMIT = /usage limit|hit your (?:usage )?limit|out of credits|purchase more credits/i;
const TRANSIENT = /overloaded|rate.?limit|429|529|timed? ?out|ECONNRESET|socket hang up|5\d\d/i;

// The child must not inherit this session's effort level or attach to its host session.
function scrubbedEnv(extraDrop = []) {
  const env = { ...process.env };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_EFFORT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID',
    'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID', ...extraDrop]) delete env[key];
  return env;
}

async function callClaude({ model, effort }, prompt) {
  const args = ['-p', '--restricted', '--strict-mcp-config', '--tools', '', '--no-session-persistence',
    '--model', model, '--effort', effort, '--system-prompt', SYSTEM_PROMPT,
    '--output-format', 'json', '--json-schema', JSON.stringify(OUTPUT_SCHEMA)];
  const started = Date.now();
  const res = await run('claude', args, { input: prompt, env: scrubbedEnv() });
  const latencyMs = Date.now() - started;
  let out = null;
  try { out = JSON.parse(res.stdout); } catch { /* handled below */ }
  const errorText = out?.is_error ? String(out.result || out.subtype || 'error') : (!out ? `${res.stderr || res.stdout}`.slice(0, 500) : '');
  if (res.timedOut) return { transient: true, error: 'The model call timed out.', latencyMs };
  if (errorText) {
    if (USAGE_LIMIT.test(errorText)) throw new FatalPlayerError(`Claude usage limit: ${errorText.slice(0, 200)}`, { vendor: 'anthropic' });
    return { transient: TRANSIENT.test(errorText), error: errorText.slice(0, 300), latencyMs };
  }
  const u = out.usage || {};
  return {
    reply: out.structured_output ?? out.result,
    latencyMs,
    apiMs: out.duration_api_ms ?? null,
    usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
    costUsd: out.total_cost_usd ?? null,
    servedBy: Object.keys(out.modelUsage || {}),
    // Structured output always takes a second internal turn; only denied tool calls count as tool use.
    toolUse: (out.permission_denials || []).map(d => d.tool_name || 'tool'),
  };
}

// Everything Codex can switch off, except the code-mode host its turn loop requires.
const CODEX_DISABLED = ['shell_tool', 'unified_exec', 'unified_exec_tty', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
  'computer_use', 'apps', 'image_generation', 'multi_agent', 'memories', 'hooks', 'plugins', 'remote_plugin', 'skill_search',
  'skill_mcp_dependency_install', 'tool_suggest', 'view_image', 'in_app_browser', 'in_app_local_automation', 'goals', 'sleep_tool',
  'realtime_conversation', 'workspace_dependencies', 'worktrees', 'shell_snapshot', 'chronicle'];

async function callCodex({ model, effort }, prompt) {
  const dir = join(SANDBOX, `codex-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const schemaPath = join(dir, 'schema.json');
  const lastPath = join(dir, 'last.txt');
  writeFileSync(schemaPath, JSON.stringify(OUTPUT_SCHEMA));
  const args = ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', dir,
    '-m', model, '-c', `model_reasoning_effort="${effort}"`, '-c', 'web_search="disabled"',
    ...CODEX_DISABLED.flatMap(feature => ['--disable', feature]),
    '--json', '--output-schema', schemaPath, '-o', lastPath, '-'];
  const started = Date.now();
  // Codex has no system-prompt flag, so the same system text leads the prompt.
  const res = await run('codex', args, { input: `${SYSTEM_PROMPT}\n\n${prompt}`, env: scrubbedEnv() });
  const latencyMs = Date.now() - started;
  const events = res.stdout.split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  let reply = null;
  try { reply = readFileSync(lastPath, 'utf8'); } catch { /* no final message */ }
  rmSync(dir, { recursive: true, force: true });
  const errorText = events.filter(e => e.type === 'error' || e.type === 'turn.failed').map(e => e.message || e.error?.message).filter(Boolean).join(' | ');
  if (res.timedOut) return { transient: true, error: 'The model call timed out.', latencyMs };
  if (errorText && !reply) {
    if (USAGE_LIMIT.test(errorText)) {
      const at = /try again at ([^.]+\d{4}[^.]*)/i.exec(errorText)?.[1] ?? null;
      throw new FatalPlayerError(`Codex usage limit: ${errorText.slice(0, 200)}`, { vendor: 'openai', resetsAt: at });
    }
    return { transient: TRANSIENT.test(errorText), error: errorText.slice(0, 300), latencyMs };
  }
  if (!reply) return { transient: true, error: (res.stderr || 'Codex returned no final message.').slice(0, 300), latencyMs };
  const usageEvent = events.findLast(e => e.type === 'turn.completed')?.usage || {};
  const toolUse = [...new Set(events
    .filter(e => e.type === 'item.started' || e.type === 'item.completed')
    .map(e => e.item?.type)
    .filter(type => type && !['agent_message', 'reasoning', 'todo_list', 'error'].includes(type)))];
  return {
    reply,
    latencyMs,
    apiMs: null,
    usage: { input: usageEvent.input_tokens ?? 0, output: usageEvent.output_tokens ?? 0, cacheRead: usageEvent.cached_input_tokens ?? 0, cacheWrite: 0, reasoning: usageEvent.reasoning_output_tokens ?? null },
    costUsd: null,
    servedBy: [model],
    toolUse,
  };
}

// ---------- Model players ----------

function modelPlayer({ id, label, vendor, model, effort = 'high' }) {
  const call = vendor === 'anthropic' ? callClaude : callCodex;
  return {
    id, label, kind: 'model', vendor, model, effort,
    async decide(state, { matchId, lastPly, log = () => {} }) {
      const errors = [];
      const calls = [];
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const prompt = buildPrompt({ state, lastPly, previousErrors: errors });
        let result = null;
        for (let tries = 0; tries <= TRANSIENT_RETRIES; tries++) {
          result = await call({ model, effort }, prompt);
          if (!result.error) break;
          log(`${id}: ${result.transient ? 'transient' : 'call'} error: ${result.error}`);
          if (!result.transient) break;
          await new Promise(r => setTimeout(r, 15000 * (tries + 1)));
        }
        calls.push({ latencyMs: result.latencyMs, apiMs: result.apiMs ?? null, usage: result.usage ?? null, costUsd: result.costUsd ?? null, servedBy: result.servedBy ?? [], toolUse: result.toolUse ?? [], error: result.error ?? null });
        if (result.error) { errors.push(`The call failed (${result.error.slice(0, 120)}).`); continue; }
        if (result.toolUse?.length) { errors.push(`It used tools (${result.toolUse.join(', ')}), which this match does not allow.`); continue; }
        const decision = parseDecision(result.reply, state);
        if (decision.ok) return { move: decision.move, commentary: decision.commentary, attempts: attempt, fumble: false, errors, calls };
        errors.push(decision.error);
      }
      // Three rejected replies: a random legal move is played and the turn is marked.
      const rng = mulberry32(hashSeed(`${matchId}:${state.ply}:fumble`));
      return { move: randomLegal(state, rng), commentary: null, attempts: MAX_ATTEMPTS, fumble: true, errors, calls };
    },
  };
}

export const PLAYERS = Object.freeze({
  'random': () => randomPlayer(),
  'bot-easy': () => botPlayer('easy'),
  'bot-normal': () => botPlayer('normal'),
  'bot-hard': () => botPlayer('hard'),
  'claude-opus-5-5': () => modelPlayer({ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', vendor: 'anthropic', model: 'claude-opus-5-5' }),
  'claude-fable-5-1': () => modelPlayer({ id: 'claude-fable-5-1', label: 'Claude Fable 5.1', vendor: 'anthropic', model: 'claude-fable-5-1' }),
  'claude-sonnet-5': () => modelPlayer({ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', vendor: 'anthropic', model: 'claude-sonnet-5' }),
  'gpt-6-astra': () => modelPlayer({ id: 'gpt-6-astra', label: 'GPT-6 Astra', vendor: 'openai', model: 'gpt-6-astra' }),
});

export function makePlayer(id) {
  const factory = PLAYERS[id];
  if (!factory) throw new Error(`Unknown player "${id}". Known players: ${Object.keys(PLAYERS).join(', ')}.`);
  return factory();
}
