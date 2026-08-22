#!/usr/bin/env node
/**
 * Write clients/<slug>/data/hero-prompt.txt from gathered content + hero ref still.
 *
 *   node services/higgsfield/hero-prompt.mjs --slug <slug> [--force]
 *
 * Run after image-plan --pick (needs refStem). Preflight runs this before render-hero.mjs.
 * Exit 0 on write/skip; 2 on missing gathered or plan.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./lib.mjs";

function planPath(slug) {
  return path.join(APP_ROOT, "clients", slug, "data", "image-plan.json");
}

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

function readHeroSlot(slug) {
  const p = planPath(slug);
  if (!existsSync(p)) return null;
  try {
    const plan = JSON.parse(readFileSync(p, "utf8"));
    return (plan.slots || []).find((s) => s.id === "hero" || s.role === "hero-video") || null;
  } catch {
    return null;
  }
}

function parseGathered(md) {
  const out = { trade: "", geo: "", photoNote: "" };
  const cat = md.match(/\*\*Category:\*\*\s*(.+)/i);
  if (cat) out.trade = cat[1].trim();
  const area = md.match(/Service area:\*\*\s*(.+)/i) || md.match(/Location \| \*\*(.+?)\*\*/);
  if (area) out.geo = area[1].replace(/\|.*/g, "").trim();
  if (!out.geo) {
    const frisco = md.match(/Frisco,?\s*TX/i);
    if (frisco) out.geo = "North Texas";
  }
  return out;
}

function photoLineForStem(md, stem) {
  if (!stem) return "";
  const re = new RegExp(`\\|\\s*${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^|]*\\|([^|]+)\\|`, "i");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

function subjectFromStem(stem, note, trade) {
  const s = (stem || "").toLowerCase();
  const n = (note || "").toLowerCase();
  const t = (trade || "").toLowerCase();
  if (/tree|trim|oak|arbor|stump|remov/.test(s + n + t)) {
    return "professional tree crew working from the ground on a large residential tree";
  }
  if (/sod|landscap|lawn|yard|mulch|gravel/.test(s + n + t)) {
    return "licensed landscapers laying fresh sod in a North Texas suburban yard";
  }
  if (/sprinkler|irrigation|backflow/.test(s + n + t)) {
    return "licensed irrigation technician servicing a residential sprinkler system";
  }
  if (/drain|french|trench/.test(s + n + t)) {
    return "drainage crew installing yard drainage in a residential property";
  }
  if (/tank|concrete|wastewater|septic|aerobic/.test(s + n + t)) {
    return "aerobic treatment system in a Gulf South industrial yard at golden hour";
  }
  if (/roof|gutter|siding/.test(s + n + t)) {
    return "trade crew completing exterior work on a suburban home";
  }
  if (/plumb|hvac|mechanic/.test(s + n + t)) {
    return "licensed trade professional at work on a residential job site";
  }
  return "professional trade crew at work on a real residential job site";
}

function buildPrompt({ trade, geo, stem, photoNote }) {
  const subject = subjectFromStem(stem, photoNote, trade);
  const place = geo || "the local service area";
  return (
    `Cinematic slow orbit and push-in on ${subject} in golden-hour ${place} light, ` +
    "shallow depth of field, volumetric light, photoreal premium documentary grade, " +
    "no text, no logos, no watermark"
  );
}

const slug = arg("slug");
if (!slug) {
  console.error("usage: node services/higgsfield/hero-prompt.mjs --slug <slug> [--force]");
  process.exit(2);
}

const force = hasFlag("force");
const gatheredPath = path.join(APP_ROOT, "clients", slug, "data", "gathered-content.md");
const outPath = path.join(APP_ROOT, "clients", slug, "data", "hero-prompt.txt");

if (!existsSync(gatheredPath)) {
  console.error(`HERO_PROMPT=FAIL slug=${slug} reason=missing gathered-content.md`);
  process.exit(2);
}

const heroSlot = readHeroSlot(slug);
const gathered = readFileSync(gatheredPath, "utf8");
const meta = parseGathered(gathered);
const refStem = heroSlot?.refStem || null;
const photoNote = photoLineForStem(gathered, refStem);

if (existsSync(outPath) && !force) {
  const existing = readFileSync(outPath, "utf8").trim();
  if (existing) {
    console.log(`HERO_PROMPT=OK slug=${slug} action=skip ref=${refStem || "none"}`);
    process.exit(0);
  }
}

const prompt = buildPrompt({ ...meta, stem: refStem, photoNote });
writeFileSync(outPath, prompt + "\n", "utf8");
console.log(`HERO_PROMPT=OK slug=${slug} action=write ref=${refStem || "none"} chars=${prompt.length}`);
