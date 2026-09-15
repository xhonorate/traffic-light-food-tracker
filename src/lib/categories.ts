/**
 * Category tags a rule can test, for the rule editor's suggestions.
 *
 * Foods reach the app from two places, and they carry very different tags:
 *
 * - **Name search (USDA)** maps each result onto a small fixed set of tags
 *   (`fdcCatsToTags` in functions/src/usda.ts, plus `en:beverages` on a drink
 *   entered by hand). Most logged foods come this way, so these are the only
 *   tags the editor suggests.
 * - **Barcode scans (Open Food Facts)** carry OFF's own taxonomy tags, around
 *   nine thousand of them. They are not suggested, but an admin can still
 *   type one; offCategories.ts keeps the list so `npm run test:categories`
 *   can flag rule tags that nothing would ever match.
 */

/** Every tag a USDA search result or hand-entered food can carry, without the
 *  `en:` prefix. `npm run test:categories` keeps this in step with the
 *  server-side mapping. */
export const USDA_CATEGORY_TAGS = [
  "beverages",
  "biscuits",
  "breakfast-cereals",
  "candies",
  "dried",
  "flavoured-milks",
  "fried-food",
  "fruit-juices",
  "fruits",
  "milks",
  "nuts",
  "salty-snacks",
  "skimmed-milks",
  "sodas",
  "sugary-snacks",
  "vegetables",
  "waters",
  "yogurts",
] as const;

/** Tidy a typed value the way rule matching reads it: case-insensitive. */
export function normaliseCategory(raw: string): string {
  return raw.trim().toLowerCase();
}

/** The USDA tags that contain what has been typed, minus those already
 *  chosen. Spaces read as dashes and an `en:` prefix is ignored. */
export function suggestCategories(query: string, exclude: string[]): string[] {
  const taken = new Set(exclude.map(normaliseCategory));
  const q = normaliseCategory(query).replace(/^en:/, "").replace(/\s+/g, "-");
  return USDA_CATEGORY_TAGS.filter((t) => !taken.has(t) && t.includes(q));
}
