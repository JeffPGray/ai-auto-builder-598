#!/usr/bin/env node
/**
 * Respawns qa-serve if it exits. Preview "keeps crashing" was the agent shell
 * reaping the orphaned server — this keeps port sticky for operator review.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = process.argv[2];
const port = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '4321';
if (!site) {
  console.error('usage: qa-serve-keep.mjs <site-dir> [--port N]');
  process.exit(2);
}

let child = null;
let stopping = false;

function start() {
  if (stopping) return;
  child = spawn(
    process.execPath,
    [join(root, 'scripts/qa-serve.mjs'), site, '--port', String(port)],
    { stdio: 'inherit', cwd: root },
  );
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    console.error(`[qa-serve-keep] exited code=${code} signal=${signal}; restarting in 400ms`);
    setTimeout(start, 400);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill(sig);
    process.exit(0);
  });
}

start();
