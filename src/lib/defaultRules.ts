import type { FoodGroup } from "./foodGroups";
import type { GroupRule, RuleSet } from "./types";

/**
 * The default rules: Epstein, The Food & Activity Reference Guide (2012),
 * p.6, as the client's prototype sets it out. One row per food group. Every
 * figure is seed data: once written to Firestore an admin owns it and can
 * retune any of it without a redeploy.
 *
 * `servG` is the app's gram estimate of the guide's household serving, and
 * the calories in it are what the lines are measured against.
 */

const graded = (
  label: string, serv: string, servG: number, yellow: number,
  extra: Partial<GroupRule> = {},
): GroupRule => ({ label, kind: "graded", serv, servG, green: null, yellow, sugarPct: null, ...extra });

const fixed = (label: string, kind: GroupRule["kind"], serv: string, servG: number | null): GroupRule =>
  ({ label, kind, serv, servG, green: null, yellow: null, sugarPct: null });

export const DEFAULT_GROUPS: Record<FoodGroup, GroupRule> = {
  veg: graded("Vegetables", "1/2 cup", 65, 45, { green: 30 }),
  starchy: graded("Starchy vegetables", "1/2 cup", 80, 120),
  fruit: graded("Fruit", "1 small piece or 1/2 cup", 90, 90),
  juice: fixed("Fruit juice & dried fruit", "alwaysRed", "8 fl oz or 1/4 cup dried", 240),
  grain: graded("Grains", "1 oz (1 slice; 1/2 cup cooked)", 28, 120),
  // FRG p.77: red above 25% of calories from sugar, even within the calorie line
  cereal: graded("Cold cereal", "1 cup flakes, 1/2 cup pieces or 1/4 cup granola", 30, 120, { sugarPct: 25 }),
  cheese: graded("Cheese", "1 oz", 28, 83),
  dairy: graded("Milk, yogurt & other dairy", "1 cup", 245, 135),
  meat: graded("Meat & seafood", "3 oz", 85, 158),
  protein: graded("Eggs, beans & meat substitutes", "1/2 cup, 1 egg or 1 patty", 90, 120),
  nuts: graded("Nuts & seeds", "1 oz", 28, 68),
  sweets: fixed("Fats, oils, sweets & others", "alwaysRed", "about 1 Tbsp, or 1 oz of a snack", 15),
  soupBroth: graded("Soup: broth-based & chowder", "1 cup", 245, 186),
  soupChili: graded("Soup: chili, bean/lentil & gumbo", "1 cup", 245, 224),
  condiment: graded("Condiments, dressings & ingredients", "1 Tbsp", 15, 23),
  combo: fixed("Combination food", "combo", "no serving given", null),
  free: fixed("Water, plain tea/coffee, seasonings", "free", "n/a", null),
};

export const DEFAULT_RULE_SET: RuleSet = {
  version: 2,
  groups: DEFAULT_GROUPS,
};

/**
 * Read a stored rule set. The retired rule list (no `version`) is replaced by
 * the defaults outright, and a table missing a group, as one saved by an
 * older build would be, has that group filled in from the defaults.
 */
export function normaliseRuleSet(stored: unknown): RuleSet {
  const r = stored as Partial<RuleSet> | null | undefined;
  if (!r || r.version !== 2 || !r.groups) return DEFAULT_RULE_SET;
  const groups = { ...DEFAULT_GROUPS };
  for (const key of Object.keys(DEFAULT_GROUPS) as FoodGroup[]) {
    if (r.groups[key]) groups[key] = { ...DEFAULT_GROUPS[key], ...r.groups[key] };
  }
  return { ...r, version: 2, groups };
}
