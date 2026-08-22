#!/usr/bin/env node
/**
 * verify-media-surface.mjs <slug> [--json]
 *
 * Enforces IMAGE-RULES / media-surface contract against a client site:
 * - globals.css recipes (overlay opacity, required classes)
 * - page.tsx composition (nav pad, money CTA, plan roles)
 * - image-plan.json when present
 *
 * Prints: MEDIA_SURFACE_CHECK=PASS|FAIL …
 * Exit 0 PASS, 1 FAIL.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkGlobalsCss,
  checkImagePlan,
  checkPageSources,
  checkBuiltPages,
  checkNextConfig,
  MARKETING_HTML,
} from "../services/media-surface/contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JSON_OUT = process.argv.includes("--json");
const slug = process.argv.find((a, i) => i > 1 && !a.startsWith("--"));

if (!slug) {
  console.error("usage: verify-media-surface.mjs <slug> [--json]");
  process.exit(2);
}

const siteDir = path.join(ROOT, "clients", slug, "site");
const globalsPath = path.join(siteDir, "src", "app", "globals.css");
const nextConfigPath = path.join(siteDir, "next.config.mjs");
const planPath = path.join(ROOT, "clients", slug, "data", "image-plan.json");
const appDir = path.join(siteDir, "src", "app");

const failures = [];
const warnings = [];
const facts = { slug };

function walkTsx(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "_components" || name === "ui") continue;
      walkTsx(full, out);
    } else if (name === "page.tsx") {
      out.push({ path: path.relative(siteDir, full), src: readFileSync(full, "utf8") });
    }
  }
  return out;
}

if (!existsSync(globalsPath)) {
  failures.push(`[contract] missing ${globalsPath}`);
} else {
  const css = readFileSync(globalsPath, "utf8");
  facts.globalsBytes = css.length;
  const r = checkGlobalsCss(css);
  failures.push(...r.failures);
  warnings.push(...r.warnings);
}

if (!existsSync(nextConfigPath)) {
  failures.push(`[host] missing next.config.mjs`);
} else {
  const r = checkNextConfig(readFileSync(nextConfigPath, "utf8"));
  failures.push(...r.failures);
  warnings.push(...r.warnings);
  facts.nextConfig = "ok";
}

const pages = walkTsx(appDir);
facts.pages = pages.length;
{
  const r = checkPageSources(pages);
  failures.push(...r.failures);
  warnings.push(...r.warnings);
}

// Built HTML — fail closed if out/ missing (same as richness); hatch budget + service atmosphere
const outDir = path.join(siteDir, "out");
function walkHtml(dir, out = [], prefix = "") {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (st.isDirectory()) {
      if (name === "_next" || name === "images") continue;
      walkHtml(full, out, rel);
    } else if (name.endsWith(".html")) {
      out.push({ path: rel, html: readFileSync(full, "utf8") });
    }
  }
  return out;
}
if (!existsSync(outDir)) {
  failures.push("[atmosphere] missing site/out — run next build before media-surface (fail closed)");
} else {
  const htmlPages = walkHtml(outDir).filter(
    (p) => MARKETING_HTML.test(p.path) || MARKETING_HTML.test(p.path.split("/").pop()),
  );
  facts.htmlPages = htmlPages.length;
  const r = checkBuiltPages(htmlPages);
  failures.push(...r.failures);
  warnings.push(...r.warnings);
}

if (existsSync(planPath)) {
  try {
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    facts.planSlots = plan.slots?.length ?? 0;
    const r = checkImagePlan(plan);
    failures.push(...r.failures);
  } catch (e) {
    failures.push(`[plan] unreadable image-plan.json: ${e.message}`);
  }
} else {
  failures.push(
    "[plan] missing image-plan.json — preflight must run `image-plan.mjs --slug … --all` (fail closed)",
  );
}

const ok = failures.length === 0;
const verdict = ok ? "PASS" : "FAIL";
const line = `MEDIA_SURFACE_CHECK=${verdict} slug=${slug} failures=${failures.length} warnings=${warnings.length}`;

if (JSON_OUT) {
  console.log(JSON.stringify({ result: verdict, failures, warnings, facts }, null, 2));
} else {
  console.log(line);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  for (const w of warnings) console.log(`  warn  ${w}`);
}

process.exit(ok ? 0 : 1);
