import type { Condition, NumericField, Rule, RuleSet } from "./types";

/**
 * Default rule set, ported from the traffic-light-food-logger prototype's
 * hardcoded `classify()` function so behaviour matches on day one. Everything
 * here is seed data: once written to Firestore an admin owns it and can
 * reorder, retune, add or delete any of it without a redeploy.
 *
 * Categories follow Open Food Facts tag style and are matched as substrings,
 * so "fruits" matches "en:fruits".
 */

const NUT_CATS = ["nuts", "nut-butters", "peanut-butter", "seeds"];
const YOGURT_CATS = ["yogurts", "kefirs", "skyr", "fromages-blancs"];
const TREAT_CATS = [
  "sugary-snacks", "candies", "candy", "chocolates", "confectioneries",
  "biscuits", "cakes", "pastries", "desserts", "ice-cream", "chips-and-fries",
  "crisps", "french-fries", "fried-food", "salty-snacks", "viennoiseries", "pies",
];
const SODA_CATS = ["sodas", "soft-drink", "energy-drink", "sweetened-beverages"];
const JUICE_CATS = ["juices", "nectars", "smoothies"];
const PRODUCE_CATS = ["fruits", "fruit", "vegetables", "legumes", "salads"];

const catIn = (...values: string[]): Condition => ({ kind: "category", op: "includesAny", values });
const catNotIn = (...values: string[]): Condition => ({ kind: "category", op: "excludesAll", values });
const isMissing = (field: NumericField): Condition => ({ kind: "missing", field, missing: true });
const num = (
  field: NumericField,
  op: "<" | "<=" | ">" | ">=" | "==",
  value: number,
  whenMissing: "skip" | "treatAsZero" | "pass" = "skip",
): Condition => ({ kind: "numeric", field, op, value, whenMissing });

/** Nuts and nut butters are calorie-dense by nature; the protocol spares them
 *  from the fat and calorie-density red rules unless they are sweetened. */
const UNLESS_NUTS: Condition[] = [catIn(...NUT_CATS), num("added_100", "<", 5, "pass")];

export const DEFAULT_RULES: Rule[] = [
  // ----------------------------- beverages ---------------------------------
  {
    id: "bev-skim-milk", enabled: true, priority: 10, scope: "beverage", color: "green",
    label: "Skim / fat-free milk",
    reason: "Skim milk: nutrient-rich, low fat",
    all: [catIn("milks"), catNotIn("flavoured-milks", "chocolate"), catIn("skimmed", "fat-free")],
  },
  {
    id: "bev-plain-milk", enabled: true, priority: 20, scope: "beverage", color: "yellow",
    label: "Plain milk",
    reason: "Plain milk: staple beverage",
    all: [catIn("milks"), catNotIn("flavoured-milks", "chocolate"), num("added_100", "<", 1, "treatAsZero")],
  },
  {
    id: "bev-diet-drink", enabled: true, priority: 30, scope: "beverage", color: "yellow",
    label: "Diet / zero-sugar drink",
    reason: "Diet / zero-sugar drink: no added sugar, but not a “go” drink",
    all: [
      catIn(...SODA_CATS),
      num("sugars_100", "<", 2.5, "treatAsZero"),
      num("added_100", "<", 1, "treatAsZero"),
    ],
  },
  {
    id: "bev-soda", enabled: true, priority: 40, scope: "beverage", color: "red",
    label: "Soda / energy drink",
    reason: "Sugary drink: soda and energy drinks are red foods",
    all: [catIn(...SODA_CATS)],
  },
  {
    id: "bev-added-sugar", enabled: true, priority: 50, scope: "beverage", color: "red",
    label: "Drink with added sugar",
    reason: "Sugary drink: {value}g added sugar per 100ml (≥ {limit})",
    all: [num("added_100", ">=", 4)],
  },
  {
    id: "bev-high-sugars", enabled: true, priority: 60, scope: "beverage", color: "red",
    label: "Sweet drink (added sugar unknown)",
    reason: "Sugary drink: {value}g sugars per 100ml (≥ {limit})",
    all: [isMissing("added_100"), num("sugars_100", ">=", 5), catNotIn("milks")],
  },
  {
    id: "bev-juice", enabled: true, priority: 70, scope: "beverage", color: "red",
    label: "Fruit juice",
    reason: "Fruit juice: most traffic-light programs count juice as red",
    all: [catIn(...JUICE_CATS)],
  },
  {
    id: "bev-water", enabled: true, priority: 80, scope: "beverage", color: "green",
    label: "Water / unsweetened drink",
    reason: "Water or unsweetened drink: {value} kcal per 100ml",
    all: [num("kcal_100", "<=", 20), num("sugars_100", "<", 2.5, "treatAsZero")],
  },

  // --------------------------- foods: red ----------------------------------
  {
    id: "red-treat-category", enabled: true, priority: 100, scope: "food", color: "red",
    label: "Sweets, snacks and fried foods",
    reason: "Treat / snack category: high in sugar or fat, low nutrition",
    all: [catIn(...TREAT_CATS)],
    // Open Food Facts files yogurts under "desserts"; judge those on nutrients.
    except: [catIn(...YOGURT_CATS)],
  },
  {
    id: "red-added-sugar-100", enabled: true, priority: 110, scope: "food", color: "red",
    label: "High added sugar (per 100g)",
    reason: "High added sugar: {value}g per 100g (≥ {limit})",
    all: [num("added_100", ">=", 10)],
  },
  {
    id: "red-added-sugar-serv", enabled: true, priority: 120, scope: "food", color: "red",
    label: "High added sugar (per serving fallback)",
    reason: "High added sugar: {value}g per serving (≥ {limit})",
    all: [isMissing("added_100"), num("added_serv", ">=", 8)],
  },
  {
    id: "red-very-high-sugars", enabled: true, priority: 130, scope: "food", color: "red",
    label: "Very high total sugars (added sugar unknown)",
    reason: "Very high sugars: {value}g per 100g (added sugar unknown)",
    all: [isMissing("added_100"), isMissing("added_serv"), num("sugars_100", ">=", 18)],
    // Whole fruit is naturally sugary; dried fruit is not spared.
    except: [catIn("fruits", "fruit"), catNotIn("dried")],
  },
  {
    id: "red-high-fat-100", enabled: true, priority: 140, scope: "food", color: "red",
    label: "High total fat (per 100g)",
    reason: "High fat: {value}g per 100g (≥ {limit})",
    all: [num("fat_100", ">=", 17)],
    except: UNLESS_NUTS,
  },
  {
    id: "red-high-fat-serv", enabled: true, priority: 150, scope: "food", color: "red",
    label: "High total fat (per serving fallback)",
    reason: "High fat: {value}g per serving (≥ {limit})",
    all: [isMissing("fat_100"), num("fat_serv", ">=", 10)],
    except: UNLESS_NUTS,
  },
  {
    id: "red-high-sat-100", enabled: true, priority: 160, scope: "food", color: "red",
    label: "High saturated fat (per 100g)",
    reason: "High saturated fat: {value}g per 100g (≥ {limit})",
    all: [num("sat_100", ">=", 8)],
    except: UNLESS_NUTS,
  },
  {
    id: "red-high-sat-serv", enabled: true, priority: 170, scope: "food", color: "red",
    label: "High saturated fat (per serving fallback)",
    reason: "High saturated fat: {value}g per serving (≥ {limit})",
    all: [isMissing("sat_100"), num("sat_serv", ">=", 5)],
    except: UNLESS_NUTS,
  },
  {
    id: "red-calorie-dense", enabled: true, priority: 180, scope: "food", color: "red",
    label: "Calorie-dense (unless protein-rich)",
    reason: "Calorie-dense: {value} kcal per 100g (≥ {limit})",
    all: [num("kcal_100", ">=", 400), num("protein_100", "<", 15, "treatAsZero")],
    except: UNLESS_NUTS,
  },

  // -------------------------- foods: green ---------------------------------
  {
    id: "green-produce", enabled: true, priority: 200, scope: "food", color: "green",
    label: "Fruit and vegetables",
    reason: "Fruit / vegetable: go food",
    all: [
      catIn(...PRODUCE_CATS),
      num("kcal_100", "<=", 100, "pass"),
      num("added_100", "<=", 2, "treatAsZero"),
    ],
    except: [catIn("dried")],
  },
  {
    id: "green-low-density", enabled: true, priority: 210, scope: "food", color: "green",
    label: "Very low calorie density",
    reason: "Very low calorie density: {value} kcal per 100g (≤ {limit})",
    all: [num("kcal_100", "<=", 45), num("added_100", "<=", 2, "treatAsZero")],
  },
  {
    id: "green-plain-yogurt", enabled: true, priority: 220, scope: "food", color: "green",
    label: "Plain low-fat yogurt",
    reason: "Plain low-fat yogurt: go food",
    all: [
      catIn(...YOGURT_CATS),
      num("fat_100", "<=", 2),
      num("added_100", "<=", 2, "treatAsZero"),
      num("sugars_100", "<=", 8, "treatAsZero"),
    ],
  },
  {
    id: "green-low-cal-serving", enabled: true, priority: 230, scope: "food", color: "green",
    label: "Low calorie (per serving fallback)",
    reason: "Low calorie: {value} kcal per serving (≤ {limit})",
    all: [
      isMissing("kcal_100"),
      num("kcal_serv", "<=", 50),
      num("fat_serv", "<=", 1, "treatAsZero"),
      num("added_serv", "<=", 2, "treatAsZero"),
    ],
  },

  // ------------------------- foods: yellow ---------------------------------
  {
    id: "yellow-nuts", enabled: true, priority: 300, scope: "food", color: "yellow",
    label: "Nuts and nut butters",
    reason: "Nuts / nut butter: nutritious but calorie-dense; watch portions",
    all: [catIn(...NUT_CATS)],
  },
];

export const DEFAULT_RULE_SET: RuleSet = {
  rules: DEFAULT_RULES,
  defaultColor: "yellow",
  defaultReasonFood: "Staple food: fine in sensible portions",
  defaultReasonBeverage: "Beverage: moderate",
};
