/**
 * Which of the guide's food groups a food belongs to.
 *
 * Ported line for line from detectGroup() and its helpers in the client's
 * traffic-light-food-logger prototype; only type annotations were added.
 * Change it only alongside theirs. It reads the food's name, USDA category
 * and FOOD_TAGS (see foodTags.ts), and returns the group, a reason, and the
 * gram serving the guide uses when it differs from the group's default.
 *
 * Epstein, The Food & Activity Reference Guide (2012). Page numbers in the
 * comments refer to the guide.
 */
import { FDC_FRUIT_WORDS, FDC_VEG_WORDS, FDC_NOT_PRODUCE } from "./foodTags";
import type { FoodFacts } from "./types";

/** The guide's seventeen food groups, in the order the rules table lists them. */
export const FOOD_GROUPS = [
  "veg", "starchy", "fruit", "juice", "grain", "cereal", "cheese", "dairy", "meat", "protein", "nuts",
  "sweets", "soupBroth", "soupChili", "condiment", "combo", "free",
] as const;

export type FoodGroup = (typeof FOOD_GROUPS)[number];

/** What detection reads. The extra fields are optional because foods saved
 *  before they existed (quick-add chips) do not carry them. */
export type GroupInput = Pick<FoodFacts, "name" | "cats" | "isBeverage" | "per100"> &
  Partial<Pick<FoodFacts, "usdaCategory" | "sweetened" | "servQtyG">>;

export interface DetectedGroup {
  group: FoodGroup | null;
  why: string;
  /** Grams of the guide's serving for this particular food, when it differs
   *  from the group's own serving (a yogurt cup, a patty, a packet). */
  servG: number | null;
}

// Match whole words, never substrings - "unsweetened-beverages" must not read
// as "sweetened-beverages", the same way "chocolate" must not read as "cola". A
// leading language prefix ("en:") is tolerated and ignored.
function tagWords(c: string): string[] { return String(c).toLowerCase().replace(/^[a-z]{2,3}:/, "").split(/[-\s]+/); }
function hasCat(cats: string[], ...needles: string[]): boolean {
  return (cats || []).some(c => {
    const w = tagWords(c);
    return needles.some(n => {
      const nw = String(n).toLowerCase().split(/[-\s]+/);
      return w.some((_, i) => nw.every((x, j) => w[i + j] === x));
    });
  });
}

// Free-text matching on product names and USDA descriptions: whole words with
// simple plural tolerance, so "carrot" finds "Carrots, raw" but "pea" never
// finds "peanuts".
function textWords(s: unknown): string[] { return String(s || "").toLowerCase().split(/[^a-z0-9']+/).filter(Boolean); }

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a === b + "s" || b === a + "s" || a === b + "es" || b === a + "es") return true;
  if (b.slice(-1) === "y" && a === b.slice(0, -1) + "ies") return true;
  if (a.slice(-1) === "y" && b === a.slice(0, -1) + "ies") return true;
  return false;
}
function hasWord(w: string[], ...needles: string[]): boolean {
  return needles.some(n => {
    const nw = textWords(n);
    return nw.length > 0 && w.some((_, i) => nw.every((x, j) => sameWord(w[i + j], x)));
  });
}

const LEAFY_WORDS = ["arugula", "bok choy", "cabbage", "chard", "collard", "endive", "escarole", "greens", "kale", "lettuce",
  "romaine", "salad", "spinach", "sprouts", "watercress"];
const STARCHY_WORDS = ["potato", "potatoes", "sweet potato", "yam", "corn", "peas", "beet", "beets", "parsnip", "pumpkin",
  "butternut", "acorn squash", "hubbard", "winter squash", "plantain", "cassava", "yucca", "taro", "jicama", "mixed vegetables",
  "succotash", "fries", "french fries", "hash browns", "tater tots", "hominy"];

// Gram estimate for the FRG serving where it differs from the group default.
// Entries are [words, grams, labelRange?]. When the guide's serving is the unit
// as sold ("1 bar", "1 patty", the yogurt cup: 6 oz, 5.3 oz, 4 oz) the label's
// own serving weight is used if it falls inside labelRange, else the estimate.
const SERV_OVERRIDES: [string[], number, [number, number]?][] = [
  [["cottage cheese"], 113], [["ricotta"], 62], [["cream cheese"], 29],
  [["yogurt", "yoghurt", "skyr"], 170, [80, 300]], [["kefir"], 245],
  // sour cream: the guide prints fat free yellow and light/regular red (p.35, p.38), which only the 1/2-cup serving reproduces
  [["sour cream"], 115],
  [["peanut butter", "almond butter", "cashew butter", "nut butter", "tahini", "sunflower butter"], 32],
  [["egg", "eggs"], 50], [["tofu", "tempeh"], 85], [["patty", "patties", "veggie burger", "links", "nuggets"], 85, [40, 150]], [["edamame"], 78],
  // beans in sauce are denser than drained beans: the guide's 1/2 cup of baked beans weighs about 127 g
  [["baked beans", "refried beans", "pork and beans", "beans in sauce"], 127],
  [["pickle", "pickles", "spear"], 35], [["salsa", "hummus", "dip", "guacamole"], 30], [["gravy"], 60],
  [["whipped cream", "reddi wip", "whipped topping"], 3],   // aerosol whipped cream: 1 Tbsp weighs about 3 g (FRG 13 cal, p.73)
  [["cocoa powder", "baking cocoa"], 5], [["gnocchi"], 68],
  [["dates", "date"], 24],   // 1 medjool or 3 deglet noor: the guide's yellow serving (p.21)
  [["broth", "stock", "bouillon"], 245],
  // hot dogs and frankfurters have no override: the guide judges every lunchmeat and sausage at 3 oz (p.44, p.52-53)
];
function servOverride(w: string[], f: GroupInput): number | null {
  for (const [needles, g, range] of SERV_OVERRIDES) if (hasWord(w, ...needles)) return labelServ(f, range) || g;
  return null;
}
function labelServ(f: GroupInput, range?: [number, number]): number | null {
  const q = f && typeof f.servQtyG === "number" ? f.servQtyG : null;
  return (range && q != null && q >= range[0] && q <= range[1]) ? q : null;
}

// Decide the FRG food group from the product name, USDA's category string and the
// tags derived from it. Order matters: the specific and the always-red come first.
export function detectGroup(f: GroupInput): DetectedGroup {
  const cats = f.cats || [];
  const w = textWords(f.name);
  const wc = textWords(f.usdaCategory);
  const k = (f.per100 && typeof f.per100.kcal === "number") ? f.per100.kcal : null;
  const sug = (f.per100 && typeof f.per100.sugars === "number") ? f.per100.sugars : null;
  const bev = !!f.isBeverage;
  const cat = (...n: string[]) => hasCat(cats, ...n);
  const word = (...n: string[]) => hasWord(w, ...n);
  const cword = (...n: string[]) => hasWord(wc, ...n);
  const R = (group: FoodGroup, why: string, servG?: number | null): DetectedGroup => ({ group, why, servG: servG || servOverride(w, f) || null });
  // canned fruit "in juice" or "in heavy syrup" is fruit at 1/2 cup (FRG p.21-23), not juice and not a sweet
  const fruitWord = cat("fruits", "fruit") || hasWord(w, ...FDC_FRUIT_WORDS);
  const juicy = word("juice") && !word("in juice", "own juice", "juice pack", "natural juice", "100% juice", "fruit juice", "pear juice", "pineapple juice", "white grape juice");   // a drink, not the pack liquid
  const cannedFruit = fruitWord && !bev && !cat("fruit-juices", "juices") &&
                      !word("dried", "dehydrated") &&
                      (!juicy &&
                       (
                       word("in juice", "own juice", "juice pack", "natural juice", "chunks", "slices", "halves", "tidbits", "crushed", "cocktail", "fruit cup", "fruit cups", "applesauce", "canned") ||
                        word("in syrup", "heavy syrup", "light syrup", "extra light syrup", "syrup pack")));
  // a name that says it is a sweet (oatmeal cookies, cinnamon rolls) overrides grain-shaped words later on
  const sweetWord = word("cookie", "cookies", "brownie", "brownies", "cupcake", "cupcakes", "pie", "pies", "donut", "donuts", "doughnut", "doughnuts",
                         "pastry", "pastries", "candy", "candies", "cinnamon roll", "cinnamon rolls", "sweet roll", "sweet rolls", "danish", "cake", "cakes", "treats",
                         "pudding", "puddings", "custard", "cobbler", "trifle") &&
                    !word("rice cake", "rice cakes", "pancake", "pancakes", "crab cake", "fish cake", "corn cake", "corn cakes");
  // A grain-shaped product keeps its grain identity when a stray word from another group appears in the
  // name: "cinnamon raisin bagel" is not dried fruit, "Cape Cod popcorn" is not cod, "basmati rice with
  // bell peppers" is not a vegetable. Chips and crisps are excluded because the guide files them as snacks.
  const grainy = !sweetWord && !word("chips", "crisps", "tortilla chips", "corn chips") &&
                 (cat("cereals") ||
                  word("bread", "bagel", "bagels", "tortilla", "tortillas", "cereal", "granola", "crackers", "cracker", "pretzel", "pretzels", "popcorn",
                       "waffle", "waffles", "pancake", "pancakes", "muffin", "muffins", "oats", "oatmeal", "pasta", "noodle", "noodles", "rice", "quinoa", "couscous", "grits",
                       "bun", "buns"));
  // Likewise a product USDA files as meat, fish or poultry keeps that identity when the name carries a
  // sauce, oil or drink word: "sardines in tomato sauce", "chicken in teriyaki sauce", "beer bratwurst".
  // The category is what settles it, because the name is exactly what is misleading here.
  const animalCategory = cword("beef", "pork", "poultry", "finfish", "shellfish", "sausages", "luncheon", "lamb");
  // tofu, tempeh and seitan are filed with legumes, alongside hummus and peanut butter, so they need naming
  const proteinTagged = animalCategory || word("tofu", "tempeh", "seitan");
  //    "tuna in vegetable oil", "artichoke hearts in oil": the oil is the pack liquid, not the food
  const inOil = word("in oil", "in vegetable oil", "in olive oil", "in soybean oil", "in canola oil", "in sunflower oil", "packed in oil", "packed in olive oil");
  const frozenDessert = (word("frozen") && word("yogurt", "yoghurt", "custard")) ||
                        word("frozen yogurt", "frozen yoghurt", "froyo", "frozen dessert", "ice cream", "popsicle", "ice pop", "italian ice", "sherbet", "sorbet", "gelato");
  //    beans stay in the protein group (p.41); peanuts are legumes botanically but nuts to the guide (p.54-55)
  // USDA writes the name inverted and calls dried legumes "mature seeds", which
  // is why the plain phrases below are not enough on their own.
  const usdaLegume = word("mature seeds") ||
                     (word("bean", "beans") && word("black", "pinto", "kidney", "navy", "cannellini", "lima", "fava", "mung", "adzuki", "great northern", "red", "white", "pink"));
  const legumey = (word("baked beans", "refried beans", "black beans", "kidney beans", "pinto beans", "navy beans", "chickpeas", "lentils") || usdaLegume) &&
                  !cat("nuts") && !word("peanut", "peanuts") &&
                  !word("green bean", "green beans", "snap", "string beans", "wax bean", "wax beans", "vanilla", "coffee", "cocoa");

  // 1. drinks the guide puts in Fats/Oils/Sweets: red, diet versions included (FRG p.2, p.59-60).
  //    Zero-calorie flavoured waters (Propel, Vitaminwater Zero, Crystal Light) sit in the guide's
  //    sports-drink list, and any drink carrying an artificial sweetener is red on p.2.
  if (cat("sodas") ||
      (!proteinTagged && !grainy && (
        (word("soda") && !word("club soda", "soda water", "baking soda")) ||
        word("cola", "energy drink", "sports drink", "lemonade", "beer", "wine", "liquor", "hot cocoa", "hot chocolate",
             "kool aid", "punch", "sweet tea", "gatorade", "powerade", "red bull", "monster", "propel", "vitaminwater", "vitamin water",
             "crystal light", "mio", "sparkling ice", "enhanced water", "water enhancer",
             "slim fast", "slimfast", "instant breakfast", "protein shake", "meal replacement", "muscle milk", "premier protein",
             "thirst quencher") ||
        // a sweetened fruit drink, but vegetable juice cocktail is vegetable juice (p.16-17)
        (word("juice cocktail", "juice drink", "fruit drink", "juice beverage") && !word("vegetable", "tomato", "v8")))) ||
      (bev && (word("diet", "zero", "sugar free", "shake", "ensure", "boost") || f.sweetened)))
    return R("sweets", f.sweetened && !word("soda", "cola", "diet", "zero", "sugar free")
      ? "Artificially sweetened drink: red in the FRG, whatever the calories (p.2)"
      : "Soda, sports, energy and sweetened drinks are red in the FRG, diet versions included");
  // 2. no colour: water, plain (nothing added) tea and coffee, seasonings (FRG p.7); anything sweetened is red.
  //    Essenced sparkling waters (LaCroix, bubly) with no sugar and no sweetener count as water.
  if (cat("waters", "carbonated-waters") ||
      (bev && word("water", "tea", "coffee")) ||
      word("sparkling water", "seltzer", "club soda", "soda water", "spring water", "purified water", "mineral water", "distilled water",
           "perrier", "pellegrino", "evian", "fiji", "dasani", "aquafina", "smartwater", "poland spring", "lacroix", "la croix", "bubly",
           "topo chico", "essentia", "voss", "deer park", "ice mountain", "arrowhead", "pure life", "zephyrhills", "ozarka")) {
    if ((k == null || k <= 5) && (sug == null || sug < 1) && !f.sweetened) return R("free", "Water and plain tea or coffee have no Traffic Light colour");
    return R("sweets", f.sweetened ? "Artificially sweetened drink: red in the FRG, whatever the calories (p.2)" : "Sweetened drink: red in the FRG");
  }
  //    A seasoning is a whole jar of spice, not any food whose name happens to contain "salt" or "herbs"
  //    ("tuna in water and sea salt", "rice medley with herb seasoning", "chili oil" are not seasonings).
  if ((cword("spices and herbs") ||
       (word("spice", "spices", "seasoning", "seasonings", "salt") && w.length <= 3)) &&
      !proteinTagged && !grainy && !legumey && !word("oil", "sauce", "dressing", "butter", "mix", "chips", "snack", "snacks", "beans") &&
      (k == null || k <= 400))
    return R("free", "Spices, herbs and salt have no Traffic Light colour");
  // 3. vegetable juice is judged as a vegetable at 8 fl oz (FRG p.16-17); fruit juice and dried fruit are red (p.24)
  if (word("vegetable juice", "tomato juice", "v8"))
    return R("veg", "Vegetable juice: judged on the vegetable range at 8 fl oz", 240);
  //    lemon, lime and clam juice are cooking ingredients on the guide's condiment page (p.73), not juices
  if (word("lemon juice", "lime juice", "clam juice"))
    return R("condiment", "Lemon, lime and clam juice are ingredients in the FRG, judged at 1 Tbsp", 15);
  //    dates are listed as fresh fruit, yellow (p.21), so they are not in the dried-fruit list; Raisin Bran is a cereal, not a dried fruit
  const cerealish = cat("breakfast-cereals") || word("cereal", "cereals", "bran", "granola", "muesli", "oatmeal");
  //    (whole pitted dates are sold as "dried fruit" but the guide lists them under fresh fruit, yellow, p.21)
  const wholeDates = word("dates", "date") && !word("chopped", "diced", "rolls", "roll", "bar", "bars", "bites", "balls", "sugar", "syrup", "paste");
  if (!cerealish && !wholeDates && !grainy && !sweetWord && !word("agave", "agave nectar") &&   // a prune cake is cake
      !cat("biscuits") &&
      !cat("nuts") && !word("peanut", "peanuts", "trail mix") && (
      (cat("fruit-juices", "juices") && !cannedFruit) ||
      (word("juice") && !cannedFruit) || word("nectar", "smoothie", "raisins", "raisin", "prunes", "craisins", "date roll", "date rolls") ||
      (word("dried", "dehydrated") && (cat("fruits", "fruit") || hasWord(w, ...FDC_FRUIT_WORDS)))))
    return R("juice", "All fruit juice and dried fruit is red in the FRG");
  // 4. granola and cereal bars are grains, judged as 1 bar (FRG p.27-28); hot cereal is a grain at 1/2 cup cooked or
  //    1 packet (p.28); cold cereal has its own sugar rule (p.77)
  if (word("granola bar", "cereal bar", "breakfast bar", "nutri grain", "clif"))
    return R("grain", "Cereal and granola bars are grains in the FRG, judged as 1 bar", labelServ(f, [20, 80]) || 28);
  if (!sweetWord && (word("oatmeal", "hot cereal", "porridge", "grits", "cream of wheat", "farina", "instant oats", "steel cut oats", "rolled oats") ||
      (word("oats") && !bev && !word("ready to eat", "milk", "beverage", "drink") &&
       (!cat("breakfast-cereals") || word("cooked", "prepared", "dry", "instant", "quick", "rolled", "steel cut", "old fashioned")))))
    return R("grain", word("instant", "packet", "packets", "cup", "cups")
      ? "Instant oatmeal is a grain in the FRG, judged as 1 packet"
      : "Hot cereal is a grain in the FRG, judged at 1 oz dry (1/2 cup cooked)",
      word("instant", "packet", "packets", "cup", "cups") ? (labelServ(f, [25, 70]) || 43) : (k != null && k < 220 ? 117 : 28));
  if (cat("breakfast-cereals") || cword("breakfast cereals") ||
      word("cereal", "cheerios", "chex", "krispies", "corn flakes", "frosted flakes", "bran flakes", "froot loops", "fruit loops",
           "pebbles", "cocoa puffs", "granola", "muesli", "mini wheats", "shredded wheat", "raisin bran", "kix", "trix",
           "lucky charms", "special k", "wheaties", "grape nuts", "honey bunches", "life cereal", "cinnamon toast crunch", "cap'n crunch"))
    return R("cereal", "Cold cereal: calories and the 25% sugar rule both apply");
  // 5. sauces the guide files under vegetables and condiments
  //    (the sauce has to be the product: "sardines in tomato sauce" is fish, "mozzarella sticks with marinara" is a combination food)
  if (word("tomato sauce", "pasta sauce", "pizza sauce", "marinara", "spaghetti sauce") &&
      !proteinTagged && !cword("fast foods", "meals, entrees", "restaurant foods") && !word("mozzarella sticks", "cheese sticks") &&
      !word("ketchup", "catsup", "barbecue", "bbq", "salsa", "hot sauce", "cocktail sauce"))
    return R("veg", "Tomato and pasta sauces sit in the vegetable group at 1/4 cup", 60);
  if (!grainy && word("fries", "french fries", "hash browns", "tater tots", "potato wedges"))
    return R("starchy", "Fried potatoes are starchy vegetables in the FRG, judged at 3 oz", 85);
  // 10. soups (1 cup); broth and stock are ingredients in the FRG (p.73, p.75)
  if (word("broth", "stock", "bouillon", "consomme") && !word("soup", "soups", "chowder", "ramen", "noodle", "noodles"))
    return R("condiment", "Broth and stock are ingredients in the FRG, judged at 1 cup", 245);
  //     "chili" the dish, not chili the flavour ("spicy thai chili seasoned tuna", "sweet chili sauce")
  const chiliDish = word("chili") && !word("seasoned", "flavored", "flavoured", "sauce", "powder", "pepper", "peppers", "flakes", "lime", "sweet chili", "chili crisp", "chili oil",
                                           "tuna", "chicken", "salmon", "shrimp", "peanut", "peanuts", "nut", "nuts", "snack", "snacks", "chips", "crisps");
  if (!cword("vegetable") && (chiliDish || word("soup", "chowder", "bisque", "gumbo", "stew", "ramen", "cup noodles", "instant lunch"))) {
    if (word("chili", "lentil", "lentils", "bean", "beans", "gumbo", "minestrone", "split pea", "black bean", "pea soup"))
      return R("soupChili", "Chili, bean, lentil and gumbo soups are judged at 1 cup in the FRG");
    return R("soupBroth", "Broth-based soups and chowders are judged at 1 cup in the FRG");
  }
  // 6. combination foods: the guide gives no range, only the rule that one red serving makes the dish red (p.8)
  //    an ice cream sandwich is a sweet, not a sandwich
  const frozenSweet = word("ice cream", "cookie", "cookies", "wafer", "wafers");
  //    plain beans are a staple, but beans in a dish USDA files as a meal are a combination food
  const legumeStaple = legumey && !cword("fast foods", "meals, entrees", "restaurant foods");
  if (!legumeStaple && !frozenSweet && (
      cword("fast foods", "meals, entrees", "restaurant foods") ||
      word("mozzarella sticks", "cheese sticks", "cheese curds") ||
      (word("sandwich", "sandwiches") && !cword("vegetable") &&
       !word("cracker", "crackers", "cookie", "cookies", "ice cream", "pickle", "pickles")) ||
      word("pizza", "burrito", "lasagna", "lasagne", "casserole", "pot pie", "enchilada", "quesadilla",
           "mac cheese", "mac and cheese", "macaroni and cheese", "macaroni cheese", "hot pocket", "hot pockets", "uncrustables", "lunchables",
           "corn dog", "sushi", "dinner", "entree", "bowl") ||
      (word("wrap", "wraps") && !grainy && !cword("baked products")) ||
      (word("taco", "tacos") && !cword("baked products") && !word("tortilla", "tortillas", "shell", "shells", "seasoning", "sauce", "kit", "chips")) ||
      (word("burger", "cheeseburger", "hamburger") &&
       !word("veggie", "vegan", "patty", "patties", "ground", "bun", "buns", "roll", "rolls", "bread", "seasoning", "dill", "pickle", "pickles", "relish"))))
    return R("combo", "Combination food: red if it holds a full serving of any red food, otherwise judge by its parts");
  // 6b. jams, syrups and honey: red, but the guide files them as ingredients at 1 Tbsp (p.75)
  if (!grainy && !sweetWord && !cerealish && !cannedFruit && !proteinTagged &&
      !cat("biscuits", "yogurts", "nuts", "salty-snacks") &&
      !word("peanut", "peanuts", "nut", "nuts", "trail mix", "roasted", "jelly bean", "jelly beans", "candy", "candies",
            "turkey", "chicken", "ham", "beef", "pork", "sandwich", "wrap", "bacon") &&
      word("jam", "jelly", "preserves", "marmalade", "honey", "maple syrup", "pancake syrup", "molasses", "corn syrup", "chocolate syrup", "caramel topping", "agave", "agave nectar"))
    return R("condiment", "Jams, syrups and honey are red ingredients in the FRG, judged at 1 Tbsp (p.75)", 15);
  // 7. Fats, Oils, Sweets & Others: always red (FRG p.59-66)
  const dairyish = !frozenDessert &&
                   (cat("milks", "yogurts") ||
                    (word("milk", "yogurt", "yoghurt", "kefir") && !word("milk chocolate", "chocolate bar", "candy", "candies")));
  if (cat("candies", "biscuits", "sugary-snacks", "salty-snacks") &&
      !cat("yogurts", "breakfast-cereals") &&
      !proteinTagged &&
      !grainy && !cannedFruit &&
      !word("coconut milk", "coconut cream") &&
      !word("whipped cream", "reddi wip", "cocoa powder", "baking cocoa", "sour cream", "cottage cheese", "cream cheese"))
    return R("sweets", "Fats, oils, sweets and salty snacks are always red in the FRG");
  //    USDA files salad dressings under "Fats and Oils" and cocoa powder under "Sweets", but the
  //    guide makes both condiments (p.73, p.75): a fat-free dressing is a yellow condiment, not a fat
  if (!grainy && !cannedFruit &&
      !word("dressing", "vinaigrette", "whipped cream", "whipped topping", "reddi wip", "cocoa powder", "baking cocoa", "unsweetened cocoa") &&
      (cword("sweets", "fats and oils") || (cword("snacks") && !word("cracker", "crackers", "pretzel", "pretzels", "popcorn", "rice cake", "rice cakes"))))
    return R("sweets", "Fats, oils, sweets and salty snacks are always red in the FRG");
  //    artificial sweeteners are on the guide's red ingredients list (p.75), as the diet-drink rule on p.2 implies
  if (word("sweetener", "sweeteners", "splenda", "stevia", "truvia", "sweet'n low", "sweet n low", "saccharin", "sucralose", "aspartame", "monk fruit") ||
      (word("equal") && !word("equal exchange")))
    return R("sweets", "Artificial sweeteners are red in the FRG (p.75)");
  //    a yogurt or milk stays dairy however its flavour is named ("salted caramel creme yogurt", "chocolate milk")
  if (!grainy && !cannedFruit && !dairyish &&
      !word("dressing", "vinaigrette") && (
      (word("chocolate", "cocoa") && !word("cocoa powder", "baking cocoa", "unsweetened cocoa")) ||
      (word("cake", "cakes") && !word("rice cake", "rice cakes", "crab cake", "fish cake", "pancake")) ||
      (word("butter") && !word("peanut butter", "almond butter", "nut butter", "cashew butter", "sunflower butter", "butter beans")) ||
      (word("bacon") && !word("canadian bacon", "canadian style bacon", "back bacon", "sausage", "links", "patties", "burger")) ||
      frozenDessert ||
      // a vegetable product's "chips" are slices ("carrot chips", "hamburger dill chips")
      (word("chips") && !cword("vegetable")) ||
      word("candy", "candies", "cookie", "cookies", "cupcake", "brownie", "brownies", "donut", "doughnut", "pie", "pastry", "pastries",
           "danish", "pudding", "custard", "gelatin", "jello", "jell-o", "cheetos", "doritos", "fritos", "pringles",
           "pork rinds", "trail mix", "margarine", "shortening", "lard", "mayonnaise", "mayo", "miracle whip", "syrup", "honey", "jam", "jelly",
           "preserves", "frosting", "icing", "fudge", "toffee", "caramel", "marshmallow", "marshmallows", "gummy", "gummies", "licorice",
           "lollipop", "pop tart", "pop tarts", "toaster pastry", "fruit snacks", "fruit roll", "creamer", "half and half", "whipped topping",
           "cool whip", "nutella", "twinkies", "oreo", "snickers", "skittles",
           "m&m's", "reese's", "kit kat", "hershey", "hershey's", "dessert", "desserts") ||
      // "olives" would otherwise match "olive oil", because word matching tolerates plurals
      (word("olives") && !word("olive oil") && !proteinTagged) ||
      (!inOil && !proteinTagged && word("olive oil", "vegetable oil", "canola oil", "cooking oil", "soybean oil", "sunflower oil", "coconut oil", "avocado oil"))))
    return R("sweets", "Fats, oils, sweets and salty snacks are always red in the FRG");
  // 7b. canned coconut milk and coconut cream are cooking ingredients (FRG p.75, 1 Tbsp, red); the drinkable kind is dairy below
  if (word("coconut milk", "coconut cream") && k != null && k >= 100)
    return R("condiment", "Canned coconut milk is an ingredient in the FRG, judged at 1 Tbsp", 15);
  // 8. cheese (1 oz), then milk, yogurt and the rest of dairy (FRG p.33-40)
  if (word("cheese", "cheddar", "mozzarella", "parmesan", "feta", "ricotta", "swiss", "brie", "gouda", "provolone", "string cheese", "cottage cheese") &&
      !grainy && !proteinTagged &&
      !word("cracker", "crackers", "puffs", "sauce", "sandwich", "mac", "macaroni", "pizza", "dip", "dressing", "vinaigrette", "chips", "flavored", "flavoured"))
    return R("cheese", "Cheese is judged at 1 oz in the FRG");
  if ((dairyish ||
      word("buttermilk", "sour cream", "eggnog", "almondmilk", "soymilk", "oatmilk", "almond milk", "soy milk", "oat milk", "rice milk", "coconut milk") ||
      (cword("dairy") && !word("egg", "eggs", "whipped cream", "whipped topping", "reddi wip", "cool whip"))) &&
      // a dressing or dip is a condiment, unless USDA itself files it as dairy ("yogurt with caramel sauce")
      !(word("dressing", "dip", "sauce", "vinaigrette", "gravy") && !cword("dairy")))
    return R("dairy", "Milk, yogurt and plant milks are judged at 1 cup (yogurt at 6 oz) in the FRG", bev ? 245 : null);
  // 9. nuts and seeds (1 oz; butters 2 Tbsp) (FRG p.54-55)
  //    beans are protein, not nuts, even where the name calls them seeds
  if (!grainy && !legumey && !cword("baked products") &&   // "wraps with super seeds" is bread
      !word("salad", "salads", "salad kit", "hummus", "dip", "dips", "guacamole", "pesto", "curry", "coconut milk", "coconut water", "coconut cream") &&
      (cat("nuts") ||
      cword("nut and seed") ||
      word("nut", "nuts", "almond", "almonds", "cashew", "cashews", "peanut", "peanuts", "walnut", "walnuts", "pecan", "pecans", "pistachio",
           "pistachios", "macadamia", "hazelnut", "hazelnuts", "seeds", "sunflower seeds", "pumpkin seeds", "chia", "flax", "flaxseed", "tahini", "coconut")))
    return R("nuts", "Nuts and seeds are judged at 1 oz in the FRG; nearly all land red");
  // 11. condiments, dressings and ingredients (1 Tbsp) (FRG p.73-76)
  //     (a meat or fish packed in a sauce is still the meat: "sardines in tomato sauce", "baked tofu teriyaki")
  if (!proteinTagged && (
      word("reddi wip") ||
      cword("sauces", "gravies") ||
      (word("mustard") && !word("greens", "spinach")) ||
      word("tomato paste", "tomato puree", "tomato concentrate") ||
      (word("ranch") && word("dressing", "dip", "sauce")) ||
      word("ketchup", "catsup", "salsa", "dressing", "vinaigrette", "relish", "pickle", "pickles", "capers", "vinegar",
           "gravy", "hummus", "dip", "guacamole", "hot sauce", "soy sauce", "barbecue sauce", "bbq sauce", "teriyaki", "worcestershire",
           "steak sauce", "tartar sauce", "cocktail sauce", "fish sauce", "oyster sauce", "taco sauce", "chili sauce", "sauce", "horseradish",
           "miso", "au jus", "whipped cream", "cocoa powder", "baking cocoa", "cooking spray",
           "kosher dill", "dill spear", "dill spears", "dill chips", "pickle chips", "sandwich stuffers")))
    return R("condiment", "Condiments and dressings are judged at 1 Tbsp in the FRG");
  // 12. produce: green beans before legumes; starchy before other vegetables (FRG p.12-20)
  if (word("green bean", "green beans", "wax bean", "wax beans", "snap beans", "string beans", "snow peas", "snap peas", "pea pods", "sugar snap") ||
      (word("bean", "beans") && word("snap", "string", "wax")))   // USDA writes "Beans, snap, green"
    return R("veg", "Green beans and pea pods are vegetables in the FRG");
  if (!grainy && word(...STARCHY_WORDS) &&
      !word("blackeye", "blackeyed", "black eyed", "cowpea", "cowpeas", "split pea", "split peas", "chickpeas", "lentils") &&
      !word("tortilla", "tortillas", "tostada", "tostadas", "gnocchi", "chips", "bread", "muffin", "starch", "meal", "dog", "flour"))
    return R("starchy", "Starchy vegetables are never green in the FRG; yellow up to 120 cal per 1/2 cup");
  // 13. meat & seafood (3 oz), then eggs, beans and substitutes (FRG p.41-58)
  //     a USDA meat category settles it; a meat word alone does not, or "Cape Cod popcorn" becomes cod (p.47)
  const meatTag = animalCategory;
  const meatWord = cword("beef", "pork", "poultry", "finfish", "shellfish", "sausages", "luncheon", "lamb, veal") ||
       word("beef", "steak", "pork", "ham", "chicken", "turkey", "lamb", "veal", "venison", "bison", "duck", "fish", "seafood", "shrimp",
            "salmon", "tuna", "cod", "tilapia", "halibut", "trout", "sardines", "anchovies", "crab", "lobster", "scallops", "clams",
            "oysters", "mussels", "jerky", "hot dog", "hot dogs", "frankfurter", "bologna", "salami", "pepperoni", "sausage", "bratwurst", "meatball",
            "meatballs", "nuggets", "tenders", "wings", "deli", "lunch meat", "luncheon", "pastrami", "prosciutto", "canadian bacon", "back bacon", "meat", "liver");
  //     baked tofu is a meat substitute in the guide (p.45), whatever words it carries
  if ((meatTag || (!grainy && meatWord)) &&
      !cword("dairy") &&                   // "Egg Ranch, Cage Free Chickens" is a carton of eggs
      !(word("bun", "buns", "bread") && grainy && !animalCategory) &&   // "Bun size franks" are franks
      !word("broth", "stock", "noodle", "noodles", "soup", "ravioli", "tortellini"))
    // a sauce or gravy word in the name must not shrink the serving to the sauce's:
    // meat is 3 oz, unless it is sold as a patty, links or nuggets
    return R("meat", "Meat and seafood are judged at 3 oz in the FRG", word("patty", "patties", "links", "nuggets") ? null : 85);
  if (!grainy && (cword("legume") ||
      (word("egg", "eggs") && !word("noodle", "noodles", "pasta", "roll", "rolls", "bread", "bagel")) ||
      word("beans", "black beans", "kidney beans", "pinto beans", "navy beans", "baked beans", "refried beans", "lentils", "chickpeas",
           "garbanzo", "tofu", "tempeh", "edamame", "veggie burger", "veggie burgers", "meatless", "seitan", "falafel", "boca", "morningstar")))
    return R("protein", "Eggs, beans and meat substitutes are judged at 1/2 cup, 1 egg or 1 patty in the FRG");
  // 14. vegetables (1/2 cup; raw leafy greens are light, about 35 g)
  //     "basmati rice with bell peppers" and "vegetable macaroni" are grains, not vegetables
  if (!grainy && (cat("vegetables") ||
      cword("vegetable") || (word(...FDC_VEG_WORDS) && !fruitWord))) {
    if (bev) return R("veg", "Vegetables: the only group that can be green", 240);
    if (word(...LEAFY_WORDS)) return R("veg", "Vegetables: the only group that can be green (raw leafy greens weigh about 35 g per 1/2 cup)", 35);
    return R("veg", "Vegetables: the only group that can be green");
  }
  // 15. fruit (yellow at most) (FRG p.21-23)
  //     canned fruit, applesauce and fruit cups are 1/2 cup in the guide, about 125 g; heavy syrup lands red (p.23)
  if (cannedFruit || (fruitWord && word("applesauce") && !hasWord(w, ...FDC_NOT_PRODUCE)))
    return R("fruit", "Canned fruit and applesauce are judged at 1/2 cup in the FRG; fruit is yellow at most", 125);
  //     a drink with a fruit flavour in its name is a drink ("lemon-lime thirst quencher")
  if (!bev && (cat("fruits", "fruit") ||
       cword("fruits") || hasWord(w, ...FDC_FRUIT_WORDS)) && !hasWord(w, ...FDC_NOT_PRODUCE))
    return R("fruit", "Fruit is yellow at most in the FRG; only vegetables can be green");
  // 16. grains (1 oz dry; 1/2 cup cooked) (FRG p.26-32)
  if (cat("cereals") ||
      cword("cereal grains", "baked products") ||
      word("bread", "bagel", "bagels", "tortilla", "tortillas", "pita", "naan", "pasta", "spaghetti", "macaroni", "penne", "noodle", "noodles",
           "rice", "oats", "oatmeal", "quinoa", "barley", "couscous", "bulgur", "farro", "cracker", "crackers", "pretzel", "pretzels",
           "rice cake", "rice cakes", "popcorn", "pancake", "pancakes", "waffle", "waffles", "muffin", "muffins", "roll", "rolls", "bun",
           "buns", "biscuit", "croissant", "flour", "cornmeal", "grits", "stuffing", "pierogi", "pierogies", "ravioli", "tortellini", "gnocchi",
           "goldfish", "cheez it", "triscuit", "wheat thins", "ritz", "saltines", "graham")) {
    // filled pasta is sold ready to boil, so the guide's 1/2 cup applies whatever the per-100 g value (p.31)
    const filled = word("ravioli", "tortellini", "gnocchi", "pierogi", "pierogies");
    const cooked = filled || (k != null && k < 220 && word("cooked", "ready", "prepared", "rice", "pasta", "noodle", "noodles", "oatmeal", "grits", "quinoa", "barley", "couscous"));
    return R("grain", cooked ? "Grains: cooked rice, pasta and hot cereal are judged at 1/2 cup" : "Grains are judged at 1 oz in the FRG",
      cooked ? (servOverride(w, f) || 75) : 28);
  }
  //     (this is the last resort, so "no colour" needs sugars actually reported as nil, not merely missing)
  if (bev || cat("beverages"))
    return (k == null || k <= 5) && sug != null && sug < 1 && !f.sweetened
      ? R("free", "An unflavoured, calorie-free drink has no Traffic Light colour")
      : R("sweets", "A drink that is not water, plain tea or coffee, milk or juice sits in Fats, Oils, Sweets & Others (p.59)", 240);
  return { group: null, why: "Food group not detected", servG: null };
}
