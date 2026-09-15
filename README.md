# Traffic Light Food Tracker

A responsive web app for traffic-light (Epstein "stoplight") food logging, built
for a coached family program. Families log what they eat and decide for
themselves whether each food is green, yellow or red; the app agrees or gently
pushes back, but never overrules them.

Phone-first, works equally well on a laptop. React + TypeScript + Tailwind on
Firebase.

**Live:** <https://traffic-light-food-tracker.web.app>
**Console:** [Firebase](https://console.firebase.google.com/project/traffic-light-food-tracker)

The project is created and hosted, but a few steps still need a human —
**see [SETUP.md](SETUP.md) for exactly what is left.**

---

## The three roles

|                      | Family           | Coach                       | Admin                       |
| -------------------- | ---------------- | --------------------------- | --------------------------- |
| Sign in with         | 6-character code | email + password, or Google | email + password, or Google |
| Log and edit foods   | ✅               | via "open as"               | via "open as"               |
| Manage families      |                  | ✅ their own                | ✅ all                      |
| Set daily goals      |                  | ✅                          | ✅                          |
| Manage coaches       |                  |                             | ✅                          |
| Edit the color rules |                  |                             | ✅                          |
| Export CSV           |                  | ✅ their own                | ✅ all                      |
| Overview dashboard   |                  | ✅ their families           | ✅ program-wide             |

A family account holds exactly one parent and one child with **separate logs**.
After entering the code, whoever is at the phone picks which of the two they
are; either can see and edit the other's log, which is intentional.

**"Open as"** lets an admin step into a coach's account, and either an admin or
the owning coach into a family's, to see exactly what they see. A persistent
amber banner makes the borrowed session obvious and offers one-click return.

---

## How a food gets its color

1. The family finds the food — search, barcode scan, a quick-add chip, or typed
   in by hand.
2. They choose the portion and **commit to a color first**. Nothing on screen
   hints at the "right" answer.
3. The rule engine scores the same food.
   - **Agreement** → _"Good job — that matches our guide!"_
   - **Disagreement** → _"Are you sure?"_, with the specific reasons and a link
     to the program's food guide. They may keep their answer or change it.
4. Whatever they chose is what gets logged. A disagreement they stood by is
   flagged `overridden`, so coaches can see where a family's intuition and the
   protocol diverge — which is teaching signal, not an error.

Both the color the family chose and the color the engine computed are stored
on every entry, along with the nutrition at the moment it was logged.
**Changing the rules never re-scores history.**

---

## The rule engine

The prototype's classifier was hardcoded JavaScript. Here the same logic is
**data** — an ordered list of rules in Firestore that an admin edits in the app,
no redeploy involved.

A rule fires when every condition in `all` holds and its `except` clause does
not. Rules are evaluated in priority order; **the first match decides the
color**, and later matches of that same color are kept as supporting reasons.

```jsonc
{
  "id": "red-high-fat-100",
  "priority": 140,
  "scope": "food",
  "color": "red",
  "label": "High total fat (per 100g)",
  "reason": "High fat: {value}g per 100g (≥ {limit})",
  "all": [
    {
      "kind": "numeric",
      "field": "fat_100",
      "op": ">=",
      "value": 17,
      "whenMissing": "skip",
    },
  ],
  // ...unless it is unsweetened nuts, which the protocol spares
  "except": [
    {
      "kind": "category",
      "op": "includesAny",
      "values": ["nuts", "nut-butters", "peanut-butter", "seeds"],
    },
    {
      "kind": "numeric",
      "field": "added_100",
      "op": "<",
      "value": 5,
      "whenMissing": "pass",
    },
  ],
}
```

Three condition kinds cover everything the protocol needed:

- **numeric** — compare a nutrient, per 100g/ml or per serving. `whenMissing`
  decides what an _unknown_ value means: skip the rule, count it as zero, or
  pass anyway. This distinction matters: unknown added sugar is not zero
  added sugar.
- **category** — match Open Food Facts style tags as substrings, so `fruits`
  matches `en:fruits`. The editor suggests only the 18 tags USDA name-search
  results are mapped to (kept in step with the server by
  `npm run test:categories`). Any other tag can still be typed, but only
  matches barcode scans, which carry Open Food Facts' ~9,000 categories. That
  list is kept in `src/lib/offCategories.ts` so the check can flag rule tags
  nothing would match; refresh it with `npm run categories:build`.
- **missing** — "the per-100g figure is unknown", which is how the per-serving
  fallback rules are expressed.

The `except` clause exists so carve-outs read the way a dietitian says them —
_"high fat is red, unless it's nuts"_ — instead of forcing every exemption to be
duplicated across near-identical rules.

### Parity with the prototype

The 22 seeded rules reproduce the original `classify()` exactly. This was
verified against the prototype's own function across 31 foods, including every
awkward path: sweetened vs unsweetened nut butter, dried vs fresh fruit, yogurt
filed under "desserts", protein-spared calorie density, diet soda, and foods
with no per-100g data at all. **31/31 agree.**

That check is kept as a regression test — run `npm run test:rules` after any
change to `defaultRules.ts` or the engine. It compares against a verbatim copy
of the prototype's original function in
[scripts/rule-parity.ts](scripts/rule-parity.ts).

### Editing rules safely

**Admin → Rules** gives you add, delete, reorder, enable/disable, and full
condition editing, plus a **Test a food** panel that runs your _unsaved_ draft
against a food and shows which rules fire, which one decides, and exactly what
values the engine is reading. Tuning thresholds blind is how a protocol quietly
breaks; the tester is the safety net.

---

## Data model

```
config/rules                              the rule set (admin-editable)
config/app                                food guide URL, program name
users/{uid}                               coaches and admins
codes/{CODE}          → { familyId }      never readable by any client
families/{familyId}
  ├── code, coachId, label, active, lastActiveAt
  ├── members.parent  { name, goals }
  ├── members.child   { name, goals }
  ├── entries/{id}                        one logged food, with its meal
  └── quickFoods/{id}                     frequently used foods
```

A "week" is the **rolling 7 days ending on the selected date**, matching the
seven bars in the graph, per the spec.

### Daily goals

A coach sets three targets per person — separately for the parent and the
child:

| Goal              | Direction                      |
| ----------------- | ------------------------------ |
| Green foods a day | **at least** this many         |
| Red foods a day   | **at most** this many          |
| Calories a day    | **within 150** of the target   |

Calories are a band, not a ceiling: too few misses the goal just as too many
does, and a miss either side is red, never amber.

|        | Calorie target                  | Green band  |
| ------ | ------------------------------- | ----------- |
| Parent | 1650 by default, coach-editable | target ±150 |
| Child  | 1350, **fixed by the program**  | 1200–1500   |

The child's figure is enforced in `resolveGoals()`, so whatever an older family
record stores is ignored, and the coach's calorie box is disabled for the child.

The family dashboard and the coach's family view both show, per goal, how many
of the last 7 days it was met, with a seven-cell strip showing _which_ days.

Two rules are worth knowing, both enforced in [src/lib/goals.ts](src/lib/goals.ts)
and pinned by `npm run test:goals`:

- **A day with nothing logged never counts as met.** The red goal is a
  ceiling, so an empty day would satisfy it automatically — which would score
  not using the app above using it honestly. Unlogged days render as a dash,
  not a cross.
- **A day whose foods have unknown calories fails the calorie goal**, rather
  than passing a band it was never measured against.

Goals replaced the original weekly red-food budget. Families created before
the change are read through `resolveGoals()`, which spreads their old weekly
figure across the week rather than discarding it, so nothing breaks and no
coach has to re-enter targets.

---

## Security

Roles live in **custom claims** minted by Cloud Functions, never in a
client-writable document, so a client cannot promote itself.

- The `codes` collection is unreadable by every client. A readable code list
  would let one family enumerate every other family's login. The only way to
  test a code is `redeemFamilyCode`, which returns an identical error for a
  revoked code and a code that never existed.
- Creating, deleting or re-keying accounts is denied in the rules outright and
  lives only in Cloud Functions, so the Auth record and Firestore document
  cannot drift apart.
- A coach reaches only families whose `coachId` matches their uid; the rules
  enforce this on both reads and writes.
- A family may write only its own logs, and may only touch `lastActiveAt` on its
  own family document.
- The USDA API key stays server-side in a Cloud Functions secret. A key in the
  browser bundle would be scraped and its quota burned.
- `claimFirstAdmin` refuses once any admin exists, so the bootstrap cannot be
  replayed to escalate.
- **Every role is signed out after 10 minutes without interaction**, with a
  one-minute warning first. The last-activity time is kept in localStorage, so
  a session Firebase restores after the page was closed is ended too, and
  activity in one tab keeps the others alive. See
  [src/lib/idle.ts](src/lib/idle.ts).

Note that a six-character code is a deliberate trade-off: low friction for
children, ~887 million combinations, no password to lose. It suits a small
coached program with non-sensitive data. If the data ever becomes clinical,
add a second factor.

---

## Accessibility

The whole app means things with color, so color is never the only channel.

Every red/yellow/green mark carries a **distinct shape** — circle, triangle,
hexagon — and the written word wherever there is room. The palette was picked
with the `dataviz` six-check validator rather than by eye:

|       | Green     | Yellow    | Red       |
| ----- | --------- | --------- | --------- |
| Light | `#047857` | `#d97706` | `#be123c` |
| Dark  | `#059669` | `#d97706` | `#e11d48` |

Light mode passes all five checks. Dark mode's closest pair sits at ΔE 7.9 under
protanopia, inside the 6–8 floor band that is permissible **only** alongside
secondary encoding — which is exactly what the shapes and labels provide.

Also: charts ship a table view, the log is keyboard navigable, dark mode is a
selected palette rather than an inverted one, and `prefers-reduced-motion` is
honoured.

---

## Export

**Coach → Export** and **Admin → Export** produce CSVs over any date range.

The **daily summary** uses exactly the columns the specification asked for:

```
Family code, User type, Date, Kcal total, #Red, #Yellow, #Green
```

The **detailed** export adds one row per logged food, in the same shape the
original traffic-light logger produced so files from either tool feed the same
analysis:

```
date, time, client, food, brand, portion, color, auto_color, overridden,
kcal, fat_g, sugars_g, protein_g
```

Two notes on that shape, both consequences of matching the original format:

- `client` carries **both** the family and the person, as `CODE · Name`. The
  original was single-client and has no family column; folding both into one
  field keeps a multi-family export unambiguous without adding columns the
  downstream format does not expect.
- It omits saturated fat, added sugar, serving size, source and barcode, which
  the app does store. Use the summary export, or widen `ENTRY_HEADERS` in
  [src/lib/csv.ts](src/lib/csv.ts), if you need them.

Unknown nutrients are written as empty cells rather than `0`, so "not measured"
never reads as "measured zero".

Files carry a UTF-8 BOM so Excel opens them correctly on Windows.

### A note on the USDA API

Food search uses the **POST** form of USDA FoodData Central, not the documented
GET form, and this is deliberate.

The GET form takes `dataType` as a comma-joined list, and two of its values
contain spaces and parentheses -- `SR Legacy` and `Survey (FNDDS)`. USDA sits
behind a load balancer whose nodes disagree about that: measured over 20
identical requests, the same query succeeded 7 times and was rejected 13 times
with a bare nginx `400 Bad Request` HTML page, before the API ever saw it.
That is what made food search fail intermittently and appear to fix itself when
the user typed one more letter.

Sending the identical filter as a JSON array in a POST body sidesteps the query
string and was clean across 50 trials. `fetchJson` additionally retries once
when an upstream answers HTML instead of JSON, since that is unambiguous
evidence of a gateway that never reached the application.

### Ranking search results

USDA's own relevance order is wrong for this app in two specific ways, so
`searchFoods` re-ranks every hit itself (`rankFdcHits` in
[functions/src/usda.ts](functions/src/usda.ts), pinned by `npm run test:rank`):

- **Generic reference rows outrank real products.** `Survey (FNDDS)` and
  `SR Legacy` entries describe a nutrient profile, not a package; their
  "serving" is a lab quantity like a 250 g cup. A family searching for a snack
  wants the box. Re-ranking sorts branded ahead of Foundation ahead of the two
  reference sets — as a tie-breaker, not a filter, so "Broccoli, raw" is still
  reachable.
- **A repeated word counts twice.** For `wheat thins`, USDA ranks
  "Roll, wheat or cracked wheat" (two "wheat"s, no "thins") above the actual
  product. Re-ranking scores a contiguous phrase match first, then all the
  query words present, then how many matched, and only then data type.

The word matching folds simple plurals (`apple` finds "Apples, raw"), but a
multi-word query keeps the un-stemmed phrase as a lower tie-breaker so
"Wheat Thins" still beats "Wheat Thin Sliced Bread".

Search also runs in two passes. A multi-word query is sent first as a quoted
phrase, so the exact product is in the candidate pool even when USDA's scoring
would bury it past the page limit; the loose word search runs only if that
returns less than a full page, or for a single-word query.

### Barcode scanning

The scanner offers three routes, all equal on screen: a live camera scan that
reads on its own, **Take a photo** (the phone's own camera app, which focuses
close up far better than a browser preview — the dependable route on iPhones),
and typing the number.

Decoding uses the browser's built-in `BarcodeDetector` where it can read
EAN-13 (Android Chrome), and zxing-cpp compiled to WebAssembly everywhere else.
The WASM file is served from this site, not a CDN. Only EAN/UPC are read.
`npm run test:barcode` renders real EAN/UPC symbols into noisy, soft-focus,
tilted 1280×720 frames and checks the WASM decoder reads each one.

### Programmatic export

For a scheduled feed into another system rather than a manual download, add a
Cloud Function that reads the same collections and serves them over HTTPS —
`summarise()` in [src/lib/csv.ts](src/lib/csv.ts) already produces the exact
row shape, and `fetchEntriesRange()` in [src/lib/data.ts](src/lib/data.ts) does
the fetching. Authenticate it with a service account rather than a user session.

---

## Project layout

```
src/
  lib/
    types.ts          domain types, including the rule schema
    rules.ts          the rule engine
    defaultRules.ts   22 rules ported from the prototype
    data.ts           all Firestore access
    auth.tsx          auth, roles, and "open as"
    csv.ts            export
    foodApi.ts        food lookup client
  components/         UI primitives, traffic-light marks, chart, add-food flow
  pages/
    family/           member picker and the logger
    coach/            family list and detail
    admin/            overview, coaches, rule editor, settings
functions/src/        Cloud Functions
firestore.rules       access control
```

## Commands

```bash
npm run dev              # dev server
npm run build            # typecheck + production build
npm run typecheck        # types only
npm test                 # the five suites below
npm run test:rules       # rule-engine parity against the prototype
npm run test:goals       # daily-goal evaluation semantics
npm run test:rank        # USDA search-result ranking
npm run test:categories  # rule-editor category suggestions
npm run test:barcode     # barcode decoding from camera-like frames
npm run categories:build # refresh the Open Food Facts category list
npm run deploy           # build and deploy everything
npm run deploy:hosting   # site only
npm run deploy:rules     # Firestore rules and indexes only
npm run deploy:functions # Cloud Functions only
```
