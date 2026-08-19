Client: cold-front-ac (slug) — Cold Front A/C Of The Woodlands, HVAC contractor, 26400 Kuykendahl Rd, The Woodlands, TX 77389. Phone +18325598236, email coldfrontacofthewoodlands@gmail.com (verified verbatim on their own live site). Already claimed in Supabase (status=claimed, extra={mode: compete, site_verdict: ok}) and `clients/cold-front-ac/data/status.md` already documents the find. Duplicate check and already-built probe both came back clean at claim time.

This is a FULL, LIVE, END-TO-END PIPELINE RUN — the first real client to go through the hardened build system committed in `950433a` (permanent design-lift floor: hard-gated richness/HyperUI-transplant checks, proof-of-read HyperUI hashes, hero-video-in-Setup, design-manifest checkpoint, node_modules cache, file-locked fingerprint ledger). The operator (Jeff) explicitly wants this run to prove the hardening actually holds under a real build before any larger-scale batch of clients goes through it. Do not take shortcuts, do not skip a gate because it's inconvenient, and do not silently downgrade a hard FAIL to a warning.

**Mode: COMPETE.** Their existing site (https://www.coldfrontacofthewoodlands.com) works — do not pitch it as broken. Pitch on what $598 + $98/mo adds on top: hosting, live chat, ongoing SEO/AEO/blog content, an owner-editable site. Same discipline as aot-mechanical.

## Run the full pipeline, each step via the Skill tool (never inline the skill's bash commands yourself — see CLAUDE.md's explicit rule on this)

1. **`/gather cold-front-ac`** — this business already has a real, working website (compete mode). Capture their real content (services, about, contact, hours) from their own site plus Google reviews/reputation signals per the skill's compete-mode gather path. Do not fabricate services or claims. Run the photo vision gate for real — read every downloaded photo and reject anything that doesn't genuinely depict the business (see the skill's § PHOTO VISION GATE). Get at least one usable, verified real photo or explicitly document a zero-photo fallback design decision.

2. **`/ui-ux-pro-max`** (or the project's equivalent design-system step per CLAUDE.md "Design system step is mandatory before /build") — generate the palette/typography/layout direction BEFORE building. Do not let /build invent this ad hoc.

3. **`/build cold-front-ac`** — build the bespoke Next.js site against that design system. Follow `build/SKILL.md`'s HARD-BLOCKER CONTRACT (all 6 checks, including the promoted RICHNESS and HYPERUI checks) and the new design-manifest checkpoint (decide richness/HyperUI-with-hash/hero-video plan in status.md BEFORE writing TSX). Use `scripts/node-modules-cache.sh` for the node_modules install, not a raw `npm install`. When citing a HyperUI component, cite the REAL vendored file and let `hyperui-lookup.mjs` print its `[hex6]` hash — do not paraphrase or guess a citation.

4. **QA** — spawn the `qa-reviewer` agent per CLAUDE.md's Exception 1 (fresh eyes, zero build context). Its script battery must include `hyperui-transplant-check.mjs`, `richness-check.mjs`, and `verify-hero-video.mjs` — all three are now hard gates, not warnings. If QA reports FAIL on any of the 6 HARD-BLOCKER items, fix and re-run QA. Do not proceed to deploy on a FAIL.

5. **`/deploy cold-front-ac`** — deploy to the shared PROSPECT lane (`{slug}.grayreserve.agency`) per the deploy skill's PROSPECT/CONVERTED table — this is a spec build, not a converted client, so it must NOT create a new dedicated Vercel project. Confirm the live URL serves 200 and spot-check the actual rendered page (nav dropdown, hero, at least one service page) before calling this done.

6. **GHL tagging** — `/deploy`'s own mirror tags the contact `demo-built` in GoHighLevel once live. Because `.env` has `OUTBOUND_SENDER=ghl` and `OUTREACH_ENABLED=true`, do **NOT** run `/outreach` yourself — the published workflow "GR-598 Demo-First Send" owns the first-touch send once the `demo-built` tag lands. Running `/outreach` as well would double-send. This is a real, live send to a real business's real email — there is no dry-run flag, so getting this step right matters.

## After the run — write the proof

Write a clear, itemized account in `clients/cold-front-ac/data/status.md` covering:
- Gather: what was captured, photo count kept/rejected and why, any fallback used.
- Design system: palette/typography/layout direction chosen and why.
- Build: richness-check numbers (gradient count, photo-grounded-section count), hyperui-transplant-check numbers (FAITHFUL/LOOSE/DECORATIVE counts, any hash failures), hero-video status (rendered or explicit degradation reason).
- QA: pass/fail on each of the 6 HARD-BLOCKER items, and how many rounds it took.
- Deploy: live URL, route-check result, curl 200 confirmation.
- GHL: contact ID, confirmation the `demo-built` tag was applied, and — this is the actual proof point Jeff asked for — confirm (via a GHL API read, not assumption) that the "GR-598 Demo-First Send" workflow actually fired and sent an email to coldfrontacofthewoodlands@gmail.com. If you can query the conversation/message log for that contact, do it and record what you found.
- Total wall-clock time and an approximate token count for the run, and how many distinct HyperUI components were actually cited-with-hash in the shipped site (a real number, not an estimate).

Be honest about anything that didn't fully complete or that you had to degrade — a clear "X did not work, here's why" is worth far more than a claimed success that doesn't hold up under a second look. This run's entire purpose is to be the trustworthy proof point before Jeff scales the pipeline to a larger batch of clients.
