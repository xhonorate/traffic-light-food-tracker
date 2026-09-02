// Parity harness: runs the ported declarative engine against the prototype's
// original hardcoded classify() over a spread of foods, and reports mismatches.
import { classify } from "../src/lib/rules";
import { DEFAULT_RULE_SET } from "../src/lib/defaultRules";
import type { FoodFacts } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Prototype original, copied verbatim from traffic_light_food_logger.html
// ---------------------------------------------------------------------------
const DEFAULT_RULES: any = {
  greenKcal100: 45, greenProduceKcal100: 100, redAdded100: 10, redAddedServ: 8,
  redFat100: 17, redFatServ: 10, redSat100: 8, redSatServ: 5, redKcal100: 400,
  proteinSpare100: 15, bevSugar100: 5, bevGreenKcal100: 20,
};
const fmt1 = (v: any) => (v == null || isNaN(v)) ? "-" : (Math.round(v * 10) / 10).toString();
function hasCat(cats: any, ...needles: any[]) {
  return cats.some((c: any) => needles.some((n: any) => c.includes(n)));
}
function protoClassify(f: any, rules: any) {
  const R = rules, p = f.per100 || {}, s = f.serv || {};
  const cats = f.cats || [];
  const reasons: string[] = [];
  const num = (v: any) => (typeof v === "number" && !isNaN(v)) ? v : null;
  const kcal100 = num(p.kcal), fat100 = num(p.fat), sat100 = num(p.sat),
    sug100 = num(p.sugars), add100 = num(p.added), prot100 = num(p.protein);
  const kcalS = num(s.kcal), fatS = num(s.fat), satS = num(s.sat), addS = num(s.added);

  if (f.isBeverage) {
    const isMilk = hasCat(cats, "milks") && !hasCat(cats, "flavoured-milks", "chocolate");
    const isSoda = hasCat(cats, "sodas", "soft-drink", "energy-drink", "sweetened-beverages");
    const isJuice = hasCat(cats, "juices", "nectars", "smoothies");
    if (isMilk) {
      if (hasCat(cats, "skimmed", "fat-free")) { reasons.push("skim"); return done("green"); }
      if ((add100 ?? 0) < 1) { reasons.push("plain milk"); return done("yellow"); }
    }
    if (isSoda || (add100 != null && add100 >= 4) || (add100 == null && sug100 != null && sug100 >= R.bevSugar100 && !isMilk)) {
      if (sug100 != null && sug100 < 2.5 && (add100 ?? 0) < 1) { reasons.push("diet"); return done("yellow"); }
      reasons.push("sugary drink"); return done("red");
    }
    if (isJuice) { reasons.push("juice"); return done("red"); }
    if (kcal100 != null && kcal100 <= R.bevGreenKcal100 && (sug100 ?? 0) < 2.5) { reasons.push("water"); return done("green"); }
    reasons.push("beverage moderate"); return done("yellow");
  }

  const isYogurt = hasCat(cats, "yogurts", "kefirs", "skyr", "fromages-blancs");
  const redCat = !isYogurt && hasCat(cats, "sugary-snacks", "candies", "candy", "chocolates", "confectioneries",
    "biscuits", "cakes", "pastries", "desserts", "ice-cream", "chips-and-fries", "crisps",
    "french-fries", "fried-food", "salty-snacks", "viennoiseries", "pies");
  const isNuts = hasCat(cats, "nuts", "nut-butters", "peanut-butter", "seeds") && (add100 == null || add100 < 5);
  const isFruitCat = hasCat(cats, "fruits", "fruit") && !hasCat(cats, "dried");
  const isVegCat = hasCat(cats, "vegetables", "legumes", "salads") && !redCat;

  if (redCat) reasons.push("treat cat");
  if (add100 != null && add100 >= R.redAdded100) reasons.push("added100");
  else if (add100 == null && addS != null && addS >= R.redAddedServ) reasons.push("addedServ");
  else if (add100 == null && addS == null && sug100 != null && sug100 >= 18 && !isFruitCat) reasons.push("veryHighSugars");

  if (!isNuts) {
    if (fat100 != null && fat100 >= R.redFat100) reasons.push("fat100");
    else if (fat100 == null && fatS != null && fatS >= R.redFatServ) reasons.push("fatServ");
    if (sat100 != null && sat100 >= R.redSat100) reasons.push("sat100");
    else if (sat100 == null && satS != null && satS >= R.redSatServ) reasons.push("satServ");
    if (kcal100 != null && kcal100 >= R.redKcal100 && (prot100 ?? 0) < R.proteinSpare100) reasons.push("dense");
  }
  if (reasons.length) return done("red");

  if ((isFruitCat || isVegCat) && (kcal100 == null || kcal100 <= R.greenProduceKcal100) && (add100 ?? 0) <= 2) { reasons.push("produce"); return done("green"); }
  if (kcal100 != null && kcal100 <= R.greenKcal100 && (add100 ?? 0) <= 2) { reasons.push("lowdens"); return done("green"); }
  if (isYogurt && (fat100 ?? 99) <= 2 && (add100 ?? 0) <= 2 && (sug100 ?? 0) <= 8) { reasons.push("yogurt"); return done("green"); }
  if (kcal100 == null && kcalS != null && kcalS <= 50 && (fatS ?? 0) <= 1 && (addS ?? 0) <= 2) { reasons.push("lowcalserv"); return done("green"); }

  if (isNuts) reasons.push("nuts");
  else reasons.push("staple");
  return done("yellow");

  function done(color: string) { return { color, reasons }; }
}

// ---------------------------------------------------------------------------
// Test corpus
// ---------------------------------------------------------------------------
const N = (o: any = {}) => ({ kcal: null, fat: null, sat: null, sugars: null, added: null, protein: null, ...o });
function food(name: string, cats: string[], isBeverage: boolean, per100: any, servG: number | null): FoodFacts {
  const p = N(per100);
  let serv = N();
  if (servG) {
    const fr = servG / 100;
    serv = N(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v == null ? null : (v as number) * fr])));
  }
  return { name, brand: "", cats, isBeverage, per100: p as any, serv: serv as any, servingLabel: "", source: "test", code: "" };
}

const CASES: FoodFacts[] = [
  // The prototype's own quick-add list
  food("Apple", ["en:fruits"], false, { kcal: 52, fat: 0.2, sat: 0, sugars: 10.4, added: 0, protein: 0.3 }, 182),
  food("Broccoli", ["en:vegetables"], false, { kcal: 35, fat: 0.4, sat: 0.1, sugars: 1.4, added: 0, protein: 2.4 }, 156),
  food("Chicken breast", ["en:meats"], false, { kcal: 165, fat: 3.6, sat: 1, sugars: 0, added: 0, protein: 31 }, 85),
  food("White rice", ["en:cereals"], false, { kcal: 130, fat: 0.3, sat: 0.1, sugars: 0.1, added: 0, protein: 2.7 }, 158),
  food("Skim milk", ["en:beverages", "en:milks", "en:skimmed-milks"], true, { kcal: 34, fat: 0.1, sat: 0.1, sugars: 5, added: 0, protein: 3.4 }, 245),
  food("Cola", ["en:beverages", "en:sodas"], true, { kcal: 39, fat: 0, sat: 0, sugars: 10.6, added: 10.6, protein: 0 }, 355),
  food("Potato chips", ["en:salty-snacks", "en:crisps"], false, { kcal: 536, fat: 35, sat: 4.6, sugars: 0.4, added: 0, protein: 7 }, 28),
  food("Choc chip cookie", ["en:sugary-snacks", "en:biscuits"], false, { kcal: 488, fat: 24, sat: 8, sugars: 36, added: 30, protein: 5 }, 30),
  // Exemption paths
  food("Peanut butter", ["en:nut-butters"], false, { kcal: 588, fat: 50, sat: 10, sugars: 9, added: 1, protein: 25 }, 32),
  food("Sweetened peanut butter", ["en:nut-butters"], false, { kcal: 588, fat: 50, sat: 10, sugars: 20, added: 8, protein: 25 }, 32),
  food("Almonds", ["en:nuts"], false, { kcal: 579, fat: 50, sat: 3.8, sugars: 4.4, added: 0, protein: 21 }, 28),
  food("Plain nonfat yogurt", ["en:dairies", "en:yogurts"], false, { kcal: 59, fat: 0.4, sat: 0.1, sugars: 3.2, added: 0, protein: 10 }, 170),
  food("Dessert yogurt", ["en:desserts", "en:yogurts"], false, { kcal: 95, fat: 1, sat: 0.6, sugars: 13, added: 9, protein: 4 }, 150),
  food("Raisins (dried fruit)", ["en:fruits", "en:dried"], false, { kcal: 299, fat: 0.5, sat: 0.1, sugars: 59, added: null, protein: 3 }, 40),
  food("Fresh grapes", ["en:fruits"], false, { kcal: 69, fat: 0.2, sat: 0.1, sugars: 16, added: null, protein: 0.7 }, 100),
  food("Very sweet fruit, unknown added", ["en:fruits"], false, { kcal: 90, fat: 0.2, sat: 0, sugars: 22, added: null, protein: 1 }, 100),
  // Protein-spared calorie density
  food("Beef jerky", ["en:meats"], false, { kcal: 410, fat: 26, sat: 11, sugars: 9, added: 5, protein: 33 }, 28),
  food("Protein bar dense", ["en:cereals"], false, { kcal: 420, fat: 12, sat: 3, sugars: 5, added: 3, protein: 30 }, 60),
  // Beverages
  food("Diet cola", ["en:beverages", "en:sodas"], true, { kcal: 0.4, fat: 0, sat: 0, sugars: 0, added: 0, protein: 0 }, 355),
  food("Orange juice", ["en:beverages", "en:juices"], true, { kcal: 45, fat: 0.2, sat: 0, sugars: 8.4, added: 0, protein: 0.7 }, 248),
  food("Water", ["en:beverages", "en:waters"], true, { kcal: 0, fat: 0, sat: 0, sugars: 0, added: 0, protein: 0 }, 500),
  food("Whole milk", ["en:beverages", "en:milks"], true, { kcal: 61, fat: 3.3, sat: 1.9, sugars: 5, added: 0, protein: 3.2 }, 244),
  food("Chocolate milk", ["en:beverages", "en:milks", "en:flavoured-milks"], true, { kcal: 83, fat: 3.4, sat: 2, sugars: 10, added: 5, protein: 3.2 }, 244),
  food("Unsweet iced tea", ["en:beverages"], true, { kcal: 1, fat: 0, sat: 0, sugars: 0.2, added: 0, protein: 0 }, 240),
  food("Sports drink, added unknown", ["en:beverages"], true, { kcal: 25, fat: 0, sat: 0, sugars: 6, added: null, protein: 0 }, 240),
  // Per-serving fallback paths (no per-100 data at all)
  { ...food("Serv-only high fat", ["en:meals"], false, {}, null), serv: N({ kcal: 300, fat: 14, sat: 6, sugars: 2, added: 1, protein: 8 }) as any },
  { ...food("Serv-only high added sugar", ["en:meals"], false, {}, null), serv: N({ kcal: 200, fat: 2, sat: 1, sugars: 20, added: 12, protein: 2 }) as any },
  { ...food("Serv-only tiny", ["en:condiments"], false, {}, null), serv: N({ kcal: 20, fat: 0.5, sat: 0, sugars: 1, added: 0, protein: 0 }) as any },
  // Sparse data
  food("Unknown everything", ["en:meals"], false, {}, null),
  food("Lettuce", ["en:vegetables", "en:salads"], false, { kcal: 15, fat: 0.2, sat: 0, sugars: 0.8, added: 0, protein: 1.4 }, 72),
  food("French fries", ["en:french-fries"], false, { kcal: 312, fat: 15, sat: 2.3, sugars: 0.3, added: 0, protein: 3.4 }, 117),
];

let pass = 0;
const fails: string[] = [];
for (const f of CASES) {
  const mine = classify(f, DEFAULT_RULE_SET);
  const proto = protoClassify(f, DEFAULT_RULES);
  if (mine.color === proto.color) pass++;
  else fails.push(`  ${f.name.padEnd(32)} ported=${mine.color.padEnd(6)} prototype=${proto.color.padEnd(6)}  [${proto.reasons.join("|")}] vs [${mine.decidedBy}]`);
}
console.log(`Parity: ${pass}/${CASES.length} match`);
if (fails.length) { console.log("MISMATCHES:"); fails.forEach((l) => console.log(l)); process.exit(1); }
else console.log("All cases agree with the prototype.");
