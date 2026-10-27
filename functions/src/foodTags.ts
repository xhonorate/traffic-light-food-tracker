/**
 * The program's food categories, and how a food is put into them.
 *
 * Every food, whatever its source, ends up carrying tags from FOOD_TAGS and
 * nothing else, so food-group detection (foodGroups.ts) sees every food the
 * same way. `fdcCatsToTags` is the client's own mapping from the traffic-light-food-
 * logger prototype, ported line for line; change it only alongside theirs.
 *
 * Kept free of imports so the identical file can live in both packages: this
 * one for custom entries and group detection, and functions/src/foodTags.ts for
 * search and barcode results. `npm run test:categories` fails if they differ.
 */

/** Every tag a food can carry. */
export const FOOD_TAGS = [
  "beverages",
  "biscuits",
  "breakfast-cereals",
  "candies",
  "carbonated-waters",
  "cereals",
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

export type FoodTag = (typeof FOOD_TAGS)[number];

// ---------------------------------------------------------------------------
// USDA FoodData Central -> tags (the prototype's fdcCatsToTags)
// ---------------------------------------------------------------------------

export const FDC_FRUIT_WORDS = ["apple", "applesauce", "apricot", "avocado", "banana", "berry", "berries", "blackberry", "blackberries",
  "blueberry", "blueberries", "cantaloupe", "cherry", "cherries", "clementine", "cranberry", "cranberries", "dates", "fig", "fruit",
  "grape", "grapefruit", "guava", "honeydew", "kiwi", "lemon", "lime", "lychee", "mandarin", "mango", "melon", "nectarine",
  "orange", "papaya", "peach", "peaches", "pear", "persimmon", "pineapple", "plum", "pomegranate", "raspberry", "raspberries",
  "strawberry", "strawberries", "tangerine", "watermelon"];
export const FDC_VEG_WORDS = ["artichoke", "arugula", "asparagus", "bok choy", "broccoli", "brussels sprout", "cabbage", "carrot",
  "cauliflower", "celery", "chard", "collard", "cucumber", "eggplant", "endive", "escarole", "green bean", "greens", "kale",
  "leek", "lettuce", "mushroom", "okra", "onion", "pepper", "radish", "romaine", "salad", "sauerkraut", "scallion", "spinach",
  "sprouts", "squash", "tomato", "tomatoes", "turnip", "vegetable", "vegetables", "watercress", "zucchini"];
export const FDC_NOT_PRODUCE = ["pie", "cake", "cobbler", "tart", "bread", "muffin", "cookie", "juice", "drink", "smoothie", "chip",
  "chips", "fries", "fried", "candied", "glazed", "pudding", "cream", "sauce", "soup", "casserole", "pizza", "jam", "jelly",
  "roll", "bar", "bars", "syrup", "nectar", "dried", "leather", "snacks"];

function fdcWords(s: unknown): string[] {
  return String(s || "").toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
}

/**
 * USDA Survey (FNDDS) records carry a WWEIA category in foodCategory -
 * "Bananas", "Carrots", "Spinach" - not the "Fruits and Fruit Juices" wording
 * Foundation and SR Legacy use, so matching on foodCategory alone misses every
 * generic produce item. FNDDS writes descriptions as "<food>, <preparation>",
 * so the segment before the first comma identifies the food. Match whole
 * words, never substrings.
 */
function fdcProduceKind(desc: unknown, cat: unknown): "fruit" | "veg" | null {
  const all = fdcWords(desc);
  if (all.some((w) => FDC_NOT_PRODUCE.indexOf(w) !== -1)) return null;
  const words = fdcWords(String(desc || "").split(",")[0]).concat(fdcWords(cat));
  const hit = (list: string[]) => words.some((w) =>
    list.indexOf(w) !== -1 ||
    (w.length > 3 && w.slice(-1) === "s" && list.indexOf(w.slice(0, -1)) !== -1) ||
    (w.length > 4 && w.slice(-2) === "es" && list.indexOf(w.slice(0, -2)) !== -1));
  if (hit(FDC_FRUIT_WORDS)) return "fruit";
  if (hit(FDC_VEG_WORDS)) return "veg";
  return null;
}

/**
 * Map a USDA record (its `foodCategory` and `description`) onto FOOD_TAGS.
 * A hand-entered food goes through here too, with its name as the
 * description.
 */
export function fdcCatsToTags(f: { foodCategory?: unknown; description?: unknown }): { tags: FoodTag[]; isBeverage: boolean } {
  const cat = String(f.foodCategory || "").toLowerCase();
  const desc = String(f.description || "").toLowerCase();
  const tags: FoodTag[] = [];
  let isBeverage = false;
  if (cat.includes("vegetable")) tags.push("vegetables");
  if (cat.includes("fruit")) {
    // "Pineapple, canned, juice pack" and "in 100% juice" name the liquid the fruit is
    // packed in; the product is canned fruit, not a glass of juice
    const packLiquid = /\b(juice pack|in (100% )?(fruit |natural |own )?juice|natural juice|own juice)\b/.test(desc);
    if ((desc.includes("juice") || desc.includes("nectar")) && !packLiquid) { tags.push("beverages", "fruit-juices"); isBeverage = true; }
    else tags.push("fruits");
    if (desc.includes("dried") || desc.includes("dehydrated")) tags.push("dried");
  }
  if (cat.includes("sweets") || desc.includes("candy") || desc.includes("candies")) tags.push("sugary-snacks", "candies");
  if (cat.includes("snacks")) tags.push("salty-snacks");
  if (cat.includes("baked products") && /cookie|cake|pastry|doughnut|donut|brownie|pie\b/.test(desc)) tags.push("sugary-snacks", "biscuits");
  // "Cereal Grains and Pasta" is USDA's grain category, not breakfast cereal
  if (cat.includes("cereal") && !cat.includes("cereal grains")) tags.push("breakfast-cereals");
  if (cat.includes("cereal grains") || cat.includes("pasta")) tags.push("cereals");
  if (cat.includes("nut and seed")) tags.push("nuts");
  if (cat.includes("beverages") || cat.includes("alcoholic")) { tags.push("beverages"); isBeverage = true; }
  // Club soda is carbonated water, so it must not read as a soda
  if (/\b(club soda|soda water|seltzer|sparkling water)\b/.test(desc)) { tags.push("beverages", "carbonated-waters"); isBeverage = true; }
  else if (/\b(soda|sodas|cola|colas|soft drinks?|energy drinks?)\b/.test(desc)) { tags.push("beverages", "sodas"); isBeverage = true; }
  if ((cat.includes("dairy") || cat.includes("beverages")) && desc.includes("milk") && !cat.includes("sweets")) {
    tags.push("beverages", "milks"); isBeverage = true;
    if (/skim|nonfat|non-fat|fat.free/.test(desc)) tags.push("skimmed-milks");
    if (/chocolate|strawberry|flavored|flavoured/.test(desc)) tags.push("flavoured-milks");
  }
  if (desc.includes("yogurt") || desc.includes("yoghurt")) { tags.push("yogurts"); isBeverage = false; }
  if (desc.includes("fried") && !desc.includes("stir")) tags.push("fried-food");
  // "Oatmeal, cooked with water" and "tuna, packed in water" are not water
  if (/\bwater\b/.test(desc) && !/\b(with|in) (tap |spring )?water\b/.test(desc) && (cat.includes("beverages") || !cat)) { tags.push("waters"); isBeverage = true; }
  if (!isBeverage && !tags.some((t) => t === "fruits" || t === "vegetables")) {
    const kind = fdcProduceKind(f.description, f.foodCategory);
    if (kind === "fruit") tags.push("fruits");
    else if (kind === "veg") tags.push("vegetables");
  }
  return { tags: [...new Set(tags)], isBeverage };
}

/**
 * Tags for a food typed in by hand: the same mapping, reading the name as the
 * description. The family's food/drink choice stands in for USDA's category
 * and always wins, so a "food" never comes out tagged as a drink.
 */
export function customFoodTags(name: string, isBeverage: boolean): FoodTag[] {
  const { tags } = fdcCatsToTags({ description: name, foodCategory: isBeverage ? "Beverages" : "" });
  return isBeverage ? tags : tags.filter((t) => t !== "beverages");
}

// ---------------------------------------------------------------------------
// Open Food Facts -> tags
// ---------------------------------------------------------------------------

/**
 * Open Food Facts categories that correspond to a tag, each mapped to what
 * fdcCatsToTags gives the matching USDA category: confectionery gets what
 * "Sweets" gets, pasta what "Cereal Grains and Pasta" gets. Most program tags
 * are Open Food Facts category names already. A product carries every
 * ancestor of its category, so the broad parents here catch the specific
 * kinds beneath them. Anything not listed contributes no tag.
 */
const OFF_TO_TAGS: Record<string, FoodTag[]> = {
  "vegetables": ["vegetables"],
  "vegetable-juices": ["vegetables"],
  "fruits": ["fruits"],
  "dried-fruits": ["fruits", "dried"],
  "fruit-juices": ["beverages", "fruit-juices"],
  "fruit-nectars": ["beverages", "fruit-juices"],
  "smoothies": ["beverages", "fruit-juices"],
  "sweet-snacks": ["sugary-snacks", "candies"],
  "confectioneries": ["sugary-snacks", "candies"],
  "candies": ["sugary-snacks", "candies"],
  "chocolates": ["sugary-snacks", "candies"],
  "desserts": ["sugary-snacks", "candies"],
  "biscuits": ["sugary-snacks", "biscuits"],
  "biscuits-and-cakes": ["sugary-snacks", "biscuits"],
  "cakes": ["sugary-snacks", "biscuits"],
  "pastries": ["sugary-snacks", "biscuits"],
  "viennoiseries": ["sugary-snacks", "biscuits"],
  "pies": ["sugary-snacks", "biscuits"],
  "doughnuts": ["sugary-snacks", "biscuits"],
  "salty-snacks": ["salty-snacks"],
  "appetizers": ["salty-snacks"],
  "crisps": ["salty-snacks"],
  "chips-and-fries": ["fried-food"],
  "fried-foods": ["fried-food"],
  "breakfast-cereals": ["breakfast-cereals"],
  "cereal-grains": ["cereals"],
  "pastas": ["cereals"],
  "rices": ["cereals"],
  "nuts": ["nuts"],
  "nut-butters": ["nuts"],
  "seeds": ["nuts"],
  "beverages": ["beverages"],
  "sodas": ["beverages", "sodas"],
  "soft-drinks": ["beverages", "sodas"],
  "energy-drinks": ["beverages", "sodas"],
  "waters": ["beverages", "waters"],
  "carbonated-waters": ["beverages", "carbonated-waters"],
  "milks": ["beverages", "milks"],
  "plant-based-milk-alternatives": ["beverages", "milks"],
  "skimmed-milks": ["skimmed-milks"],
  "flavoured-milks": ["flavoured-milks"],
  "yogurts": ["yogurts"],
};

/** Map an Open Food Facts product's `categories_tags` onto FOOD_TAGS. */
export function offCatsToTags(categories: string[]): FoodTag[] {
  const tags = new Set<FoodTag>();
  for (const c of categories) {
    const slug = String(c).toLowerCase().replace(/^en:/, "");
    for (const t of OFF_TO_TAGS[slug] ?? []) tags.add(t);
  }
  return [...tags];
}
