import type {
  Classification, Condition, FoodFacts, NumericField, Rule, RuleSet, TrafficColor,
} from "./types";

/** Pull a numeric field off a food, returning `null` for unknown. */
export function readField(food: FoodFacts, field: NumericField): number | null {
  const [key, basis] = field.split("_") as ["kcal" | "fat" | "sat" | "sugars" | "added" | "protein", "100" | "serv"];
  const block = basis === "100" ? food.per100 : food.serv;
  const v = block?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case ">=": return a >= b;
    case ">": return a > b;
    case "<=": return a <= b;
    case "<": return a < b;
    case "==": return a === b;
    default: return false;
  }
}

/** Category tags are matched as substrings, mirroring Open Food Facts style
 *  tags ("en:sugary-snacks" matches the needle "sugary-snacks"). */
function catMatches(cats: string[], needles: string[]): boolean {
  return cats.some((c) => needles.some((n) => n && c.toLowerCase().includes(n.toLowerCase())));
}

function evalCondition(cond: Condition, food: FoodFacts): boolean {
  switch (cond.kind) {
    case "numeric": {
      const raw = readField(food, cond.field);
      if (raw === null) {
        if (cond.whenMissing === "pass") return true;
        if (cond.whenMissing === "skip") return false;
        return compare(0, cond.op, cond.value); // treatAsZero
      }
      return compare(raw, cond.op, cond.value);
    }
    case "missing":
      return (readField(food, cond.field) === null) === cond.missing;
    case "category": {
      const hit = catMatches(food.cats ?? [], cond.values);
      return cond.op === "includesAny" ? hit : !hit;
    }
    default:
      return false;
  }
}

function fires(rule: Rule, food: FoodFacts): boolean {
  if (!rule.enabled) return false;
  if (rule.scope === "food" && food.isBeverage) return false;
  if (rule.scope === "beverage" && !food.isBeverage) return false;
  if (!rule.all.every((c) => evalCondition(c, food))) return false;
  // An empty `except` must never veto.
  if (rule.except?.length && rule.except.every((c) => evalCondition(c, food))) return false;
  return true;
}

const fmt1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** Fill `{value}` / `{limit}` from the rule's first numeric condition. */
function renderReason(rule: Rule, food: FoodFacts): string {
  const numeric = rule.all.find((c) => c.kind === "numeric");
  if (!numeric || numeric.kind !== "numeric") return rule.reason;
  const raw = readField(food, numeric.field);
  return rule.reason
    .replace(/\{value\}/g, raw === null ? "\u2013" : fmt1(raw))
    .replace(/\{limit\}/g, fmt1(numeric.value));
}

export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

/**
 * Run a food through the rule set.
 *
 * The first firing rule (lowest priority number) decides the color. Any
 * later rules that fire with that same color are kept as supporting
 * reasons, so a food that is red for three separate reasons says so --
 * matching how the original prototype accumulated its explanations.
 */
export function classify(food: FoodFacts, ruleSet: RuleSet): Classification {
  const matches = sortRules(ruleSet.rules).filter((r) => fires(r, food));

  if (matches.length === 0) {
    return {
      color: ruleSet.defaultColor,
      decidedBy: null,
      reasons: [food.isBeverage ? ruleSet.defaultReasonBeverage : ruleSet.defaultReasonFood],
    };
  }

  const decisive = matches[0];
  const supporting = matches.slice(1).filter((r) => r.color === decisive.color);
  return {
    color: decisive.color,
    decidedBy: decisive.id,
    reasons: [decisive, ...supporting].map((r) => renderReason(r, food)),
  };
}

export const COLOR_LABEL: Record<TrafficColor, string> = {
  green: "Green", yellow: "Yellow", red: "Red",
};

/** Tailwind class bundles, kept in one place so color usage stays consistent. */
export const COLOR_STYLES: Record<TrafficColor, { dot: string; chip: string; ring: string; bar: string }> = {
  green: {
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
    ring: "ring-emerald-500",
    bar: "bg-emerald-500",
  },
  yellow: {
    dot: "bg-amber-400",
    chip: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800",
    ring: "ring-amber-400",
    bar: "bg-amber-400",
  },
  red: {
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
    ring: "ring-rose-500",
    bar: "bg-rose-500",
  },
};

/** Plain-English rendering of a condition, for the admin rule editor. */
export function describeCondition(cond: Condition): string {
  switch (cond.kind) {
    case "numeric": {
      const opWord = { ">=": "\u2265", ">": ">", "<=": "\u2264", "<": "<", "==": "=" }[cond.op];
      const missing = cond.whenMissing === "treatAsZero" ? " (unknown counts as 0)"
        : cond.whenMissing === "pass" ? " (or unknown)" : "";
      return `${cond.field} ${opWord} ${cond.value}${missing}`;
    }
    case "missing":
      return `${cond.field} is ${cond.missing ? "unknown" : "known"}`;
    case "category":
      return cond.op === "includesAny"
        ? `category is one of: ${cond.values.join(", ")}`
        : `category is none of: ${cond.values.join(", ")}`;
  }
}
