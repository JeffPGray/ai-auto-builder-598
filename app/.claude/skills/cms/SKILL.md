---
name: cms
description: Retrofit a deployed client site with a self-serve CMS — a password-protected /admin editor where the owner edits their own text, photos and reviews. Vercel only.
argument-hint: [business-name]
effort: high
allowed-tools: Bash(npx *), Bash(npm *), Bash(python3 *), Bash(cd *), Bash(cp *), Bash(mv *), Bash(mkdir *), Bash(rm *), Bash(cat *), Bash(grep *), Bash(test *), Bash(curl *), Bash(diff *), Bash(openssl *), Bash(printf *), Bash(sleep *), Bash(kill *), Bash(pkill *), Bash(bash *), Bash(head *), Bash(cut *), Bash(tr *), Bash(touch *), Read, Write, Edit, Glob, Grep
---

# Add a self-serve CMS to $ARGUMENTS

Read `prompts/lessons/build.md` and `prompts/lessons/deploy.md` before starting — this skill rebuilds and redeploys the client site, and those failure modes apply.

Retrofit the already-deployed site in `clients/$ARGUMENTS/site` with a custom CMS: a password-protected editor at `/admin` where the business owner edits their own contact details, text, services, reviews and photos — phone-friendly, no WordPress, no plugins, no extra hosting cost. Edits go live within seconds and survive every redeploy (content lives in Vercel Blob, not in the code).

This is a known-good, production-proven architecture. The plumbing is copied verbatim from `.claude/skills/cms/reference/`; only the content model, the page refactor and the admin sections are generated per site. Do not redesign the architecture.

**The one-shot contract:** the operator says `/cms acme-roofing` and gets back a working live editor plus the owner's password. If they asked for specific editable fields, honour that; otherwise use the defaults in Step 4.

## Architecture (read once, then follow the steps)

- `src/lib/content.ts` — the content model (`SiteContent`) + `defaultContent`, extracted **verbatim** from the current site. What the site shows before any edits.
- `src/lib/blob.ts` — content + photo storage in Vercel Blob. Each save writes a NEW uniquely-named `content/site-*.json` (reading the newest, pruning older) rather than overwriting one file — overwriting a stable Blob URL is defeated by the Blob CDN, so edits wouldn't show. Defensive sanitising means a malformed blob can never white-screen the live site. Do not revert to a stable key + allowOverwrite.
- `src/lib/auth.ts` — HMAC-signed session cookie (Edge-compatible). Env vars `ADMIN_PASSWORD` + `SESSION_SECRET` on the Vercel project.
- `src/lib/actions.ts` — server actions for login + every edit. **Every mutating action self-authorises via `requireSession()`** — the route gate does not protect server actions.
- `src/proxy.ts` — gates `/admin` routes (Next 16's renamed middleware convention).
- `src/app/admin/` — the dashboard (generated) + login + shared UI building blocks + browser-side photo compression.
- **Every marketing route** becomes a thin server component (loads content, `dynamic = "force-dynamic"` so it always serves the latest saved content); each old page body moves to its own client view. The sites are multi-page (build skill § Site structure: `/`, `/services`, `/about`, `/contact`), so this is `src/app/page.tsx` → `src/app/HomeView.tsx`, `src/app/services/page.tsx` → `src/app/services/ServicesView.tsx`, and likewise for `/about` and `/contact`. **Enumerate the routes from disk, never assume:** `find clients/$ARGUMENTS/site/src/app -name 'page.tsx' -not -path '*/admin/*' -not -path '*/book/*'`. Shared chrome in `src/app/_components/` (`SiteNav`, `SiteFooter`) is refactored once and takes `content` as a prop.

  **Retrofitting only `page.tsx` is the failure mode this skill has to avoid.** It builds green, the `/admin` dashboard looks complete, and the owner discovers months later that editing their phone number changed it on the home page and nowhere else. There is no error and nothing in the logs — Step 7's identity check is what catches it, which is why that check now walks every route.

## Step 0 — Preconditions (STOP gates)

1. **Host must be Vercel.** `grep -E '^DEPLOY_PROVIDER=' .env | head -1 | cut -d= -f2- | tr -d '"'` — if it says `cloudflare` or `netlify`, **STOP** and tell the operator: the CMS needs server actions and Vercel Blob, which Cloudflare Pages and Netlify's static hosting can't run. No partial install, no workaround.
2. **The site must exist and be deployed.** `test -d clients/$ARGUMENTS/site` and a `deployed_url` in Supabase (`python3 scripts/db.py client $ARGUMENTS`) or `clients/$ARGUMENTS/data/status.md`. If built but not yet deployed, run the deploy skill (`/deploy $ARGUMENTS`) first, then continue.
3. **Not already CMS-enabled.** If `clients/$ARGUMENTS/data/cms.md` exists, this site already has a CMS — do NOT reinstall. Switch to § Maintenance at the bottom and ask what the operator wants changed. If `data/cms-in-progress` exists without `cms.md`, a previous run failed partway — resume the install from wherever it stopped (every step below is safe to re-run).
4. **Note the Next/React versions** from `clients/$ARGUMENTS/site/package.json`. Next ≥ 16 → `src/proxy.ts`; Next ≤ 15 → `src/middleware.ts` (same body, export renamed `middleware`). React ≤ 18 → `useFormState`/`useFormStatus` instead of `useActionState` in `LoginForm.tsx`.
5. **Owner-facing language is `${OPERATOR_LANGUAGE}`** from `.env` (falls back to English). Every string the owner sees — admin labels, buttons, hints, login page, error messages, the handover note — must be written in it. The reference files ship in English; translate their owner-facing strings after copying if needed. (Note: messages *thrown* from server actions are redacted by Next in production — the owner sees `admin-error.tsx` for those, which is why that page's copy matters most. Messages *returned* as values, like `loginAction`'s, reach the owner verbatim.)
6. **Drop the in-progress marker** so a parallel session can never `/build` over this client mid-conversion (the build skill checks for it): `touch clients/$ARGUMENTS/data/cms-in-progress`. It's removed at Step 11.

## Step 1 — Capture the before-state

The refactor must not change a single visible character. Capture the ground truth first, from the live deployed site:

Capture **every** route, not just the homepage — the identity check in Step 7 compares route by route:

```bash
npx playwright-cli -s=cms open                            # MUST open the named session before its first goto
for P in "" services about contact; do                    # extend if this client has extra routes
  test -z "$P" && SLUGF=home || SLUGF="$P"
  npx playwright-cli -s=cms goto "$DEPLOYED_URL/$P"
  npx playwright-cli -s=cms eval "document.body.innerText" > /tmp/cms-before-$ARGUMENTS-$SLUGF.txt
done
wc -l /tmp/cms-before-$ARGUMENTS-*.txt   # every file must be non-trivial; an empty one means a 404 you need to explain
```

(The `-s=cms` named session keeps this isolated from any parallel pipeline session's browser state. A named session must be `open`ed before the first `goto`, or `goto` errors with "browser 'cms' is not open"; re-running `open` later is harmless.)

## Step 2 — Flip the runtime + install deps

```bash
cd clients/$ARGUMENTS/site
npm install     # node_modules is usually deleted post-deploy
rm -rf out      # stale static export, no longer produced
rm -f vercel.json   # static-export-only `/` → `/index` rewrite; see below
cp ../../../.claude/skills/cms/reference/next.config.mjs next.config.mjs
npm install @vercel/blob browser-image-compression
```

If the site's `next.config.mjs` had extra keys beyond the scaffold defaults (rare), merge them into the new file instead of overwriting — the non-negotiables are: **no** `output: 'export'`, keep `images: { unoptimized: true }`, add `experimental.serverActions.bodySizeLimit: "4.5mb"`.

**`rm -f vercel.json` is not optional.** The scaffold ships a `vercel.json` containing a single rewrite, `/` → `/index`. It exists only because a **static-export** prebuilt deploy otherwise serves 404 at `/` (Next 16 + Vercel CLI 59 re-home `index.html` onto the serving path `index` and nothing maps `/` onto it). Once this site is a server app there is no `/index` route, so leaving the file in place would rewrite the homepage onto a non-existent route and 404 the very page the retrofit is meant to preserve. If you take the abort path in § Rollback, restore `vercel.json` alongside `next.config.mjs`.

## Step 3 — Copy the plumbing (verbatim)

From the project root:

```bash
SITE=clients/$ARGUMENTS/site
REF=.claude/skills/cms/reference
mkdir -p $SITE/src/lib $SITE/src/app/admin/login
cp $REF/auth.ts            $SITE/src/lib/auth.ts
cp $REF/blob.ts            $SITE/src/lib/blob.ts
cp $REF/actions.ts         $SITE/src/lib/actions.ts
cp $REF/PhotoUploader.tsx  $SITE/src/app/admin/PhotoUploader.tsx
cp $REF/admin-ui.tsx       $SITE/src/app/admin/ui.tsx
cp $REF/login-page.tsx     $SITE/src/app/admin/login/page.tsx
cp $REF/LoginForm.tsx      $SITE/src/app/admin/login/LoginForm.tsx
cp $REF/admin-error.tsx    $SITE/src/app/admin/error.tsx
cp $REF/proxy.ts           $SITE/src/proxy.ts   # Next ≤15: src/middleware.ts + rename export
```

Then:
- Confirm `tsconfig.json` maps `"@/*"` → `"./src/*"` (the scaffold default). If missing, add it.
- Set the business name in the login page's metadata title.
- Apply the version tweaks from Step 0.4 and the language translation from Step 0.5.
- Do NOT edit the generic zones of the copied files beyond that. The marked `SITE-SPECIFIC` sections at the bottom of `blob.ts` and `actions.ts` are yours to generate; everything else is proven plumbing.

## Step 4 — Extract the content model (`src/lib/content.ts`)

Read **every** route's `page.tsx` end to end (the full list from § Architecture, plus `_components/SiteNav.tsx` and `SiteFooter.tsx`) and decide what the owner can edit. `SiteContent` is one object spanning the whole site, keyed by page:

```ts
export type SiteContent = {
  business: Business;            // phone/email/address/hours — SHARED, edited once, used by every page and the chrome
  home: HomeContent;
  services: ServicesContent;     // the service list lives here, not under `home`
  about: AboutContent;
  contact: ContactContent;
};
```

**Shared-vs-page is the decision that matters.** Anything appearing on more than one page (phone, email, address, hours, the footer tagline, the rating badge, the nav labels' targets) belongs in `business` and is edited **once**. Duplicating the phone number under both `home` and `contact` gives the owner two fields that silently disagree, which is worse than not being editable at all. Anything appearing on exactly one page nests under that page's key.

**Editable by default** (the owner's world): contact details (phone, email, address, hours, area — phone/email propagate everywhere they appear), the hero headline/intro, each section's headings and body text, services (add/edit/reorder/delete), reviews (add/edit/reorder/delete — verbatim, real reviews only), price lists if the site has them, opening hours, a rating badge if shown (with a `show` toggle), the footer tagline, **every photo + caption** (fixed slots) and any photo gallery (add/replace/caption/reorder/delete). If the operator asked for specific fields, include those.

**Stays hardcoded** (design furniture): section eyebrows, decorative microcopy, nav link labels, form field labels, aria-labels, anything that would break the layout if the owner changed it freely. Also stays out: **the booking facade** on a booking-mode lead (its service menu, staff list, slot logic and confirmation copy). The facade is a stand-in that `/booking` replaces wholesale at conversion — modelling it as owner-editable content would create edits that vanish the moment the real system lands.

Rules for `content.ts`:

- `defaultContent` values are copied **byte-for-byte** from the current page — this is what makes the refactor provably safe (Step 7 diffs against it). Never "improve" copy while extracting.
- Always define and export `type Photo = { src: string; caption: string }` and `type GalleryPhoto = { id: string; src: string; caption: string }` — `blob.ts` imports both (export them even if one goes unused).
- Lists of objects get stable string ids (`svc-…`, `rev-…`).
- Existing photo srcs stay verbatim (`/images/x.jpg` or hotlinked `https://` URLs). Once the owner replaces one, the new src is a Blob URL; the originals in `public/images/` remain as defaults/fallbacks.
- `site.json` lives in a PUBLIC Blob store (world-readable at a guessable URL). Only model content that already renders on the public site — never private notes, unlisted phone numbers, or anything the owner wouldn't publish.
- Top of file: a comment block explaining the lockstep contract (see § Maintenance) and that anything the owner is likely to edit lives here, with design furniture staying in `HomeView`.

## Step 5 — Refactor the page to render from content

Back up **every** route file plus the shared chrome, mirroring the `src/app` tree so nothing collides:

```bash
SITE=clients/$ARGUMENTS/site
BAK=clients/$ARGUMENTS/data/pre-cms
mkdir -p "$BAK"
( cd "$SITE/src/app" && find . -name 'page.tsx' -not -path './admin/*' -not -path './book/*' -o -path './_components/*' -name '*.tsx' ) | while read -r f; do
  mkdir -p "$BAK/$(dirname "$f")"
  test -f "$BAK/$f" || cp "$SITE/src/app/$f" "$BAK/$f"
done
find "$BAK" -name '*.tsx'   # confirm one backup per route + the chrome components
```

(The `test -f` guard matters: on a re-run after a partial failure, each `page.tsx` is already the refactored thin wrapper — an unconditional `cp` would overwrite the only copy of the original. Installs predating this step have a single `data/page.tsx.pre-cms.bak`; that older path stays valid for those clients, do not delete it.)

Then, **for each route**:

1. Move the old page body to a sibling client view — `src/app/HomeView.tsx`, `src/app/services/ServicesView.tsx`, `src/app/about/AboutView.tsx`, `src/app/contact/ContactView.tsx`: keep/add `"use client"`, change the signature to `export default function ServicesView({ content }: { content: SiteContent })` (pass the whole object, so the shared `business` fields are always in reach), and replace every extracted string/array with its `content.…` reference. Mechanical substitution only — no layout, class, or copy changes.
1b. Refactor `_components/SiteNav.tsx` and `SiteFooter.tsx` the same way — they render `content.business` values (phone, hours, tagline) and take `content` as a prop from whichever view renders them. Do this **once**; if you find yourself editing the nav's markup in four places, the build did not use shared chrome and you should extract it now rather than propagate the duplication into the CMS.
2. Write the new thin server `page.tsx` for that route (`src/app/page.tsx`, `src/app/services/page.tsx`, …), each importing its own view:

```tsx
import { getContent } from "@/lib/blob";
import HomeView from "./HomeView";

// Render dynamically on every request so the page ALWAYS reflects the latest
// content saved in Blob — the owner's edits appear immediately. Do NOT use ISR
// (`export const revalidate = N`) here: on Next.js 16 a page with `revalidate`
// that also does a `no-store` fetch (as getContent does) can freeze as its
// deploy-time prerender and never pick up edits, leaving the live site stale
// forever. A per-request Blob read is negligible at small-business traffic.
export const dynamic = "force-dynamic";

export default async function Page() {
  const content = await getContent();
  return <HomeView content={content} />;
}
```

3. If the site renders anything else derived from content (e.g. JSON-LD), derive it from `content` in the server page. Leave `layout.tsx` alone **except** for site-level JSON-LD, which `/seo` puts there — if that graph carries business facts the owner can now edit (phone, address, hours), it has to read from `getContent()` too, or the machine-readable copy silently diverges from the visible one after the first edit. If the old `page.tsx` exported `metadata` or `viewport`, move those exports onto the corresponding new server `page.tsx` — a client component can't export them and `next build` fails confusingly. **Each route keeps its OWN distinct `metadata`**; do not collapse four titles into one while refactoring.
4. Any list the owner can empty out must degrade gracefully (hide the section or render nothing — never a broken layout).

## Step 6 — Generate the site-specific halves

Replace every `cms-generate` stub. All three follow directly from the content model:

**`blob.ts → mergeWithDefaults`** — coerce every field with the provided helpers (`str` / `bool` / `strArray` / `photo` / `gallery`, plus per-item object-list sanitisers). The invariants are documented at the stub. Special care: fixed-length photo arrays (e.g. exactly two case-study slots) must ALWAYS come back at exact length by index.

**`actions.ts` site zone** — `resolvePhotoTarget` + `applyCaption` for every photo slot, then one action per section and add/update/delete/reorder per list. Every action starts with `await requireSession()`. Pattern for a fixed section:

```ts
export async function updateBusinessAction(form: FormData): Promise<void> {
  await requireSession();
  const content = await getContent();
  const next: SiteContent = {
    ...content,
    business: {
      // critical fields back-fill from the existing value when left blank, so
      // the owner can't accidentally wipe what every "Call" link uses
      phone: readString(form, "phone", content.business.phone).trim() || content.business.phone,
      email: readString(form, "email", content.business.email).trim() || content.business.email,
      hours: readString(form, "hours", content.business.hours).trim() || content.business.hours,
    },
  };
  await setContent(next);
  await refreshAfterEdit();
}
```

**`src/app/admin/page.tsx`** — compose one `<section>` per content section, from the building blocks in `./ui`. **Group the sections by the page they appear on, in nav order** (Shared details, then Home, Services, About, Contact), each group under a `SectionHeader` naming the page as the owner sees it ("Your Services page"). An owner who cannot tell which page a field affects will not use the editor. Put the shared `business` group first and say plainly in its subtitle that those values update across the whole site. Skeleton:

```tsx
import { fetchContent, logoutAction, updateBusinessAction /* … */ } from "@/lib/actions";
import { SectionHeader, Field, SubmitButton, PhotoSlot, ReorderButton, DeleteForm, Empty, ViewSiteLink, inputCls, formCls, summaryCls, editSummaryCls } from "./ui";
import PhotoUploader from "./PhotoUploader";

export const metadata = { title: "Site editor — BUSINESS NAME", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic"; // always render the latest saved content

export default async function AdminPage() {
  const content = await fetchContent();
  return (
    <main className="min-h-screen bg-[#F7F6F3] py-8 px-5 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-12">
        {/* header with title + sign-out form (action={logoutAction}), then <ViewSiteLink/>, then the sections */}
      </div>
    </main>
  );
}

function BusinessSection({ business }: { business: Business }) {
  return (
    <section>
      <SectionHeader title="Contact details" subtitle="Your phone, email and hours. These update everywhere they appear on the site." />
      <form action={updateBusinessAction} className={formCls}>
        <Field label="Phone number" htmlFor="phone">
          <input id="phone" name="phone" type="text" defaultValue={business.phone} className={inputCls} />
        </Field>
        {/* …one Field per editable value… */}
        <SubmitButton>Save contact details</SubmitButton>
      </form>
    </section>
  );
}
```

For lists: a collapsed `<details>` "+ Add" form, then one card per item with inline edit `<details>`, `ReorderButton` up/down (hide at the edges), and `DeleteForm`. For photo slots: `PhotoSlot` with a plain-language title/hint per slot ("The large photo behind the headline…") — and don't forget its required `replaceLabel` / `captionSaveLabel` props (owner's language). Galleries use `PhotoUploader` with `withCaption` for adds and `replacePhotoAction` with a `work:<id>` target for swaps.

**Per-item icons + reorder.** If a list renders hardcoded per-item icons as design furniture (e.g. service cards each with their own SVG) and the owner can reorder or add items, icons indexed purely by position will drift on reorder and owner-added items get no icon. Bind each icon to a stable per-item key so it travels with its item (or render a neutral fallback marker for added items) — never key icons to array index alone. Say in the admin copy that the icon itself isn't editable here.

Admin copy rules: plain, non-technical, in `${OPERATOR_LANGUAGE}`; explain paragraph/list conventions inline ("separate paragraphs with a blank line", "one item per line"); textareas join paragraphs with `\n\n` and lists with `\n` (matching `readParagraphs`/`readLines`). Keep the neutral monochrome palette from `ui.tsx` — the admin is a tool, not the brand site.

## Step 7 — Build + identity check

```bash
grep -rn "cms-generate" clients/$ARGUMENTS/site/src && echo "STUBS REMAIN — finish Step 6" || echo "clean — no stubs remain"
cd clients/$ARGUMENTS/site
npx next build
```

Fix until clean. Then prove the refactor changed nothing visible (no Blob token locally → `getContent()` falls back to `defaultContent`, which must equal the launch copy):

```bash
npx next start -p 3111 & echo $! > /tmp/cms-next-$ARGUMENTS.pid
sleep 6
npx playwright-cli -s=cms open
for P in "" services about contact; do                    # same route list as Step 1
  test -z "$P" && SLUGF=home || SLUGF="$P"
  npx playwright-cli -s=cms goto "http://localhost:3111/$P"
  npx playwright-cli -s=cms eval "document.body.innerText" > /tmp/cms-after-$ARGUMENTS-$SLUGF.txt
  echo "=== /$P ==="
  diff <(tr -s '[:space:]' ' ' < /tmp/cms-before-$ARGUMENTS-$SLUGF.txt) \
       <(tr -s '[:space:]' ' ' < /tmp/cms-after-$ARGUMENTS-$SLUGF.txt) && echo "identical"
done
kill "$(cat /tmp/cms-next-$ARGUMENTS.pid)" 2>/dev/null || pkill -f "next start -p 3111" || true
```

**Every route must print `identical`**, and every route must have been visited — a route that was never retrofitted still renders its hardcoded strings and therefore also diffs clean, so check the *count*: `ls /tmp/cms-after-$ARGUMENTS-*.txt | wc -l` must equal the number of routes found in Step 5, and `grep -rLn 'content\.' clients/$ARGUMENTS/site/src/app/*/[A-Z]*View.tsx` must return nothing (a view that never references `content.` was not actually wired up).

Then prove the shared fields really propagate, which is the whole point of one `SiteContent`:

```bash
# the phone number must be reached through content on EVERY page that shows it,
# never left as a hardcoded literal in a view
PHONE=$(grep -oE '\(?[0-9]{3}\)?[ -][0-9]{3}-[0-9]{4}' "clients/$ARGUMENTS/data/gathered-content.md" | head -1)
grep -rn "$PHONE" clients/$ARGUMENTS/site/src/app --include='*.tsx'
```

Any hit in a **view** is a literal that survived extraction: the owner will edit their phone number in `/admin` and that page will keep showing the old one. Fix it in `content.ts` + the view before continuing.

Hits in a route's **`metadata` export** (title/description) are a real but different problem, and this grep will find them: `metadata` is evaluated at build time on the server, so it cannot read Blob content and cannot be made owner-editable without a rebuild. Do not try to wire it — instead **remove the volatile fact from the metadata string** (a description that says "call us for a free consultation in Frisco" ages as well as the site does, one that hardcodes the phone number goes stale the first time the owner changes it) and say so in `cms.md` under what the owner can and cannot edit. Same reasoning for opening hours and addresses in metadata.

The diff must be empty (whitespace-only noise aside). A real difference has two likely causes: (a) a string was dropped or "improved" during extraction — fix `content.ts`/`HomeView.tsx`, don't rationalise it; or (b) the local `site/` source was stale relative to the live deployment (edited or deployed from another machine) — if the differences clearly predate your refactor, STOP and flag it to the operator rather than patching `content.ts` to match old copy. Also confirm `http://localhost:3111/admin` redirects to `/admin/login` and the login page renders (you can re-start the server briefly for this).

## Step 8 — Vercel wiring (secrets + Blob store)

Link first (same discipline as the deploy skill — never skip the project assertion):

```bash
cd clients/$ARGUMENTS/site
rm -rf .vercel
npx vercel link --token=$VERCEL_TOKEN ${VERCEL_SCOPE:+--scope=$VERCEL_SCOPE} --yes --project $ARGUMENTS
cat .vercel/project.json | python3 -c "import sys,json; p=json.load(sys.stdin); assert p['projectName']=='$ARGUMENTS', f'WRONG PROJECT: {p[\"projectName\"]}'; print('linked correctly')"
npx vercel env ls production --token=$VERCEL_TOKEN
```

Then, based on what `env ls` shows:

- **`ADMIN_PASSWORD` missing** → compose one the owner can type on a phone: three unrelated lowercase words + two digits, hyphen-separated (e.g. `maple-river-frost-42`). Never derive it from the business name. Set both secrets:

  ```bash
  printf '%s' "THE_PASSWORD" | npx vercel env add ADMIN_PASSWORD production --token=$VERCEL_TOKEN
  printf '%s' "$(openssl rand -hex 32)" | npx vercel env add SESSION_SECRET production --token=$VERCEL_TOKEN
  ```

  `SESSION_SECRET` is machine-only: never print it, never write it to any file.
- **`ADMIN_PASSWORD` already exists** → do NOT overwrite (the owner may already know it). The recorded password is in `clients/$ARGUMENTS/data/cms.md`. Exception: if it exists but `cms.md` does NOT (a previous run failed before Step 11), the value is unrecoverable from Vercel — reset it: `npx vercel env rm ADMIN_PASSWORD production --yes --token=$VERCEL_TOKEN`, then add a fresh one as above.
- **`BLOB_READ_WRITE_TOKEN` missing** → create + auto-connect a store (the `--yes` connects it to the linked project, which injects the env var):

  ```bash
  npx vercel blob create-store "$ARGUMENTS" --access public --yes --token=$VERCEL_TOKEN
  npx vercel env ls production --token=$VERCEL_TOKEN   # BLOB_READ_WRITE_TOKEN must now be listed
  ```

  If the store name is rejected (length/charset), shorten it — the name is cosmetic, the connection is what matters. If after creation the token still isn't listed, tell the operator the one manual step: Vercel dashboard → project `$ARGUMENTS` → Storage → connect the Blob store — then re-verify before continuing. Do not proceed without the token: the deploy would silently serve default content and discard owner edits.

## Step 9 — Deploy

Invoke the deploy skill (`/deploy $ARGUMENTS`) — do not hand-roll deploy commands here. It re-verifies the project link, records the URL, and cleans up `node_modules`. The three new env vars reach the live site from the Vercel platform at runtime — they don't need to be in the local build (`ADMIN_PASSWORD`/`SESSION_SECRET` are runtime-only, and `vercel pull` may not deliver sensitive values). Because the public page is `force-dynamic`, it reads the Blob fresh on every request — so whether or not the Blob token was present at build time, the live site always serves current content and the owner's edits appear immediately.

## Step 10 — Verify the live admin

```bash
test "$(curl -sS -o /dev/null -w '%{http_code}' "$DEPLOYED_URL/admin/login")" = "200" || echo "LOGIN PAGE BROKEN — investigate"
curl -sS -o /dev/null -w '%{http_code}' "$DEPLOYED_URL/admin"   # expect 307/308/302 (redirect to login), NOT 200/500
test "$(curl -sS -o /dev/null -w '%{http_code}' "$DEPLOYED_URL/")" = "200" || echo "HOMEPAGE BROKEN — investigate"
```

Then prove the password works, headlessly:

```bash
npx playwright-cli -s=cms open
npx playwright-cli -s=cms goto "$DEPLOYED_URL/admin/login"
npx playwright-cli -s=cms eval "() => { document.getElementById('password').value='THE_PASSWORD'; document.querySelector('button[type=submit]').click(); }"
sleep 4
npx playwright-cli -s=cms eval "location.pathname + ' :: ' + document.body.innerText.slice(0, 300)"
```

Expect `/admin` and the dashboard header. If login fails or the dashboard errors, fix before handover — never hand the operator a password you haven't verified live.

## Step 11 — Record + handover

1. Write `clients/$ARGUMENTS/data/cms.md`: the `/admin` URL, the password, date enabled, the Blob store name, the list of what the owner can edit, and the warnings from § Rules (never rebuild; Vercel-only; content lives in Blob and survives redeploys). This file is the operator's record — keep it accurate on every later change. Then remove the marker: `rm -f clients/$ARGUMENTS/data/cms-in-progress`.
2. Append one line to `clients/$ARGUMENTS/data/status.md`: `CMS enabled <date> — editor at <url>/admin, credentials in cms.md`.
3. Final message to the operator: the admin URL, the password, what the owner can edit, plus a short ready-to-forward handover note for the business owner written in `${OPERATOR_LANGUAGE}` ("Your website now has its own editor at …/admin. Password: … . You can change your text, photos and reviews yourself — edits go live in seconds. Keep the password safe.").

## Rules

- **Vercel only.** Server actions + Vercel Blob. On `DEPLOY_PROVIDER=cloudflare` or `netlify`, stop at Step 0 — no partial installs.
- **This site never goes back to static export.** From now on it deploys as a server app (the deploy skill handles both shapes), and `/build` must never be re-run for this client — it would delete the CMS (the build skill checks `data/cms.md` and refuses).
- **Never remove `requireSession()` from an action**, and every new action you ever add starts with it. The proxy gate does not protect server actions.
- **The identity check is non-negotiable.** A CMS retrofit that changes the visible site is a failed retrofit.
- **Browser-side photo compression stays.** Vercel rejects bodies over 4.5 MB; the compress-then-upload flow in `PhotoUploader.tsx` is what makes phone photos work.
- **Cost honesty:** free on Vercel's Hobby allowances (as of mid-2026: 1 GB Blob storage + 10 GB transfer/month, shared across the account). A small site's content JSON + a few dozen compressed photos is ~40 MB — comfortable, but an operator with many CMS sites on one account shares the pot. Don't promise "unlimited".
- **Secrets:** the password goes in `cms.md` and the final message (the operator must hand it to their client); `SESSION_SECRET` goes nowhere except the Vercel env var.
- If anything fails irrecoverably (Vercel API errors, Blob store won't connect, deploy fails), alert via `bash scripts/notify.sh "cms $ARGUMENTS: <reason>"` and stop — don't leave the site half-converted without telling anyone. If you must abort before Step 9, you can restore the site by reverting `next.config.mjs` to the scaffold version (`output: 'export'`), **re-creating the `vercel.json` deleted in Step 2** (`{"rewrites":[{"source":"/","destination":"/index"}]}` — without it the restored static site serves 404 at `/`), restoring **every** file from `data/pre-cms/` back over `src/app/` (`cd clients/$ARGUMENTS/data/pre-cms && find . -name '*.tsx' -exec cp {} ../../site/src/app/{} \;` — older single-page installs restore `data/page.tsx.pre-cms.bak` to `src/app/page.tsx` instead), and deleting `src/lib`, `src/app/admin`, `src/proxy.ts` and every generated `*View.tsx`. A partial restore that puts back only the homepage leaves the site in a state where three routes import a `content` prop nothing supplies — it will not build.

## § Maintenance (the site already has a CMS)

When the operator asks for a change to an existing CMS site ("the client wants to edit X too", "rename a label", "the owner forgot the password"):

- **New editable field** — the lockstep contract, always all five in one pass: add to `content.ts` (field + verbatim default, under the right page key or under `business` if it is shared) → coerce it in `mergeWithDefaults` → action in `actions.ts` (with `requireSession()`) → admin form section, in that page's group → render it in **every** view that shows it (`HomeView`, `ServicesView`, `AboutView`, `ContactView`, `SiteNav`, `SiteFooter` — a shared field usually touches more than one). `mergeWithDefaults` makes adding fields safe for already-saved blobs.
- **New page** — the owner asked for a route the build didn't produce, or `/build` was re-run before the CMS existed. Add `src/app/<route>/page.tsx` (thin server component) + `<Route>View.tsx`, a key on `SiteContent`, its own admin group, a nav link in `SiteNav`, and a `sitemap.ts` entry. Re-run Step 7 for the new route.
- **Forgotten password** — read it back from `data/cms.md`. Only if genuinely lost: set a new value via `npx vercel env rm ADMIN_PASSWORD production --yes --token=$VERCEL_TOKEN` + `env add` (as in Step 8), redeploy via the deploy skill, update `cms.md`, and tell the operator to pass it on.
- **Redeploys** never touch live content (it's in Blob) — safe to ship code changes any time via the deploy skill. (The public page is `force-dynamic`, so it always serves the current Blob content regardless of build-time env.)
- After any maintenance change, re-run Step 7's build check and update `cms.md`.
