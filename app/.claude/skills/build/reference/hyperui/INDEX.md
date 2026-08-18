# HyperUI reference index

469 files vendored from github.com/markmead/hyperui on 2026-08-16.

**Every entry with hasLoremIpsum=true or any genericColorClasses MUST have that content/colour replaced before shipping** — see build/SKILL.md § "EXPERIMENT BRANCH ONLY — HyperUI component reference".

> Entries with an indented `↳` line carry a visual descriptor (layout, composition, imagery, controls) taken from the rendered component — search these to pick the right structure for a section instead of citing blind. Quoted names are HyperUI's official component titles. Source of truth: `descriptors.json` in this directory (merged in by `scripts/build-hyperui-index.mjs`; edit the JSON, not this file).

## Application (UI primitives — structure/technique)

### accordions (10 files, 10 carry lorem ipsum)
- `accordions/1-dark.html` [dark,LOREM] — ~135w, colours: bg-gray-50 bg-gray-800 bg-gray-900 border-gray-200…
  ↳ dark-scheme variant of `accordions/1.html` — same layout (see its descriptor)
- `accordions/1.html` [LOREM] — ~135w, colours: bg-gray-50 border-gray-200 text-gray-700 text-gray-900
  ↳ bordered FAQ accordion: stacked white rounded-lg <details> rows, question left + chevron right (rotates 180° on open), answer paragraph in padded panel below
- `accordions/2-dark.html` [dark,LOREM] — ~124w, colours: bg-gray-50 bg-gray-800 bg-gray-900 border-gray-200…
  ↳ dark-scheme variant of `accordions/2.html` — same layout (see its descriptor)
- `accordions/2.html` [LOREM] — ~124w, colours: bg-gray-50 border-gray-200 text-gray-700 text-gray-900
  ↳ accordion with leading icons: each summary row pairs a small topic icon + label left, rotating chevron right; bordered rounded rows, native <details>/<summary>
- `accordions/3-dark.html` [dark,LOREM] — ~128w, colours: text-gray-200 text-gray-700 text-gray-900
  ↳ dark-scheme variant of `accordions/3.html` — same layout (see its descriptor)
- `accordions/3.html` [LOREM] — ~128w, colours: text-gray-700 text-gray-900
  ↳ flush divider accordion: no cards or borders, rows separated by thin divide-y hairlines, question + rotating chevron, answer expands inline
- `accordions/4-dark.html` [dark,LOREM] — ~130w, colours: bg-gray-100 bg-gray-50 bg-gray-700 bg-gray-800…
  ↳ dark-scheme variant of `accordions/4.html` — same layout (see its descriptor)
- `accordions/4.html` [LOREM] — ~130w, colours: bg-gray-100 bg-gray-50 border-gray-200 text-gray-700…
  ↳ nested two-level accordion: outer bordered <details> rows contain indented child accordions with smaller gray-50 summaries — settings-tree style
- `accordions/5-dark.html` [dark,LOREM] — ~127w, colours: bg-gray-100 bg-gray-800 text-gray-200 text-gray-700
  ↳ dark-scheme variant of `accordions/5.html` — same layout (see its descriptor)
- `accordions/5.html` [LOREM] — ~127w, colours: bg-gray-100 text-gray-700
  ↳ compact borderless accordion: small text-sm summaries with rounded hover fill and rotating chevron, tight spacing — sidebar/settings scale

### badges (10 files)
- `badges/1-dark.html` [dark] — ~2w, colours: bg-purple-100 bg-purple-700 border-purple-500 text-purple-100…
  ↳ dark-scheme variant of `badges/1.html` — same layout (see its descriptor)
- `badges/1.html` — ~2w, colours: bg-purple-100 border-purple-500 text-purple-700
  ↳ pill badge pair: solid-tinted rounded-full label + outlined twin — the base status chip
- `badges/2-dark.html` [dark] — ~2w, colours: bg-purple-100 bg-purple-700 border-purple-500 text-purple-100…
  ↳ dark-scheme variant of `badges/2.html` — same layout (see its descriptor)
- `badges/2.html` — ~2w, colours: bg-purple-100 border-purple-500 text-purple-700
  ↳ pill badges with leading icon: small icon + text inside a rounded-full chip, solid-tint and outlined variants
- `badges/3-dark.html` [dark] — ~6w, colours: bg-purple-100 bg-purple-200 bg-purple-300 bg-purple-700…
  ↳ dark-scheme variant of `badges/3.html` — same layout (see its descriptor)
- `badges/3.html` — ~6w, colours: bg-purple-100 bg-purple-200 bg-purple-300 border-purple-500…
  ↳ dismissible pill badge: chip with a small circular X remove-button on the right, solid + outlined variants
- `badges/4-dark.html` [dark] — ~0w, colours: bg-purple-100 bg-purple-700 border-purple-500 text-purple-100…
  ↳ dark-scheme variant of `badges/4.html` — same layout (see its descriptor)
- `badges/4.html` — ~0w, colours: bg-purple-100 border-purple-500 text-purple-700
  ↳ icon-only circular badges: rounded-full chip containing just an icon, solid-tint + outlined pair
- `badges/5-dark.html` [dark] — ~6w, colours: bg-amber-100 bg-amber-700 bg-emerald-100 bg-emerald-700…
  ↳ dark-scheme variant of `badges/5.html` — same layout (see its descriptor)
- `badges/5.html` — ~6w, colours: bg-amber-100 bg-emerald-100 bg-red-100 border-amber-500…
  ↳ semantic status badge set: green Paid / amber Refunded / red Failed chips with icons, each in solid-tint and outlined form

### breadcrumbs (10 files)
- `breadcrumbs/1-dark.html` [dark] — ~3w, colours: text-gray-200 text-gray-700 text-gray-900
  ↳ dark-scheme variant of `breadcrumbs/1.html` — same layout (see its descriptor)
- `breadcrumbs/1.html` — ~3w, colours: text-gray-700 text-gray-900
  ↳ text breadcrumb trail: Home / Category / Product links separated by small chevron icons, gray text-sm
- `breadcrumbs/2-dark.html` [dark] — ~2w, colours: text-gray-200 text-gray-700 text-gray-900
  ↳ dark-scheme variant of `breadcrumbs/2.html` — same layout (see its descriptor)
- `breadcrumbs/2.html` — ~2w, colours: text-gray-700 text-gray-900
  ↳ breadcrumb with home icon: house icon as the first crumb, then text links separated by chevrons
- `breadcrumbs/3-dark.html` [dark] — ~3w, colours: text-gray-200 text-gray-700 text-gray-900
  ↳ dark-scheme variant of `breadcrumbs/3.html` — same layout (see its descriptor)
- `breadcrumbs/3.html` — ~3w, colours: text-gray-700 text-gray-900
  ↳ slash-separated breadcrumb: text links with slanted slash strokes between them
- `breadcrumbs/4-dark.html` [dark] — ~2w, colours: text-gray-200 text-gray-700 text-gray-900
  ↳ dark-scheme variant of `breadcrumbs/4.html` — same layout (see its descriptor)
- `breadcrumbs/4.html` — ~2w, colours: text-gray-700 text-gray-900
  ↳ home-icon breadcrumb with slash separators (icon first crumb, slanted slashes between links)
- `breadcrumbs/5-dark.html` [dark] — ~2w, colours: bg-gray-100 bg-gray-700 bg-gray-800 border-gray-300…
  ↳ dark-scheme variant of `breadcrumbs/5.html` — same layout (see its descriptor)
- `breadcrumbs/5.html` — ~2w, colours: bg-gray-100 border-gray-300 text-gray-700 text-gray-900
  ↳ chevron-block breadcrumb: joined bordered bar where the first crumb is a gray filled block ending in an arrow-shaped clip-path point into the next crumb

### button-groups (10 files)
- `button-groups/1-dark.html` [dark] — ~3w, colours: bg-gray-50 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `button-groups/1.html` — same layout (see its descriptor)
- `button-groups/1.html` — ~3w, colours: bg-gray-50 border-gray-200 ring-blue-500 text-gray-700…
  ↳ joined 3-button segmented group (View / Edit / Delete): bordered text buttons sharing borders via -ms-px, rounded outer corners only
- `button-groups/2-dark.html` [dark] — ~0w, colours: bg-gray-50 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `button-groups/2.html` — same layout (see its descriptor)
- `button-groups/2.html` — ~0w, colours: bg-gray-50 border-gray-200 ring-blue-500 text-gray-700…
  ↳ joined icon-button group: three bordered square icon buttons (eye / pencil / trash) sharing borders
- `button-groups/3-dark.html` [dark] — ~1w, colours: bg-gray-50 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `button-groups/3.html` — same layout (see its descriptor)
- `button-groups/3.html` — ~1w, colours: bg-gray-50 border-gray-200 ring-blue-500 text-gray-700…
  ↳ mixed joined pair: text button + icon button sharing a border
- `button-groups/4-dark.html` [dark] — ~0w, colours: bg-gray-50 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `button-groups/4.html` — same layout (see its descriptor)
- `button-groups/4.html` — ~0w, colours: bg-gray-50 border-gray-200 ring-blue-500 text-gray-700…
  ↳ detached icon-toggle pair: two separate bordered square icon buttons (grid view / list view) with a gap
- `button-groups/5-dark.html` [dark] — ~0w, colours: bg-gray-50 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `button-groups/5.html` — same layout (see its descriptor)
- `button-groups/5.html` — ~0w, colours: bg-gray-50 border-gray-200 ring-blue-500 text-gray-700…
  ↳ joined icon-toggle pair: grid/list view buttons sharing a border, rounded ends

### charts (22 files)
- `charts/1-dark.html` [dark] — ~252w, colours: bg-gray-800 bg-gray-900 border-gray-700 border-gray-800…
  ↳ dark-scheme variant of `charts/1.html` — same layout (see its descriptor)
- `charts/1.html` — ~275w, colours: bg-gray-100 border-gray-200 text-gray-600 text-gray-900
  ↳ line-chart card with range toggle: 'Monthly revenue' title + 6M/12M segmented switch, smooth indigo line with gradient area fill (Chart.js via CDN, sr-only data table)
- `charts/10-dark.html` [dark] — ~195w, colours: bg-gray-900 border-gray-800
  ↳ dark-scheme variant of `charts/10.html` — same layout (see its descriptor)
- `charts/10.html` — ~189w, colours: border-gray-200 text-gray-900
  ↳ scatter-plot card: single-series spend-vs-conversions dots (Chart.js)
- `charts/11-dark.html` [dark] — ~241w, colours: bg-gray-900 border-gray-800
  ↳ dark-scheme variant of `charts/11.html` — same layout (see its descriptor)
- `charts/11.html` — ~235w, colours: border-gray-200 text-gray-900
  ↳ bubble-chart card: 5 campaigns as sized bubbles (x spend, y conversions, r reach), bottom legend (Chart.js)
- `charts/2-dark.html` [dark] — ~135w, colours: bg-gray-900 border-gray-800
  ↳ dark-scheme variant of `charts/2.html` — same layout (see its descriptor)
- `charts/2.html` — ~132w, colours: border-gray-200 text-gray-900
  ↳ bar-chart card: single-series rounded indigo bars over weekday labels (Chart.js, sr-only data table)
- `charts/3-dark.html` [dark] — ~85w, colours: bg-gray-900 border-gray-800
  ↳ dark-scheme variant of `charts/3.html` — same layout (see its descriptor)
- `charts/3.html` — ~85w, colours: border-gray-200 text-gray-900
  ↳ donut-chart card: 3-slice doughnut with 70% cutout and bottom legend (Chart.js)
- `charts/4-dark.html` [dark] — ~96w, colours: bg-gray-900 border-gray-800 text-gray-400
  ↳ dark-scheme variant of `charts/4.html` — same layout (see its descriptor)
- `charts/4.html` — ~96w, colours: border-gray-200 text-gray-600 text-gray-900
  ↳ sparkline stat card: label + big dollar figure left, tiny 96x48 sparkline canvas right — KPI-row material (Chart.js)
- `charts/5-dark.html` [dark] — ~209w, colours: bg-gray-900 border-gray-800
  ↳ dark-scheme variant of `charts/5.html` — same layout (see its descriptor)
- `charts/5.html` — ~206w, colours: border-gray-200 text-gray-900
  ↳ stacked bar-chart card: 3 series stacked per weekday, bottom legend (Chart.js)
- `charts/6-dark.html` [dark] — ~191w, colours: bg-gray-900 border-gray-800
  ↳ dark-scheme variant of `charts/6.html` — same layout (see its descriptor)
- `charts/6.html` — ~188w, colours: border-gray-200 text-gray-900
  ↳ combo chart card: revenue bars + dashed amber target line overlaid, bottom legend (Chart.js)
- `charts/7-dark.html` [dark] — ~206w, colours: bg-gray-900 border-gray-800
  ↳ dark-scheme variant of `charts/7.html` — same layout (see its descriptor)
- `charts/7.html` — ~203w, colours: border-gray-200 text-gray-900
  ↳ dual-line comparison card: solid indigo 'this year' line vs dashed gray 'last year' line, bottom legend (Chart.js)
- `charts/8-dark.html` [dark] — ~174w, colours: bg-gray-900 border-gray-800
  ↳ dark-scheme variant of `charts/8.html` — same layout (see its descriptor)
- `charts/8.html` — ~168w, colours: border-gray-200 text-gray-900
  ↳ radar-chart card: two overlapping translucent team polygons across 5 metrics, bottom legend (Chart.js)
- `charts/9-dark.html` [dark] — ~133w, colours: bg-gray-900 border-gray-800
  ↳ dark-scheme variant of `charts/9.html` — same layout (see its descriptor)
- `charts/9.html` — ~127w, colours: border-gray-200 text-gray-900
  ↳ polar-area chart card: 4 translucent wedges from a common center, bottom legend (Chart.js)

### checkboxes (6 files, 4 carry lorem ipsum)
- `checkboxes/1-dark.html` [dark] — ~7w, colours: bg-blue-600 bg-gray-900 border-gray-300 border-gray-600…
  ↳ dark-scheme variant of `checkboxes/1.html` — same layout (see its descriptor)
- `checkboxes/1.html` — ~7w, colours: border-gray-300 text-gray-700
  ↳ plain checkbox stack: 3 labelled square checkboxes in a vertical column inside a fieldset
- `checkboxes/2-dark.html` [dark,LOREM] — ~37w, colours: bg-blue-600 bg-gray-900 border-gray-300 border-gray-600…
  ↳ dark-scheme variant of `checkboxes/2.html` — same layout (see its descriptor)
- `checkboxes/2.html` [LOREM] — ~37w, colours: border-gray-300 text-gray-700
  ↳ checkbox stack with helper text: each checkbox pairs a bold label + small description paragraph
- `checkboxes/3-dark.html` [dark,LOREM] — ~37w, colours: bg-blue-600 bg-gray-900 border-gray-300 border-gray-600…
  ↳ dark-scheme variant of `checkboxes/3.html` — same layout (see its descriptor)
- `checkboxes/3.html` [LOREM] — ~37w, colours: border-gray-300 text-gray-700
  ↳ divided checkbox list: label+description rows separated by thin divide-y hairlines

### details-list (8 files, 8 carry lorem ipsum)
- `details-list/1-dark.html` [dark,LOREM] — ~40w, colours: text-gray-200 text-gray-700 text-gray-900
  ↳ dark-scheme variant of `details-list/1.html` — same layout (see its descriptor)
- `details-list/1.html` [LOREM] — ~40w, colours: text-gray-700 text-gray-900
  ↳ definition list in 3-column rows: bold dt label left, dd value spanning 2 cols, rows split by divide-y — profile/spec-sheet pattern
- `details-list/2-dark.html` [dark,LOREM] — ~40w, colours: bg-gray-50 bg-gray-800 text-gray-200 text-gray-700…
  ↳ dark-scheme variant of `details-list/2.html` — same layout (see its descriptor)
- `details-list/2.html` [LOREM] — ~40w, colours: bg-gray-50 text-gray-700 text-gray-900
  ↳ zebra definition list: 3-col dt/dd rows with even rows tinted gray-50
- `details-list/3-dark.html` [dark,LOREM] — ~40w, colours: border-gray-200 border-gray-800 text-gray-200 text-gray-700…
  ↳ dark-scheme variant of `details-list/3.html` — same layout (see its descriptor)
- `details-list/3.html` [LOREM] — ~40w, colours: border-gray-200 text-gray-700 text-gray-900
  ↳ bordered definition list: dt/dd rows inside a rounded border card
- `details-list/4-dark.html` [dark,LOREM] — ~40w, colours: bg-gray-50 bg-gray-800 border-gray-200 border-gray-800…
  ↳ dark-scheme variant of `details-list/4.html` — same layout (see its descriptor)
- `details-list/4.html` [LOREM] — ~40w, colours: bg-gray-50 border-gray-200 text-gray-700 text-gray-900
  ↳ bordered zebra definition list: rounded border card with even-row gray tint

### dividers (12 files)
- `dividers/1-dark.html` [dark] — ~3w, colours: bg-gray-300 bg-gray-600 text-gray-900
  ↳ dark-scheme variant of `dividers/1.html` — same layout (see its descriptor)
- `dividers/1.html` — ~3w, colours: bg-gray-300 text-gray-900
  ↳ centered label divider: hairline — title — hairline
- `dividers/2-dark.html` [dark] — ~3w, colours: text-gray-900 to-gray-300 to-gray-600
  ↳ dark-scheme variant of `dividers/2.html` — same layout (see its descriptor)
- `dividers/2.html` — ~3w, colours: text-gray-900 to-gray-300
  ↳ centered label divider with gradient hairlines fading from transparent toward the label
- `dividers/3-dark.html` [dark] — ~3w, colours: bg-gray-300 bg-gray-600 text-gray-900
  ↳ dark-scheme variant of `dividers/3.html` — same layout (see its descriptor)
- `dividers/3.html` — ~3w, colours: bg-gray-300 text-gray-900
  ↳ left-label divider: title first, hairline fills the rest of the row
- `dividers/4-dark.html` [dark] — ~3w, colours: text-gray-900 to-gray-300 to-gray-600
  ↳ dark-scheme variant of `dividers/4.html` — same layout (see its descriptor)
- `dividers/4.html` — ~3w, colours: text-gray-900 to-gray-300
  ↳ left-label divider with a gradient hairline
- `dividers/5-dark.html` [dark] — ~3w, colours: bg-gray-300 bg-gray-600 text-gray-900
  ↳ dark-scheme variant of `dividers/5.html` — same layout (see its descriptor)
- `dividers/5.html` — ~3w, colours: bg-gray-300 text-gray-900
  ↳ right-label divider: hairline first, title at the end
- `dividers/6-dark.html` [dark] — ~3w, colours: text-gray-900 to-gray-300 to-gray-600
  ↳ dark-scheme variant of `dividers/6.html` — same layout (see its descriptor)
- `dividers/6.html` — ~3w, colours: text-gray-900 to-gray-300
  ↳ right-label divider with a gradient hairline

### dropdown (6 files)
- `dropdown/1-dark.html` [dark] — ~5w, colours: bg-gray-50 bg-gray-700 bg-gray-800 bg-red-50…
  ↳ dark-scheme variant of `dropdown/1.html` — same layout (see its descriptor)
- `dropdown/1.html` — ~5w, colours: bg-gray-50 bg-red-50 border-gray-300 text-gray-700…
  ↳ split-button dropdown: 'Product' text button + chevron button joined by divide-x, flat menu panel below with 3 links and a red Delete action
- `dropdown/2-dark.html` [dark] — ~5w, colours: bg-gray-50 bg-gray-700 bg-gray-800 bg-red-50…
  ↳ dark-scheme variant of `dropdown/2.html` — same layout (see its descriptor)
- `dropdown/2.html` — ~5w, colours: bg-gray-50 bg-red-50 border-gray-300 text-gray-700…
  ↳ split-button dropdown with divided menu: link group separated from the red Delete action by a divide-y rule
- `dropdown/3-dark.html` [dark] — ~7w, colours: bg-gray-50 bg-gray-700 bg-gray-800 bg-red-50…
  ↳ dark-scheme variant of `dropdown/3.html` — same layout (see its descriptor)
- `dropdown/3.html` — ~7w, colours: bg-gray-50 bg-red-50 border-gray-300 text-gray-500…
  ↳ split-button dropdown with grouped menu: muted 'General' and 'Actions' section headers over links + red Delete

### empty-states (10 files)
- `empty-states/1-dark.html` [dark] — ~23w, colours: bg-indigo-600 bg-indigo-700 text-gray-200 text-gray-400…
  ↳ dark-scheme variant of `empty-states/1.html` — same layout (see its descriptor)
- `empty-states/1.html` — ~23w, colours: bg-indigo-600 bg-indigo-700 text-gray-400 text-gray-700…
  ↳ centered empty state: large gray outline icon, bold heading, helper text, full-width solid button, small text links below
- `empty-states/2-dark.html` [dark] — ~25w, colours: bg-gray-50 bg-gray-800 bg-indigo-600 bg-indigo-700…
  ↳ dark-scheme variant of `empty-states/2.html` — same layout (see its descriptor)
- `empty-states/2.html` — ~25w, colours: bg-gray-50 bg-indigo-600 bg-indigo-700 border-gray-300…
  ↳ empty state with dual actions: icon + heading + stacked solid ('Import Data') and outlined ('Create New') full-width buttons, format hint below
- `empty-states/3-dark.html` [dark] — ~25w, colours: bg-gray-50 bg-gray-800 border-gray-300 border-gray-600…
  ↳ dark-scheme variant of `empty-states/3.html` — same layout (see its descriptor)
- `empty-states/3.html` — ~25w, colours: bg-gray-50 border-gray-300 text-gray-400 text-gray-700…
  ↳ upload empty state: icon + heading + dashed-border drop-zone label wrapping a hidden file input, size/format hint below
- `empty-states/4-dark.html` [dark] — ~27w, colours: bg-indigo-600 bg-indigo-700 text-gray-200 text-gray-400…
  ↳ dark-scheme variant of `empty-states/4.html` — same layout (see its descriptor)
- `empty-states/4.html` — ~27w, colours: bg-indigo-600 bg-indigo-700 text-gray-400 text-gray-700…
  ↳ onboarding empty state: icon + heading + numbered 3-step checklist (filled circle numerals) + solid CTA
- `empty-states/5-dark.html` [dark] — ~23w, colours: bg-gray-50 bg-gray-800 bg-gray-900 border-gray-300…
  ↳ dark-scheme variant of `empty-states/5.html` — same layout (see its descriptor)
- `empty-states/5.html` — ~23w, colours: bg-gray-50 border-gray-300 border-indigo-500 text-gray-400…
  ↳ no-results empty state: icon + heading + search-again input + outlined 'Clear filters' button, support link below

### file-uploaders (4 files)
- `file-uploaders/1-dark.html` [dark] — ~3w, colours: bg-gray-900 border-gray-300 border-gray-700 text-gray-900
  ↳ dark-scheme variant of `file-uploaders/1.html` — same layout (see its descriptor)
- `file-uploaders/1.html` — ~3w, colours: border-gray-300 text-gray-900
  ↳ single-row upload card: bordered rounded label with centered 'Upload your file(s)' text + upload icon, hidden multi-file input
- `file-uploaders/2-dark.html` [dark] — ~5w, colours: bg-gray-100 bg-gray-50 bg-gray-700 bg-gray-800…
  ↳ dark-scheme variant of `file-uploaders/2.html` — same layout (see its descriptor)
- `file-uploaders/2.html` — ~5w, colours: bg-gray-100 bg-gray-50 border-gray-200 border-gray-300…
  ↳ stacked upload card: centered icon over text over a small bordered 'Browse files' pseudo-button, hidden multi-file input

### filters (4 files)
- `filters/1-dark.html` [dark] — ~19w, colours: bg-blue-600 bg-gray-900 border-gray-300 border-gray-400…
  ↳ dark-scheme variant of `filters/1.html` — same layout (see its descriptor)
- `filters/1.html` — ~19w, colours: border-gray-300 border-gray-400 text-gray-700 text-gray-900
  ↳ inline filter bar: underlined <details> triggers ('Availability', 'Price') popping absolute-positioned panels — checkbox list with selected-count + reset, and min/max price number inputs
- `filters/2-dark.html` [dark] — ~19w, colours: bg-blue-600 bg-gray-900 border-gray-300 border-gray-600…
  ↳ dark-scheme variant of `filters/2.html` — same layout (see its descriptor)
- `filters/2.html` — ~19w, colours: border-gray-300 text-gray-700 text-gray-900
  ↳ stacked filter accordions: bordered rounded <details> blocks expanding in place with a checkbox group and min/max price inputs — sidebar-filter style

### grids (10 files)
- `grids/1.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: 2 equal columns (lg), collapsing to 1
- `grids/10.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: fluid main column + fixed 120px right rail (grid-cols-[1fr_120px])
- `grids/2.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: 3-col grid, right cell spans 2 — narrow-left / wide-right
- `grids/3.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: 3-col grid, left cell spans 2 — wide-left / narrow-right
- `grids/4.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: 3 equal columns
- `grids/5.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: 4 equal columns
- `grids/6.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: 4-col grid as 1-1-2 (two singles + trailing double)
- `grids/7.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: 4-col grid as 2-1-1 (leading double + two singles)
- `grids/8.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: 4-col grid as 1-2-1 (double in the middle)
- `grids/9.html` — ~0w, colours: bg-gray-300
  ↳ layout scaffold: fixed 120px sidebar + fluid main column (grid-cols-[120px_1fr])

### inputs (8 files)
- `inputs/1-dark.html` [dark] — ~1w, colours: bg-gray-900 border-gray-300 border-gray-600 text-gray-200…
  ↳ dark-scheme variant of `inputs/1.html` — same layout (see its descriptor)
- `inputs/1.html` — ~1w, colours: border-gray-300 text-gray-700
  ↳ plain labelled text input: small label above a full-width rounded bordered field
- `inputs/2-dark.html` [dark] — ~1w, colours: bg-gray-900 border-gray-300 border-gray-600 text-gray-200…
  ↳ dark-scheme variant of `inputs/2.html` — same layout (see its descriptor)
- `inputs/2.html` — ~1w, colours: border-gray-300 text-gray-700
  ↳ input with trailing inline icon sitting inside the field's right edge
- `inputs/3-dark.html` [dark] — ~1w, colours: bg-gray-100 bg-gray-800 bg-gray-900 border-gray-300…
  ↳ dark-scheme variant of `inputs/3.html` — same layout (see its descriptor)
- `inputs/3.html` — ~1w, colours: bg-gray-100 border-gray-300 text-gray-700
  ↳ search input with an embedded circular submit icon-button inside the field
- `inputs/4-dark.html` [dark] — ~1w, colours: bg-gray-900 border-gray-300 border-gray-600 text-gray-700
  ↳ dark-scheme variant of `inputs/4.html` — same layout (see its descriptor)
- `inputs/4.html` — ~1w, colours: border-gray-300 text-gray-700
  ↳ floating-label input: label sits on the border and drops into the field when empty (peer-placeholder-shown translate trick)

### loaders (14 files)
- `loaders/1-dark.html` [dark] — ~0w, colours: text-indigo-300 text-indigo-600
  ↳ dark-scheme variant of `loaders/1.html` — same layout (see its descriptor)
- `loaders/1.html` — ~0w, colours: text-indigo-600
  ↳ classic spinning SVG ring loader, single indigo spinner
- `loaders/2-dark.html` [dark] — ~1w, colours: text-gray-200 text-gray-700 text-indigo-300 text-indigo-600
  ↳ dark-scheme variant of `loaders/2.html` — same layout (see its descriptor)
- `loaders/2.html` — ~1w, colours: text-gray-700 text-indigo-600
  ↳ spinner with 'Loading...' caption below, centered
- `loaders/3-dark.html` [dark] — ~1w, colours: text-gray-200 text-gray-700 text-indigo-300 text-indigo-600
  ↳ dark-scheme variant of `loaders/3.html` — same layout (see its descriptor)
- `loaders/3.html` — ~1w, colours: text-gray-700 text-indigo-600
  ↳ inline spinner + 'Loading...' text side by side
- `loaders/4-dark.html` [dark] — ~1w, colours: bg-gray-200 bg-gray-700 bg-indigo-300 bg-indigo-600…
  ↳ dark-scheme variant of `loaders/4.html` — same layout (see its descriptor)
- `loaders/4.html` — ~1w, colours: bg-gray-200 bg-indigo-600 text-gray-700
  ↳ indeterminate progress-bar loader: thin rounded track with pulsing 80% fill + caption below
- `loaders/5-dark.html` [dark] — ~0w, colours: bg-indigo-300 bg-indigo-600
  ↳ dark-scheme variant of `loaders/5.html` — same layout (see its descriptor)
- `loaders/5.html` — ~0w, colours: bg-indigo-600
  ↳ three-dot pulse loader: trio of dots with staggered animate-pulse delays
- `loaders/6-dark.html` [dark] — ~0w, colours: bg-indigo-300 bg-indigo-600
  ↳ dark-scheme variant of `loaders/6.html` — same layout (see its descriptor)
- `loaders/6.html` — ~0w, colours: bg-indigo-600
  ↳ three-dot ping loader: staggered animate-ping ripple dots
- `loaders/7-dark.html` [dark] — ~0w, colours: bg-indigo-300 bg-indigo-600
  ↳ dark-scheme variant of `loaders/7.html` — same layout (see its descriptor)
- `loaders/7.html` — ~0w, colours: bg-indigo-600
  ↳ three-dot bounce loader: staggered bouncing dots

### media (8 files, 8 carry lorem ipsum)
- `media/1.html` [LOREM] — ~18w, colours: text-gray-700 text-gray-900
  ↳ media object: square thumbnail left, title + text right, top-aligned
- `media/2.html` [LOREM] — ~18w, colours: text-gray-700 text-gray-900
  ↳ media object with image and text vertically centered
- `media/3.html` [LOREM] — ~18w, colours: text-gray-700 text-gray-900
  ↳ media object, bottom-aligned
- `media/4.html` [LOREM] — ~18w, colours: text-gray-700 text-gray-900
  ↳ media object with the image stretched to match the text block's height (items-stretch)
- `media/5.html` [LOREM] — ~18w, colours: text-gray-700 text-gray-900
  ↳ reversed media object: thumbnail on the right, top-aligned
- `media/6.html` [LOREM] — ~18w, colours: text-gray-700 text-gray-900
  ↳ reversed media object, vertically centered
- `media/7.html` [LOREM] — ~18w, colours: text-gray-700 text-gray-900
  ↳ reversed media object, bottom-aligned
- `media/8.html` [LOREM] — ~18w, colours: text-gray-700 text-gray-900
  ↳ reversed media object with stretched image

### modals (12 files, 12 carry lorem ipsum)
- `modals/1-dark.html` [dark,LOREM] — ~47w, colours: bg-gray-100 bg-gray-800 bg-gray-900 border-gray-300…
  ↳ dark-scheme variant of `modals/1.html` — same layout (see its descriptor)
- `modals/1.html` [LOREM] — ~47w, colours: bg-gray-100 border-gray-300 text-gray-700 text-gray-900
  ↳ minimal native <dialog> modal: title + paragraph over a dimmed backdrop, closes on outside click (closedby='any'), tiny showModal script
- `modals/2-dark.html` [dark,LOREM] — ~47w, colours: bg-gray-100 bg-gray-50 bg-gray-800 bg-gray-900…
  ↳ dark-scheme variant of `modals/2.html` — same layout (see its descriptor)
- `modals/2.html` [LOREM] — ~47w, colours: bg-gray-100 bg-gray-50 border-gray-300 ring-indigo-600…
  ↳ native <dialog> modal with a circular X close-button at the top-right of the title row
- `modals/3-dark.html` [dark,LOREM] — ~49w, colours: bg-blue-200 bg-blue-300 bg-blue-600 bg-blue-700…
  ↳ dark-scheme variant of `modals/3.html` — same layout (see its descriptor)
- `modals/3.html` [LOREM] — ~49w, colours: bg-blue-600 bg-blue-700 bg-gray-100 bg-gray-200…
  ↳ native <dialog> modal with footer button row: gray Cancel + solid Done, right-aligned
- `modals/4-dark.html` [dark,LOREM] — ~49w, colours: bg-blue-200 bg-blue-300 bg-blue-600 bg-blue-700…
  ↳ dark-scheme variant of `modals/4.html` — same layout (see its descriptor)
- `modals/4.html` [LOREM] — ~49w, colours: bg-blue-600 bg-blue-700 bg-gray-100 bg-gray-200…
  ↳ full-dress native <dialog> modal: X close top-right, paragraph, Cancel/Done footer buttons
- `modals/5-dark.html` [dark,LOREM] — ~55w, colours: bg-blue-200 bg-blue-300 bg-blue-600 bg-blue-700…
  ↳ dark-scheme variant of `modals/5.html` — same layout (see its descriptor)
- `modals/5.html` [LOREM] — ~55w, colours: bg-blue-600 bg-blue-700 bg-gray-100 bg-gray-200…
  ↳ type-to-confirm modal: text input demanding the word 'Confirm' above Cancel/Done buttons
- `modals/6-dark.html` [dark,LOREM] — ~55w, colours: bg-blue-200 bg-blue-300 bg-blue-600 bg-blue-700…
  ↳ dark-scheme variant of `modals/6.html` — same layout (see its descriptor)
- `modals/6.html` [LOREM] — ~55w, colours: bg-blue-600 bg-blue-700 bg-gray-100 bg-gray-200…
  ↳ type-to-confirm modal with an X close-button as well

### pagination (6 files)
- `pagination/1-dark.html` [dark] — ~4w, colours: bg-gray-50 bg-gray-800 bg-indigo-600 border-gray-200…
  ↳ dark-scheme variant of `pagination/1.html` — same layout (see its descriptor)
- `pagination/1.html` — ~4w, colours: bg-gray-50 bg-indigo-600 border-gray-200 border-indigo-600…
  ↳ numbered pagination: square bordered page buttons 1-4 with prev/next chevrons, current page solid indigo
- `pagination/2-dark.html` [dark] — ~1w, colours: bg-gray-50 bg-gray-800 bg-gray-900 border-gray-200…
  ↳ dark-scheme variant of `pagination/2.html` — same layout (see its descriptor)
- `pagination/2.html` — ~1w, colours: bg-gray-50 border-gray-200 border-gray-300 text-gray-900
  ↳ page-jump pagination: prev/next chevron buttons flanking a numeric input for direct page entry
- `pagination/3-dark.html` [dark] — ~1w, colours: bg-gray-50 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `pagination/3.html` — same layout (see its descriptor)
- `pagination/3.html` — ~1w, colours: bg-gray-50 border-gray-200 text-gray-900
  ↳ compact pagination: prev/next chevrons around a '2/12' position label

### progress-bars (4 files)
- `progress-bars/1.html` — ~1w, colours: bg-blue-600 bg-gray-200 text-gray-900
  ↳ basic progress bar: percentage label above a thin rounded track with partial fill
- `progress-bars/2.html` — ~6w, colours: bg-blue-600 bg-gray-200 bg-gray-600 bg-green-600…
  ↳ stacked labelled progress bars: task name left + % right over each bar (blue running, green complete, gray loading)
- `progress-bars/3.html` — ~13w, colours: bg-blue-600 bg-gray-200 bg-green-600 text-gray-700
  ↳ file-transfer progress list: uppercase micro-labels, hairline square-ended bars, byte/status captions below
- `progress-bars/4.html` — ~5w, colours: text-blue-600 text-gray-200 text-gray-700 text-gray-900…
  ↳ circular progress rings: SVG donut rings with the % figure centered inside and a caption below (stroke-dasharray arc)

### quantity-inputs (8 files)
- `quantity-inputs/1-dark.html` [dark] — ~3w, colours: bg-gray-800 border-gray-200 border-gray-700 text-gray-300…
  ↳ dark-scheme variant of `quantity-inputs/1.html` — same layout (see its descriptor)
- `quantity-inputs/1.html` — ~3w, colours: border-gray-200 text-gray-600
  ↳ quantity stepper: minus button / numeric input / plus button in a row
- `quantity-inputs/2-dark.html` [dark] — ~3w, colours: bg-gray-800 border-gray-200 border-gray-700 text-gray-300…
  ↳ dark-scheme variant of `quantity-inputs/2.html` — same layout (see its descriptor)
- `quantity-inputs/2.html` — ~3w, colours: border-gray-200 text-gray-600
  ↳ quantity stepper with native number spinners suppressed (appearance-none)
- `quantity-inputs/3-dark.html` [dark] — ~3w, colours: bg-gray-800 border-gray-200 border-gray-700 text-gray-300…
  ↳ dark-scheme variant of `quantity-inputs/3.html` — same layout (see its descriptor)
- `quantity-inputs/3.html` — ~3w, colours: border-gray-200 text-gray-600
  ↳ compact quantity stepper: narrower center-aligned number field, no spinners
- `quantity-inputs/4-dark.html` [dark] — ~3w, colours: bg-gray-900 border-gray-200 border-gray-800 text-gray-300…
  ↳ dark-scheme variant of `quantity-inputs/4.html` — same layout (see its descriptor)
- `quantity-inputs/4.html` — ~3w, colours: border-gray-200 text-gray-600
  ↳ enclosed quantity stepper: minus / number / plus fused inside a single bordered pill

### radio-groups (5 files)
- `radio-groups/1-dark.html` [dark] — ~6w, colours: bg-gray-50 bg-gray-800 bg-gray-900 border-blue-600…
  ↳ dark-scheme variant of `radio-groups/1.html` — same layout (see its descriptor)
- `radio-groups/1.html` — ~6w, colours: bg-gray-50 border-blue-600 border-gray-300 ring-blue-600…
  ↳ card radio group: full-width bordered option rows (name left, price right), selection shown by blue border + ring via has-checked, radio itself hidden
- `radio-groups/2-dark.html` [dark] — ~6w, colours: bg-blue-600 bg-gray-50 bg-gray-800 bg-gray-900…
  ↳ dark-scheme variant of `radio-groups/2.html` — same layout (see its descriptor)
- `radio-groups/2.html` — ~6w, colours: bg-gray-50 border-blue-600 border-gray-300 ring-blue-600…
  ↳ card radio group with a visible radio dot on the right of each bordered option row
- `radio-groups/3.html` — ~5w, colours: bg-amber-500 bg-blue-500 bg-red-500 ring-amber-500…
  ↳ colour-swatch radio group: row of coloured circles, the checked swatch gains a matching offset ring

### range-inputs (5 files)
- `range-inputs/1.html` — ~2w, colours: bg-gray-200 bg-gray-300 border-gray-500 text-gray-900
  ↳ single range slider: fat rounded custom track with a large bordered circular thumb, label above
- `range-inputs/2.html` — ~3w, colours: bg-gray-200 bg-gray-300 border-gray-500 text-gray-700…
  ↳ range slider with a live value readout to the right of the track
- `range-inputs/3.html` — ~4w, colours: bg-gray-200 bg-gray-300 border-gray-500 text-gray-700…
  ↳ range slider with 0% / 100% end labels underneath
- `range-inputs/4.html` — ~2w, colours: text-gray-900
  ↳ native range slider with tick marks (datalist options, browser-default track)
- `range-inputs/5.html` — ~2w, colours: text-gray-900
  ↳ native range slider with labelled tick marks (0/25/50/75/100 spread under the track)

### selects (6 files)
- `selects/1-dark.html` [dark] — ~18w, colours: bg-gray-900 border-gray-300 border-gray-600 text-gray-200…
  ↳ dark-scheme variant of `selects/1.html` — same layout (see its descriptor)
- `selects/1.html` — ~18w, colours: border-gray-300 text-gray-700
  ↳ labelled native select with a 'Please select' placeholder — plain rounded bordered dropdown
- `selects/2-dark.html` [dark] — ~18w, colours: bg-gray-900 border-gray-300 border-gray-600 text-gray-200…
  ↳ dark-scheme variant of `selects/2.html` — same layout (see its descriptor)
- `selects/2.html` — ~18w, colours: border-gray-300 text-gray-700
  ↳ grouped native select: options bucketed under optgroup letter headers
- `selects/3-dark.html` [dark] — ~16w, colours: bg-gray-900 border-gray-300 border-gray-600 text-gray-200…
  ↳ dark-scheme variant of `selects/3.html` — same layout (see its descriptor)
- `selects/3.html` — ~16w, colours: border-gray-300 text-gray-700
  ↳ combobox-style select: text input backed by a datalist with a chevron icon — free-type + pick

### side-menu (4 files)
- `side-menu/1-dark.html` [dark] — ~15w, colours: bg-gray-100 bg-gray-50 bg-gray-800 bg-gray-900…
  ↳ dark-scheme variant of `side-menu/1.html` — same layout (see its descriptor)
- `side-menu/1.html` — ~15w, colours: bg-gray-100 bg-gray-50 border-gray-100 text-gray-500…
  ↳ full sidebar: logo block top, nav list with collapsible <details> submenus (Teams, Account), sticky user card (avatar + email) pinned to the bottom, right border
- `side-menu/2-dark.html` [dark] — ~7w, colours: bg-gray-100 bg-gray-200 bg-gray-700 bg-gray-800…
  ↳ dark-scheme variant of `side-menu/2.html` — same layout (see its descriptor)
- `side-menu/2.html` — ~7w, colours: bg-gray-100 bg-gray-200 border-gray-100 text-gray-500…
  ↳ icon-rail sidebar: 16-wide (w-16) column of icon buttons with hover tooltip flyouts, logo square top, sticky logout at the bottom

### skip-links (3 files)
- `skip-links/1.html` — ~4w, colours: bg-blue-600 bg-blue-700
  ↳ single skip-link: off-screen blue 'Skip to main content' button that slides down into view on focus
- `skip-links/2.html` — ~5w, colours: bg-gray-100 text-blue-600 text-blue-700 text-gray-700
  ↳ multi-target skip panel: centered card listing Navigation / Content / Footer links, slides in on focus-within
- `skip-links/3.html` — ~5w, colours: bg-gray-100 text-blue-600 text-blue-700 text-gray-700
  ↳ full-width skip bar: edge-to-edge strip with inline skip links, translates into view on focus-within

### stats (12 files)
- `stats/1-dark.html` [dark] — ~12w, colours: bg-gray-900 bg-green-100 bg-green-700 bg-red-100…
  ↳ dark-scheme variant of `stats/1.html` — same layout (see its descriptor)
- `stats/1.html` — ~12w, colours: bg-green-100 bg-red-100 border-gray-100 text-gray-500…
  ↳ KPI card with trend chip top-right: green/red arrow+% pill self-ends above the label and big value with a 'from …' comparison
- `stats/2-dark.html` [dark] — ~8w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-green-100…
  ↳ dark-scheme variant of `stats/2.html` — same layout (see its descriptor)
- `stats/2.html` — ~8w, colours: bg-gray-100 bg-green-100 bg-red-100 border-gray-100…
  ↳ KPI card: circular tinted icon left of label + value, green/red trend chip at the opposite end (items-end flex)
- `stats/3-dark.html` [dark] — ~8w, colours: bg-gray-900 bg-green-100 bg-green-700 bg-red-100…
  ↳ dark-scheme variant of `stats/3.html` — same layout (see its descriptor)
- `stats/3.html` — ~8w, colours: bg-green-100 bg-red-100 border-gray-100 text-gray-500…
  ↳ minimal KPI card: label + big value left, green/red trend chip right
- `stats/4-dark.html` [dark] — ~6w, colours: bg-blue-100 bg-blue-500 bg-gray-900 border-gray-100…
  ↳ dark-scheme variant of `stats/4.html` — same layout (see its descriptor)
- `stats/4.html` — ~6w, colours: bg-blue-100 border-gray-100 text-blue-600 text-gray-500…
  ↳ icon KPI card: big circular tinted icon beside value + label; second variant flips the icon to the right (order-last)
- `stats/5-dark.html` [dark] — ~14w, colours: bg-gray-900 border-gray-100 border-gray-800 text-gray-400…
  ↳ dark-scheme variant of `stats/5.html` — same layout (see its descriptor)
- `stats/5.html` — ~14w, colours: border-gray-100 text-gray-500 text-gray-900 text-green-600…
  ↳ KPI card with trend caption below: value on top, arrow + % + 'Since last week' underneath
- `stats/6-dark.html` [dark] — ~14w, colours: bg-blue-100 bg-blue-500 bg-gray-900 border-gray-100…
  ↳ dark-scheme variant of `stats/6.html` — same layout (see its descriptor)
- `stats/6.html` — ~14w, colours: bg-blue-100 border-gray-100 text-blue-600 text-gray-500…
  ↳ full KPI card: label + value left, circular icon right, trend caption row below

### steps (10 files)
- `steps/1-dark.html` [dark] — ~4w, colours: bg-blue-500 bg-gray-200 bg-gray-700 text-blue-500…
  ↳ dark-scheme variant of `steps/1.html` — same layout (see its descriptor)
- `steps/1.html` — ~4w, colours: bg-blue-500 bg-gray-200 text-blue-500 text-gray-600
  ↳ progress-bar stepper: half-filled bar on top, 3 labelled icon steps spread beneath (start / center / end aligned), done steps blue
- `steps/2-dark.html` [dark] — ~4w, colours: bg-blue-500 bg-gray-200 bg-gray-700 text-gray-300…
  ↳ dark-scheme variant of `steps/2.html` — same layout (see its descriptor)
- `steps/2.html` — ~4w, colours: bg-blue-500 bg-gray-200 text-gray-600
  ↳ minimal stepper: '2/3 - Address' caption over a partially-filled progress bar
- `steps/3-dark.html` [dark] — ~4w, colours: bg-blue-500 bg-gray-200 bg-gray-400 bg-gray-500…
  ↳ dark-scheme variant of `steps/3.html` — same layout (see its descriptor)
- `steps/3.html` — ~4w, colours: bg-blue-500 bg-gray-200 bg-gray-500 text-blue-500…
  ↳ underline stepper: 3 labels with check-circle markers hanging below a full-width line, completed steps blue
- `steps/4-dark.html` [dark] — ~16w, colours: bg-gray-50 bg-gray-800 bg-gray-900 border-gray-100…
  ↳ dark-scheme variant of `steps/4.html` — same layout (see its descriptor)
- `steps/4.html` — ~16w, colours: bg-gray-50 border-gray-100 text-gray-600 text-gray-900
  ↳ arrow-segment stepper: 3 joined cells with rotated-square arrow joints between them, active cell tinted gray-50, each cell icon + title + subtitle
- `steps/5-dark.html` [dark] — ~7w, colours: bg-blue-500 bg-gray-100 bg-gray-200 bg-gray-700…
  ↳ dark-scheme variant of `steps/5.html` — same layout (see its descriptor)
- `steps/5.html` — ~7w, colours: bg-blue-500 bg-gray-100 bg-gray-200 text-gray-600
  ↳ numbered-circle stepper: 1-2-3 badges with labels sitting on a horizontal line running through the middle, active circle filled blue

### tables (10 files)
- `tables/1-dark.html` [dark] — ~36w, colours: text-gray-900
  ↳ dark-scheme variant of `tables/1.html` — same layout (see its descriptor)
- `tables/1.html` — ~36w, colours: text-gray-900
  ↳ plain data table: divide-y rows, 4 columns, no outer chrome
- `tables/2-dark.html` [dark] — ~36w, colours: border-gray-300 border-gray-600 text-gray-900
  ↳ dark-scheme variant of `tables/2.html` — same layout (see its descriptor)
- `tables/2.html` — ~36w, colours: border-gray-300 text-gray-900
  ↳ bordered card table: data table wrapped in a rounded border + shadow
- `tables/3-dark.html` [dark] — ~36w, colours: bg-gray-50 bg-gray-800 text-gray-900
  ↳ dark-scheme variant of `tables/3.html` — same layout (see its descriptor)
- `tables/3.html` — ~36w, colours: bg-gray-50 text-gray-900
  ↳ zebra table: even rows tinted gray-50
- `tables/4-dark.html` [dark] — ~36w, colours: bg-gray-900 text-gray-900
  ↳ dark-scheme variant of `tables/4.html` — same layout (see its descriptor)
- `tables/4.html` — ~36w, colours: text-gray-900
  ↳ sticky-header table: max-height scroll container with the thead pinned to the top
- `tables/5-dark.html` [dark] — ~36w, colours: bg-gray-900 text-gray-900
  ↳ dark-scheme variant of `tables/5.html` — same layout (see its descriptor)
- `tables/5.html` — ~36w, colours: text-gray-900
  ↳ sticky-first-column table: first cell of every row pinned left for horizontal scrolling

### tabs (10 files, 10 carry lorem ipsum)
- `tabs/1-dark.html` [dark,LOREM] — ~43w, colours: border-blue-600 border-gray-200 border-gray-700 text-blue-500…
  ↳ dark-scheme variant of `tabs/1.html` — same layout (see its descriptor)
- `tabs/1.html` [LOREM] — ~43w, colours: border-blue-600 border-gray-200 text-blue-600 text-blue-700…
  ↳ underline tabs: full-width bottom-border bar, active tab's border + text blue, content panel below
- `tabs/2-dark.html` [dark,LOREM] — ~43w, colours: border-blue-600 border-gray-200 border-gray-700 text-blue-500…
  ↳ dark-scheme variant of `tabs/2.html` — same layout (see its descriptor)
- `tabs/2.html` [LOREM] — ~43w, colours: border-blue-600 border-gray-200 text-blue-600 text-blue-700…
  ↳ underline tabs with a leading icon on each tab
- `tabs/3-dark.html` [dark,LOREM] — ~43w, colours: border-blue-600 border-gray-200 border-gray-700 text-blue-500…
  ↳ dark-scheme variant of `tabs/3.html` — same layout (see its descriptor)
- `tabs/3.html` [LOREM] — ~43w, colours: border-blue-600 border-gray-200 text-blue-600 text-blue-700…
  ↳ vertical tabs: left rail with a right-border indicator, active tab blue, content panel to the right
- `tabs/4-dark.html` [dark,LOREM] — ~43w, colours: border-blue-600 text-blue-500 text-blue-600 text-blue-700…
  ↳ dark-scheme variant of `tabs/4.html` — same layout (see its descriptor)
- `tabs/4.html` [LOREM] — ~43w, colours: border-blue-600 text-blue-600 text-blue-700 text-gray-600…
  ↳ bare underline tabs without the full-width border bar — just the active tab's underline
- `tabs/5-dark.html` [dark,LOREM] — ~43w, colours: bg-blue-600 bg-blue-700 bg-gray-200 bg-gray-300…
  ↳ dark-scheme variant of `tabs/5.html` — same layout (see its descriptor)
- `tabs/5.html` [LOREM] — ~43w, colours: bg-blue-600 bg-blue-700 bg-gray-200 bg-gray-300…
  ↳ pill tabs: rounded-full buttons, active solid blue, inactive gray fills

### textareas (6 files)
- `textareas/1-dark.html` [dark] — ~1w, colours: bg-gray-900 border-gray-300 border-gray-600 text-gray-200…
  ↳ dark-scheme variant of `textareas/1.html` — same layout (see its descriptor)
- `textareas/1.html` — ~1w, colours: border-gray-300 text-gray-700
  ↳ plain labelled textarea: 4 rows, rounded border, resize disabled
- `textareas/2-dark.html` [dark] — ~3w, colours: bg-gray-100 bg-gray-700 bg-gray-900 border-gray-300…
  ↳ dark-scheme variant of `textareas/2.html` — same layout (see its descriptor)
- `textareas/2.html` — ~3w, colours: bg-gray-100 border-gray-300 ring-blue-600 text-gray-700…
  ↳ textarea with built-in toolbar: Clear/Save buttons docked inside the bordered wrapper's footer, focus ring wraps the whole box
- `textareas/3-dark.html` [dark] — ~3w, colours: bg-gray-100 bg-gray-700 bg-gray-900 border-gray-300…
  ↳ dark-scheme variant of `textareas/3.html` — same layout (see its descriptor)
- `textareas/3.html` — ~3w, colours: bg-gray-100 border-gray-300 text-gray-700 text-gray-900
  ↳ textarea with external actions: Clear/Save buttons right-aligned below the field

### timelines (6 files, 6 carry lorem ipsum)
- `timelines/1-dark.html` [dark,LOREM] — ~67w, colours: bg-blue-600 bg-gray-200 bg-gray-700 text-gray-200…
  ↳ dark-scheme variant of `timelines/1.html` — same layout (see its descriptor)
- `timelines/1.html` [LOREM] — ~67w, colours: bg-blue-600 bg-gray-200 text-gray-700 text-gray-900
  ↳ vertical timeline: left rail line with a blue dot per event, date / title / description stacked to the right
- `timelines/2-dark.html` [dark,LOREM] — ~67w, colours: bg-blue-600 bg-gray-200 bg-gray-700 text-gray-200…
  ↳ dark-scheme variant of `timelines/2.html` — same layout (see its descriptor)
- `timelines/2.html` [LOREM] — ~67w, colours: bg-blue-600 bg-gray-200 text-gray-700 text-gray-900
  ↳ alternating center timeline: central line with entries zig-zagging left/right (group-odd reversed) — classic milestone spine
- `timelines/3-dark.html` [dark,LOREM] — ~67w, colours: bg-blue-600 bg-gray-200 bg-gray-700 text-gray-200…
  ↳ dark-scheme variant of `timelines/3.html` — same layout (see its descriptor)
- `timelines/3.html` [LOREM] — ~67w, colours: bg-blue-600 bg-gray-200 text-gray-700 text-gray-900
  ↳ horizontal timeline: top line with dots, event columns (date / title / text) hanging below

### toasts (12 files, 12 carry lorem ipsum)
- `toasts/1-dark.html` [dark,LOREM] — ~11w, colours: bg-green-50 bg-green-800 border-green-400 border-green-500…
  ↳ dark-scheme variant of `toasts/1.html` — same layout (see its descriptor)
- `toasts/1.html` [LOREM] — ~11w, colours: bg-green-50 border-green-500 text-green-700 text-green-800
  ↳ success toast: green-tinted bordered rounded card, icon + bold 'Success' title + message
- `toasts/2-dark.html` [dark,LOREM] — ~11w, colours: bg-red-50 bg-red-800 border-red-400 border-red-500…
  ↳ dark-scheme variant of `toasts/2.html` — same layout (see its descriptor)
- `toasts/2.html` [LOREM] — ~11w, colours: bg-red-50 border-red-500 text-red-700 text-red-800
  ↳ error toast: red-tinted bordered card with icon + title + message
- `toasts/3-dark.html` [dark,LOREM] — ~11w, colours: bg-amber-50 bg-amber-800 border-amber-400 border-amber-500…
  ↳ dark-scheme variant of `toasts/3.html` — same layout (see its descriptor)
- `toasts/3.html` [LOREM] — ~11w, colours: bg-amber-50 border-amber-500 text-amber-700 text-amber-800
  ↳ warning toast: amber-tinted bordered card with icon + title + message
- `toasts/4-dark.html` [dark,LOREM] — ~11w, colours: bg-blue-50 bg-blue-800 border-blue-400 border-blue-500…
  ↳ dark-scheme variant of `toasts/4.html` — same layout (see its descriptor)
- `toasts/4.html` [LOREM] — ~11w, colours: bg-blue-50 border-blue-500 text-blue-700 text-blue-800
  ↳ info toast: blue-tinted bordered card with icon + title + message
- `toasts/5-dark.html` [dark,LOREM] — ~12w, colours: bg-blue-50 bg-blue-600 bg-blue-800 border-blue-400…
  ↳ dark-scheme variant of `toasts/5.html` — same layout (see its descriptor)
- `toasts/5.html` [LOREM] — ~12w, colours: bg-blue-50 bg-blue-600 border-blue-500 border-blue-600…
  ↳ actionable toast: info card with a solid 'Accept' button inside the body
- `toasts/6-dark.html` [dark,LOREM] — ~11w, colours: bg-blue-50 bg-blue-800 border-blue-600 border-blue-700…
  ↳ dark-scheme variant of `toasts/6.html` — same layout (see its descriptor)
- `toasts/6.html` [LOREM] — ~11w, colours: bg-blue-50 border-blue-700 text-blue-700 text-blue-800
  ↳ accent-edge alert: thick left border stripe (border-s-4), icon + title row, message below — flatter than the card toasts

### toggles (8 files)
- `toggles/1-dark.html` [dark] — ~0w, colours: bg-gray-300 bg-gray-600 bg-gray-900 bg-green-500…
  ↳ dark-scheme variant of `toggles/1.html` — same layout (see its descriptor)
- `toggles/1.html` — ~0w, colours: bg-gray-300 bg-green-500
  ↳ pill switch: gray track turns green when checked, white knob slides right — pure CSS via has-checked/peer
- `toggles/2-dark.html` [dark] — ~0w, colours: bg-gray-300 bg-gray-600 bg-gray-900 bg-green-500…
  ↳ dark-scheme variant of `toggles/2.html` — same layout (see its descriptor)
- `toggles/2.html` — ~0w, colours: bg-gray-300 bg-green-500 text-gray-700
  ↳ icon pill switch: the knob carries an X icon that swaps to a check when on
- `toggles/3-dark.html` [dark] — ~0w, colours: bg-gray-200 bg-gray-300 bg-gray-400 bg-gray-500…
  ↳ dark-scheme variant of `toggles/3.html` — same layout (see its descriptor)
- `toggles/3.html` — ~0w, colours: bg-gray-200 bg-gray-300 bg-gray-500
  ↳ slim-rail switch: thin center track with a large knob carrying an inner dot that collapses when checked
- `toggles/4-dark.html` [dark] — ~0w, colours: bg-blue-500 bg-blue-600 bg-gray-300 bg-gray-600…
  ↳ dark-scheme variant of `toggles/4.html` — same layout (see its descriptor)
- `toggles/4.html` — ~0w, colours: bg-blue-500 bg-gray-300
  ↳ morphing switch: ring-inset knob that squashes into a 2px sliver at the far end when checked

### vertical-menu (16 files)
- `vertical-menu/1-dark.html` [dark] — ~5w, colours: bg-gray-100 bg-gray-800 text-gray-200 text-gray-400…
  ↳ dark-scheme variant of `vertical-menu/1.html` — same layout (see its descriptor)
- `vertical-menu/1.html` — ~5w, colours: bg-gray-100 text-gray-500 text-gray-700
  ↳ simple vertical nav: rounded link list, active item gray-filled
- `vertical-menu/2-dark.html` [dark] — ~7w, colours: bg-gray-100 bg-gray-200 bg-gray-700 bg-gray-800…
  ↳ dark-scheme variant of `vertical-menu/2.html` — same layout (see its descriptor)
- `vertical-menu/2.html` — ~7w, colours: bg-gray-100 bg-gray-200 text-gray-500 text-gray-600…
  ↳ vertical nav with count badges: rounded-full numeric pills right-aligned on some items
- `vertical-menu/3-dark.html` [dark] — ~5w, colours: bg-gray-100 bg-gray-800 text-gray-200 text-gray-400…
  ↳ dark-scheme variant of `vertical-menu/3.html` — same layout (see its descriptor)
- `vertical-menu/3.html` — ~5w, colours: bg-gray-100 text-gray-500 text-gray-700
  ↳ vertical nav with a leading icon on every link
- `vertical-menu/4-dark.html` [dark] — ~7w, colours: bg-gray-100 bg-gray-200 bg-gray-800 bg-gray-900…
  ↳ dark-scheme variant of `vertical-menu/4.html` — same layout (see its descriptor)
- `vertical-menu/4.html` — ~7w, colours: bg-gray-100 bg-gray-200 text-gray-500 text-gray-600…
  ↳ vertical nav with icons + count badges combined
- `vertical-menu/5-dark.html` [dark] — ~5w, colours: bg-blue-50 bg-blue-500 bg-gray-50 bg-gray-800…
  ↳ dark-scheme variant of `vertical-menu/5.html` — same layout (see its descriptor)
- `vertical-menu/5.html` — ~5w, colours: bg-blue-50 bg-gray-50 border-blue-500 border-gray-100…
  ↳ accent-border vertical nav: active link gets a 3px blue left border + blue tint; hover previews the border on others
- `vertical-menu/6-dark.html` [dark] — ~11w, colours: bg-gray-100 bg-gray-800 text-gray-200 text-gray-400…
  ↳ dark-scheme variant of `vertical-menu/6.html` — same layout (see its descriptor)
- `vertical-menu/6.html` — ~11w, colours: bg-gray-100 text-gray-500 text-gray-700
  ↳ vertical nav with collapsible <details> submenus (Teams, Account) and a Logout form button
- `vertical-menu/7-dark.html` [dark] — ~11w, colours: bg-gray-100 bg-gray-800 text-gray-200 text-gray-400…
  ↳ dark-scheme variant of `vertical-menu/7.html` — same layout (see its descriptor)
- `vertical-menu/7.html` — ~11w, colours: bg-gray-100 text-gray-500 text-gray-700
  ↳ vertical nav with icons + collapsible submenus + rotating chevrons
- `vertical-menu/8-dark.html` [dark] — ~9w, colours: bg-gray-100 bg-gray-800 text-gray-200 text-gray-400…
  ↳ dark-scheme variant of `vertical-menu/8.html` — same layout (see its descriptor)
- `vertical-menu/8.html` — ~9w, colours: bg-gray-100 text-gray-500 text-gray-700
  ↳ sectioned vertical nav: link groups separated by divide-y rules, Logout form at the bottom

## Marketing (sections — content-heavy, rewrite everything)

### announcements (12 files, 12 carry lorem ipsum)
- `marketing-announcements/1-dark.html` [dark,LOREM] — ~6w, colours: bg-gray-100 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `marketing-announcements/1.html` — same layout (see its descriptor)
- `marketing-announcements/1.html` [LOREM] — ~6w, colours: bg-gray-100 border-gray-200 text-gray-900
  ↳ "Base" — slim full-width announcement bar (top, border-b): single centered one-line message with inline underlined link
- `marketing-announcements/2-dark.html` [dark,LOREM] — ~6w, colours: bg-gray-100 bg-gray-50 bg-gray-800 bg-gray-900…
  ↳ dark-scheme variant of `marketing-announcements/2.html` — same layout (see its descriptor)
- `marketing-announcements/2.html` [LOREM] — ~6w, colours: bg-gray-100 bg-gray-50 border-gray-200 border-gray-300…
  ↳ "Base with dismiss" — slim top announcement bar: centered message + inline link, bordered dismiss-X button pinned right (flex justify-between)
- `marketing-announcements/3-dark.html` [dark,LOREM] — ~6w, colours: bg-gray-100 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `marketing-announcements/3.html` — same layout (see its descriptor)
- `marketing-announcements/3.html` [LOREM] — ~6w, colours: bg-gray-100 border-gray-200 text-gray-900
  ↳ "Fixed" — announcement bar fixed to viewport BOTTOM (fixed inset-x-0 bottom-0, border-t): centered message + inline link
- `marketing-announcements/4-dark.html` [dark,LOREM] — ~6w, colours: bg-gray-100 bg-gray-50 bg-gray-800 bg-gray-900…
  ↳ dark-scheme variant of `marketing-announcements/4.html` — same layout (see its descriptor)
- `marketing-announcements/4.html` [LOREM] — ~6w, colours: bg-gray-100 bg-gray-50 border-gray-200 border-gray-300…
  ↳ "Fixed with dismiss" — fixed bottom announcement bar: centered message + inline link, dismiss-X button right
- `marketing-announcements/5-dark.html` [dark,LOREM] — ~6w, colours: bg-gray-100 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `marketing-announcements/5.html` — same layout (see its descriptor)
- `marketing-announcements/5.html` [LOREM] — ~6w, colours: bg-gray-100 border-gray-200 text-gray-900
  ↳ "Floating" — floating rounded announcement card hovering at viewport bottom (fixed bottom + p-4 inset): centered message + inline link
- `marketing-announcements/6-dark.html` [dark,LOREM] — ~6w, colours: bg-gray-100 bg-gray-50 bg-gray-800 bg-gray-900…
  ↳ dark-scheme variant of `marketing-announcements/6.html` — same layout (see its descriptor)
- `marketing-announcements/6.html` [LOREM] — ~6w, colours: bg-gray-100 bg-gray-50 border-gray-200 border-gray-300…
  ↳ "Floating with dismiss" — floating rounded bottom announcement card: centered message + inline link, dismiss-X right

### banners (6 files, 6 carry lorem ipsum)
- `marketing-banners/1-dark.html` [dark,LOREM] — ~28w, colours: bg-gray-50 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-banners/1.html` — same layout (see its descriptor)
- `marketing-banners/1.html` [LOREM] — ~28w, colours: bg-gray-50 bg-indigo-600 bg-indigo-700 border-gray-200…
  ↳ "Center" — full-height centered hero: 4xl/5xl h1 with one accent-coloured <strong> word, short subhead, two side-by-side CTA buttons (solid primary + neutral outline), all centered in a max-w-prose column
- `marketing-banners/2-dark.html` [dark,LOREM] — ~28w, colours: bg-gray-50 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-banners/2.html` — same layout (see its descriptor)
- `marketing-banners/2.html` [LOREM] — ~28w, colours: bg-gray-50 bg-indigo-600 bg-indigo-700 border-gray-200…
  ↳ "Left" — same full-height hero left-aligned: h1 with accent word, subhead, dual CTA buttons, text hugging the left edge of a max-w-prose column
- `marketing-banners/3-dark.html` [dark,LOREM] — ~28w, colours: bg-gray-50 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-banners/3.html` — same layout (see its descriptor)
- `marketing-banners/3.html` [LOREM] — ~28w, colours: bg-gray-50 bg-indigo-600 bg-indigo-700 border-gray-200…
  ↳ "Left with image" — two-column hero (md:grid-cols-2): left-aligned h1 + subhead + dual CTAs left, inline SVG illustration right

### blog-cards (13 files, 11 carry lorem ipsum)
- `marketing-blog-cards/1-dark.html` [dark,LOREM] — ~50w, colours: bg-gray-900 text-gray-400 text-gray-500 text-gray-900
  ↳ dark-scheme variant of `marketing-blog-cards/1.html` — same layout (see its descriptor)
- `marketing-blog-cards/1.html` [LOREM] — ~50w, colours: text-gray-500 text-gray-900
  ↳ vertical card, image top (h-56 cover) over white body: small date, title, 3-line clamped excerpt; rounded, shadow grows on hover
- `marketing-blog-cards/2-dark.html` [dark,LOREM] — ~45w, colours: text-gray-400 text-gray-500 text-gray-900
  ↳ dark-scheme variant of `marketing-blog-cards/2.html` — same layout (see its descriptor)
- `marketing-blog-cards/2.html` [LOREM] — ~45w, colours: text-gray-500 text-gray-900
  ↳ "floating image" card: rounded-xl shadowed photo sits on the page background (no card box), title + clamped excerpt in plain padding below
- `marketing-blog-cards/3-dark.html` [dark,LOREM] — ~52w, colours: bg-gray-900 border-gray-100 border-gray-800 text-blue-600…
  ↳ dark-scheme variant of `marketing-blog-cards/3.html` — same layout (see its descriptor)
- `marketing-blog-cards/3.html` [LOREM] — ~52w, colours: border-gray-100 text-blue-600 text-gray-500 text-gray-900
  ↳ bordered card: image top, title, clamped excerpt, "Find out more →" text link whose arrow nudges right on hover
- `marketing-blog-cards/4-dark.html` [dark] — ~14w, colours: bg-gray-900 bg-purple-100 bg-purple-600 border-gray-200…
  ↳ dark-scheme variant of `marketing-blog-cards/4.html` — same layout (see its descriptor)
- `marketing-blog-cards/4.html` — ~14w, colours: bg-purple-100 border-gray-200 text-gray-500 text-gray-900…
  ↳ text-only card (no image): rounded-[10px] border, tall top padding, small date eyebrow, title, row of rounded-full purple tag pills
- `marketing-blog-cards/5-dark.html` [dark,LOREM] — ~52w, colours: bg-blue-600 bg-blue-700 bg-gray-900 border-gray-100…
  ↳ dark-scheme variant of `marketing-blog-cards/5.html` — same layout (see its descriptor)
- `marketing-blog-cards/5.html` [LOREM] — ~52w, colours: bg-blue-600 border-gray-100 text-blue-600 text-gray-500…
  ↳ icon-badge card: small square solid-colour icon chip top-left, title, clamped excerpt, "Find out more →" arrow link; bordered, shadow on hover
- `marketing-blog-cards/6-dark.html` [dark,LOREM] — ~55w, colours: bg-gray-900 bg-yellow-400 bg-yellow-500 border-gray-900…
  ↳ dark-scheme variant of `marketing-blog-cards/6.html` — same layout (see its descriptor)
- `marketing-blog-cards/6.html` [LOREM] — ~55w, colours: bg-gray-900 bg-yellow-300 bg-yellow-400 border-gray-900…
  ↳ horizontal magazine card (max-w-3xl): rotated vertical date rail on the left ([writing-mode:vertical-lr]), square image, bold uppercase title + excerpt, yellow block "Read Blog" button pinned bottom-right
- `marketing-blog-cards/7.html` [LOREM] — ~50w, colours: from-gray-900 to-gray-900
  ↳ full-bleed image card: photo fills the card behind a dark bottom gradient overlay; white date, title and clamped excerpt pinned to the lower edge (pt-32→64 spacer)

### buttons (10 files)
- `marketing-buttons/1-dark.html` [dark] — ~4w, colours: bg-gray-900 bg-indigo-200 bg-indigo-300 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-buttons/1.html` — same layout (see its descriptor)
- `marketing-buttons/1.html` — ~4w, colours: bg-indigo-600 bg-indigo-700 bg-slate-50 border-indigo-600…
  ↳ "Solid and bordered" — pair of rounded-full pill buttons: solid indigo primary + white bordered secondary
- `marketing-buttons/2-dark.html` [dark] — ~4w, colours: bg-indigo-200 bg-indigo-300 bg-indigo-50 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-buttons/2.html` — same layout (see its descriptor)
- `marketing-buttons/2.html` — ~4w, colours: bg-indigo-50 bg-indigo-600 bg-indigo-700 border-indigo-600…
  ↳ "Solid and bordered with icon" — pill pair: solid with trailing icon, outlined with leading icon
- `marketing-buttons/3-dark.html` [dark] — ~6w, colours: bg-gray-900 bg-indigo-200 bg-indigo-300 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-buttons/3.html` — same layout (see its descriptor)
- `marketing-buttons/3.html` — ~6w, colours: bg-indigo-600 bg-indigo-700 bg-slate-50 border-indigo-600…
  ↳ "Icon only" — two circular size-12 icon buttons (solid + bordered), sr-only labels
- `marketing-buttons/4-dark.html` [dark] — ~4w, colours: bg-gray-900 bg-indigo-200 bg-indigo-300 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-buttons/4.html` — same layout (see its descriptor)
- `marketing-buttons/4.html` — ~4w, colours: bg-indigo-600 bg-indigo-700 bg-slate-50 border-indigo-600…
  ↳ "CTA with icon bubble" — pill button whose trailing arrow sits inside a translucent circle that slides right on hover; plus bordered twin with plain icon
- `marketing-buttons/5-dark.html` [dark] — ~4w, colours: bg-slate-100 bg-slate-800 ring-indigo-200 ring-indigo-700…
  ↳ dark-scheme variant of `marketing-buttons/5.html` — same layout (see its descriptor)
- `marketing-buttons/5.html` — ~4w, colours: bg-slate-100 ring-indigo-200 ring-slate-200 text-indigo-600…
  ↳ "Quiet text buttons" — borderless pair: underlined link-style button (offset underline, colour shifts on hover) + plain text button with hover fill

### cards (9 files, 7 carry lorem ipsum)
- `marketing-cards/1.html` [LOREM] — ~42w, colours: border-gray-300 text-gray-700 text-gray-900
  ↳ bordered article card: circular avatar on the RIGHT (sm:order-last), title + "By …" byline + 2-line clamped excerpt left, icon meta dl row below (published date, reading time)
- `marketing-cards/2.html` [LOREM] — ~16w, colours: text-gray-700 text-gray-900
  ↳ minimal stacked card, no border: tall image (h-64→96), bold title, short paragraph
- `marketing-cards/3.html` [LOREM] — ~23w, colours: text-pink-500
  ↳ hover-reveal image card on black: photo at 75% opacity, uppercase pink eyebrow + white name top-left; hidden description slides up + fades in on hover
- `marketing-cards/4.html` [LOREM] — ~25w
  ↳ brutalist offset card: dashed 2px black border sits behind a solid-bordered white panel that shifts up-left on hover, swapping an icon+title face for the full title/description/"Read more" content
- `marketing-cards/5.html` — ~17w, colours: text-gray-500 text-indigo-700
  ↳ real-estate style listing card: rounded photo, price + address definition list, horizontal icon meta row (parking / bathroom / bedroom counts)
- `marketing-cards/6.html` [LOREM] — ~36w, colours: bg-gray-800 border-gray-700 border-pink-600 text-gray-300
  ↳ dark profile card (gray-800): round avatar + name + inline social links, then stacked bordered project tiles whose border tints pink on hover
- `marketing-cards/7.html` — ~5w, colours: bg-yellow-500
  ↳ portfolio tile: photo with asymmetric corners (rounded-se-3xl + rounded-es-3xl), centered caption row below — company name, short yellow divider bar, muted category text
- `marketing-cards/8.html` [LOREM] — ~45w, colours: bg-indigo-500 border-indigo-500 ring-indigo-50 text-gray-500…
  ↳ podcast episode card: indigo-ringed white card, circular audio-waveform motif (5 vertical bars) left, solid "Episode #" badge, title, one-line description, duration + "Featuring …" linked names meta
- `marketing-cards/9.html` [LOREM] — ~30w, colours: bg-green-600 border-gray-100 text-gray-500 text-gray-700
  ↳ forum post card: square thumbnail left, title + 2-line clamped excerpt, comments-count + "Posted by" meta; green "Solved!" ribbon notched into the bottom-right corner

### carts (6 files)
- `marketing-carts/1-dark.html` [dark] — ~30w, colours: bg-blue-200 bg-blue-300 bg-blue-600 bg-blue-700…
  ↳ dark-scheme variant of `marketing-carts/1.html` — same layout (see its descriptor)
- `marketing-carts/1.html` — ~30w, colours: bg-blue-600 bg-blue-700 bg-gray-100 bg-gray-50…
  ↳ "Popup" — slide-over cart drawer (max-w-sm, role=dialog): close-X top right, 3 line items (thumb + name + size/colour dl), stacked full-width actions: View cart (outline), Checkout (solid), Continue shopping (text link)
- `marketing-carts/2-dark.html` [dark] — ~39w, colours: bg-blue-200 bg-blue-300 bg-blue-600 bg-blue-700…
  ↳ dark-scheme variant of `marketing-carts/2.html` — same layout (see its descriptor)
- `marketing-carts/2.html` — ~39w, colours: bg-blue-600 bg-blue-700 bg-gray-100 bg-gray-50…
  ↳ "Popup with actions" — same slide-over drawer plus per-line quantity number input and trash/remove button on each item
- `marketing-carts/3-dark.html` [dark] — ~45w, colours: bg-blue-200 bg-blue-300 bg-blue-600 bg-blue-700…
  ↳ dark-scheme variant of `marketing-carts/3.html` — same layout (see its descriptor)
- `marketing-carts/3.html` — ~45w, colours: bg-blue-600 bg-blue-700 bg-gray-50 border-blue-600…
  ↳ "Page" — full-width cart page (max-w-7xl): line items with qty + remove, then right-aligned totals dl (Subtotal / VAT / Discount / bold Total) above right-aligned View-cart + Checkout buttons and a Continue-shopping link

### contact-forms (10 files, 2 carry lorem ipsum)
- `marketing-contact-forms/1-dark.html` [dark] — ~5w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-contact-forms/1.html` — same layout (see its descriptor)
- `marketing-contact-forms/1.html` — ~5w, colours: bg-gray-100 bg-indigo-600 border-gray-300 border-indigo-500…
  ↳ "Base" — single-column card form (max-w-md, gray panel, rounded): Name, Email, 4-row Message textarea, full-width solid indigo submit
- `marketing-contact-forms/2-dark.html` [dark] — ~20w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-contact-forms/2.html` — same layout (see its descriptor)
- `marketing-contact-forms/2.html` — ~20w, colours: bg-gray-100 bg-indigo-600 border-gray-300 border-indigo-500…
  ↳ "Base with triage" — base card form plus Subject and Priority select dropdowns between email and message
- `marketing-contact-forms/3-dark.html` [dark] — ~11w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-contact-forms/3.html` — same layout (see its descriptor)
- `marketing-contact-forms/3.html` — ~11w, colours: bg-gray-100 bg-indigo-600 border-gray-300 border-indigo-500…
  ↳ "Base with checkboxes" — base card form plus an Inquiry checkbox fieldset (4 stacked options)
- `marketing-contact-forms/4-dark.html` [dark] — ~6w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-contact-forms/4.html` — same layout (see its descriptor)
- `marketing-contact-forms/4.html` — ~6w, colours: bg-gray-100 bg-indigo-600 border-gray-300 border-indigo-500…
  ↳ "Grid" — 2-column form card (sm:grid-cols-2): Name full-width, Email + Phone side-by-side, Message + submit spanning both columns
- `marketing-contact-forms/5-dark.html` [dark,LOREM] — ~51w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-contact-forms/5.html` — same layout (see its descriptor)
- `marketing-contact-forms/5.html` [LOREM] — ~51w, colours: bg-gray-100 bg-indigo-600 border-gray-300 border-indigo-500…
  ↳ "Side-by-side" — 2-column section: heading + intro copy + icon contact dl (phone / email / address) left, base card form right

### ctas (8 files, 8 carry lorem ipsum)
- `marketing-ctas/1-dark.html` [dark,LOREM] — ~43w, colours: bg-emerald-600 bg-emerald-700 bg-gray-50 bg-gray-900…
  ↳ dark-scheme variant of `marketing-ctas/1.html` — same layout (see its descriptor)
- `marketing-ctas/1.html` [LOREM] — ~43w, colours: bg-emerald-600 bg-emerald-700 bg-gray-50 ring-yellow-400…
  ↳ 2-column split CTA (sm:grid-cols-2): centered-to-left heading + hidden-on-mobile copy + single solid emerald button left, full-bleed edge-to-edge photo right
- `marketing-ctas/2-dark.html` [dark,LOREM] — ~35w, colours: bg-gray-50 bg-gray-800 bg-gray-900 bg-rose-600…
  ↳ dark-scheme variant of `marketing-ctas/2.html` — same layout (see its descriptor)
- `marketing-ctas/2.html` [LOREM] — ~35w, colours: bg-gray-50 bg-rose-600 border-gray-200 ring-yellow-400…
  ↳ newsletter CTA band: centered heading + copy, then inline email-capture row (input + solid rose submit with icon) that stacks on mobile
- `marketing-ctas/3-dark.html` [dark,LOREM] — ~43w, colours: bg-emerald-600 bg-emerald-700 bg-gray-50 bg-gray-900…
  ↳ dark-scheme variant of `marketing-ctas/3.html` — same layout (see its descriptor)
- `marketing-ctas/3.html` [LOREM] — ~43w, colours: bg-emerald-600 bg-emerald-700 bg-gray-50 ring-yellow-400…
  ↳ split CTA with offset image: text + solid button left; photo right is inset from the top and gets a large rounded upper-start corner (rounded-ss-[30-60px]), bottom-aligned
- `marketing-ctas/4-dark.html` [dark,LOREM] — ~43w, colours: bg-blue-300 bg-blue-600 bg-gray-100 bg-gray-800…
  ↳ dark-scheme variant of `marketing-ctas/4.html` — same layout (see its descriptor)
- `marketing-ctas/4.html` [LOREM] — ~43w, colours: bg-blue-600 bg-gray-100 border-blue-600 text-blue-600…
  ↳ boxed 2-column CTA inside page padding: flat gray content panel (centered heading + copy + solid blue button) left, 2-up photo grid right

### empty-content (10 files)
- `marketing-empty-content/1-dark.html` [dark] — ~34w, colours: bg-gray-800 bg-indigo-50 bg-indigo-600 bg-indigo-700…
  ↳ dark-scheme variant of `marketing-empty-content/1.html` — same layout (see its descriptor)
- `marketing-empty-content/1.html` — ~34w, colours: bg-indigo-50 bg-indigo-600 bg-indigo-700 border-indigo-600…
  ↳ "No search results" — centered max-w-md state: icon, bold heading, copy, stacked solid + outline buttons, "Popular searches:" inline text links
- `marketing-empty-content/2-dark.html` [dark] — ~30w, colours: bg-gray-800 bg-indigo-50 bg-indigo-600 bg-indigo-700…
  ↳ dark-scheme variant of `marketing-empty-content/2.html` — same layout (see its descriptor)
- `marketing-empty-content/2.html` — ~30w, colours: bg-indigo-50 bg-indigo-600 bg-indigo-700 border-indigo-600…
  ↳ "No search results (alt)" — same centered state but popular links rendered as a spaced horizontal row instead of inline sentence
- `marketing-empty-content/3-dark.html` [dark] — ~25w, colours: bg-gray-900 bg-indigo-600 bg-indigo-700 border-gray-300…
  ↳ dark-scheme variant of `marketing-empty-content/3.html` — same layout (see its descriptor)
- `marketing-empty-content/3.html` — ~25w, colours: bg-indigo-600 bg-indigo-700 border-gray-300 border-indigo-500…
  ↳ "Coming soon" — centered state, no icon: heading, copy, stacked email input + solid Notify Me button, reassurance footnote
- `marketing-empty-content/4-dark.html` [dark] — ~30w, colours: bg-gray-50 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-empty-content/4.html` — same layout (see its descriptor)
- `marketing-empty-content/4.html` — ~30w, colours: bg-gray-50 bg-indigo-600 bg-indigo-700 border-gray-300…
  ↳ "Related content" — centered state: icon, heading, two left-aligned bordered suggestion cards (title + subtitle), then full-width solid back button
- `marketing-empty-content/5-dark.html` [dark] — ~26w, colours: bg-gray-800 bg-indigo-50 bg-indigo-600 bg-indigo-700…
  ↳ dark-scheme variant of `marketing-empty-content/5.html` — same layout (see its descriptor)
- `marketing-empty-content/5.html` — ~26w, colours: bg-indigo-50 bg-indigo-600 bg-indigo-700 border-indigo-600…
  ↳ "No stock" — centered state: icon, heading, Notify-when-available (solid) + Explore-similar (outline) buttons, "Last restocked" footnote

### faqs (6 files, 6 carry lorem ipsum)
- `marketing-faqs/1-dark.html` [dark,LOREM] — ~111w, colours: bg-gray-50 bg-gray-800 border-gray-100 border-gray-700…
  ↳ dark-scheme variant of `marketing-faqs/1.html` — same layout (see its descriptor)
- `marketing-faqs/1.html` [LOREM] — ~111w, colours: bg-gray-50 border-gray-100 text-gray-900
  ↳ "Base with chevrons" — stack of native <details> accordions: rounded bordered gray summary bars with rotating chevron, answer text below, first item open
- `marketing-faqs/2-dark.html` [dark,LOREM] — ~111w, colours: text-gray-900
  ↳ dark-scheme variant of `marketing-faqs/2.html` — same layout (see its descriptor)
- `marketing-faqs/2.html` [LOREM] — ~111w, colours: text-gray-900
  ↳ "Divided with chevrons" — flat accordion list separated only by divide-y rules (no borders or fills), chevron toggles
- `marketing-faqs/3-dark.html` [dark,LOREM] — ~111w, colours: bg-gray-50 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `marketing-faqs/3.html` — same layout (see its descriptor)
- `marketing-faqs/3.html` [LOREM] — ~111w, colours: bg-gray-50 border-gray-200 text-gray-900
  ↳ "Background" — accordion cards on gray fill with a thick 4px left accent border (border-s-4)

### feature-grids (8 files, 6 carry lorem ipsum)
- `marketing-feature-grids/1-dark.html` [dark,LOREM] — ~51w, colours: bg-gray-100 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `marketing-feature-grids/1.html` — same layout (see its descriptor)
- `marketing-feature-grids/1.html` [LOREM] — ~51w, colours: bg-gray-100 border-gray-200 text-gray-700 text-gray-900
  ↳ "Grid with content" — centered heading + intro over a 3-across grid of bordered rounded cards: gray icon chip, title, one-line description
- `marketing-feature-grids/2-dark.html` [dark,LOREM] — ~49w, colours: bg-gray-100 bg-gray-800 text-gray-200 text-gray-700…
  ↳ dark-scheme variant of `marketing-feature-grids/2.html` — same layout (see its descriptor)
- `marketing-feature-grids/2.html` [LOREM] — ~49w, colours: bg-gray-100 text-gray-700 text-gray-900
  ↳ "List with content" — 2-column: heading + intro left; vertical list of 3 icon-chip + title + one-liner rows right
- `marketing-feature-grids/3-dark.html` [dark] — ~20w, colours: bg-gray-100 bg-gray-800 text-gray-200 text-gray-700…
  ↳ dark-scheme variant of `marketing-feature-grids/3.html` — same layout (see its descriptor)
- `marketing-feature-grids/3.html` — ~20w, colours: bg-gray-100 text-gray-700 text-gray-900
  ↳ "Simple grid" — headerless 4-across (2 on tablet) centered features: icon chip, title, 2-3 word description; no card borders
- `marketing-feature-grids/4-dark.html` [dark,LOREM] — ~88w, colours: bg-gray-100 bg-gray-800 border-gray-200 border-gray-700…
  ↳ dark-scheme variant of `marketing-feature-grids/4.html` — same layout (see its descriptor)
- `marketing-feature-grids/4.html` [LOREM] — ~88w, colours: bg-gray-100 border-gray-200 text-gray-700 text-gray-900
  ↳ "Grid with list items" — 2x2 grid of bordered horizontal cards: icon chip left, title + full paragraph right

### footers (24 files, 16 carry lorem ipsum)
- `marketing-footers/1-dark.html` [dark,LOREM] — ~76w, colours: bg-gray-900 bg-teal-500 bg-teal-600 border-gray-100…
  ↳ dark-scheme variant of `marketing-footers/1.html` — same layout (see its descriptor)
- `marketing-footers/1.html` [LOREM] — ~76w, colours: bg-teal-500 bg-teal-600 border-gray-100 text-gray-500…
  ↳ "Large with newsletter form" — mega-footer: logo left of a 5-column grid — newsletter heading + inline email signup spanning top, then Services / Company / Helpful Links / Legal / Downloads link columns, social icon row, bordered bottom bar (copyright + legal links)
- `marketing-footers/10-dark.html` [dark,LOREM] — ~67w, colours: bg-gray-900 bg-teal-400 bg-teal-500 border-gray-100…
  ↳ dark-scheme variant of `marketing-footers/10.html` — same layout (see its descriptor)
- `marketing-footers/10.html` [LOREM] — ~67w, colours: bg-teal-400 bg-teal-500 border-gray-100 text-gray-500…
  ↳ "Company info and links" — 3-col grid: brand block (logo, blurb, social) left; About / Services / Helpful Links / Contact Us columns right — contact column carries icon rows (email, phone, address) and a pulsing live-chat dot; bordered legal bar below
- `marketing-footers/11-dark.html` [dark] — ~6w, colours: bg-gray-50 bg-gray-900 text-gray-400 text-gray-500…
  ↳ dark-scheme variant of `marketing-footers/11.html` — same layout (see its descriptor)
- `marketing-footers/11.html` — ~6w, colours: bg-gray-50 text-gray-500 text-teal-600
  ↳ "Inline with logo and copyright" — one-row minimal footer: logo left, copyright right
- `marketing-footers/12-dark.html` [dark] — ~53w, colours: bg-gray-900 bg-indigo-600 bg-teal-400 bg-teal-500…
  ↳ dark-scheme variant of `marketing-footers/12.html` — same layout (see its descriptor)
- `marketing-footers/12.html` — ~53w, colours: bg-indigo-600 bg-teal-400 bg-teal-500 text-gray-500…
  ↳ "With call to action" — top strip with bold "Make Your Next Career Move!" + rounded-full arrow CTA button, then 4 link columns, social icon row, logo + copyright bottom row
- `marketing-footers/2-dark.html` [dark] — ~44w, colours: bg-gray-900 border-gray-100 border-gray-800 text-gray-200…
  ↳ dark-scheme variant of `marketing-footers/2.html` — same layout (see its descriptor)
- `marketing-footers/2.html` — ~44w, colours: border-gray-100 text-gray-500 text-gray-700 text-gray-900…
  ↳ "Simple stacked" — logo left / social icons right on the top row, hairline rule, then 4 link columns (Services / Company / Helpful Links / Legal), copyright line last
- `marketing-footers/3-dark.html` [dark,LOREM] — ~58w, colours: bg-gray-900 text-gray-200 text-gray-400 text-gray-500…
  ↳ dark-scheme variant of `marketing-footers/3.html` — same layout (see its descriptor)
- `marketing-footers/3.html` [LOREM] — ~58w, colours: text-gray-500 text-gray-700 text-gray-900 text-teal-600
  ↳ "Simple row" — 3-column grid: brand block (logo, blurb, social icons) left third, 4 link columns across the right two-thirds, copyright below
- `marketing-footers/4-dark.html` [dark,LOREM] — ~31w, colours: bg-gray-900 bg-indigo-600 border-gray-100 border-gray-800…
  ↳ dark-scheme variant of `marketing-footers/4.html` — same layout (see its descriptor)
- `marketing-footers/4.html` [LOREM] — ~31w, colours: bg-indigo-600 border-gray-100 border-indigo-600 text-gray-500…
  ↳ "Call to action with gradient" — CTA-first footer: big centered heading + copy + rounded-full Get Started button, then bordered bottom row with legal links left / social icons right
- `marketing-footers/5-dark.html` [dark] — ~49w, colours: bg-gray-900 border-gray-100 border-gray-800 text-gray-200…
  ↳ dark-scheme variant of `marketing-footers/5.html` — same layout (see its descriptor)
- `marketing-footers/5.html` — ~49w, colours: border-gray-100 text-gray-500 text-gray-700 text-gray-900
  ↳ "Split with company info, links and image" — 5-col split: full-height photo fills the left 2 columns; right side holds call-us phone block + opening hours + social, 2 link columns, and a bordered legal/copyright bar
- `marketing-footers/6-dark.html` [dark,LOREM] — ~68w, colours: bg-gray-900 bg-teal-500 bg-teal-600 border-gray-100…
  ↳ dark-scheme variant of `marketing-footers/6.html` — same layout (see its descriptor)
- `marketing-footers/6.html` [LOREM] — ~68w, colours: bg-teal-500 bg-teal-600 border-gray-100 text-gray-500…
  ↳ "Split with company info, links and call to action" — 2-col split with vertical rule: logo + 3 link columns + legal bar left; "Request a Demo" heading + inline email form right (order-last)
- `marketing-footers/7-dark.html` [dark,LOREM] — ~69w, colours: bg-blue-600 bg-blue-700 bg-gray-100 bg-gray-800…
  ↳ dark-scheme variant of `marketing-footers/7.html` — same layout (see its descriptor)
- `marketing-footers/7.html` [LOREM] — ~69w, colours: bg-blue-600 bg-blue-700 bg-gray-100 border-gray-100…
  ↳ "Newsletter form as priority" — centered pill email-capture (Subscribe button absolutely inset inside the rounded-full input) under a big headline, then blurb + social left / 3 centered link columns right, credit line at bottom
- `marketing-footers/8-dark.html` [dark,LOREM] — ~26w, colours: bg-gray-100 bg-gray-900 text-gray-400 text-gray-500…
  ↳ dark-scheme variant of `marketing-footers/8.html` — same layout (see its descriptor)
- `marketing-footers/8.html` [LOREM] — ~26w, colours: bg-gray-100 text-gray-500 text-gray-700 text-teal-600
  ↳ "Centered with branding" — fully centered stack: logo, short blurb, horizontal nav link row, social icon row — no columns, no bottom bar
- `marketing-footers/9-dark.html` [dark,LOREM] — ~28w, colours: bg-gray-100 bg-gray-600 bg-gray-700 bg-gray-900…
  ↳ dark-scheme variant of `marketing-footers/9.html` — same layout (see its descriptor)
- `marketing-footers/9.html` [LOREM] — ~28w, colours: bg-gray-100 bg-teal-500 bg-teal-600 text-gray-500…
  ↳ "Slim with branding and link top" — slim footer with a circular "Back to top" button pinned to the upper corner: logo + blurb left, nav link row right, right-aligned copyright

### headers (8 files)
- `marketing-headers/1-dark.html` [dark] — ~11w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-teal-500…
  ↳ dark-scheme variant of `marketing-headers/1.html` — same layout (see its descriptor)
- `marketing-headers/1.html` — ~11w, colours: bg-gray-100 bg-teal-600 bg-teal-700 text-gray-500…
  ↳ top nav bar (h-16): logo left, inline text links immediately after, solid Login + tinted Register buttons right, hamburger fallback on mobile
- `marketing-headers/2-dark.html` [dark] — ~11w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-teal-500…
  ↳ dark-scheme variant of `marketing-headers/2.html` — same layout (see its descriptor)
- `marketing-headers/2.html` — ~11w, colours: bg-gray-100 bg-teal-600 text-gray-500 text-gray-600…
  ↳ top nav bar: logo left, link row centered-right, Login/Register buttons far right, mobile hamburger
- `marketing-headers/3-dark.html` [dark] — ~11w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-teal-500…
  ↳ dark-scheme variant of `marketing-headers/3.html` — same layout (see its descriptor)
- `marketing-headers/3.html` — ~11w, colours: bg-gray-100 bg-teal-600 text-gray-500 text-gray-600…
  ↳ top nav bar: logo pushed far left (flex-1), links + Login/Register grouped together on the right, mobile hamburger
- `marketing-headers/4-dark.html` [dark] — ~19w, colours: bg-gray-100 bg-gray-50 bg-gray-800 bg-gray-900…
  ↳ dark-scheme variant of `marketing-headers/4.html` — same layout (see its descriptor)
- `marketing-headers/4.html` — ~19w, colours: bg-gray-100 bg-gray-50 bg-red-50 border-gray-100…
  ↳ top nav bar with account dropdown: logo left, links right, then circular avatar button opening a shadowed menu (My profile / Billing / Team settings + red Logout) instead of auth buttons

### logo-clouds (4 files, 2 carry lorem ipsum)
- `marketing-logo-clouds/1.html` — ~0w
  ↳ "Base" — bare 4-across (2 on mobile) logo grid, logos grayscale until hover
- `marketing-logo-clouds/2.html` [LOREM] — ~33w, colours: text-gray-700 text-gray-900
  ↳ "Base with title" — centered heading + copy above the 4-logo grayscale grid
- `marketing-logo-clouds/3.html` [LOREM] — ~33w, colours: bg-gray-100 text-gray-700 text-gray-900
  ↳ "Title left aligned" — left-aligned heading + copy; 4 logo cells as gray aspect-video tiles in a rounded grid
- `marketing-logo-clouds/4.html` — ~0w, colours: bg-gray-100
  ↳ "Grid" — headerless 8-logo wall (2x4 on desktop) of gray aspect-video tiles, grayscale-to-colour hover

### newsletter-signup (4 files, 4 carry lorem ipsum)
- `marketing-newsletter-signup/1-dark.html` [dark,LOREM] — ~28w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-newsletter-signup/1.html` — same layout (see its descriptor)
- `marketing-newsletter-signup/1.html` [LOREM] — ~28w, colours: bg-gray-100 bg-indigo-600 border-gray-300 border-indigo-600…
  ↳ "Simple signup" — gray band, left-aligned: heading + copy, then inline email input + solid Sign Up button (stacks on mobile)
- `marketing-newsletter-signup/2-dark.html` [dark,LOREM] — ~28w, colours: bg-gray-100 bg-gray-800 bg-gray-900 bg-indigo-600…
  ↳ dark-scheme variant of `marketing-newsletter-signup/2.html` — same layout (see its descriptor)
- `marketing-newsletter-signup/2.html` [LOREM] — ~28w, colours: bg-gray-100 bg-indigo-600 border-gray-300 border-indigo-600…
  ↳ "Simple signup centered" — same band with heading, copy and input row all centered

### polls (6 files, 4 carry lorem ipsum)
- `marketing-polls/1-dark.html` [dark,LOREM] — ~53w, colours: bg-gray-100 bg-gray-800 bg-gray-900 border-gray-300…
  ↳ dark-scheme variant of `marketing-polls/1.html` — same layout (see its descriptor)
- `marketing-polls/1.html` [LOREM] — ~53w, colours: bg-gray-100 border-gray-300 text-gray-700 text-gray-900
  ↳ "Single question poll" — question heading + copy, radio options rendered as full-width bordered bars with a live %-width result fill behind each label and the percentage figure to the right; end-date footnote
- `marketing-polls/2-dark.html` [dark,LOREM] — ~53w, colours: bg-gray-100 bg-gray-800 border-gray-300 border-gray-600…
  ↳ dark-scheme variant of `marketing-polls/2.html` — same layout (see its descriptor)
- `marketing-polls/2.html` [LOREM] — ~53w, colours: bg-gray-100 border-gray-300 text-gray-700 text-gray-900
  ↳ "Multiple choice survey" — identical result-bar layout with checkboxes (multi-select) instead of radios
- `marketing-polls/3-dark.html` [dark] — ~13w, colours: text-gray-900 text-yellow-500
  ↳ dark-scheme variant of `marketing-polls/3.html` — same layout (see its descriptor)
- `marketing-polls/3.html` — ~13w, colours: text-gray-900 text-yellow-500
  ↳ "Rating poll" — bare 5-star rating row: radio-backed stars that fill yellow on hover (and all stars before them), no other chrome

### pricing (2 files, 1 carry lorem ipsum)
- `marketing-pricing/1.html` — ~38w, colours: bg-indigo-600 bg-indigo-700 border-gray-200 border-indigo-600…
  ↳ 2-tier comparison (max-w-3xl): side-by-side rounded-2xl cards, centered tier name + large price, checkmark feature list, pill CTA; highlighted tier gets indigo border+ring and sits last (right) on desktop
- `marketing-pricing/2.html` [LOREM] — ~90w, colours: bg-indigo-600 border-gray-200 border-indigo-600 text-gray-700…
  ↳ 3-tier row (md:grid-cols-3): bordered rounded-2xl cards split by a horizontal divider — tier name, blurb, price, solid CTA on top; "What's included:" checkmark list below

### product-cards (8 files, 3 carry lorem ipsum)
- `marketing-product-cards/1.html` — ~5w, colours: text-gray-700 text-gray-900
  ↳ minimal product tile: very tall image that cross-fades to a second photo on hover, then title + price stacked below
- `marketing-product-cards/2.html` — ~7w, colours: text-gray-700 text-gray-900
  ↳ hover-swap image tile with meta row: title, then price left / "6 Colors" variant count right
- `marketing-product-cards/3.html` [LOREM] — ~18w, colours: text-gray-500 text-gray-900
  ↳ product tile: tall image, then title + tiny description left, price right
- `marketing-product-cards/4.html` — ~3w, colours: text-gray-700 text-gray-900
  ↳ smallest tile: square rounded image, title, price — nothing else
- `marketing-product-cards/5.html` — ~12w, colours: text-gray-500 text-gray-900
  ↳ variant-picker tile: tall image, colour-swatch selector dots (checkbox-backed circles), then title left / price right
- `marketing-product-cards/6.html` — ~8w, colours: bg-yellow-400 border-gray-100 text-gray-700 text-gray-900
  ↳ boxed commerce card: wishlist heart button top-right over an image that zooms on hover, yellow "New" tag, title, price, full-width yellow Add to Cart button
- `marketing-product-cards/7.html` [LOREM] — ~26w, colours: bg-indigo-900 bg-rose-600 border-gray-100 border-indigo-900…
  ↳ promo card: rose "Save 10%" ribbon notched into the top-right corner of an asymmetric-rounded card, photo, centered product name + copy + uppercase indigo Buy Now button
- `marketing-product-cards/8.html` [LOREM] — ~30w, colours: bg-gray-100 bg-gray-900 border-gray-100 text-gray-600…
  ↳ sale card: wishlist heart + zoom-on-hover image, price with struck-through compare-at, title, clamped description, twin Add to Cart (gray) / Buy Now (black) buttons

### product-collections (4 files, 4 carry lorem ipsum)
- `marketing-product-collections/1.html` [LOREM] — ~46w, colours: text-gray-500 text-gray-700 text-gray-900
  ↳ "Base" — left-aligned heading + blurb over a 4-across product grid (images zoom on hover, tiny title + price below each)
- `marketing-product-collections/2.html` [LOREM] — ~46w, colours: text-gray-500 text-gray-700 text-gray-900
  ↳ "Base with centered title" — identical grid with the heading + blurb centered
- `marketing-product-collections/3.html` [LOREM] — ~83w, colours: border-gray-200 border-gray-300 border-gray-400 border-gray-600…
  ↳ "Filtering (Dropdown)" — adds a toolbar row above the grid: Availability + Price dropdown <details> filter panels and a Sort By select (collapses to a "Filters & Sorting" button on mobile)
- `marketing-product-collections/4.html` [LOREM] — ~89w, colours: border-gray-200 border-gray-300 border-gray-400 border-gray-600…
  ↳ "Filtering (Side)" — sidebar layout (lg:grid-cols-4): left rail with Sort select + stacked accordion filters (Availability / Price / Colors), 3-column product grid right

### sections (4 files, 4 carry lorem ipsum)
- `marketing-sections/1.html` [LOREM] — ~28w, colours: text-gray-700 text-gray-900
  ↳ "1/2 grid" — two equal columns: heading + paragraph left, rounded image right
- `marketing-sections/2.html` [LOREM] — ~28w, colours: text-gray-700 text-gray-900
  ↳ "2/3 grid" — 4-col grid: narrow text column (1/4) left, wide rounded image (3/4) right
- `marketing-sections/3.html` [LOREM] — ~28w, colours: text-gray-700 text-gray-900
  ↳ "3/2 grid" — mirror: wide rounded image (3/4) left, narrow text column right
- `marketing-sections/4.html` [LOREM] — ~28w, colours: text-gray-700 text-gray-900
  ↳ "vertical split" — stacked: heading + paragraph, then full-width rounded image below

### stats (6 files, 6 carry lorem ipsum)
- `marketing-stats/1-dark.html` [dark,LOREM] — ~35w, colours: border-gray-100 border-gray-800 text-blue-600 text-gray-400…
  ↳ dark-scheme variant of `marketing-stats/1.html` — same layout (see its descriptor)
- `marketing-stats/1.html` [LOREM] — ~35w, colours: border-gray-100 text-blue-600 text-gray-500 text-gray-900
  ↳ centered heading + copy over a 4-up (2 on tablet) grid of bordered rounded stat cards: huge accent-colour figure above a smaller label (dt is order-last)
- `marketing-stats/2-dark.html` [dark,LOREM] — ~35w, colours: text-blue-600 text-gray-400 text-gray-500 text-gray-900
  ↳ dark-scheme variant of `marketing-stats/2.html` — same layout (see its descriptor)
- `marketing-stats/2.html` [LOREM] — ~35w, colours: text-blue-600 text-gray-500 text-gray-900
  ↳ same stat band with flat cells separated by hairline dividers (divide-y / sm:divide-x) instead of card borders
- `marketing-stats/3-dark.html` [dark,LOREM] — ~35w, colours: bg-blue-50 bg-blue-700 text-blue-50 text-blue-600…
  ↳ dark-scheme variant of `marketing-stats/3.html` — same layout (see its descriptor)
- `marketing-stats/3.html` [LOREM] — ~35w, colours: bg-blue-50 text-blue-600 text-gray-500 text-gray-900
  ↳ same stat band with soft tinted rounded cells (bg-blue-50) instead of borders

### team-sections (6 files, 2 carry lorem ipsum)
- `marketing-team-sections/1-dark.html` [dark] — ~15w, colours: text-gray-200 text-gray-700 text-gray-900
  ↳ dark-scheme variant of `marketing-team-sections/1.html` — same layout (see its descriptor)
- `marketing-team-sections/1.html` — ~15w, colours: text-gray-700 text-gray-900
  ↳ "Base" — 3-column team grid: landscape (aspect-video) rounded photo, name + role left with a LinkedIn icon link on the right
- `marketing-team-sections/2-dark.html` [dark,LOREM] — ~60w, colours: text-gray-200 text-gray-700 text-gray-900
  ↳ dark-scheme variant of `marketing-team-sections/2.html` — same layout (see its descriptor)
- `marketing-team-sections/2.html` [LOREM] — ~60w, colours: text-gray-700 text-gray-900
  ↳ "Base with description" — same 3-up grid plus a short bio paragraph under each member
- `marketing-team-sections/3-dark.html` [dark] — ~24w, colours: text-gray-200 text-gray-700 text-gray-900
  ↳ dark-scheme variant of `marketing-team-sections/3.html` — same layout (see its descriptor)
- `marketing-team-sections/3.html` — ~24w, colours: text-gray-700 text-gray-900
  ↳ "Small" — compact 6-across (2 on mobile) grid: circular headshots with centered name + role, no links

