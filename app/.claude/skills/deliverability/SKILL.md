---
name: deliverability
description: Check that your outreach email is authenticated correctly — SPF, DKIM and DMARC, verified by sending a test message and reading back the verdict the receiving server stamped on it
allowed-tools: Bash(python3 *), Bash(node *), Read
---

# Email deliverability check

Two scripts. Both print their own explanations — read their output and relay it;
don't restate it from here.

## Step 1 — live test (authoritative)

```bash
python3 scripts/check-live-auth.py              # to themselves; try this first
python3 scripts/check-live-auth.py --to <addr>  # when the above is inconclusive
```

Sends one message and reports the SPF / DKIM / DMARC verdicts the receiving server
stamped on it, plus the DKIM selector in use.

**Say you're about to send a test message before running it.** It's one message to
their own inbox, but it's their mailbox.

**On `inconclusive`, ask them for a second email address and re-run with `--to`.**
Any mailbox they can open works. The script explains why it's needed and what to
read back — relay that rather than rephrasing it. Step 2 runs regardless.

## Step 2 — DNS audit

```bash
node scripts/check-dns-auth.js
node scripts/check-dns-auth.js --selector <selector from step 1>
```

Reports what needs fixing, with the literal record to paste where one applies.
Pass `--selector` when step 1 reported one — that inspects the real key instead of
guessing. `--json` on either script if you need to reason over the output.

**Run step 2 even when step 1 passes** — DMARC policy and reporting are worth
looking at either way.

## Interpreting the results

The scripts are careful about what they claim. Don't harden their hedges into
verdicts when you summarise:

- **`? UNKNOWN` on DKIM is not a failure**, and neither is `inconclusive`. Both mean
  nothing was observed. Calling either one broken sends the operator into their DNS
  panel to "fix" something that works.
- **Passing authentication is not "your mail is reaching inboxes".** Different claim,
  untested, and nothing measures real placement reliably. If asked how to know, the
  honest answer is reply rate over time, which lives in the pipeline data.
- **On a free provider** the audit short-circuits and explains why. Don't manufacture
  work; relay it and stop.

## If asked about warmup

Klaudius doesn't warm up mailboxes and shouldn't. Warmup pools are a bulk-sending
remedy and the large providers now detect the pattern. Klaudius outreach is already
the shape that gets left alone: plain text, one link, no tracking pixel, a unique
message and URL per recipient, sent one at a time as each build finishes.

## Reporting back

Lead with the live verdict — it's the observed one. Then DNS findings, fixes first.
A clean result is a short report.
