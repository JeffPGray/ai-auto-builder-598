#!/usr/bin/env node
/**
 * Image plan: pick slots → generate missing HF thin plates → KEEP lines.
 *
 * Rules: services/higgsfield/IMAGE-RULES.md
 *
 *   node services/higgsfield/image-plan.mjs --slug <slug> --pick|--apply|--keep|--all [--force]
 *
 * Exit 0 OK, 2 policy/misuse. Prints IMAGE_PLAN=OK|FAIL …
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./lib.mjs";

const ROLES_BAN_PHOTO = new Set(["metrics", "dense-copy", "faq", "spec-ledger"]);
const ROLES_ALLOW_HF_STILL = new Set(["thin-shelf", "atmosphere-ground", "photo-ground"]);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

export function planPath(slug) {
  return path.join(APP_ROOT, "clients", slug, "data", "image-plan.json");
}

export function parseClearedStems(md) {
  const stems = new Set();
  for (const line of md.split("\n")) {
    const m = line.match(/\/images\/([A-Za-z0-9_\-.]+?)\.(?:jpg|jpeg|png|webp)\b/i);
    if (!m) continue;
    if (/not yet verified|unverified|rejected|do not use|never-use|facility-delivery/i.test(line)) {
      continue;
    }
    if (/✅\s*KEEP|KEEP/i.test(line) || !/REJECT|never/i.test(line)) {
      stems.add(m[1].toLowerCase().replace(/\.(jpg|jpeg|png|webp)$/i, ""));
    }
  }
  // Explicit never-use
  stems.delete("facility-delivery");
  return stems;
}

function aquaDefaults(slug, cleared) {
  const has = (s) => cleared.has(s);
  return {
    version: 1,
    slug,
    pickedAt: new Date().toISOString(),
    heroPromptFile: "hero-prompt.txt",
    slots: [
      {
        id: "hero",
        role: "hero-video",
        source: "hf-hero",
        mode: "ref",
        refStem: has("product-concrete-tank") ? "product-concrete-tank" : null,
        out: "hero.mp4",
        poster: "hero-poster.jpg",
        promptFile: "hero-prompt.txt",
        crop: null,
      },
      {
        id: "dealer-plate",
        role: "photo-ground",
        // Portrait gmaps1 fails wide cinema — prefer HF 16:9 plate when present
        source: existsSync(path.join(APP_ROOT, "clients", slug, "data", "images", "dealer-plate.webp"))
          || existsSync(path.join(APP_ROOT, "clients", slug, "site", "public", "images", "dealer-plate.webp"))
          ? "hf-still"
          : "cleared",
        stem: existsSync(path.join(APP_ROOT, "clients", slug, "data", "images", "dealer-plate.webp"))
          || existsSync(path.join(APP_ROOT, "clients", slug, "site", "public", "images", "dealer-plate.webp"))
          ? "dealer-plate"
          : "gmaps1",
        file: existsSync(path.join(APP_ROOT, "clients", slug, "data", "images", "dealer-plate.webp"))
          || existsSync(path.join(APP_ROOT, "clients", slug, "site", "public", "images", "dealer-plate.webp"))
          ? "dealer-plate.webp"
          : "gmaps1.webp",
        fromStem: "gmaps1",
        crop: { objectPosition: "70% 35%", treatment: "cinema-letterbox" },
        prompt:
          "Wide 16:9 cinematic dealer-yard photograph, two contractors shaking hands beside aerobic treatment tanks on a trailer, white work truck soft in background, Pearl Mississippi outdoor light, photoreal documentary, handshake in the RIGHT half of frame, left third soft/open for UI overlay, no text, no logos, no watermark",
        optional: false,
      },
      {
        id: "product-primary",
        role: "product-feature",
        source: "cleared",
        stem: "product-concrete-tank",
        file: "product-concrete-tank.webp",
        crop: { objectPosition: "center 40%", aspect: "21/9" },
      },
      {
        id: "product-secondary",
        role: "product-feature",
        source: "cleared",
        stem: "product-install",
        file: "product-install.webp",
        crop: { objectPosition: "center", aspect: "4/3" },
      },
      {
        id: "cutaway-canvas",
        role: "product-feature",
        source: "cleared",
        stem: "product-concrete-tank",
        file: "product-concrete-tank.webp",
        crop: { objectPosition: "center" },
      },
      {
        id: "measured-band",
        role: "metrics",
        source: "none",
        note: "copper plate only — photo veil banned",
      },
    ].filter((s) => {
      if (s.source === "cleared" && s.stem && !has(s.stem) && s.stem !== "dealer-plate") {
        return false;
      }
      return true;
    }),
  };
}

export function assertNoBannedPhotoRoles(plan) {
  for (const slot of plan.slots || []) {
    if (ROLES_BAN_PHOTO.has(slot.role) && slot.source && slot.source !== "none") {
      throw new Error(`banned photo role=${slot.role} slot=${slot.id} source=${slot.source}`);
    }
    if (slot.source === "hf-still" && !ROLES_ALLOW_HF_STILL.has(slot.role) && slot.role !== "photo-ground") {
      throw new Error(`hf-still not allowed for role=${slot.role} slot=${slot.id}`);
    }
  }
}

function genericDefaults(slug, cleared) {
  const stems = [...cleared].filter((s) => !/^logo/.test(s));
  const ref = stems[0] || null;
  const secondary = stems[1] || stems[0] || null;
  const slots = [
    {
      id: "hero",
      role: "hero-video",
      source: "hf-hero",
      mode: ref ? "ref" : "t2v",
      refStem: ref,
      out: "hero.mp4",
      poster: "hero-poster.jpg",
      promptFile: "hero-prompt.txt",
      crop: null,
    },
    {
      id: "measured-band",
      role: "metrics",
      source: "none",
      note: "no photo veil under metrics",
    },
  ];
  if (ref) {
    const pub = path.join(APP_ROOT, "clients", slug, "site", "public", "images");
    const data = path.join(APP_ROOT, "clients", slug, "data", "images");
    const extFor = (stem) => {
      for (const e of [".webp", ".jpg", ".jpeg", ".png"]) {
        if (existsSync(path.join(pub, stem + e)) || existsSync(path.join(data, stem + e))) {
          return e.replace(".", "");
        }
      }
      return "webp";
    };
    slots.splice(1, 0, {
      id: "photo-ground-primary",
      role: "photo-ground",
      source: "cleared",
      stem: ref,
      file: `${ref}.${extFor(ref)}`,
      crop: { objectPosition: "70% 40%", treatment: "cinema-letterbox" },
    });
    if (secondary && secondary !== ref) {
      slots.splice(2, 0, {
        id: "product-primary",
        role: "product-feature",
        source: "cleared",
        stem: secondary,
        file: `${secondary}.${extFor(secondary)}`,
        crop: { objectPosition: "center 40%" },
      });
    }
  }
  return {
    version: 1,
    slug,
    pickedAt: new Date().toISOString(),
    heroPromptFile: "hero-prompt.txt",
    slots,
  };
}

function pickPlan(slug, force) {
  const gathered = path.join(APP_ROOT, "clients", slug, "data", "gathered-content.md");
  if (!existsSync(gathered)) throw new Error(`missing ${gathered}`);
  const cleared = parseClearedStems(readFileSync(gathered, "utf8"));
  const out = planPath(slug);
  if (existsSync(out) && !force) {
    const existing = JSON.parse(readFileSync(out, "utf8"));
    assertNoBannedPhotoRoles(existing);
    console.log(`IMAGE_PLAN=OK slug=${slug} action=pick-skip slots=${existing.slots.length}`);
    return existing;
  }
  // Aqua keeps the rich Clarity Engine preset; every other slug derives from cleared KEEP stems.
  const plan =
    slug === "aquaklear-ms" ? aquaDefaults(slug, cleared) : genericDefaults(slug, cleared);
  assertNoBannedPhotoRoles(plan);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(plan, null, 2) + "\n");
  console.log(`IMAGE_PLAN=OK slug=${slug} action=pick slots=${plan.slots.length}`);
  return plan;
}

function applyPlan(slug, force) {
  const out = planPath(slug);
  if (!existsSync(out)) pickPlan(slug, true);
  const plan = JSON.parse(readFileSync(out, "utf8"));
  assertNoBannedPhotoRoles(plan);
  const dataImg = path.join(APP_ROOT, "clients", slug, "data", "images");
  const pubImg = path.join(APP_ROOT, "clients", slug, "site", "public", "images");
  mkdirSync(dataImg, { recursive: true });
  mkdirSync(pubImg, { recursive: true });

  for (const slot of plan.slots) {
    if (slot.source !== "hf-still") continue;
    if (slot.optional && !slot.prompt) continue;
    const destName = slot.file || `${slot.stem}.webp`;
    const destData = path.join(dataImg, destName);
    const destPub = path.join(pubImg, destName);
    if (existsSync(destData) && existsSync(destPub) && !force) {
      console.log(`IMAGE_PLAN=SKIP slot=${slot.id} exists=${destName}`);
      continue;
    }
    const fromStem = slot.fromStem || "product-concrete-tank";
    const fromCandidates = [
      path.join(pubImg, `${fromStem}.webp`),
      path.join(pubImg, `${fromStem}.jpg`),
      path.join(dataImg, `${fromStem}.jpg`),
      path.join(dataImg, `${fromStem}.webp`),
    ];
    const from = fromCandidates.find((p) => existsSync(p));
    if (!from) throw new Error(`slot=${slot.id} missing fromStem=${fromStem}`);
    if (!slot.prompt) throw new Error(`slot=${slot.id} hf-still needs prompt`);

    const r = spawnSync(
      process.execPath,
      [
        path.join(APP_ROOT, "services", "higgsfield", "generate-stills.mjs"),
        "--slug",
        slug,
        "--from",
        from,
        "--out",
        destName,
        "--aspect",
        "16:9",
        "--prompt",
        slot.prompt,
      ],
      { cwd: APP_ROOT, encoding: "utf8", env: process.env },
    );
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) throw new Error(`generate-stills failed for ${slot.id}`);
    // generate-stills writes public/; copy to data/
    if (existsSync(destPub)) copyFileSync(destPub, destData);
  }
  console.log(`IMAGE_PLAN=OK slug=${slug} action=apply`);
  return plan;
}

function appendKeepLines(slug) {
  const plan = JSON.parse(readFileSync(planPath(slug), "utf8"));
  const gathered = path.join(APP_ROOT, "clients", slug, "data", "gathered-content.md");
  let md = readFileSync(gathered, "utf8");
  let added = 0;
  for (const slot of plan.slots) {
    if (slot.source !== "hf-still" || !slot.file) continue;
    const needle = `/images/${slot.file}`;
    if (md.includes(needle)) continue;
    const why =
      slot.fromStem
        ? `Higgsfield i2i ${slot.role} from ${slot.fromStem}`
        : `Higgsfield i2i ${slot.role}`;
    const block = `\n- \`${needle}\` ✅ KEEP (${why})\n  - Planned slot \`${slot.id}\`. Soft reference only; not a product hero.\n`;
    md = md.replace(/\n---\n\n## Brand/, `${block}\n---\n\n## Brand`);
    if (!md.includes(needle)) md += block;
    added++;
  }
  writeFileSync(gathered, md);
  console.log(`IMAGE_PLAN=OK slug=${slug} action=keep added=${added}`);
}

function fail(msg) {
  console.error(`IMAGE_PLAN=FAIL reason=${msg}`);
  process.exit(2);
}

const slug = arg("slug");
if (!slug) fail("usage: image-plan.mjs --slug <slug> --pick|--apply|--keep|--all [--force]");
const force = hasFlag("force");

try {
  if (hasFlag("all") || (!hasFlag("pick") && !hasFlag("apply") && !hasFlag("keep"))) {
    // default --all when only --slug given with --all; require a flag
  }
  if (hasFlag("all")) {
    pickPlan(slug, force);
    applyPlan(slug, force);
    appendKeepLines(slug);
  } else if (hasFlag("pick")) pickPlan(slug, force);
  else if (hasFlag("apply")) applyPlan(slug, force);
  else if (hasFlag("keep")) appendKeepLines(slug);
  else fail("pass --pick, --apply, --keep, or --all");
} catch (e) {
  fail(e.message);
}
