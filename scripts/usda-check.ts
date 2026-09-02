// Runs the real USDA normaliser against live FoodData Central responses and
// reports how often a food ends up with a genuine household serving rather
// than a bare 100g fallback.
//
//   USDA_API_KEY=... npm run test:usda
//
// Needs network and a key, so it is not part of `npm test`.
import { foodFromFDC, portionFromDetail, withPortion } from "../functions/src/usda";

const key = process.env.USDA_API_KEY;
if (!key) {
  console.error("Set USDA_API_KEY to run this check.");
  process.exit(2);
}

const GENERIC = ["Foundation", "SR Legacy", "Survey (FNDDS)"];
const QUERIES = ["apple", "broccoli", "chicken breast", "white rice", "cheddar cheese"];
const BRANDED = ["cheerios", "oreo", "greek yogurt", "potato chips", "orange juice"];

async function search(query: string, dataType: string[], pageSize = 5) {
  const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, pageSize, dataType }),
  });
  if (!r.ok) throw new Error(`USDA ${r.status} for "${query}"`);
  return (await r.json()).foods ?? [];
}

/** The same lazy enrichment the app performs when a family picks a food. */
async function enrich(raw: Record<string, any>, food: ReturnType<typeof foodFromFDC>) {
  if (food.serv.kcal !== null || food.per100.kcal === null) return food;
  const r = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${raw.fdcId}?api_key=${key}`);
  if (!r.ok) return food;
  const portion = portionFromDetail(await r.json());
  return portion ? withPortion(food, portion) : food;
}

interface Tally { total: number; fromSearch: number; afterDetail: number; }

async function run(label: string, queries: string[], dataType: string[]) {
  const tally: Tally = { total: 0, fromSearch: 0, afterDetail: 0 };
  const samples: string[] = [];

  for (const q of queries) {
    for (const raw of await search(q, dataType)) {
      const searchOnly = foodFromFDC(raw);
      const food = await enrich(raw, searchOnly);

      tally.total++;
      if (searchOnly.serv.kcal !== null) tally.fromSearch++;
      const has = food.serv.kcal !== null;
      if (has) tally.afterDetail++;

      if (samples.length < 8) {
        const via = searchOnly.serv.kcal !== null ? "search"
          : has ? "detail" : "none  ";
        samples.push(
          `    ${has ? "OK  " : "100g"} via ${via}  ${food.name.slice(0, 30).padEnd(30)} ` +
          `${food.servingLabel.slice(0, 28).padEnd(28)} ` +
          `${food.serv.kcal === null ? "-" : Math.round(food.serv.kcal)} kcal/serving` +
          `${food.per100.kcal === null ? "" : ` (${Math.round(food.per100.kcal)}/100g)`}`,
        );
      }
    }
  }

  const pct = tally.total ? Math.round((tally.afterDetail / tally.total) * 100) : 0;
  const searchPct = tally.total ? Math.round((tally.fromSearch / tally.total) * 100) : 0;
  console.log(
    `\n${label}: ${tally.afterDetail}/${tally.total} (${pct}%) have a real serving` +
    `  [${searchPct}% from search alone, rest recovered from the detail endpoint]`,
  );
  samples.forEach((s) => console.log(s));
  return pct;
}

const genericPct = await run("Generic (Foundation / SR Legacy / FNDDS)", QUERIES, GENERIC);
const brandedPct = await run("Branded", BRANDED, ["Branded"]);

console.log("");
// Thresholds are regression guards set just under measured reality, not
// aspirations. Some USDA records carry no portion data anywhere (Foundation
// entries with an empty foodPortions list) and a few branded records report
// nonsense units like "30 MG" for a cup of cereal, which the guard rejects on
// purpose. Those honestly fall back to 100g.
let failed = false;
if (genericPct < 85) {
  console.log(`FAIL: generic serving coverage ${genericPct}% dropped below 85%`);
  failed = true;
}
if (brandedPct < 90) {
  console.log(`FAIL: branded serving coverage ${brandedPct}% dropped below 90%`);
  failed = true;
}
if (failed) process.exit(1);
console.log("Serving-size coverage looks healthy.");
