import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { FoodFacts, Nutrients } from "./types";
import { EMPTY_NUTRIENTS } from "./types";

/**
 * Food lookup goes through Cloud Functions rather than straight from the
 * browser. That keeps the USDA API key server-side (a key shipped in the
 * bundle would be scraped and its hourly quota burned), lets results be
 * cached across all families, and sidesteps third-party CORS behaviour.
 */

export interface FoodSearchResult {
  /** Stable id for list keys; not persisted. */
  key: string;
  label: string;
  sublabel: string;
  facts: FoodFacts;
}

const searchFn = httpsCallable<{ query: string }, { results: FoodSearchResult[] }>(functions, "searchFoods");
const barcodeFn = httpsCallable<{ code: string }, { result: FoodSearchResult | null }>(functions, "lookupBarcode");

const portionFn = httpsCallable<
  { fdcId: string },
  { portion: { grams: number; label: string } | null }
>(functions, "foodPortion");

/**
 * Fill in a household serving for a food that arrived without one.
 *
 * USDA search results omit portion data for Foundation and SR Legacy
 * records, leaving a bare 100g basis -- not a portion anyone eats, and
 * enough to distort both logged calories and the per-serving rules. The
 * detail endpoint usually has it, so we fetch it the moment a family
 * actually picks such a food.
 *
 * Best-effort: on any failure the food keeps its 100g basis.
 */
export async function resolvePortion(
  facts: FoodFacts,
  key: string,
): Promise<FoodFacts> {
  if (facts.serv.kcal !== null) return facts;
  if (facts.per100.kcal === null) return facts;
  if (!/^[0-9]+$/.test(key)) return facts;

  try {
    const { data } = await portionFn({ fdcId: key });
    if (!data.portion) return facts;
    const f = data.portion.grams / 100;
    const s = (v: number | null) => (v === null ? null : v * f);
    return {
      ...facts,
      serv: {
        kcal: s(facts.per100.kcal), fat: s(facts.per100.fat), sat: s(facts.per100.sat),
        sugars: s(facts.per100.sugars), added: s(facts.per100.added),
        protein: s(facts.per100.protein),
      },
      servingLabel: data.portion.label,
    };
  } catch {
    return facts;
  }
}

/** In-memory cache; a family logging breakfast usually searches the same
 *  handful of terms repeatedly within a session. */
const searchCache = new Map<string, FoodSearchResult[]>();

export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const cached = searchCache.get(q.toLowerCase());
  if (cached) return cached;
  const { data } = await searchFn({ query: q });
  searchCache.set(q.toLowerCase(), data.results);
  return data.results;
}

export async function lookupBarcode(code: string): Promise<FoodSearchResult | null> {
  const c = code.trim();
  if (!/^\d{6,14}$/.test(c)) throw new Error("That does not look like a barcode.");
  const { data } = await barcodeFn({ code: c });
  return data.result;
}

// ---------------------------------------------------------------------------
// Custom entry
// ---------------------------------------------------------------------------

export interface CustomFoodInput {
  name: string;
  servingLabel: string;
  kcal: number;
  fat: number;
  sat: number;
  added: number;
  protein: number;
  /** Optional; when omitted, added sugar is used as the total-sugars signal. */
  sugars?: number | null;
  isBeverage: boolean;
}

/**
 * Build FoodFacts from hand-entered values. Only per-serving figures are
 * known -- density is genuinely unknown, so it stays null and the engine's
 * per-serving fallback rules do the work.
 */
export function customFood(input: CustomFoodInput): FoodFacts {
  const serv: Nutrients = {
    kcal: input.kcal,
    fat: input.fat,
    sat: input.sat,
    sugars: input.sugars ?? input.added,
    added: input.added,
    protein: input.protein,
  };
  return {
    name: input.name.trim(),
    brand: "Custom entry",
    cats: input.isBeverage ? ["en:beverages"] : [],
    isBeverage: input.isBeverage,
    per100: { ...EMPTY_NUTRIENTS },
    serv,
    servingLabel: input.servingLabel.trim() || "1 serving",
    source: "Custom entry",
    code: "",
  };
}

/**
 * Nutrition for a given number of servings. When a labelled serving is known
 * we scale that; otherwise the per-100g block stands in and one "serving"
 * means 100g -- which is what `servingLabel` says in that case.
 */
export function nutritionFor(facts: FoodFacts, servings: number): Nutrients {
  const base = facts.serv.kcal !== null ? facts.serv : facts.per100;
  const s = (v: number | null) => (v === null ? null : v * servings);
  return {
    kcal: s(base.kcal), fat: s(base.fat), sat: s(base.sat),
    sugars: s(base.sugars), added: s(base.added), protein: s(base.protein),
  };
}

export const PORTION_OPTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
