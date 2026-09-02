/**
 * Normalising USDA FoodData Central and Open Food Facts records into the
 * app's own `FoodFacts` shape.
 *
 * Kept free of side effects (no Firebase initialisation) so it can be unit
 * tested directly against live API responses -- see scripts/usda-check.ts.
 */

export interface Nutrients {
  kcal: number | null; fat: number | null; sat: number | null;
  sugars: number | null; added: number | null; protein: number | null;
}
export const EMPTY: Nutrients = { kcal: null, fat: null, sat: null, sugars: null, added: null, protein: null };

export interface FoodFacts {
  name: string; brand: string; cats: string[]; isBeverage: boolean;
  per100: Nutrients; serv: Nutrients; servingLabel: string; source: string; code: string;
}

const FDC_NUTR: Record<number, keyof Nutrients> = {
  1008: "kcal", 1004: "fat", 1258: "sat", 1003: "protein", 1235: "added", 2000: "sugars", 1063: "sugars",
};

function titleCase(s: string): string {
  if (s === s.toUpperCase()) {
    return s.toLowerCase().replace(/(^|\s|[("\-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  }
  return s;
}

/**
 * Map a USDA record onto Open Food Facts style category tags, so a single set
 * of rules can score foods from either source.
 */
function fdcCatsToTags(f: Record<string, unknown>): { tags: string[]; isBeverage: boolean } {
  const cat = String(f.foodCategory ?? "").toLowerCase();
  const desc = String(f.description ?? "").toLowerCase();
  const tags: string[] = [];
  let isBeverage = false;

  if (cat.includes("vegetable")) tags.push("en:vegetables");
  if (cat.includes("fruit")) {
    if (desc.includes("juice") || desc.includes("nectar")) {
      tags.push("en:beverages", "en:fruit-juices"); isBeverage = true;
    } else tags.push("en:fruits");
    if (desc.includes("dried") || desc.includes("dehydrated")) tags.push("en:dried");
  }
  if (cat.includes("sweets") || desc.includes("candy") || desc.includes("candies")) {
    tags.push("en:sugary-snacks", "en:candies");
  }
  if (cat.includes("snacks")) tags.push("en:salty-snacks");
  if (cat.includes("baked products") && /cookie|cake|pastry|doughnut|donut|brownie|pie\b/.test(desc)) {
    tags.push("en:sugary-snacks", "en:biscuits");
  }
  if (cat.includes("cereal")) tags.push("en:breakfast-cereals");
  if (cat.includes("nut and seed")) tags.push("en:nuts");
  if (cat.includes("beverages") || cat.includes("alcoholic")) { tags.push("en:beverages"); isBeverage = true; }
  if (/\b(soda|sodas|cola|colas|soft drinks?|energy drinks?)\b/.test(desc)) {
    tags.push("en:beverages", "en:sodas"); isBeverage = true;
  }
  if ((cat.includes("dairy") || cat.includes("beverages")) && desc.includes("milk") && !cat.includes("sweets")) {
    tags.push("en:beverages", "en:milks"); isBeverage = true;
    if (/skim|nonfat|non-fat|fat.free/.test(desc)) tags.push("en:skimmed-milks");
    if (/chocolate|strawberry|flavou?red/.test(desc)) tags.push("en:flavoured-milks");
  }
  if (desc.includes("yogurt") || desc.includes("yoghurt")) { tags.push("en:yogurts"); isBeverage = false; }
  if (desc.includes("fried") && !desc.includes("stir")) tags.push("en:fried-food");
  if (desc.includes("water") && (cat.includes("beverages") || !cat)) { tags.push("en:waters"); isBeverage = true; }

  return { tags, isBeverage };
}

/** USDA reports serving units with UNECE codes as well as plain ones. Only
 *  mass and volume are usable; anything else (mg, IU) is either a data error
 *  or not a portion at all. */
const GRAM_UNITS = new Set(["g", "grm"]);
const ML_UNITS = new Set(["ml", "mlt"]);

/** Guard against label data that is obviously wrong -- USDA branded records
 *  contain servings like "30 MG" for a cup of cereal. */
const MIN_SERVING_G = 1;
const MAX_SERVING_G = 2000;

const round1 = (v: number) => Math.round(v * 10) / 10;

export interface Portion {
  grams: number;
  label: string;
}

/**
 * The labelled serving for a branded product, when USDA gives a usable one.
 */
function brandedPortion(f: Record<string, any>): Portion | null {
  const unit = String(f.servingSizeUnit ?? "").toLowerCase();
  const qty = f.servingSize;
  if (typeof qty !== "number" || !Number.isFinite(qty)) return null;
  if (!GRAM_UNITS.has(unit) && !ML_UNITS.has(unit)) return null;
  if (qty < MIN_SERVING_G || qty > MAX_SERVING_G) return null;

  const unitLabel = ML_UNITS.has(unit) ? "ml" : "g";
  const household = String(f.householdServingFullText ?? "").trim();
  // The household text often already repeats the gram figure -- "1 pouch
  // (26g)" -- so only append the measured amount when it adds something.
  const amount = `${round1(qty)} ${unitLabel}`;
  const label = household
    ? (household.replace(/\s+/g, "").toLowerCase().includes(amount.replace(/\s+/g, "").toLowerCase())
      ? household
      : `${household} (${amount})`)
    : amount;

  return { grams: qty, label };
}

/**
 * A household portion for a generic food.
 *
 * Foundation, SR Legacy and FNDDS records carry no `servingSize` at all --
 * only `foodMeasures`, a ranked list of real-world portions with gram
 * weights ("1 medium", "1 cup"). Without this, every generic food fell back
 * to 100g, which is not a portion anyone eats and which threw off both logged
 * calories and the per-serving rules.
 *
 * `rank` 1 is USDA's most representative measure. "Quantity not specified" is
 * a placeholder rather than a portion, so it is skipped.
 */
function measuredPortion(f: Record<string, any>): Portion | null {
  const measures = Array.isArray(f.foodMeasures) ? f.foodMeasures : [];
  const usable = measures
    .filter((m: Record<string, any>) =>
      typeof m?.gramWeight === "number" &&
      m.gramWeight >= MIN_SERVING_G &&
      m.gramWeight <= MAX_SERVING_G &&
      typeof m?.disseminationText === "string" &&
      m.disseminationText.trim() !== "" &&
      !/quantity not specified/i.test(m.disseminationText))
    .sort((a: Record<string, any>, b: Record<string, any>) =>
      (typeof a.rank === "number" ? a.rank : 999) - (typeof b.rank === "number" ? b.rank : 999));

  const best = usable[0];
  if (!best) return null;
  return {
    grams: best.gramWeight,
    label: `${String(best.disseminationText).trim()} (${round1(best.gramWeight)}g)`,
  };
}

/**
 * A household portion from the single-food detail endpoint.
 *
 * Foundation and SR Legacy records carry no measures in *search* results, but
 * the detail endpoint has `foodPortions` for most of them. Since those are the
 * whole-food staples families log constantly -- cheese, broccoli, chicken --
 * and 100g of cheddar is nearly four times a real slice, it is worth the extra
 * request. `sequenceNumber` is USDA's own ordering, so the first is the most
 * typical portion.
 */
export function portionFromDetail(detail: Record<string, any>): Portion | null {
  const portions = Array.isArray(detail?.foodPortions) ? detail.foodPortions : [];
  const usable = portions
    .filter((p: Record<string, any>) =>
      typeof p?.gramWeight === "number" &&
      p.gramWeight >= MIN_SERVING_G &&
      p.gramWeight <= MAX_SERVING_G &&
      (String(p?.modifier ?? "").trim() !== "" || String(p?.portionDescription ?? "").trim() !== ""))
    .sort((a: Record<string, any>, b: Record<string, any>) =>
      (typeof a.sequenceNumber === "number" ? a.sequenceNumber : 999) -
      (typeof b.sequenceNumber === "number" ? b.sequenceNumber : 999));

  const best = usable[0];
  if (!best) return null;

  const what = String(best.portionDescription ?? best.modifier ?? "").trim();
  const amount = typeof best.amount === "number" && best.amount > 0 ? best.amount : 1;
  const head = `${round1(amount)} ${what}`.trim();
  return { grams: best.gramWeight, label: `${head} (${round1(best.gramWeight)}g)` };
}

/** Apply a resolved portion to a food that had none. */
export function withPortion(food: FoodFacts, portion: Portion): FoodFacts {
  return {
    ...food,
    serv: scaleTo(food.per100, portion.grams),
    servingLabel: portion.label,
  };
}

/** Scale a per-100g block to an arbitrary gram weight. */
function scaleTo(per100: Nutrients, grams: number): Nutrients {
  const f = grams / 100;
  const s = (v: number | null) => (v === null ? null : v * f);
  return {
    kcal: s(per100.kcal), fat: s(per100.fat), sat: s(per100.sat),
    sugars: s(per100.sugars), added: s(per100.added), protein: s(per100.protein),
  };
}

export function foodFromFDC(f: Record<string, any>): FoodFacts {
  const per100: Nutrients = { ...EMPTY };
  for (const n of (f.foodNutrients ?? []) as Record<string, any>[]) {
    const key = FDC_NUTR[n.nutrientId as number];
    if (key && per100[key] === null && typeof n.value === "number") per100[key] = n.value;
  }

  const { tags, isBeverage } = fdcCatsToTags(f);

  // Prefer the label serving on a packaged product; otherwise fall back to
  // USDA's household measures; only then to a bare 100g.
  const portion = brandedPortion(f) ?? measuredPortion(f);

  const serv: Nutrients = portion ? scaleTo(per100, portion.grams) : { ...EMPTY };
  const servingLabel = portion ? portion.label : (isBeverage ? "100 ml" : "100 g");

  return {
    name: titleCase(String(f.description ?? "Unnamed food")),
    brand: [f.brandName, f.brandOwner].filter(Boolean).map(String).join(" · ") || String(f.dataType ?? ""),
    cats: tags, isBeverage, per100, serv, servingLabel,
    source: `USDA ${f.dataType ?? "FoodData Central"}`,
    code: String(f.gtinUpc ?? ""),
  };
}

export function foodFromOFF(p: Record<string, any>): FoodFacts {
  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const g = (k: string): number | null => {
    const v = n[k];
    if (typeof v === "number") return v;
    if (v != null && v !== "") { const f = parseFloat(String(v)); return Number.isNaN(f) ? null : f; }
    return null;
  };

  const cats = ((p.categories_tags ?? []) as string[]).map((c) => String(c).toLowerCase());
  const isBeverage = cats.some((c) =>
    ["beverages", "waters", "juices", "sodas", "milks"].some((k) => c.includes(k)));

  const per100: Nutrients = {
    kcal: g("energy-kcal_100g"), fat: g("fat_100g"), sat: g("saturated-fat_100g"),
    sugars: g("sugars_100g"), added: g("added-sugars_100g"), protein: g("proteins_100g"),
  };

  let serv: Nutrients = {
    kcal: g("energy-kcal_serving"), fat: g("fat_serving"), sat: g("saturated-fat_serving"),
    sugars: g("sugars_serving"), added: g("added-sugars_serving"), protein: g("proteins_serving"),
  };

  const servQty = typeof p.serving_quantity === "number"
    ? p.serving_quantity : parseFloat(String(p.serving_quantity ?? ""));

  if (serv.kcal === null && per100.kcal !== null && servQty > 0) {
    const fr = servQty / 100;
    const nz = (v: number | null) => (v === null ? null : v * fr);
    serv = {
      kcal: per100.kcal * fr, fat: nz(per100.fat), sat: nz(per100.sat),
      sugars: nz(per100.sugars), added: nz(per100.added), protein: nz(per100.protein),
    };
  }

  let servingLabel = String(p.serving_size ?? (servQty > 0 ? `${servQty} g` : "100 g"));
  // OFF data often repeats the gram figure: "1 bar (28 g) (28 g)".
  servingLabel = servingLabel.replace(/(\([^()]*\))(\s*\1)+/g, "$1");

  return {
    name: String(p.product_name || "Unnamed product"),
    brand: String(p.brands ?? ""),
    cats, isBeverage, per100, serv, servingLabel,
    source: "Open Food Facts",
    code: String(p.code ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Search-result ranking
// ---------------------------------------------------------------------------

/**
 * Re-rank raw USDA search hits before they reach a family.
 *
 * USDA's own relevance order is a poor fit here for two reasons:
 *
 *  - It interleaves `Survey (FNDDS)` and `SR Legacy` rows with brand-name
 *    products. Those rows describe a nutrient profile, not a package, and
 *    their "serving" is a lab quantity -- 100 g, a 250 g cup -- not what a
 *    family eats. Searching for a snack, you want the box, not the reference
 *    datum.
 *  - Its scoring rewards a word that appears twice in a description, so for
 *    `wheat thins` "Roll, wheat or cracked wheat" can outrank "Wheat Thins"
 *    -- which does not even contain the word "thins".
 *
 * So we score every hit ourselves. The sort keys, in order:
 *
 *   1. phrase      -- query words appear in order and adjacent
 *   2. allWords    -- every query word is somewhere in the description
 *   3. matched     -- how many query words matched (partial credit)
 *   4. typeRank    -- branded, then Foundation, then the two reference sets
 *   5. exactPhrase -- (1) again but before stemming, so "Wheat Thins" beats
 *                     "Wheat Thin Sliced Bread". Multi-word queries only: on a
 *                     single word this is just the plural fold running
 *                     backwards, which would sink "Apples, raw" under
 *                     "Croissants, apple" for the query `apple`.
 *   6. exactAll    -- (2) again before stemming; multi-word queries only
 *   7. leads       -- the description starts with the query
 *   8. density     -- matched words as a share of the description; a tie-break
 *                     that favours "Wheat Thins" over "Wheat Thins Reduced Fat
 *                     Baked Snack Crackers Family Size"
 *
 * Keys 1-3 are stemmed (see `stem`) so `apple` finds "Apples, raw"; the exact
 * forms come back in as keys 5-6 to break the ties stemming introduces.
 */

/** Branded ahead of Foundation ahead of the two generic reference sets. */
const DATA_TYPE_RANK: Record<string, number> = {
  "Branded": 3,
  "Foundation": 2,
  "SR Legacy": 1,
  "Survey (FNDDS)": 0,
};

/**
 * Fold the obvious English plurals together so `apple` matches "Apples, raw"
 * and `egg` matches "Eggs, Grade A". Applied to the query and the description
 * alike, so even a rough stem still lines the two up. Deliberately shallow --
 * this is a search nicety, not linguistics.
 */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y"; // berries -> berry
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);       // potatoes -> potato
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1); // apples -> apple
  return w;
}

/** Lower-cased word tokens, punctuation dropped. */
const tokenize = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Start index of the first contiguous whole-word run of `needle` in `hay`,
 *  or -1. Whole-word so `apple` does not match inside "pineapple", and
 *  `wheat thins` is not double-counted against a "wheat ... wheat" description
 *  that never says "thin". */
function phraseAt(hay: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { hit = false; break; }
    }
    if (hit) return i;
  }
  return -1;
}

interface WordMatch {
  phrase: boolean;
  allWords: boolean;
  matched: number;
  leads: boolean;
}

/** Compare a token stream against a query token stream. */
function match(descWords: string[], queryWords: string[]): WordMatch {
  const distinct = [...new Set(queryWords)];
  const present = new Set(descWords);
  const matched = distinct.filter((w) => present.has(w)).length;
  const at = phraseAt(descWords, queryWords);
  return {
    phrase: at >= 0,
    allWords: distinct.length > 0 && matched === distinct.length,
    matched,
    leads: at === 0,
  };
}

export interface HitScore {
  phrase: boolean;
  allWords: boolean;
  matched: number;
  typeRank: number;
  exactPhrase: boolean;
  exactAll: boolean;
  leads: boolean;
  density: number;
}

export function scoreFdcHit(f: Record<string, any>, query: string): HitScore {
  const descTokens = tokenize(String(f.description ?? ""));
  const queryTokens = tokenize(query);

  const exact = match(descTokens, queryTokens);
  const stemmed = match(descTokens.map(stem), queryTokens.map(stem));
  const multiWord = new Set(queryTokens).size > 1;

  return {
    phrase: stemmed.phrase,
    allWords: stemmed.allWords,
    matched: stemmed.matched,
    typeRank: DATA_TYPE_RANK[String(f.dataType ?? "")] ?? 0,
    exactPhrase: multiWord && exact.phrase,
    exactAll: multiWord && exact.allWords,
    leads: stemmed.leads,
    density: descTokens.length ? stemmed.matched / descTokens.length : 0,
  };
}

/** Stable-sort `foods`, best match for `query` first. */
export function rankFdcHits<T extends Record<string, any>>(foods: T[], query: string): T[] {
  return foods
    .map((f, i) => ({ f, i, s: scoreFdcHit(f, query) }))
    .sort((a, b) =>
      Number(b.s.phrase) - Number(a.s.phrase) ||
      Number(b.s.allWords) - Number(a.s.allWords) ||
      b.s.matched - a.s.matched ||
      b.s.typeRank - a.s.typeRank ||
      Number(b.s.exactPhrase) - Number(a.s.exactPhrase) ||
      Number(b.s.exactAll) - Number(a.s.exactAll) ||
      Number(b.s.leads) - Number(a.s.leads) ||
      b.s.density - a.s.density ||
      a.i - b.i)
    .map((x) => x.f);
}
