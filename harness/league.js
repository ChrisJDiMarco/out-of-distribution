#!/usr/bin/env node
// Runs league matches. Examples:
//   node harness/league.js --round opus-vs-bots --concurrency 2
//   node harness/league.js --match mytest=claude-opus-5-5,bot-normal
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makePlayer, FatalPlayerError } from './players.js';
import { playMatch } from './match.js';
import { ROUNDS } from './schedule.js';

const ROOT = new URL('..', import.meta.url).pathname;
const MATCH_DIR = join(ROOT, 'data', 'matches');
const LOG = join(ROOT, 'logs', 'league.log');
mkdirSync(MATCH_DIR, { recursive: true });
mkdirSync(join(ROOT, 'logs'), { recursive: true });

function log(line) {
  const stamped = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync(LOG, `${stamped}\n`);
}

function parseArgs(argv) {
  const opts = { rounds: [], matches: [], concurrency: 2 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--round') opts.rounds.push(argv[++i]);
    else if (arg === '--match') {
      const [id, pair] = argv[++i].split('=');
      const [amber, blue] = pair.split(',');
      opts.matches.push({ id, amber, blue, round: 'adhoc' });
    } else if (arg === '--concurrency') opts.concurrency = Math.max(1, Number(argv[++i]));
    else throw new Error(`Unknown argument ${arg}`);
  }
  for (const name of opts.rounds) {
    if (!ROUNDS[name]) throw new Error(`Unknown round "${name}". Rounds: ${Object.keys(ROUNDS).join(', ')}`);
    opts.matches.push(...ROUNDS[name].map(m => ({ ...m, round: name })));
  }
  return opts;
}

const vendorOf = id => (id.startsWith('claude-') ? 'anthropic' : id.startsWith('gpt-') ? 'openai' : null);

async function main() {
  const { matches, concurrency } = parseArgs(process.argv.slice(2));
  if (!matches.length) throw new Error('Nothing to play. Pass --round <name> or --match id=amber,blue.');
  const blocked = new Map();
  const queue = [...matches];
  const summary = [];
  log(`league: ${matches.length} match(es), concurrency ${concurrency}`);

  async function worker() {
    while (queue.length) {
      const spec = queue.shift();
      const vendors = [vendorOf(spec.amber), vendorOf(spec.blue)].filter(Boolean);
      const stop = vendors.find(v => blocked.has(v));
      if (stop) { summary.push(`${spec.id}: skipped (${stop} blocked)`); continue; }
      const file = join(MATCH_DIR, `${spec.id}.json`);
      try {
        const record = await playMatch({ id: spec.id, round: spec.round, amber: makePlayer(spec.amber), blue: makePlayer(spec.blue), file, log });
        summary.push(`${spec.id}: ${record.result.winner} ${record.result.scores.join('-')} (${record.result.reason})`);
      } catch (error) {
        if (error instanceof FatalPlayerError) {
          const vendor = error.vendor;
          blocked.set(vendor, error.message);
          log(`BLOCKED ${vendor}: ${error.message}${error.resetsAt ? ` (resets ${error.resetsAt})` : ''}`);
          summary.push(`${spec.id}: paused (${vendor} blocked)${existsSync(file) ? ', resumable' : ''}`);
        } else {
          log(`ERROR ${spec.id}: ${error.stack || error.message}`);
          summary.push(`${spec.id}: error ${error.message}`);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, matches.length) }, worker));
  log(`league done:\n  ${summary.join('\n  ')}`);
  if (blocked.size) process.exitCode = 3;
}

main().catch(error => { log(`FATAL ${error.stack || error.message}`); process.exitCode = 1; });
