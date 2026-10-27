// Checks for the traffic-light engine. Run with `npm run test:rules`. Pure, no
// network.
//
// Each food goes the whole way a real one does: a USDA or Open Food Facts
// record through the server's mapping (functions/src/usda.ts), then group
// detection and the default rules table. Expected results are the client's
// own: the worked examples and lines in "Traffic light logic" (the PDF), and
// the guide's page numbers where the prototype cites them.
import { foodFromFDC, foodFromOFF } from "../functions/src/usda";
import { classify } from "../src/lib/rules";
import { DEFAULT_RULE_SET, normaliseRuleSet } from "../src/lib/defaultRules";
import { customFoodTags } from "../src/lib/foodTags";
import type { FoodGroup } from "../src/lib/foodGroups";
import { EMPTY_NUTRIENTS, type EntryColor, type FoodFacts } from "../src/lib/types";

const failures: string[] = [];
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) failures.push(`  ${label}: got ${a}, expected ${e}`);
}

/** A USDA search hit, as the API returns it. */
function usda(description: string, foodCategory: string, kcal: number | null, sugars: number | null = null,
  extra: Record<string, unknown> = {}): FoodFacts {
  const foodNutrients = [];
  if (kcal != null) foodNutrients.push({ nutrientId: 1008, value: kcal });
  if (sugars != null) foodNutrients.push({ nutrientId: 2000, value: sugars });
  return foodFromFDC({ description, foodCategory, dataType: "SR Legacy", foodNutrients, ...extra }) as FoodFacts;
}

/** [group, color, calories in the guide's serving] */
function verdict(f: FoodFacts): [FoodGroup | null, EntryColor | null, number | null] {
  const r = classify(f, DEFAULT_RULE_SET);
  return [r.group, r.color, r.kcalServ == null ? null : Math.round(r.kcalServ)];
}

// --- The PDF's worked example (slide 5) -------------------------------------
check("cheddar: cheese, 1 oz, 113 cal, red", verdict(usda("Cheese, cheddar", "Dairy and Egg Products", 403, 0.5)), ["cheese", "red", 113]);
check("carrots: vegetables, 1/2 cup, 27 cal, green", verdict(usda("Carrots, raw", "Vegetables and Vegetable Products", 41, 4.7)), ["veg", "green", 27]);

// --- One food per row of the table (slide 4) --------------------------------
check("vegetables: yellow band", verdict(usda("Peas, green, frozen, unprepared", "Vegetables and Vegetable Products", 77)), ["starchy", "yellow", 62]);
check("vegetables: red above 45", verdict(usda("Avocados, raw, California", "Vegetables and Vegetable Products", 167)), ["veg", "red", 109]);
check("starchy vegetables", verdict(usda("Potatoes, baked, flesh and skin", "Vegetables and Vegetable Products", 93)), ["starchy", "yellow", 74]);
check("fruit", verdict(usda("Apples, raw, with skin", "Fruits and Fruit Juices", 52, 10.4)), ["fruit", "yellow", 47]);
check("fruit juice is always red", verdict(usda("Orange juice, raw", "Fruits and Fruit Juices", 45, 8.4))[1], "red");
check("dried fruit is always red", verdict(usda("Raisins, seedless", "Fruits and Fruit Juices", 299, 59))[1], "red");
check("grains", verdict(usda("Bread, whole-wheat, commercially prepared", "Baked Products", 252)), ["grain", "yellow", 71]);
check("cold cereal within both lines", verdict(usda("Cereals ready-to-eat, GENERAL MILLS, CHEERIOS", "Breakfast Cereals", 376, 4.4)), ["cereal", "yellow", 113]);
check("cold cereal: red above 25% sugar", verdict(usda("Cereals ready-to-eat, KELLOGG, KELLOGG'S FROSTED FLAKES", "Breakfast Cereals", 369, 35)), ["cereal", "red", 111]);
check("milk", verdict(usda("Milk, nonfat, fluid, with added vitamin A and vitamin D", "Dairy and Egg Products", 34, 5)), ["dairy", "yellow", 83]);
check("whole milk is red", verdict(usda("Milk, whole, 3.25% milkfat, with added vitamin D", "Dairy and Egg Products", 61, 5))[1], "red");
check("meat", verdict(usda("Chicken, broilers or fryers, breast, meat only, cooked, roasted", "Poultry Products", 165)), ["meat", "yellow", 140]);
check("meat: red above 158", verdict(usda("Beef, ground, 80% lean meat / 20% fat, pan-browned", "Beef Products", 272)), ["meat", "red", 231]);
check("eggs, at 1 egg", verdict(usda("Egg, whole, cooked, hard-boiled", "Dairy and Egg Products", 155)), ["protein", "yellow", 78]);
check("beans", verdict(usda("Beans, black, mature seeds, cooked, boiled, without salt", "Legumes and Legume Products", 132)), ["protein", "yellow", 119]);
check("nuts", verdict(usda("Nuts, almonds", "Nut and Seed Products", 579)), ["nuts", "red", 162]);
check("fats and oils are always red", verdict(usda("Oil, olive, salad or cooking", "Fats and Oils", 884))[1], "red");
check("sweets are always red", verdict(usda("Cookies, chocolate chip, commercially prepared", "Baked Products", 488))[1], "red");
check("broth soup", verdict(usda("Soup, chicken noodle, canned, prepared with equal volume water", "Soups, Sauces, and Gravies", 25)), ["soupBroth", "yellow", 61]);
check("chili", verdict(usda("Chili con carne with beans, canned entree", "Meals, Entrees, and Side Dishes", 105)), ["soupChili", "red", 257]);
check("lentil soup", verdict(usda("Soup, lentil, canned, ready-to-serve", "Soups, Sauces, and Gravies", 56)), ["soupChili", "yellow", 137]);
check("condiment", verdict(usda("Catsup", "Soups, Sauces, and Gravies", 101)), ["condiment", "yellow", 15]);
check("combination food: no verdict", verdict(usda("Pizza, pepperoni topping, regular crust, frozen, cooked", "Fast Foods", 270)), ["combo", null, null]);
check("water has no color", verdict(usda("Beverages, water, tap, drinking", "Beverages", 0, 0)), ["free", "none", null]);
check("plain coffee has no color", verdict(usda("Beverages, coffee, brewed, prepared with tap water", "Beverages", 1, 0))[1], "none");
check("salt has no color", verdict(usda("Salt, table", "Spices and Herbs", 0))[1], "none");

// --- The special rules (slide 6) --------------------------------------------
check("soda is red", verdict(usda("Beverages, carbonated, cola, contains caffeine", "Beverages", 37, 9))[1], "red");
check("diet soda is red at zero calories", verdict(usda("Beverages, carbonated, cola, without caffeine, sugar free", "Beverages", 0, 0))[1], "red");
check("an artificial sweetener in the ingredients makes a drink red",
  verdict(usda("SPARKLING FLAVORED WATER", "Beverages", 0, 0, { dataType: "Branded", ingredients: "CARBONATED WATER, NATURAL FLAVOR, SUCRALOSE" }))[1], "red");

// --- The guide's serving, not the package's ---------------------------------
check("a yogurt cup is judged as the cup (label serving 150 g)",
  verdict(usda("GREEK YOGURT, PLAIN, NONFAT", "Dairy and Egg Products", 59, 3.2, { dataType: "Branded", servingSize: 150, servingSizeUnit: "g" })), ["dairy", "yellow", 89]);
check("cottage cheese at 1/2 cup", verdict(usda("COTTAGE CHEESE, LOWFAT", "Dairy and Egg Products", 81))[2], 92);
// The prototype's serving overrides read words in order, and USDA's reference
// rows invert the name, so "Cheese, cottage" is judged at the 1 oz cheese
// serving. Pinned so a change to that is deliberate.
check("USDA's inverted \"Cheese, cottage\" gets the 1 oz serving", verdict(usda("Cheese, cottage, lowfat, 2% milkfat", "Dairy and Egg Products", 81))[2], 23);
check("Foundation foods report energy as 2047",
  verdict(foodFromFDC({ description: "Carrots, baby, raw", foodCategory: "Vegetables and Vegetable Products", dataType: "Foundation", foodNutrients: [{ nutrientId: 2047, value: 35 }] }) as FoodFacts),
  ["veg", "green", 23]);
check("calories are compared as whole numbers (120.4 is 120, yellow)",
  verdict(usda("Bread, white, commercially prepared", "Baked Products", 430))[1], "yellow");

// --- No verdict where the guide gives none ----------------------------------
check("no calorie data: no verdict", verdict(usda("Cheese, cheddar", "Dairy and Egg Products", null))[1], null);
check("undetected group: no verdict", verdict(usda("Xyzzy", "", 100)), [null, null, null]);

// --- Other routes in -------------------------------------------------------
const off = foodFromOFF({
  product_name: "Greek Yogurt Plain", categories_tags: ["en:dairies", "en:fermented-milk-products", "en:yogurts"],
  nutriments: { "energy-kcal_100g": 59, "sugars_100g": 3.2 }, serving_quantity: 170, serving_size: "170 g",
}) as FoodFacts;
check("barcode (Open Food Facts) yogurt", verdict(off), ["dairy", "yellow", 100]);
// Shaped as customFood() in src/lib/foodApi.ts builds it (that module needs a
// browser Firebase config, so it cannot load here): per-serving figures only.
const custom = (name: string, kcal: number, isBeverage = false): FoodFacts => ({
  name, brand: "Custom entry", cats: customFoodTags(name, isBeverage), isBeverage,
  per100: { ...EMPTY_NUTRIENTS }, serv: { ...EMPTY_NUTRIENTS, kcal, sugars: 0 },
  servingLabel: "1 serving", source: "Custom entry", code: "", usdaCategory: "", sweetened: false, servQtyG: null,
});
check("hand-entered: per-serving calories stand in", verdict(custom("Grilled chicken", 200)), ["meat", "red", 200]);
check("hand-entered sweet is red", verdict(custom("Homemade cookie", 150))[1], "red");
check("hand-entered water has no color", verdict(custom("Water", 0, true))[1], "none");

// --- Stored rule sets ----------------------------------------------------
check("the retired rule list reads as the defaults",
  normaliseRuleSet({ rules: [], defaultColor: "yellow" }) === DEFAULT_RULE_SET, true);
check("a retuned line is kept",
  normaliseRuleSet({ version: 2, groups: { cheese: { ...DEFAULT_RULE_SET.groups.cheese, yellow: 120 } } }).groups.cheese.yellow, 120);
check("a group missing from a stored table is filled in",
  normaliseRuleSet({ version: 2, groups: {} }).groups.veg.green, 30);
check("a retuned line changes the verdict",
  classify(usda("Cheese, cheddar", "Dairy and Egg Products", 403),
    normaliseRuleSet({ version: 2, groups: { cheese: { ...DEFAULT_RULE_SET.groups.cheese, yellow: 120 } } })).color, "yellow");

if (failures.length) {
  console.log(`Rules: ${failures.length} check(s) FAILED`);
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log(`Rules: all ${checks} checks pass`);
