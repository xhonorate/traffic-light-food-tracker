// Checks for USDA search-result ranking -- the cases where USDA's own order
// puts a generic reference row, or a description that merely repeats a word,
// above the brand-name product a family is looking for. Run with
// `npm run test:rank`. Pure function, no network.
import { rankFdcHits, scoreFdcHit } from "../functions/src/usda";

/** A stand-in for the fields of a USDA search hit that ranking reads. */
const hit = (description: string, dataType: string) => ({ description, dataType, fdcId: description });

const failures: string[] = [];

/** Assert that `query` orders `hits` exactly as given (best first). Feeds them
 *  in reversed so a no-op sort cannot pass by accident. */
function order(query: string, hits: { description: string; dataType: string }[]) {
  const got = rankFdcHits([...hits].reverse() as any, query).map((h) => h.description);
  const want = hits.map((h) => h.description);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`  "${query}"\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`);
  }
}

// The headline case. "Wheat Thins" is the phrase; "Roll, wheat or cracked
// wheat" only has "wheat" (twice) and never "thin(s)". The pizza does contain
// "wheat thin" but it is Survey (FNDDS), so it lands below every brand.
order("wheat thins", [
  hit("Wheat Thins", "Branded"),
  hit("Wheat Thins Original", "Branded"),
  hit("Organic Wheat Thins", "Branded"),
  hit("Pizza, cheese, whole wheat thin crust", "Survey (FNDDS)"),
  hit("Roll, wheat or cracked wheat", "SR Legacy"),
]);

// Generic reference rows sink below brand-name products at the same relevance.
order("greek yogurt", [
  hit("Chobani Non-Fat Greek Yogurt, Plain", "Branded"),
  hit("Yogurt, Greek, plain, nonfat", "SR Legacy"),
  hit("Yogurt, Greek, plain, whole milk", "Survey (FNDDS)"),
]);

// An adjacent-phrase match outranks a row that has both words apart.
order("cheddar cheese", [
  hit("Cheddar Cheese", "Branded"),
  hit("Cheese, cheddar", "SR Legacy"),
]);

// Among rows that all contain the phrase, data type is the tie-breaker:
// branded, then Foundation, then SR Legacy, then Survey (FNDDS).
order("cheddar cheese", [
  hit("Kraft Cheddar Cheese", "Branded"),
  hit("Cheddar Cheese, mild", "Foundation"),
  hit("Cheddar Cheese, sharp", "SR Legacy"),
  hit("Cheddar Cheese (FNDDS)", "Survey (FNDDS)"),
]);

// Plurals fold together: "apple" must find "Apples, raw", and a leading match
// ("Apples, ...") beats an incidental one ("..., apple") within a data type.
order("apple", [
  hit("Apple", "Branded"),
  hit("Apples, gala, with skin, raw", "Foundation"),
  hit("Apples, raw, without skin", "SR Legacy"),
  hit("Croissants, apple", "SR Legacy"),
  hit("Apple, raw", "Survey (FNDDS)"),
]);

// A partial match (one word of two) ranks below a full match, any data type.
order("apple juice", [
  hit("Mott's 100% Apple Juice", "Branded"),
  hit("Juice, apple, unsweetened", "SR Legacy"),
  hit("Apple, raw", "Foundation"),
]);

// Spot-check one score so the shape is pinned, not just the ordering.
const s = scoreFdcHit(hit("Roll, wheat or cracked wheat", "SR Legacy"), "wheat thins");
if (s.phrase || s.allWords || s.matched !== 1 || s.typeRank !== 1) {
  failures.push(`  score("Roll, wheat or cracked wheat" / "wheat thins") = ${JSON.stringify(s)}`);
}

if (failures.length) {
  console.log(`Ranking: ${failures.length} case(s) FAILED`);
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log("Ranking: all 7 checks pass");
