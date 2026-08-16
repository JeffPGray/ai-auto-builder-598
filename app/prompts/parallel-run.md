# Running the pipeline in parallel — orchestrator playbook (Claude Code)

Full mechanics for "run pipeline in parallel" / "run pipeline x3" / "Parallel run". `CLAUDE.md`'s "Run pipeline in parallel" command points here — read this before dispatching anything.

Same goal as "Run the pipeline" but in parallel. You act as the **orchestrator**: dispatch N concurrent headless `claude -p` children in background shells, classify each completion in natural language when its notification arrives, and dispatch a replacement to keep the pool full. You never run pipeline skills yourself.

## ⛔ Hard ceilings — check BEFORE every dispatch, no exceptions

Everything else in this playbook is instruction-following. These two are a
counted gate, because instruction-following is exactly what fails when a loop
goes wrong, and here each runaway unit is a **full Claude Code session burning
subscription usage**, not a cheap request.

On 2026-08-15 a fan-out in `scripts/notify.sh` re-invoked itself, each level
spawning two more, and delivered several hundred alerts before it was killed.
That was `curl`. The same shape here spends money and can wedge the machine.

```bash
# Run this IMMEDIATELY BEFORE every dispatch, including refills.
#
# NOTE the exact shape: `grep -c` PRINTS "0" and EXITS 1 when it matches
# nothing, so the obvious `... | grep -ci running || echo 0` yields the string
# "0\n0" and every later [ ] comparison dies with "integer expression
# expected". Measured 2026-08-15. A guard that errors is a guard that does not
# guard — and it fails OPEN, which is the worst possible direction here.
RUNNING=$(claude agents --cwd . 2>/dev/null | grep -ci 'running')
case "$RUNNING" in ''|*[!0-9]*) RUNNING=0 ;; esac   # non-numeric => treat as 0
MAX_POOL=${KLAUDIUS_MAX_POOL:-6}
if [ "$RUNNING" -ge "$MAX_POOL" ]; then
  echo "POOL FULL ($RUNNING/$MAX_POOL) — do NOT dispatch. Wait for a slot."
  exit 1
fi
echo "pool $RUNNING/$MAX_POOL — dispatch allowed"
```

1. **`MAX_POOL` (default 6, override `KLAUDIUS_MAX_POOL`).** Never exceed it,
   even if the operator says a bigger number — tell them the ceiling and ask
   them to raise `KLAUDIUS_MAX_POOL` deliberately. A number typed in
   conversation is not a considered decision about machine load.
2. **`MAX_TOTAL` per invocation (default 40).** Track dispatches this run; at
   the ceiling, STOP and report rather than refilling. A refill loop with no
   total cap is unbounded by construction — the only thing standing between it
   and a runaway is that nothing has gone wrong yet.

**A child must NEVER dispatch a child.** `CLAUDE.md` rule 10 states it
("You are a worker, not an orchestrator") and the child prompt says "one
client, then stop". If you are running as a `pipeline-<N>` child, you are the
worker: do the pipeline for one client and exit. Dispatching from a child is
recursive by definition and is the fork-bomb case this section exists for.

## ⛔ THIS PLAYBOOK WAS REWRITTEN 2026-08-16. The original never worked.

The shipped version dispatched with `claude --bg ... --permission-mode auto --name ...`. Every
element of that command is wrong on this CLI, and the errors are sequential — you fix one and hit
the next — so nobody who tried it once would have reached a working dispatch:

| Shipped | Reality |
|---|---|
| `--bg` | **No such flag.** Not in `claude --help` at all. |
| `--permission-mode auto` | **Not a valid value.** Allowed: `acceptEdits`, `bypassPermissions`, `default`, `dontAsk`, `plan`. |
| `--name` | Belongs to `--bg`; gone with it. |
| bare `claude` from a session | `Error: Claude Code cannot be launched inside another Claude Code session.` The orchestrator IS a session, so every dispatch is nested by definition. |
| `~/.claude/jobs/$ID/state.json` polling | That file is a `--bg` artefact. With no `--bg`, it never exists. |
| `python3 scripts/*.py` inside the child | Resolved to macOS Python 3.9.6 without `supabase`. Fixed by the PATH override in `app/.claude/settings.json`. |

The working mechanism is **`claude -p` (headless print mode) in a background shell**. That is worth
saying plainly because it contradicts the vendor's "no headless/CI support" position: Klaudius
*can* run unattended. Verified 2026-08-16 — a child launched this way reported `python 3.12.13
supabase-OK` and ran a full pipeline.

**Dispatch each child in two steps:**

1. **Background Bash** (`run_in_background=true`) — dispatch AND wait are the same call, because a
   `claude -p` process exits when the work is done. No job files, no supervisor polling, no
   `claude agents --json` (which spawned a ~280MB process per check and has OOM'd small machines):

   ```bash
   cd ~/Github/klaudius/app
   env -u CLAUDECODE -u CLAUDE_CODE CLAUDE_WORKER_CHILD=1 \
     claude -p --permission-mode dontAsk --model opus --effort high \
     "Run the pipeline for one client, then stop." \
     > /tmp/pipeline-<N>.log 2>&1
   echo "exit=$?"
   tail -40 /tmp/pipeline-<N>.log
   ```

   - ⛔ **NEVER pass `--mcp-config` (with or without `--strict-mcp-config`).** It hangs `claude -p`
     on this CLI — verified 2026-08-16 by bisecting against a prompt whose entire content was
     "say hi": bare 5s exit 0, `--model opus` 6s, `--permission-mode dontAsk` 5s, but **every**
     variant carrying `--mcp-config` timed out with ZERO bytes written, including one pointed at an
     empty `{"mcpServers":{}}` file. An empty config hanging identically is what rules out the MCP
     *servers* and indicts the *flag*.

     This flag was added EARLIER THE SAME NIGHT to fix the 52-minute MCP hang in builds 1-2, and it
     silently killed the next THREE builds — each ran for many minutes, wrote a zero-byte log, and
     never created a client row. The repair manufactured the defect it was meant to prevent, which
     is already in Jeff's memory as a named failure mode. **If a dispatch produces an empty log,
     suspect the flags before the pipeline.**
   - `CLAUDE_WORKER_CHILD=1` — **required.** Exempts the child from the global Stop hook
     (`~/.claude/hooks/keep-working.mjs`). Without it the child answers, hits Stop, is handed the
     ORCHESTRATOR's ledger and told workable items remain — so it abandons its assigned client and
     grinds our backlog for up to MAX_BLOCKS full model turns, writing nothing to stdout. A worker's
     job is one client (`CLAUDE.md` rule 10); the ledger belongs to the orchestrator.
   - ⛔ **Never dispatch with `nohup <cmd> &`.** The harness kills the process group when the tool
     call returns, nohup notwithstanding — measured: dead within 45s, zero bytes. Dispatch through
     the tool's own background mode instead.
   - `--model opus` — **explicit on every dispatch.** Nothing in Klaudius sets a model; it is an
     operator flag, and a dropped flag silently changes both quality and cost. The vendor's own
     guidance (DOCS.html): *"On Claude Max: use Opus."* On Pro they recommend Sonnet for volume, or
     Opus at roughly one site per 5-hour window. At 50-100 builds/day the model is the single
     biggest lever on plan consumption — measure before changing it.
   - `--effort <low|medium|high>` — the quality dial. **`high` is the ceiling on this account, and
     that is settled from the CLI SOURCE, not from docs or trial and error.** The gate in
     `/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js` reads:

     ```js
     if ($.effort === "max" && (!s || Y7())) {
       let F8 = !s ? 'Effort level "max" is not available in interactive mode.'
                   : 'Effort level "max" is not available for Claude.ai subscribers.';
     ```

     Two independent conditions block `max`: not being in headless/print mode, and being a
     Claude.ai subscriber. A real dispatch returned the SECOND message, which proves headless mode
     passed and the account check failed. **`max` requires API billing.** Reaching it would mean
     running Klaudius on metered tokens instead of the subscription, destroying the ~$0 marginal
     cost that is the entire reason this engine was bought.

     ⚠️ I got this wrong TWICE before reading the source, in opposite directions:
     * `claude --help` lists only `low|medium|high` -> I said high was the ceiling.
     * `--effort max --help` succeeds (the PARSER accepts it) -> I said max was available.
     * The RUNTIME rejects it -> high is the ceiling after all.

     **The parser, the service, and the UI are three different gates.** Verifying a capability with
     `--help` proves nothing about what will be served. Read the source or dispatch it for real.

     **`ultracode` is NOT an effort level** — zero occurrences in the entire CLI bundle. It is the
     multi-agent orchestration toggle, a different axis. The `xhigh` strings in the bundle are
     false positives from minified code, not effort values.

     MEASURED on this account: medium 39.5 min / 8.26M tok / 0.071% plan; **high 25.2 min / 7.29M
     tok / 0.063%** — high is faster AND cheaper, so it is the documented default and there is
     nothing above it to try.
   - `env -u CLAUDECODE -u CLAUDE_CODE` — **required**, defeats the nested-session guard.
   - `--permission-mode dontAsk` — stops the child wedging on an approval prompt it cannot answer.
   - `> /tmp/pipeline-<N>.log` — the child's narration. Read this, not a state file.
   - `<N>` is a monotonically-increasing counter, never reused, so logs stay attributable.

   The harness fires a `<task-notification>` when the process exits. That IS the completion signal;
   the elaborate wait-wrapper the old playbook specified is unnecessary and its polling targets do
   not exist.

2. **There is no step 2.** Dispatch and wait are one call. When the notification arrives, read
   the log.

**On each `<task-notification>`:**

a. **Read the child's log** (`/tmp/pipeline-<N>.log`), not a state file. `claude -p` writes its
   narration there and exits. There is no `state=`/`detail=`/`result=` triple and no
   `~/.claude/jobs/` entry — both were `--bg` artefacts and neither exists.

b. Classify from the log's tail and the shell exit code:
   - **exit 0 + a deployed URL** -> success. Record slug and URL.
   - **exit 0 + "no candidates found in <town>"** -> also success. An expected skip is not a failure.
   - **exit 0 + a pipeline failure** ("build failed: gathered-content.md has no photos") -> counts
     toward the failure streak.
   - **non-zero exit** -> infrastructure (auth expiry, rate limit, OOM, killed). Never a success.
   - **empty log + non-zero exit** -> the DISPATCH failed, not the pipeline. Check the four known
     causes in the rewrite table above before concluding anything about the build.

c. Log one line in your reply: child number, slug, deployed URL, verdict.

d. **No worktree sync.** `claude -p` with `cwd = app/` writes straight into `clients/`. The old
   `.claude/worktrees/<id>/` rsync existed because `--bg` sessions in a git repo were isolated;
   that does not apply. Only sync if you deliberately passed `--worktree`.

e. **Failure streak:** 3 consecutive pipeline failures, or 2 dispatch failures, stop dispatching
   and report. Never keep refilling into a systemic fault — that is how one bad config burns a
   week's plan allocation overnight, unattended.

**Browser cleanup — on EVERY child exit, whatever the exit code:** a child that died between a playwright-cli `open` and its `close` orphans a headless browser (0.4–0.7 GB, resident indefinitely). Failed/killed children are the likeliest leakers. Recover the slug from the child's log (`/tmp/pipeline-<N>.log`) or by diffing `ls clients/` against what you dispatched. Then:
```bash
npx playwright-cli -s=gather-<slug> close 2>/dev/null || true
npx playwright-cli -s=qa-<slug> close 2>/dev/null || true
```
Both are no-ops if already closed, so run them unconditionally. A child that died inside `/find` (no slug yet) may instead leak `find-<region-slug>` — close that too if you can name the region. Never reap browsers by age or by pattern-matching `node` processes.

Then, for `done` children only, stop the session: `claude stop <ID>` (the ID from the notification you're processing). A finished child's runtime holds ~750MB until stopped; nothing is lost — the conversation is kept and `claude attach <id>` reopens it anytime. `failed`/`stopped` children are already torn down. NEVER stop a `blocked` child, including to free memory — it's mid-work; stopping it throws away the run and strands its claim.

**Concurrency safety** is handled in Supabase — `claim_client` claims are atomic, and the DB's unique constraints settle it when two children discover the same business at once: the loser skips that candidate (an expected skip, like "no candidates found"). Children also skip rows with status `claimed`. No coordination needed at the orchestrator level.

**When the user asks for status:** conversation history covers *run* status only — current pool size, last few outcomes, current failure streak (if any), in-flight sessions and how long they've been running. Optionally cross-check `claude agents --cwd .` for the supervisor's live view of every session. For *pipeline* state (client counts, statuses, who's been contacted), query Supabase — children mutate it continuously.

**When the user asks to stop:** stop dispatching new replacements. In-flight `claude -p` children keep running as independent OS processes — your orchestrator session exiting does not touch them. Ask whether they want them killed now (`pkill -f 'claude -p'`, or kill the specific pids from `ps -eo pid,command | grep '[c]laude -p'`) or left to drain naturally. Prefer draining: a child killed mid-deploy can leave a half-published tenant.

**When the user asks to scale (e.g. "make it 5"):** dispatch extra children up to the new pool size. To scale down, stop dispatching replacements for surplus slots and let them drain.

**Stop condition:** keep going until the user tells you to stop, or the failure-streak threshold trips.

**What you do NOT do as orchestrator:**
- Don't run the pipeline yourself — only dispatch children
- Don't read `clients/<slug>/data/gathered-content.md` or any pipeline output
- Don't run skills (`/find`, `/gather`, `/build`, `/deploy`, etc.) yourself
- Don't classify by regex on the `result=` field; reason in natural language. (The `state=` prefix IS structured — pattern-match on it.)
- Don't wait for all in-flight sessions to finish before refilling on a single completion — refill the affected slot immediately
