---
name: send-invoice
description: Generate a bespoke PDF invoice for a client and drop a ready-to-send draft email (invoice attached) into your own mailbox's Drafts folder. Never sends anything — you review the draft and hit send yourself. First ever run asks for your business details once, then remembers them.
argument-hint: [business-name] [amount]
effort: medium
allowed-tools: Bash(python3 *), Bash(node *), Bash(mkdir *), Bash(ls *), Bash(test *), Bash(cat *), Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, mcp__supabase__execute_sql
---

# Send an invoice for $ARGUMENTS

Generate a professional PDF invoice for a client and place a draft email with it attached into the operator's own mailbox Drafts folder. **This skill never sends email.** The end state is always: the operator opens their mail client, finds the ready-to-send draft, reviews it, and clicks send themselves. Money emails get a human final click, always.

**The contract:** the operator says `/send-invoice acme-bistro 450` (or just `/send-invoice acme bistro` — the amount can come later); you resolve the client, ask for the operator's business details ONCE EVER (first run only), confirm this invoice's numbers in one batched message, then produce the PDF and the draft autonomously.

## Step 0 — Preconditions (STOP gates)

1. **Email must be configured.** `EMAIL_ADDRESS` set to a real address in `.env`, plus either password-mode credentials (`EMAIL_PASSWORD` + IMAP settings) or `EMAIL_AUTH=oauth-microsoft` with a completed `python3 scripts/ms_oauth.py login`. If not, STOP and tell the operator what's missing — there is nowhere to put the draft without a connected mailbox.
2. **Resolve the client.** `$ARGUMENTS` is free-form: it may be an exact slug, a partial business name, an owner's name, and may end with an amount (a number, with or without a currency symbol — peel it off before matching). Look the rest up in Supabase:
   ```sql
   SELECT slug, name, owner, email, price, status, deployed_url, location
   FROM clients
   WHERE slug ILIKE '%<term>%' OR name ILIKE '%<term>%' OR owner ILIKE '%<term>%'
   ```
   Exactly one match → proceed. Several → list them and ask which. Zero → say so and show the nearest few (`python3 scripts/db.py status` helps the operator orient). **Never guess between candidates.**
3. **The client needs an email address** — from the `email` column, or failing that ask the operator which address to invoice. Never invent or scrape one at this stage.
4. Status is NOT a gate — invoices usually go to `converted` clients, but the operator may invoice a deposit, an extra feature, or a maintenance period at any stage. If the client has never even responded (`status` before `responded`), mention that in the Step 2 confirmation rather than blocking.

## Step 1 — First run only: the operator's business details (asked once, remembered forever)

Check `.env` for `INVOICE_BUSINESS_NAME`. If it's set, skip this step entirely — the details below are already on file.

If it's blank or absent, this is the first invoice this install has ever produced. Collect the operator's business details in **ONE batched message** — propose defaults from what the pipeline already knows, never one question at a time:

1. **Invoice-under name** — propose `${OPERATOR_NAME}` / `EMAIL_FROM_NAME`; the operator may have a registered company name instead. If they invoice as a registered company, also capture the **company registration number** (Companies House number, KvK, SIREN, etc. — framed natively for `${OPERATOR_COUNTRY}`; many countries require it on invoices, and it's distinct from the tax number). Sole traders just need their own name plus any trading name.
2. **Business address** — as it should print on the invoice. No default; ask.
3. **Tax** — frame this question natively for `${OPERATOR_COUNTRY}` using what you know about that country's regime. Examples of the right framing: a UK operator gets "Are you VAT registered? (Many sole traders under the registration threshold aren't — if not, your invoices simply show no VAT line)"; an Australian gets GST at 10%; a German gets USt./MwSt. plus the Kleinunternehmer exemption; a US operator gets "services like this usually aren't sales-taxable — skip the tax line?". Capture three things if they charge tax: the **label** as it should print, the **rate** (a bare percentage), and their **registration number** if any. Not registered → all three stay blank and no tax line ever renders. **You propose the framing; the operator decides the values. Never decide their tax status for them, and add one line suggesting they confirm with their accountant if unsure.**
4. **Payment details** — how clients pay (bank transfer details, PayPal, payment link — whatever they use), exactly as it should print on the invoice. Prompt with the fields native to `${OPERATOR_COUNTRY}` (sort code + account number in the UK, IBAN + BIC in the eurozone, routing + account in the US...), but store and render whatever they give, verbatim — never reformat or validate it.

**Registry shortcut:** if the operator invoices as a registered company, most countries publish its details in a free public register (UK: Companies House; France: SIRENE; Australia: ABN Lookup; ...). Offer to look the company up by name with your web access and present the registered name, company number, and registered-office address as prefilled defaults in the same batched message, clearly marked as looked-up — the operator's confirmation is the gate (a same-name lookalike would put the wrong legal identity on every invoice, and the registered office may differ from where they trade). Tax numbers and payment details are never in these registers. If the country's register is paywalled or the lookup fails, drop it and just ask — it's a shortcut, never a dependency.

Then write the answers to `.env` as the `INVOICE_*` variables (`.env.example` defines each one — `INVOICE_BUSINESS_NAME`, `INVOICE_COMPANY_NUMBER`, `INVOICE_BUSINESS_ADDRESS`, `INVOICE_TAX_LABEL`, `INVOICE_TAX_RATE`, `INVOICE_TAX_ID`, `INVOICE_PAYMENT_DETAILS`). Multi-line values (address, payment details) are stored on one line with ` | ` between segments; the invoice renders each segment on its own line. Append the addition to `CUSTOMISATIONS.md` (one line: date + "invoice business details captured by /send-invoice"). **Never invent any of these values — every one comes from the operator's own answer.**

## Step 2 — Confirm THIS invoice (one batched message)

Mine what's known before asking: the client row from Step 0 (name, owner, email, per-client `price`), `${PRICING}` from `.env`, and `clients/<slug>/data/status.md` if present (what was actually delivered — CMS? booking? SEO?). Then present the whole invoice for confirmation in **one message**:

1. **Bill to** — business name (+ owner's name if known), their invoice address, and the email it will be drafted to. UK/EU rules require the customer's name and address, so the address can't be skipped. Source it in order: the client row's `address` column → `clients/<slug>/data/gathered-content.md` → `node scripts/places-address.js "<business name> <location>"` (verify the returned name matches this client; never `places-search.js`, which hides businesses that have websites) → ask for it here. A town-only result means the business hides its street address on Google Maps (common for service-area trades) — asking is then the correct outcome. A looked-up address prints only once confirmed in this message.
2. **Line items** — default is one line: "Website design and build — <business name>" at the amount from (in priority order) the amount peeled from `$ARGUMENTS` → the client's `price` column → `${PRICING}`. If status.md shows extras (booking system, CMS, SEO), offer them as separate lines rather than silently bundling.
3. **Tax** — if `INVOICE_TAX_LABEL`/`INVOICE_TAX_RATE` are set, show the computed maths explicitly: subtotal, "<label> @ <rate>%" amount, total. Also confirm whether the quoted amount is tax-inclusive or tax-exclusive — default to treating `${PRICING}`-derived amounts as inclusive (that's what the outreach quoted) and splitting the tax out of it, and say that's what you did. **The operator verifies the arithmetic here — show every number.**
4. **Dates and terms** — issue date today, payment due default 14 days; confirm.

Currency comes from the amount as given (keep amounts as strings with their symbol — never convert or assume a currency the operator didn't use).

Wait for the confirmation, then run the rest autonomously.

## Step 3 — Invoice number

Numbers are sequential across ALL clients, never reused. Find the highest existing one by globbing `clients/*/data/invoice-*.md`, extracting each file's number, and adding 1 (no existing records → start at 1). Format: `<INVOICE_NUMBER_PREFIX or INV>-NNNN`, zero-padded to 4 digits. **Reserve the number the moment you pick it**: immediately write `clients/<slug>/data/invoice-<number>.md` containing just `# Invoice <number>` and `- Status: reserved <date>`; Step 7 completes it. The record must exist before the PDF or draft does — otherwise a crash between drafting and recording lets the next run re-mint a number that's already sitting in a mailbox. A correction to an already-drafted invoice gets a **fresh number** with a "Supersedes <old number>" line — never edit a number that may already have reached the client.

## Step 4 — Render the invoice HTML

Write `clients/<slug>/data/invoice-<number>.html`. This is a bespoke document — design it properly, but keep it a business document, not a website:

- **Self-contained, print-first.** System font stack only (no webfonts), no external assets of any kind — the PDF renders offline from a local file. One A4 page for a normal invoice. The PDF step renders with ZERO page margins, so the HTML owns its margins: give `body` (or a wrapper) ~18–22mm padding.
- **Restrained and professional.** Clear hierarchy, generous whitespace, one accent colour at most. This lands in a business owner's inbox next to invoices from their accountant — it should look like the most polished one there, not like a flyer.
- **Content, all from confirmed values, in `${OPERATOR_LANGUAGE}`:**
  - Header: `INVOICE_BUSINESS_NAME`, `INVOICE_COMPANY_NUMBER` if set (as "Company no. …" or the local equivalent), `INVOICE_BUSINESS_ADDRESS` (split on ` | `), `INVOICE_TAX_ID` if set, the operator's `EMAIL_ADDRESS`.
  - Meta block: invoice number, issue date, due date — plus the supply date ONLY if the work was delivered on a materially different date than the invoice (UK/EU tax rules key off it; same-date is the norm and prints nothing extra).
  - Bill-to block: client business name (+ owner) and their address as confirmed in Step 2 — required content, never guessed.
  - Items table: description + amount per line.
  - Totals: subtotal; tax line (`<INVOICE_TAX_LABEL> @ <rate>%`) ONLY if configured; total, visually dominant.
  - Payment block: `INVOICE_PAYMENT_DETAILS` (split on ` | `), plus the payment terms ("Due within 14 days of issue" or as confirmed).
  - If superseding: "Supersedes <old number>" in the meta block.
- **No invented content anywhere** — no made-up registration numbers, no placeholder addresses, no fabricated late-payment-interest clauses. If a field wasn't provided, it doesn't appear.
- **No commentary or sales language.** An invoice states what is billed, full stop. Never add pricing-terms lines ("one-off fee, no ongoing charges"), reassurances, or marketing phrases — if it isn't a confirmed Step 2 value or a required field above, it doesn't go on the document.

## Step 5 — Render the PDF

```bash
node scripts/invoice-pdf.js clients/<slug>/data/invoice-<number>.html clients/<slug>/data/invoice-<number>.pdf
```

The script prints `PDF written: <path> (<bytes> bytes)` on success and exits non-zero on failure — check that. Then visually verify the PDF with the Read tool (it renders in-context): correct number, correct totals, nothing clipped at page edges, one page. If your tooling can't render PDFs, re-read the HTML instead and check the values. Fix and re-render until right — this document is the deliverable.

## Step 6 — Draft the email (never send)

Compose a short covering email in `${OPERATOR_LANGUAGE}`, following the outreach style rules (contractions, no em dashes, human tone, sign off with `${SIGNATURE}` or `${OPERATOR_NAME}`). The body carries exactly three things: one natural thank-you line, that the invoice is attached, and the total with the due date. Everything else — the invoice number, payment method, bank details, payment reference — is already in the subject line and on the invoice itself; the body never restates any of it. 30–60 words. Subject: `Invoice <number> from <INVOICE_BUSINESS_NAME>`.

```bash
python3 scripts/gmail.py draft --to "<client email>" \
  --subject "Invoice <number> from <INVOICE_BUSINESS_NAME>" \
  --body "<the email body>" \
  --attach clients/<slug>/data/invoice-<number>.pdf
```

Rules:
- **`draft` only. Never `gmail.py send`, never `reply`.** There is no fallback to sending — if the draft fails, fix the failure.
- A non-zero exit or an `ERROR:` line means the draft is NOT in the mailbox. Surface the script's own error text (it says what to fix — usually `EMAIL_DRAFTS_FOLDER` for IMAP, or an expired Microsoft sign-in) and re-run after fixing. Do not tell the operator the draft exists until the script confirmed it.

## Step 7 — Record + handover

1. Complete `clients/<slug>/data/invoice-<number>.md` (replacing the Step 3 reservation stub) — the permanent record and the numbering source for future runs:
   ```markdown
   # Invoice <number>
   - Issued: <date>
   - Client: <slug> (<business name>, <email drafted to>)
   - Line items: <description — amount> (one per line)
   - Subtotal / tax / total: <values, or "no tax line">
   - Terms: <due date / terms>
   - Files: invoice-<number>.html, invoice-<number>.pdf
   - Draft: saved to mailbox Drafts <timestamp>  (re-drafted lines get appended below if ever regenerated)
   - Supersedes: <old number, if applicable>
   ```
2. Append one line to `clients/<slug>/data/status.md`: `Invoice <number> for <total> drafted <date> — awaiting operator send.`
3. Final message to the operator: invoice number and total, and where it is — "the draft is sitting in your <mailbox> Drafts folder with the PDF attached; review it and hit send". Do not mark anything in Supabase — invoicing state lives in the record files.

## Rules

- **Draft, never send.** No exceptions, no "the operator said they trust me". The human click on a money email is the product.
- **Never invent business, bank, or tax details.** Everything on the invoice traces to the operator's `.env` answers or the confirmed Step 2 values.
- **Tax is rendered, not advised.** You format the label/rate/number the operator gave you; you don't determine anyone's tax obligations. When the operator seems unsure in Step 1, suggest they confirm with their accountant — one line, then move on.
- **Numbers are sequential and never reused.** Corrections get a fresh number that references the old one.
- **Show all arithmetic in Step 2.** The operator confirming the maths is the correctness gate for the numbers on the PDF.
- **Windows-safe paths only** — everything lives under `clients/<slug>/data/`; never use `/tmp`.

## Maintenance

- **"Change my payment details / address / tax rate / business name"** → edit the matching `INVOICE_*` line in `.env` (append a `CUSTOMISATIONS.md` line). Applies to all future invoices; already-issued PDFs are immutable records.
- **"Use a different invoice number prefix"** → set `INVOICE_NUMBER_PREFIX` in `.env` (default `INV`). The numeric sequence continues regardless of prefix changes.
- **"The draft got lost / I deleted it"** → re-run the draft command from Step 6 with the same PDF; same invoice number, since it's the same invoice. Append a "re-drafted <date>" line to the record file.
- **"The amount/details were wrong"** → new invoice with the next number and a "Supersedes" line (Step 3), then draft it; note in the covering email that it replaces the earlier one.
- **"Invoice them monthly for maintenance"** → run the skill again each month; each run is an independent invoice. Recurring line items just reuse the same description with the period in it ("Website hosting and maintenance — March 2027").
