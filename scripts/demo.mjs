#!/usr/bin/env node
// `npm run demo`: migrate, seed, then show the three answers a sales manager asks for first.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args) => {
  const r = spawnSync(process.execPath, args.map((a, i) => (i === 0 ? path.join(root, 'scripts', a) : a)), { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('migrate.mjs');
run('seed.mjs');
run('leads.mjs', 'response');
run('leads.mjs', 'attention');
run('leads.mjs', 'sources');
console.log('\nNext: open this folder in Claude Code and type /attention, or ask "who is still waiting for a call back?"');
