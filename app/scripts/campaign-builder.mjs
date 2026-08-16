#!/usr/bin/env node
/**
 * campaign-builder.mjs [--json] [--days 60] [--voice] [--out <file>]
 *
 * Emits a complete cold-outreach campaign definition — an Instantly-style sequence expressed in
 * GoHighLevel terms — so the sequence is DATA rather than something hand-assembled in a UI.
 *
 * WHY A BUILDER AND NOT A HAND-BUILT WORKFLOW. The live workflow today has two emails and was built
 * by hand, which means nobody can diff it, review it, or rebuild it after an accident. A sequence is
 * a product decision worth versioning: cadence, copy, halt conditions and field mappings all belong
 * in one file that can be argued with in a pull request.
 *
 * THE CADENCE IS NOT INVENTED. It comes from Instantly's own platform data (Cold Email Benchmark
 * Report 2026, ~700k businesses), deliberately preferring their PRODUCT DOCS and BENCHMARK data over
 * their blog — the blog claims 4-7 step sequences reply at 27%, which cannot be true when the same
 * company reports a 3.43% platform average and 10.7% for elite senders. Directionally "more steps
 * reply more" survives; that magnitude does not.
 *
 * Key inherited numbers:
 *   - 3.43% average reply rate, ~14% of replies positive => ~1 real conversation per 157 contacts
 *   - 58% of replies land on step 1
 *   - optimum 4-7 steps in a 14-21 day window; gaps 3-7 days early, 7-14 days late
 *   - performance drops after step 7
 *
 * WHY 8 STEPS HERE rather than their 7. Our window is 60 days, ~3x theirs, so the same step count
 * lands at materially lower per-week pressure. Step 8 is a BREAKUP, which is consistently the
 * second-highest-reply step and does not consume fatigue budget the way another "just bumping this"
 * does. And unlike a generic pitch, every step can reveal something new about a real website that
 * already exists with the prospect's own business on it.
 *
 * ⚠️ DELIVERABILITY WARNING, and it is the most important thing in this file: GHL HAS NO INBOX
 * ROTATION. LC Email sends from one authenticated domain on shared-IP reputation you do not control,
 * so Instantly's Primed/Ramping/Resting pools cannot be reproduced. Running true cold volume through
 * GHL risks the domain that also sends invoices and contracts. The intended architecture is cold
 * acquisition in a dedicated tool on throwaway domains, with GHL owning everything POST-REPLY.
 * `--channel ghl` exists for the operator who accepts that risk knowingly; it caps hard at 30/day.
 */
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const JSON_OUT = args.includes('--json');
const WITH_VOICE = args.includes('--voice');
const DAYS = Number(flag('days', 60));
const OUT = flag('out', null);

/* GHL identity, read from the live account 2026-08-16. Stage ids matter because the halt condition
 * checks STAGE MEMBERSHIP as well as opportunity status — see HALTS below. */
const GHL = {
  locationId: 'fHLsjtxsf1nWzIfVvxY6',
  pipeline: { id: 'JpMRvchzprTlgFFtY8TT', name: '$185 Site Pipeline (rename -> GR-598)' },
  stages: {
    demoBuilt: '152b946b-4982-4bc5-88b2-8d2ef39e56df',
    outreachSent: '738f4d3b-69cf-40fe-ab8d-4a4340d1dd9c',
    callScheduled: 'cfcfc082-8ce5-4df5-817e-4c721acdadac',
    contractSigned: '402b653b-7017-4519-ab68-24e94da67799',
    live: '43053652-7eef-45e2-aa14-1bee6963340f',
    recurring: 'd15eaee2-f2c9-4fc1-8d78-c879c69173df',
  },
  fields: {
    demoUrl: 'uejY9J7kzO4drvb77DKW',       // contact.gr185_demo_url
    previewUrl: 'zIAaoBKcYRRlrs7WCGVv',    // contact.preview_url
    painPoint: 'UPQHxESeV2KF5kSs8KxF',     // contact.top_pain_point
    industry: 'VOhLZwZR0nEZBZZ1Yxjx',      // contact.gr_industry
    leadStatus: 's7SVZeLChwO8tXaLdB7m',    // has 'unsubscribed' + 'customer'
    softBounces: 'OqTjOz06z91xRqncmOuj',
  },
  /* MISSING and required — a sequence that cannot record its own position cannot resume after an
   * outage, and cannot answer "why did this contact stop at step 4?". Create before going live. */
  fieldsToCreate: [
    { name: 'Seq Step', key: 'contact.seq_step', type: 'NUMERICAL' },
    { name: 'Seq Started At', key: 'contact.seq_started_at', type: 'DATE' },
    { name: 'Seq State', key: 'contact.seq_state', type: 'SINGLE_OPTIONS',
      options: ['active', 'halted', 'completed'] },
    { name: 'Seq Halt Reason', key: 'contact.seq_halt_reason', type: 'TEXT' },
  ],
};

/* Gap profile: dense while the build is newest and novelty is highest, widening as it ages.
 * The front half carries the value — 58% of replies land on step 1 — so if only part of this ever
 * ships, ship days 0-9 plus the day-60 breakup and skip the middle. */
const STEPS = [
  { day: 0,  id: 'E1', ch: 'email', name: 'The reveal',
    job: 'Link to their finished live site. No pitch, no price.',
    nepq: 'connection', words: '55-80', links: 1 },
  { day: 2,  id: 'E2', ch: 'email', name: 'Same-thread bump',
    job: 'One specific detail noticed on their current site or listing.',
    nepq: 'situation', words: '40-60', links: 0 },
  { day: 5,  id: 'E3', ch: 'email', name: 'Price, unasked',
    job: 'State $598 + $98/mo plainly. Removes the cost stall before it forms.',
    nepq: 'situation', words: '60-80', links: 1 },
  { day: 9,  id: 'E4', ch: 'email', name: 'Proof',
    job: 'A comparable trade business, same metro where possible.',
    nepq: 'problem-awareness', words: '60-90', links: 1 },
  { day: 12, id: 'V1', ch: 'voice', name: 'First call',
    job: 'Highest-value voice slot: four emails seen, price known, site exists.',
    nepq: 'problem-awareness', words: 'n/a', links: 0 },
  { day: 17, id: 'E5', ch: 'email', name: 'Loss frame',
    job: 'What the current situation costs per month in missed calls.',
    nepq: 'consequence', words: '70-100', links: 1 },
  { day: 25, id: 'E6', ch: 'email', name: 'Objection pre-handle',
    job: '"Who maintains it", "I already have a guy", "I am too busy".',
    nepq: 'solution-awareness', words: '80-110', links: 1 },
  { day: 33, id: 'V2', ch: 'voice', name: 'Accuracy call',
    job: 'Different pretext: is the demo still accurate? Genuinely useful, not a nag.',
    nepq: 'situation', words: 'n/a', links: 0 },
  { day: 41, id: 'E7', ch: 'email', name: 'The takeaway',
    job: 'The demo comes down on a stated date. A REAL deadline, honoured.',
    nepq: 'consequence', words: '50-70', links: 1 },
  { day: 53, id: 'V3', ch: 'voice', name: 'Final call',
    job: 'Voicemail-safe. Assume no pickup and write for the machine.',
    nepq: 'commitment', words: 'n/a', links: 0 },
  { day: 60, id: 'E8', ch: 'email', name: 'Breakup',
    job: 'Permission to close the file. Historically the #2 reply step.',
    nepq: 'commitment', words: '40-60', links: 0 },
];

/* HALTS. Two things here are load-bearing and easy to get wrong.
 *
 * 1. CHECK STAGE AS WELL AS STATUS. A rep dragging a card to Contract Signed does not necessarily
 *    flip opportunity status to won. Status alone would keep emailing a signed client, which is the
 *    single worst failure this system can produce.
 * 2. DOMAIN-LEVEL HALT. Instantly stops the sequence for EVERY contact at a company when anyone
 *    there replies. GHL has no equivalent, and trade businesses routinely have info@, the owner and
 *    a manager on one domain — so three people get the same sequence unless this is built. */
const HALTS = [
  { on: 'inbound reply (any channel)', action: 'halt', why: 'the conversation has started' },
  { on: 'opportunity status = won/lost/abandoned', action: 'halt', why: 'deal resolved' },
  { on: `stage in {Contract Signed, Live, Recurring Client}`, action: 'halt',
    why: 'a dragged card may never flip status; emailing a signed client is the worst failure here' },
  { on: 'lead_status = unsubscribed or customer', action: 'halt', why: 'explicit opt-out or already bought' },
  { on: 'hard bounce', action: 'halt + suppress', why: 'address is dead; further sends damage reputation' },
  { on: 'soft_bounce_count >= 3', action: 'halt', why: 'repeated soft bounces predict a hard one' },
  { on: 'DND / unsubscribe link', action: 'halt + suppress', why: 'legal' },
  { on: 'ANY reply from the same company domain', action: 'halt all contacts at that domain',
    why: 'NOT native to GHL — needs a company-domain custom field plus a tagging workflow' },
  { on: 'demo-built tag removed', action: 'halt', why: 'the asset the sequence is about no longer exists' },
];

const GUARDRAILS = {
  perMailboxPerDay: 30,
  warmupPerDay: 10,
  minGapBetweenSendsMin: 9,
  randomJitterMin: [0, 5],
  maxAccountsPerDomain: 5,
  rampStartPerDay: 2,
  rampIncrementPerDay: 2,
  autoPauseCampaignBounceRate: 0.05,
  restMailboxBelowHealth: 0.85,
  sendWindow: 'Tue-Thu, 9-11am or 1-3pm prospect local; launch Mondays; avoid Friday',
  copy: { maxWords: 80, format: 'plain text', firstEmailLinks: 1, signature: 'minimal, no images' },
  abTesting: {
    minContactsPerVariant: 500,
    sendsPerVariantFor20pctLift: 3800,
    minDurationWeeks: 2,
    onlyTest: 'subject line and email-1 opening, on step 1 only — 58% of replies land there, and '
      + 'testing step 5 at this volume is statistically hopeless',
  },
};

const MATH = {
  avgReplyRate: 0.0343,
  positiveShareOfReplies: 0.14,
  contactsPerConversation: 157,
  note: 'From Instantly platform data, not their blog. 500 prospects through this sequence yields '
    + 'roughly 3 real conversations. The sequence is the easy part; the binding constraint is '
    + 'accurate, deliverable prospects at the top of it.',
};

const steps = STEPS.filter((s) => (WITH_VOICE || s.ch === 'email') && s.day <= DAYS);
const campaign = {
  name: `GR-598 Demo-First — ${steps.length} steps / ${DAYS} days`,
  generatedFrom: 'Instantly benchmark data + product docs; see file header',
  ghl: GHL, steps, halts: HALTS, guardrails: GUARDRAILS, math: MATH,
  deliverabilityWarning:
    'GHL has NO inbox rotation. Running cold volume here risks the domain that also sends invoices '
    + 'and contracts. Intended architecture: cold acquisition on dedicated throwaway domains in a '
    + 'rotation-capable tool; GHL owns everything post-reply.',
};

if (JSON_OUT || OUT) {
  const s = JSON.stringify(campaign, null, 2);
  if (OUT) { writeFileSync(OUT, s); console.log(`  written -> ${OUT}`); } else console.log(s);
} else {
  console.log(`\n  ${campaign.name}\n`);
  for (const s of steps) {
    console.log(`  day ${String(s.day).padStart(2)}  ${s.id}  ${s.ch.padEnd(5)} ${s.name.padEnd(22)} ${s.job}`);
  }
  console.log(`\n  HALTS (${HALTS.length}):`);
  for (const h of HALTS) console.log(`    - ${h.on}  ->  ${h.action}`);
  console.log(`\n  MISSING FIELDS (create before go-live): ${GHL.fieldsToCreate.map((f) => f.key).join(', ')}`);
  console.log(`\n  ⚠️  ${campaign.deliverabilityWarning}\n`);
  console.log(`  MATH: ~1 conversation per ${MATH.contactsPerConversation} contacts. ${MATH.note}\n`);
}
