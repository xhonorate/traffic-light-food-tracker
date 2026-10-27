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
   - **No verdict** (a combination food such as pizza, a food whose group
     cannot be worked out, or one with no calorie data) → their choice is
     logged unchallenged. For a combination food the picker shows the guide's
     rule as a hint: red if it holds a full serving of a red food.
4. Whatever they chose is what gets logged. A disagreement they stood by is
   flagged `overridden`, so coaches can see where a family's intuition and the
   protocol diverge — which is teaching signal, not an error.

**No color.** Water, plain tea and coffee, and seasonings have no color in the
guide. The family is not asked; the entry is logged as `none`, its calories
count, and it counts toward no red, yellow or green total and no goal.

Both the color the family chose and the color the engine computed are stored
on every entry (`autoColor` is `null` where the guide gave no verdict), along
with the food group and the nutrition at the moment it was logged.
**Changing the rules never re-scores history.**

---

## The rule engine

The rules are Epstein's _Food & Activity Reference Guide_ (2012), as the
client's traffic-light-food-logger prototype implements it and their "Traffic
light logic" slides set out. Every food goes through three questions:

1. **Which food group?** One of 17, worked out from the name, USDA's category
   and the food's [categories](#food-categories).
2. **How many calories in the guide's serving for that group?** Often not the
   package's: cheese is judged at 1 oz (28 g) whatever the label says.
3. **Which side of the group's line?** Only vegetables have a green line.

| Group                            | Serving used | Green  | Yellow | Red                         |
| -------------------------------- | ------------ | ------ | ------ | --------------------------- |
| Vegetables                       | 65 g         | ≤ 30   | ≤ 45   | above 45                    |
| Starchy vegetables               | 80 g         |        | ≤ 120  | above 120                   |
| Fruit                            | 90 g         |        | ≤ 90   | above 90                    |
| Fruit juice & dried fruit        | 240 g        |        |        | always                      |
| Grains                           | 28 g         |        | ≤ 120  | above 120                   |
| Cold cereal                      | 30 g         |        | ≤ 120  | above 120, or > 25% sugar   |
| Cheese                           | 28 g         |        | ≤ 83   | above 83                    |
| Milk, yogurt & other dairy       | 245 g        |        | ≤ 135  | above 135                   |
| Meat & seafood                   | 85 g         |        | ≤ 158  | above 158                   |
| Eggs, beans & meat substitutes   | 90 g         |        | ≤ 120  | above 120                   |
| Nuts & seeds                     | 28 g         |        | ≤ 68   | above 68                    |
| Fats, oils, sweets & others      | 15 g         |        |        | always                      |
| Soup: broth-based & chowder      | 245 g        |        | ≤ 186  | above 186                   |
| Soup: chili, bean/lentil & gumbo | 245 g        |        | ≤ 224  | above 224                   |
| Condiments, dressings & ingredients | 15 g      |        | ≤ 23   | above 23                    |
| Combination food                 | —            | no verdict: the family decides |  |                    |
| Water, plain tea/coffee, seasonings | —         | no color |      |                             |

The table is **data** in Firestore (`config/rules`), and every serving size and
line is editable in the app. Some foods get the guide's own serving instead of
the group's: a yogurt cup, a patty, a packet of instant
oatmeal. Diet soda and anything whose ingredients name an artificial sweetener
are in the always-red group (FRG p.2). Calories are rounded to whole numbers
before they are compared, as labels are.

Group detection ([src/lib/foodGroups.ts](src/lib/foodGroups.ts)) is the
prototype's `detectGroup()`, ported line for line with only type annotations
added; change it only alongside theirs. The engine itself
([src/lib/rules.ts](src/lib/rules.ts)) follows the prototype's `classify()`,
except that where the prototype asks the clinician to decide or falls back to
yellow, the app gives no verdict. The verdict is only ever used to question
the family's choice, and a guess is no grounds to question it.

Combination foods are not taken apart. The prototype estimates each
ingredient's share from the order of the label's ingredient list and adds up
the red servings; that is left out for now, so the family decides.

`npm run test:rules` runs real-shaped USDA, Open Food Facts and hand-entered
records through the server's mapping and the engine, and pins the results the
slides give (cheddar 113 cal red, carrots 27 cal green) plus a food for every
row of the table.

A rule set saved before the table existed (the old list of nutrient rules)
reads as the defaults until an admin saves or resets.

### Food categories

The tags, and the mapping that assigns them, are the client's
`fdcCatsToTags()` from their traffic-light-food-logger prototype, ported line
for line into [src/lib/foodTags.ts](src/lib/foodTags.ts). They are one of the
inputs to group detection. A food can carry several (skim milk is
`beverages`, `milks` and `skimmed-milks`) or none (chicken breast).

| Food added by            | How it gets its tags                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| Name search (USDA)       | `fdcCatsToTags`, from USDA's food category and the description                         |
| Barcode, USDA match      | the same                                                                               |
| Barcode, Open Food Facts | `offCatsToTags`: each OFF category gets what the matching USDA category would get, so chocolate gets what USDA's "Sweets" gets |
| Typed in by hand         | `fdcCatsToTags` on the name, with the family's food/drink choice standing in for the category |

Cloud Functions are a separate package, so `functions/src/foodTags.ts` is a
verbatim copy; `npm run test:categories` fails if the two differ, or if any
pinned USDA or Open Food Facts example is sorted differently.

### Editing rules safely

**Admin → Rules** shows one row per food group: the guide's serving in words,
the grams used, and the green and yellow lines (and cold cereal's sugar
share). A row with a missing line cannot be saved. **Test a food** runs your
_unsaved_ draft against a food and shows each step — group, serving, calories,
line, verdict — and lets you force a group to see how it would score there.
Tuning figures blind is how a protocol quietly breaks; the tester is the
safety net.

---

## Data model

```
config/rules                              the rule set (admin-editable)
config/app                                food guide URL, program name
users/{uid}                               coaches and admins, with syncId
codes/{CODE}          → { familyId }      never readable by any client
syncIds/{syncId}      → { kind, … }       Sync ID → coach or member; server-only
families/{familyId}
  ├── code, coachId, label, active, lastActiveAt
  ├── members.parent  { name, goals, syncId }
  ├── members.child   { name, goals, syncId }
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

`color` can be `none` (water, plain tea). `auto_color` is blank where the guide
gave no verdict (combination foods). The summary's counts leave `none` out.

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

---

## External platform (3C) integration

Coaches and family members are created on the external platform first. Each
carries a **Sync ID**, and the Sync ID is the only field that links a person
across the two systems. Email and names are never used for matching.

- Every coach and every family member (parent and child separately) has one.
  It is required when creating either, in the app or through the API.
  Administrators may have one but do not need it.
- Sync IDs are unique across coaches and members. The `syncIds` collection
  enforces this, and only Cloud Functions write to it.
- Admins can link an older record, or correct a mistyped ID, from **Coaches →
  Set Sync ID** or **Families → Edit**. Coaches can see their families' Sync
  IDs but cannot change them.
- Deleting a coach or family frees their Sync IDs.

### API

Base URL: `https://<project>.web.app/api`. Every request needs the
`X-API-Key` header, which must match the `SYNC_API_KEY` secret (each Firebase
project, QA or prod, has its own). Every response includes `errorMessage`,
which is `null` on success and a sentence on failure. The HTTP status code is
set to match: 400 bad input, 401 bad key, 404 unknown Sync ID, 409 conflict.

| Route | Does |
|---|---|
| `GET /api/data` | Daily totals for every family member that has a Sync ID |
| `GET /api/data/{syncId}` | Daily totals for one family member |
| `POST /api/coaches` | Create a coach, or update the one with this Sync ID |
| `POST /api/families` | Create a family, or update the one both Sync IDs belong to |
| `DELETE /api/coaches/{syncId}` | Delete a coach; their families are kept, unassigned |
| `DELETE /api/families/{syncId}` | Delete the **whole** family either member's Sync ID belongs to |

The full contract is in [openapi.yaml](openapi.yaml) (OpenAPI 3.0). Paste it
into <https://editor.swagger.io> to browse it or generate a client.

The data routes accept optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` bounds. Each
day lists `green` and `red` as **servings**, the same way goals are scored,
so fractional values like `2.5` are possible. `calories` is the rounded total,
with unknown calories counted as 0. Days with nothing logged are left out, and
the newest day comes first.

```json
{ "errorMessage": null,
  "data": [ { "syncId": "1234abcd",
              "days": [ { "isoDate": "2026-09-24 00:00:00", "green": 4, "red": 5, "calories": 2300 } ] } ] }
```

`POST /api/coaches`: `{ "syncId", "name", "email", "disabled"?, "sendInvite"? }`.
A new coach gets the same password-setup email that the Coaches screen sends
(pass `"sendInvite": false` to skip it). For an existing coach,
`"sendInvite": true` sends the email again. `inviteSent` in the response says
whether it went out. This route
never creates or edits administrators. If a coach or admin who already has
dashboard access uses the email but is not linked to this Sync ID, the request
is rejected, not merged. A login with no dashboard access, such as someone who
tried "Sign in with Google" before being added, does not block creation: it is
taken over and becomes the coach's login. If that login has a password the
owner never verified, the password is replaced, because anyone can register an
unverified address. All of its existing sessions are signed out. The invite
email then lets the real owner set their own password.

`POST /api/families`:
`{ "label", "coachSyncId"?, "active"?, "parent": { "syncId", "name", "goals"? }, "child": { … } }`.
If both Sync IDs are new, a family is created. If both already belong to the
same family, as parent and child, that family is updated. Any other
combination is a 409. The response includes `accessCode`, the code the
family signs in with. Goals are changed only when they are sent.

```bash
curl -H "X-API-Key: $KEY" https://traffic-light-food-tracker.web.app/api/data/1234abcd
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"label":"Smith family","coachSyncId":"c-01","parent":{"syncId":"p-01","name":"J.S."},"child":{"syncId":"k-01","name":"A.S."}}' \
  https://traffic-light-food-tracker.web.app/api/families
```

---

## Project layout

```
src/
  lib/
    types.ts          domain types, including the rules table
    foodTags.ts       food categories (the client's fdcCatsToTags)
    foodGroups.ts     the guide's 17 food groups (the client's detectGroup)
    rules.ts          the rule engine
    defaultRules.ts   the guide's rules table
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
npm test                 # the suites below
npm run test:rules       # the engine against the client's worked examples
npm run test:goals       # daily-goal evaluation semantics
npm run test:rank        # USDA search-result ranking
npm run test:categories  # food categories and the rule editor's list
npm run test:barcode     # barcode decoding from camera-like frames
npm run deploy           # build and deploy everything
npm run deploy:hosting   # site only
npm run deploy:rules     # Firestore rules and indexes only
npm run deploy:functions # Cloud Functions only
```
