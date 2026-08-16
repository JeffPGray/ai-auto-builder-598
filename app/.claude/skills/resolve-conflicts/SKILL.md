---
name: resolve-conflicts
description: Walk through and resolve conflicts surfaced by `npx klaudius update`. Reads .klaudius/conflicts.md, shows each conflict, applies your chosen resolution, updates the manifest.
argument-hint: none
model: sonnet
allowed-tools: Bash(python3 *), Bash(rm *), Bash(cat *), Bash(diff *), Bash(grep *), Read, Write, Edit
---

# Resolve Update Conflicts

`npx klaudius update` has staged some conflicts. This skill walks through each one interactively, applies the user's chosen resolution, updates `.klaudius/manifest.json`, and cleans up the staging directory when done.

## HARD RULES

1. **Never auto-pick a resolution.** Every conflict requires explicit user confirmation before any file is modified.
2. **One conflict at a time.** Show the conflict, propose options, wait for the user's reply, apply it, then move on.
3. **Update the manifest immediately after each resolution** (not at the end). If the user interrupts halfway through, the manifest stays consistent with what's actually on disk.
4. **Never delete the `incoming/` directory or `conflicts.md` until ALL conflicts are resolved.**
5. **Back up before you destroy.** Any resolution that overwrites or deletes the user's current version of a file must first copy it to `.klaudius/backup/<to-version>/<path>`. Most Klaudius projects have no git history — a mis-chosen resolution must never permanently destroy a customisation.
6. **Manifest hashes always track canonical, never local.** When the user keeps their own edits or produces a merged version, the manifest still stores the *canonical* hash from this update. That way the user's customisation is naturally detected as `user-only` on the next run, and only a *further* canonical change re-triggers a conflict for that file. Writing the local/merged hash here is the wrong move — it tells future updates "the user agreed with canonical" and silently overwrites their edits next cycle.

## Step 1: Read the conflict report

Read `.klaudius/conflicts.md`. It contains:
- Total number of conflicts
- The "to" version (in the "Updating from X to Y" line) — it names the backup directory `.klaudius/backup/<to-version>/` used throughout Step 2
- For each conflict: the file path, a `**Type:**` line (`Edit conflict`, `Deleted locally`, or `Removed upstream`), paths to the local version and canonical version (where they exist), hash metadata

If the file doesn't exist, tell the user there's nothing to resolve and stop.

Count the conflicts and announce: "There are N conflicts to resolve. We'll go through them one at a time."

## Step 2: For each conflict, in the order they appear

Branch on the `**Type:**` line.

### Type: Edit conflict

#### 2a. Show the conflict context

Read three things:
1. The user's local version: `<conflict.path>` (relative to project root)
2. The canonical (new) version: `.klaudius/incoming/<conflict.path>`
3. (Optional) Run `diff <local> <canonical>` to show a unified diff if either file is small enough to make the diff readable.

**Use the "What upstream changed since your base" section** under each edit
conflict in conflicts.md: it shows exactly the hunks upstream touched. If the
user's local edits don't overlap those hunks, Merge is mechanical — take the
canonical file and re-apply their edits — and say so in your summary. If the
section is absent or says the snapshot is missing/stale, fall back to the
full compare above; don't guess.

For each conflict, present to the user:

```
Conflict {N} of {TOTAL}: {file path}

Your version is at:  {file path}
New canonical is at: .klaudius/incoming/{file path}

Summary of differences:
  - {2-4 bullet points describing what's actually different — read both files yourself first and characterise the differences in plain prose, do not just dump the diff}

Options:
  1. Keep mine     — discard the new canonical changes for this file
  2. Take canonical — overwrite my edits with the new version
  3. Merge          — combine both, deciding section-by-section
  4. Show diff      — print the unified diff and re-ask
  5. Skip for now   — leave this conflict in place, move to the next
```

While reading both versions, also check: does the **local** version reference a file path (script, skill, hook, agent, data file) that the **canonical** version does not? That is often the only call site for an operator-created file — "Take canonical" would leave the file on disk with nothing invoking it, and no error anywhere. If so, add a ⚠ line to the summary naming the file and the consequence, e.g. "Taking canonical leaves `scripts/my-notify.py` on disk but nothing will run it (Merge can keep the hook)."

**⚠ Special case — `.gitignore`: never plain "Take canonical".** The user's version may ignore secrets canonical doesn't know about (extra `.env` copies, credential artefacts); taking canonical un-ignores them all, and one `git add -A` later they're in git history. The only safe resolution is a union: keep EVERY user line, append canonical's new patterns, remove nothing. Say this when presenting the conflict instead of offering "Take canonical" neutrally. (Recent CLIs auto-merge `.gitignore` during `update`, so this mostly appears on older CLIs.)

Wait for the user's reply.

#### 2b. Apply the resolution

Based on the user's choice:

**Option 1 (Keep mine):**
Do nothing to the file itself. Update the manifest entry to the **canonical** hash, hashed from the staged incoming copy (HARD RULE 6):
```bash
python3 -c "
import json, hashlib, pathlib
m = json.loads(pathlib.Path('.klaudius/manifest.json').read_text())
canonical_hash = hashlib.sha256(pathlib.Path('.klaudius/incoming/{conflict.path}').read_bytes()).hexdigest()
m['files']['{conflict.path}'] = canonical_hash
m['updatedAt'] = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z')
pathlib.Path('.klaudius/manifest.json').write_text(json.dumps(m, indent=2) + chr(10))
"
```

**Option 2 (Take canonical):**
Back up the user's version, then overwrite it with the canonical copy (HARD RULE 5):
```bash
python3 -c "
import pathlib, shutil
p = pathlib.Path('{conflict.path}')
b = pathlib.Path('.klaudius/backup/{to-version}/{conflict.path}')
b.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(p, b)
shutil.copy2(pathlib.Path('.klaudius/incoming/{conflict.path}'), p)
"
```
Then update the manifest entry to the canonical hash:
```bash
python3 -c "
import json, hashlib, pathlib
m = json.loads(pathlib.Path('.klaudius/manifest.json').read_text())
canonical_hash = hashlib.sha256(pathlib.Path('.klaudius/incoming/{conflict.path}').read_bytes()).hexdigest()
m['files']['{conflict.path}'] = canonical_hash
m['updatedAt'] = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z')
pathlib.Path('.klaudius/manifest.json').write_text(json.dumps(m, indent=2) + chr(10))
"
```

**Option 3 (Merge):**
Read both files. Reason about what each side changed relative to a plausible common ancestor. Propose a merged version to the user. Once they confirm, back up their current version before overwriting it (HARD RULE 5):
```bash
python3 -c "
import pathlib, shutil
b = pathlib.Path('.klaudius/backup/{to-version}/{conflict.path}')
b.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(pathlib.Path('{conflict.path}'), b)
"
```
Then write the merged version to the local file path, and update the manifest with the **canonical** hash, not the merged file's hash (HARD RULE 6).

For complex files (skills, lessons, configs) you may need to walk the user through several decisions: "the new version added X, but you also added Y in the same section — should we keep both, prefer one, or rewrite?". Take your time. The user's intent is more important than speed.

After writing the merged file:
```bash
python3 -c "
import json, hashlib, pathlib
m = json.loads(pathlib.Path('.klaudius/manifest.json').read_text())
canonical_hash = hashlib.sha256(pathlib.Path('.klaudius/incoming/{conflict.path}').read_bytes()).hexdigest()
m['files']['{conflict.path}'] = canonical_hash
m['updatedAt'] = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z')
pathlib.Path('.klaudius/manifest.json').write_text(json.dumps(m, indent=2) + chr(10))
"
```

**Option 4 (Show diff):**
Run `diff -u <local> <canonical>` and re-present options 1-5.

**Option 5 (Skip for now):**
Leave the file untouched, leave the manifest entry untouched, leave the incoming/ copy in place. The conflict will reappear next run. Move to the next conflict.

### Type: Deleted locally

This shape means the file was installed by a previous init/update, the new canonical template still ships it, but the user has deleted their local copy. The user decides here whether it comes back — `update` never reinstalls it silently. The canonical version is staged at `.klaudius/incoming/<conflict.path>`.

#### 2a. Show the deletion context

Read the staged canonical copy and summarise what the file does in 1-3 bullets. Also grep the project (CLAUDE.md, `.claude/skills/`, `scripts/`) for references to the file's path or name — keeping it deleted leaves any such reference dangling, so name what you find in the summary (e.g. "CLAUDE.md still advertises the /cms command this file implements"). Then present:

```
Conflict {N} of {TOTAL}: {file path}  (deleted locally)

You deleted this file, but the canonical template still ships it
(possibly in a newer version).

What the canonical version contains:
  - {1-3 bullets summarising the file in plain prose}

Options:
  1. Restore      — copy the canonical version back into place (tracked again as normal)
  2. Keep deleted — never reinstall this file; future updates will skip it
  3. Skip for now — leave this conflict in place, move to the next
```

Wait for the user's reply.

#### 2b. Apply the resolution

**Option 1 (Restore):**
Copy the staged canonical version back into place. If the user recreated a file at this path since `update` ran, it gets backed up first (HARD RULE 5):
```bash
python3 -c "
import pathlib, shutil
src = pathlib.Path('.klaudius/incoming/{conflict.path}')
dst = pathlib.Path('{conflict.path}')
if dst.exists():
    b = pathlib.Path('.klaudius/backup/{to-version}/{conflict.path}')
    b.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dst, b)
dst.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(src, dst)
"
```
Then update the manifest entry to the canonical hash:
```bash
python3 -c "
import json, hashlib, pathlib
m = json.loads(pathlib.Path('.klaudius/manifest.json').read_text())
canonical_hash = hashlib.sha256(pathlib.Path('.klaudius/incoming/{conflict.path}').read_bytes()).hexdigest()
m['files']['{conflict.path}'] = canonical_hash
m['updatedAt'] = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z')
pathlib.Path('.klaudius/manifest.json').write_text(json.dumps(m, indent=2) + chr(10))
"
```

**Option 2 (Keep deleted):**
Drop the manifest entry AND record the path in the manifest's `ignored` list. The `ignored` entry is what makes the choice stick — without it the next update would classify the missing file as brand-new and reinstall it:
```bash
python3 -c "
import json, pathlib
m = json.loads(pathlib.Path('.klaudius/manifest.json').read_text())
m['files'].pop('{conflict.path}', None)
ig = m.setdefault('ignored', [])
if '{conflict.path}' not in ig:
    ig.append('{conflict.path}')
m['updatedAt'] = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z')
pathlib.Path('.klaudius/manifest.json').write_text(json.dumps(m, indent=2) + chr(10))
"
```
Mention to the user: if they ever want the file back, remove its entry from `ignored` in `.klaudius/manifest.json` and re-run `npx klaudius@latest update`.

**Option 3 (Skip for now):**
Leave everything. The conflict will reappear on the next update.

### Type: Removed upstream

This shape means the file used to be in canonical, the user edited it locally, and it's been removed from the new template version. There's no canonical version to merge with — the user just decides whether to keep their local copy (untracked from here on) or delete it.

#### 2a. Show the deletion context

Read the user's local file: `<conflict.path>`. Summarise what's in it in 1-3 bullets. Also grep the project (CLAUDE.md, `.claude/skills/`, `scripts/`) for references to the file's path or name — if anything still points at it, name that in the summary before the user chooses Delete. Then present:

```
Conflict {N} of {TOTAL}: {file path}  (removed upstream)

The new canonical template no longer ships this file. You've modified
your local copy since install.

What it currently contains:
  - {1-3 bullets summarising the file in plain prose}

Options:
  1. Keep mine — leave the file in place; stop tracking it in the manifest (it becomes a user-managed file going forward)
  2. Delete    — remove the file from disk
  3. Skip for now — leave both file and manifest entry untouched, move to the next
```

Wait for the user's reply.

#### 2b. Apply the resolution

**Option 1 (Keep mine — untrack):**
Leave the file. Drop the manifest entry so future updates don't keep re-flagging it:
```bash
python3 -c "
import json, pathlib
m = json.loads(pathlib.Path('.klaudius/manifest.json').read_text())
m['files'].pop('{conflict.path}', None)
m['updatedAt'] = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z')
pathlib.Path('.klaudius/manifest.json').write_text(json.dumps(m, indent=2) + chr(10))
"
```

**Option 2 (Delete):**
Back up the (locally modified) file, then delete it (HARD RULE 5):
```bash
python3 -c "
import pathlib, shutil
p = pathlib.Path('{conflict.path}')
b = pathlib.Path('.klaudius/backup/{to-version}/{conflict.path}')
b.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(p, b)
p.unlink()
"
```
Then drop the manifest entry:
```bash
python3 -c "
import json, pathlib
m = json.loads(pathlib.Path('.klaudius/manifest.json').read_text())
m['files'].pop('{conflict.path}', None)
m['updatedAt'] = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z')
pathlib.Path('.klaudius/manifest.json').write_text(json.dumps(m, indent=2) + chr(10))
"
```

**Option 3 (Skip for now):**
Leave everything. The conflict will reappear on the next update.

### 2c. Confirm and move on

Print "✓ Resolved {file}" and proceed to the next conflict. If the resolution wrote a backup (Take canonical, Merge, Delete, or a Restore that overwrote a recreated file), say so in the same line:

```
✓ Resolved {file} (your previous version is saved at .klaudius/backup/{to-version}/{file})
```

## Step 3: After all conflicts resolved

If at least one conflict was skipped, leave `.klaudius/incoming/` and `.klaudius/conflicts.md` in place — the user can come back later. Tell them: "{N} conflicts skipped. Re-run /resolve-conflicts when you're ready."

If every conflict was resolved (no skips):

1. Bump the manifest's `templateVersion` to the value mentioned at the top of `.klaudius/conflicts.md` (the "to" version):
```bash
python3 -c "
import json, pathlib, re
m = json.loads(pathlib.Path('.klaudius/manifest.json').read_text())
report = pathlib.Path('.klaudius/conflicts.md').read_text()
to_match = re.search(r'to \\*\\*([^*]+)\\*\\*', report)
if to_match:
    m['templateVersion'] = to_match.group(1).strip()
pathlib.Path('.klaudius/manifest.json').write_text(json.dumps(m, indent=2) + chr(10))
"
```

2. Delete the staging directory and report:
```bash
rm -rf .klaudius/incoming
rm .klaudius/conflicts.md
```

3. Tell the user: "All conflicts resolved. Manifest bumped to template version X. Staging cleaned up." If any resolutions wrote backups, add: "Your pre-resolution versions are kept under `.klaudius/backup/{to-version}/` — delete that folder whenever you're confident you don't need them."

Never delete `.klaudius/backup/` during cleanup.

## Tips for merging well

- Read both versions in full before proposing anything. Don't skim.
- If the local version references a path the canonical one doesn't (custom script, hook, skill, data file), prefer a merge that carries the reference forward — see the orphan check in Step 2a.
- The diff is mechanical. Your value is reasoning about INTENT — what was the user trying to achieve with their edits, what is the canonical change trying to achieve, and how do they coexist.
- For lessons files (`prompts/lessons/*.md` — lists of bullets), it's usually safe to take the union: keep all of the user's added bullets plus all of the new canonical bullets, in a sensible order. Surface duplicates for the user to decide.
- **Special case — `prompts/lessons.md` conflicts where the canonical version became a small per-stage index** (the lessons file was split into `prompts/lessons/{find,gather,build,deploy,outreach}.md`): don't union. Accept the canonical index as the new `prompts/lessons.md`, then MOVE each lesson the user had added to the old monolithic file into the matching per-stage file (Site Access Status entries and gather-source notes → `gather.md`, layout/CSS lessons → `build.md`, messaging lessons → `outreach.md`, etc.). Nothing the user wrote should be lost — it just needs re-homing.
- For SKILL.md files, the canonical version is usually the source of truth for structure/wording, but the user may have added their own paragraphs or rules. Preserve their additions, take canonical's improvements to existing prose.
- For `scripts/*.py` and `scripts/*.js` files, merging is risky — these have correctness implications. Default to asking the user explicitly per change rather than auto-merging.
- For `CLAUDE.md`: structure is usually canonical, but the buyer may have added their own rules in the Critical Rules section. Preserve those.

## When to abort

If at any point you can't tell what the user wants, or you've made too many merge decisions in a row without confirmation, stop. Ask: "I've made N decisions on this file. Want me to dump the proposed merged result for you to review before I write it?"

Better to over-confirm than to silently mangle a file.
