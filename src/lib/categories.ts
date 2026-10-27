/**
 * Category tags, for the rule tester's picker.
 *
 * Every food carries tags from the program's own fixed list, FOOD_TAGS in
 * foodTags.ts, whichever way it was added: name search, barcode scan or typed
 * in by hand. Group detection reads them.
 */
import { FOOD_TAGS, type FoodTag } from "./foodTags";

export { FOOD_TAGS };

/** Tidy a typed value the way rule matching reads it: case-insensitive. */
export function normaliseCategory(raw: string): string {
  return raw.trim().toLowerCase().replace(/^en:/, "").replace(/\s+/g, "-");
}

/** Whether a value is one of the program's tags. */
export function isFoodTag(value: string): value is FoodTag {
  return (FOOD_TAGS as readonly string[]).includes(normaliseCategory(value));
}

/** The tags that contain what has been typed, minus those already chosen.
 *  Spaces read as dashes and an `en:` prefix is ignored. */
export function suggestCategories(query: string, exclude: string[]): string[] {
  const taken = new Set(exclude.map(normaliseCategory));
  const q = normaliseCategory(query);
  return FOOD_TAGS.filter((t) => !taken.has(t) && t.includes(q));
}
