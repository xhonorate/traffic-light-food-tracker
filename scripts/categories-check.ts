// Checks for the program's food categories. Run with `npm run test:categories`.
// Pure, no network.
//
// The tag mapping lives in src/lib/foodTags.ts and is copied verbatim to
// functions/src/foodTags.ts, a separate package; this fails the moment the two
// drift apart. It also pins how real USDA and Open Food Facts records are
// sorted. The tags feed food-group detection (src/lib/foodGroups.ts).
import { readFileSync } from "node:fs";
import { FOOD_TAGS, customFoodTags, fdcCatsToTags, offCatsToTags } from "../src/lib/foodTags";
import { isFoodTag, suggestCategories } from "../src/lib/categories";

const failures: string[] = [];
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) failures.push(`  ${label}: got ${a}, expected ${e}`);
}

const eol = (s: string) => s.replace(/\r\n/g, "\n");
check("functions/src/foodTags.ts is identical to src/lib/foodTags.ts",
  eol(readFileSync("functions/src/foodTags.ts", "utf8")) === eol(readFileSync("src/lib/foodTags.ts", "utf8")), true);

// Every tag a mapping can emit is in FOOD_TAGS, and every tag in FOOD_TAGS
// can be emitted by something.
const src = readFileSync("src/lib/foodTags.ts", "utf8");
const listEnd = src.indexOf("] as const");
const emitted = new Set([...src.slice(listEnd).matchAll(/"([a-z]+(?:-[a-z]+)*)"/g)].map((m) => m[1])
  .filter((t) => (FOOD_TAGS as readonly string[]).includes(t)));
check("every food tag can be produced", [...FOOD_TAGS].filter((t) => !emitted.has(t)), []);

// USDA records, sorted the way the client's prototype sorts them.
const fdc = (description: string, foodCategory: string) => {
  const r = fdcCatsToTags({ description, foodCategory });
  return [r.tags.sort(), r.isBeverage];
};
check("fresh fruit", fdc("Apples, raw, with skin", "Fruits and Fruit Juices"), [["fruits"], false]);
check("canned fruit in juice is fruit", fdc("Pineapple, canned, juice pack, solids and liquids", "Fruits and Fruit Juices"), [["fruits"], false]);
check("fruit juice", fdc("Orange juice, raw", "Fruits and Fruit Juices"), [["beverages", "fruit-juices"], true]);
check("dried fruit", fdc("Apricots, dried, sulfured, uncooked", "Fruits and Fruit Juices"), [["dried", "fruits"], false]);
check("FNDDS produce by name", fdc("Banana, raw", "Bananas"), [["fruits"], false]);
check("FNDDS vegetable by name", fdc("Carrots, raw", "Carrots"), [["vegetables"], false]);
check("cereal grains are not breakfast cereal", fdc("Rice, white, long-grain, cooked", "Cereal Grains and Pasta"), [["cereals"], false]);
check("breakfast cereal", fdc("Cereals ready-to-eat, corn flakes", "Breakfast Cereals"), [["breakfast-cereals"], false]);
check("cookie", fdc("Cookies, chocolate chip", "Baked Products"), [["biscuits", "sugary-snacks"], false]);
check("candy", fdc("Candies, milk chocolate", "Sweets"), [["candies", "sugary-snacks"], false]);
check("chips", fdc("Snacks, potato chips, plain, salted", "Snacks"), [["salty-snacks"], false]);
check("nuts", fdc("Nuts, almonds", "Nut and Seed Products"), [["nuts"], false]);
check("soda", fdc("Beverages, carbonated, cola", "Beverages"), [["beverages", "sodas"], true]);
check("club soda is water, not soda", fdc("Beverages, carbonated, club soda", "Beverages"), [["beverages", "carbonated-waters"], true]);
check("skim milk", fdc("Milk, nonfat, fluid", "Dairy and Egg Products"), [["beverages", "milks", "skimmed-milks"], true]);
check("chocolate milk", fdc("Milk, chocolate, fluid", "Dairy and Egg Products"), [["beverages", "flavoured-milks", "milks"], true]);
check("yogurt is food", fdc("Yogurt, Greek, plain, nonfat", "Dairy and Egg Products"), [["yogurts"], false]);
check("fried", fdc("Chicken, broilers or fryers, breast, meat only, fried", "Poultry Products"), [["fried-food"], false]);
check("stir-fried is not fried food", fdc("Beef, stir fried", "Beef Products"), [[], false]);
check("water", fdc("Beverages, water, tap, drinking", "Beverages"), [["beverages", "waters"], true]);
check("cooked with water is not water", fdc("Cereals, oats, cooked with water", "Breakfast Cereals"), [["breakfast-cereals"], false]);

// Open Food Facts products, by their real category tags (ancestors included).
const off = (cats: string[]) => offCatsToTags(cats).sort();
check("OFF orange juice", off(["en:plant-based-foods-and-beverages", "en:beverages", "en:plant-based-beverages",
  "en:fruit-based-beverages", "en:juices-and-nectars", "en:fruit-juices", "en:orange-juices"]), ["beverages", "fruit-juices"]);
check("OFF vegetable juice is not fruit juice", off(["en:beverages", "en:juices-and-nectars", "en:vegetable-juices"]), ["beverages", "vegetables"]);
check("OFF peanut butter", off(["en:spreads", "en:plant-based-spreads", "en:nut-butters", "en:peanut-butters"]), ["nuts"]);
check("OFF raisins", off(["en:plant-based-foods", "en:fruits", "en:dried-fruits", "en:raisins"]), ["dried", "fruits"]);
check("OFF chocolate bar", off(["en:snacks", "en:sweet-snacks", "en:cocoa-and-its-products", "en:chocolates"]), ["candies", "sugary-snacks"]);
check("OFF crisps", off(["en:snacks", "en:salty-snacks", "en:appetizers", "en:chips-and-fries", "en:crisps"]), ["fried-food", "salty-snacks"]);
check("OFF pasta", off(["en:plant-based-foods", "en:cereals-and-potatoes", "en:cereals-and-their-products", "en:pastas"]), ["cereals"]);
check("OFF meat has no tag", off(["en:meats", "en:poultries", "en:chickens"]), []);

// Hand-entered foods go through the same USDA mapping.
const custom = (name: string, isBeverage: boolean) => customFoodTags(name, isBeverage).sort();
check("custom fruit", custom("Strawberries", false), ["fruits"]);
check("custom drink", custom("Iced tea", true), ["beverages"]);
check("custom milk drink", custom("Skim milk", true), ["beverages", "milks", "skimmed-milks"]);
check("custom food is never tagged a drink", custom("Diet soda", false), ["sodas"]);

// Rule editor suggestions.
const s = (q: string, exclude: string[] = []) => suggestCategories(q, exclude);
check("empty query offers every food tag", s(""), [...FOOD_TAGS]);
check("matches within food tags", s("snack"), ["salty-snacks", "sugary-snacks"]);
check("unknown categories are not offered", s("chocolate"), []);
check("already-chosen tags are not offered", s("snack", ["salty-snacks"]), ["sugary-snacks"]);
check("spaces read as dashes", s("breakfast cereals")[0], "breakfast-cereals");
check("en: prefix is ignored", s("en:yogurts")[0], "yogurts");
check("old Open Food Facts tags are not food tags", isFoodTag("nut-butters"), false);

if (failures.length) {
  console.log(`Categories: ${failures.length} check(s) FAILED`);
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log(`Categories: all ${checks} checks pass`);
