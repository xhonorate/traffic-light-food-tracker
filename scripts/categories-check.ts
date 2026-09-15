// Checks for the rule editor's category suggestions. Run with
// `npm run test:categories`. Pure, no network.
//
// The USDA tag list in src/lib/categories.ts is copied by hand from the
// server-side mapping, which lives in a separate package; this fails the
// moment the two drift apart. It also flags any category in the default rules
// that no known tag contains, since such a condition can never match.
import { readFileSync } from "node:fs";
import { USDA_CATEGORY_TAGS, suggestCategories } from "../src/lib/categories";
import { DEFAULT_RULES } from "../src/lib/defaultRules";
import { OFF_CATEGORIES } from "../src/lib/offCategories";

const failures: string[] = [];
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) failures.push(`  ${label}: got ${a}, expected ${e}`);
}

/** Every `"en:..."` literal inside one function of a source file. */
function tagsIn(file: string, fn: string): string[] {
  const src = readFileSync(file, "utf8");
  const start = src.indexOf(`function ${fn}`);
  if (start < 0) throw new Error(`${fn} not found in ${file}`);
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end);
  return [...body.matchAll(/"en:([a-z-]+)"/g)].map((m) => m[1]);
}

const server = new Set([
  ...tagsIn("functions/src/usda.ts", "fdcCatsToTags"),
  ...tagsIn("src/lib/foodApi.ts", "customFood"),
]);
check("USDA tag list matches the server mapping",
  [...USDA_CATEGORY_TAGS].sort(), [...server].sort());

check("OFF list is populated", OFF_CATEGORIES.length > 5000, true);
check("OFF list has no duplicates", new Set(OFF_CATEGORIES).size, OFF_CATEGORIES.length);

// Suggestion behaviour: USDA tags only.
const s = (q: string, exclude: string[] = []) => suggestCategories(q, exclude);
check("empty query offers the USDA tags", s(""), [...USDA_CATEGORY_TAGS]);
check("matches within USDA tags", s("snack"), ["salty-snacks", "sugary-snacks"]);
check("Open Food Facts tags are not offered", s("chocolate"), []);
check("already-chosen tags are not offered", s("snack", ["salty-snacks"]), ["sugary-snacks"]);
check("spaces read as dashes", s("breakfast cereals")[0], "breakfast-cereals");
check("en: prefix is ignored", s("en:yogurts")[0], "yogurts");

// Default-rule categories that nothing can match are reported, not failed:
// they are protocol data an admin owns, not a code defect.
const known = [...USDA_CATEGORY_TAGS, ...OFF_CATEGORIES];
const dead = new Set<string>();
for (const rule of DEFAULT_RULES) {
  for (const c of [...rule.all, ...(rule.except ?? [])]) {
    if (c.kind !== "category") continue;
    for (const v of c.values) if (!known.some((t) => t.includes(v))) dead.add(v);
  }
}

if (failures.length) {
  console.log(`Categories: ${failures.length} check(s) FAILED`);
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log(`Categories: all ${checks} checks pass`);
if (dead.size) {
  console.log(`  note: no known tag contains these default-rule categories: ${[...dead].join(", ")}`);
}
