#!/usr/bin/env node
/**
 * Project SessionStart guard: a dispatched worker must get ZERO orchestrator ledger.
 * Global ~/.claude/hooks/surface-ledger.mjs already exits on CLAUDE_WORKER_CHILD=1;
 * this copy is the in-repo belt so a drifted global hook cannot tax a child 15 minutes.
 */
if (process.env.CLAUDE_WORKER_CHILD === '1') process.exit(0);
process.exit(0);
