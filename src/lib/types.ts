/** Shared domain types for the Traffic Light Food Tracker. */

export type TrafficColor = "green" | "yellow" | "red";

export type Role = "admin" | "coach" | "family";

export type MemberId = "parent" | "child";

/** Nutrient block. `null` means "unknown", which the rule engine treats
 *  differently from zero -- see `Condition.whenMissing`. */
export interface Nutrients {
  kcal: number | null;
  fat: number | null;
  sat: number | null;
  sugars: number | null;
  added: number | null;
  protein: number | null;
}

export const EMPTY_NUTRIENTS: Nutrients = {
  kcal: null, fat: null, sat: null, sugars: null, added: null, protein: null,
};

/** A food as resolved from USDA / Open Food Facts / custom entry, before it
 *  is logged. Nutrients are carried both per 100g and per serving because the
 *  rule engine prefers density but falls back to per-serving figures. */
export interface FoodFacts {
  name: string;
  brand: string;
  cats: string[];
  isBeverage: boolean;
  per100: Nutrients;
  serv: Nutrients;
  servingLabel: string;
  source: string;
  code: string;
}

// ---------------------------------------------------------------------------
// Declarative rule engine
// ---------------------------------------------------------------------------

/** Every numeric field a rule can test. `*_100` is per 100g/ml (density),
 *  `*_serv` is per labelled serving. */
export type NumericField =
  | "kcal_100" | "fat_100" | "sat_100" | "sugars_100" | "added_100" | "protein_100"
  | "kcal_serv" | "fat_serv" | "sat_serv" | "sugars_serv" | "added_serv" | "protein_serv";

export const NUMERIC_FIELDS: { value: NumericField; label: string; unit: string }[] = [
  { value: "kcal_100", label: "Calories per 100g/ml", unit: "kcal" },
  { value: "fat_100", label: "Total fat per 100g/ml", unit: "g" },
  { value: "sat_100", label: "Saturated fat per 100g/ml", unit: "g" },
  { value: "sugars_100", label: "Total sugars per 100g/ml", unit: "g" },
  { value: "added_100", label: "Added sugar per 100g/ml", unit: "g" },
  { value: "protein_100", label: "Protein per 100g/ml", unit: "g" },
  { value: "kcal_serv", label: "Calories per serving", unit: "kcal" },
  { value: "fat_serv", label: "Total fat per serving", unit: "g" },
  { value: "sat_serv", label: "Saturated fat per serving", unit: "g" },
  { value: "sugars_serv", label: "Total sugars per serving", unit: "g" },
  { value: "added_serv", label: "Added sugar per serving", unit: "g" },
  { value: "protein_serv", label: "Protein per serving", unit: "g" },
];

export type NumericOp = ">=" | ">" | "<=" | "<" | "==";

export const NUMERIC_OPS: { value: NumericOp; label: string }[] = [
  { value: ">=", label: "is at least (\u2265)" },
  { value: ">", label: "is more than (>)" },
  { value: "<=", label: "is at most (\u2264)" },
  { value: "<", label: "is less than (<)" },
  { value: "==", label: "equals (=)" },
];

/** What to do when the tested nutrient is unknown for this food.
 *  - `skip`  : the condition fails, so the rule does not fire (safest default)
 *  - `treatAsZero` : substitute 0 and carry on comparing
 *  - `pass`  : the condition succeeds regardless */
export type MissingPolicy = "skip" | "treatAsZero" | "pass";

export type Condition =
  | { kind: "numeric"; field: NumericField; op: NumericOp; value: number; whenMissing: MissingPolicy }
  /** True when the nutrient is (or is not) unknown. Used to build
   *  "per 100g figure is missing, so fall back to per-serving" rules. */
  | { kind: "missing"; field: NumericField; missing: boolean }
  | { kind: "category"; op: "includesAny" | "excludesAll"; values: string[] };

/** A rule fires when EVERY condition in `all` holds AND the `except` clause
 *  does not (an empty/absent `except` never vetoes). Rules are evaluated in
 *  ascending `priority`; the first firing rule decides the color.
 *
 *  `except` exists so the protocol's carve-outs read the way a dietitian
 *  states them -- "high fat is red, unless it is nuts" -- instead of forcing
 *  every exemption to be duplicated across near-identical rules. */
export interface Rule {
  id: string;
  enabled: boolean;
  priority: number;
  label: string;
  scope: "food" | "beverage" | "any";
  color: TrafficColor;
  /** Family-facing explanation. Supports `{value}` (the measured amount of
   *  the rule's first numeric condition) and `{limit}` (its threshold). */
  reason: string;
  all: Condition[];
  except?: Condition[];
}

export interface RuleSet {
  rules: Rule[];
  /** color applied when no rule fires. */
  defaultColor: TrafficColor;
  defaultReasonFood: string;
  defaultReasonBeverage: string;
  updatedAt?: number;
  updatedBy?: string;
}

export interface Classification {
  color: TrafficColor;
  /** The rule that decided the color (`null` when the default applied). */
  decidedBy: string | null;
  /** Human-readable explanations, decisive one first. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Firestore documents
// ---------------------------------------------------------------------------

/** Program-wide settings an admin controls. */
export interface AppConfig {
  /** Opened in a new tab by the "Help me choose" button next to the color
   *  picker (requirement 10.1). Supplied by the program, not bundled. */
  foodGuideUrl: string;
  programName: string;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  foodGuideUrl: "",
  programName: "Traffic Light Food Tracker",
};

export interface UserDoc {
  uid: string;
  email: string;
  name: string;
  role: "admin" | "coach";
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

/**
 * The three daily targets a coach sets per person. One is a ceiling, one a
 * floor and one a band -- kept explicit in the field docs because "goal" alone
 * is ambiguous and the direction decides whether a day counts as met.
 */
export interface MemberGoals {
  /** Ceiling: at most this many red foods in a day. */
  dailyRed: number;
  /** Floor: at least this many green foods in a day. */
  dailyGreen: number;
  /** Band centre: the day is met within `KCAL_BAND` calories either side.
   *  Eating too little misses the goal just as eating too much does. */
  dailyKcal: number;
}

/** Half-width of the calorie band: a 1650 target is met from 1500 to 1800. */
export const KCAL_BAND = 150;

/** The child's calorie target is fixed by the program, not set by coaches:
 *  1200-1500 a day. Anything stored on the family record is ignored. */
export const CHILD_KCAL_TARGET = 1350;

export const DEFAULT_GOALS: MemberGoals = {
  dailyRed: 2,
  dailyGreen: 5,
  dailyKcal: 1650,
};

/** Starting goals for a new family member. */
export function defaultGoalsFor(memberId: MemberId): MemberGoals {
  return memberId === "child"
    ? { ...DEFAULT_GOALS, dailyKcal: CHILD_KCAL_TARGET }
    : { ...DEFAULT_GOALS };
}

export interface FamilyMember {
  name: string;
  /** The coach-set daily targets. Absent on families created before goals
   *  existed -- read it through `resolveGoals`, never directly. */
  goals?: MemberGoals;
  /** @deprecated Weekly red-food budget from the original spec. Superseded by
   *  `goals.dailyRed`. Retained so families created earlier keep working, and
   *  used to seed a sensible daily figure for them. */
  redBudget?: number;
}

/**
 * Read a member's goals, filling gaps for records written before goals
 * existed. A legacy weekly red budget is spread across the week rather than
 * discarded, so an existing family's target carries over roughly intact.
 *
 * The child's calorie target is always `CHILD_KCAL_TARGET`, whatever the
 * record says, so families saved before it was fixed pick it up too.
 */
export function resolveGoals(member: FamilyMember | undefined, memberId: MemberId): MemberGoals {
  const defaults = defaultGoalsFor(memberId);
  let goals: MemberGoals;
  if (member?.goals) {
    goals = { ...defaults, ...member.goals };
  } else {
    const legacyDailyRed = typeof member?.redBudget === "number"
      ? Math.max(1, Math.round(member.redBudget / 7))
      : defaults.dailyRed;
    goals = { ...defaults, dailyRed: legacyDailyRed };
  }
  if (memberId === "child") goals.dailyKcal = CHILD_KCAL_TARGET;
  return goals;
}

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";

export const MEALS: { value: Meal; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack",
};

export interface FamilyDoc {
  id: string;
  code: string;
  coachId: string;
  label: string;
  active: boolean;
  createdAt: number;
  lastActiveAt: number | null;
  members: Record<MemberId, FamilyMember>;
}

/** One logged food. Denormalised nutrition is stored at log time so that
 *  history stays stable even if a USDA record or a rule later changes. */
export interface LogEntry {
  id: string;
  memberId: MemberId;
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Which meal it was logged under. Absent on entries logged before meals
   *  existed. */
  meal?: Meal;
  createdAt: number;
  name: string;
  brand: string;
  servings: number;
  /** Nutrition for the logged amount (per serving x servings). */
  kcal: number | null;
  fat: number | null;
  sat: number | null;
  sugars: number | null;
  added: number | null;
  protein: number | null;
  servingLabel: string;
  source: string;
  code: string;
  /** color the family chose. This is what counts -- always authoritative. */
  color: TrafficColor;
  /** color the rule engine computed at log time. */
  autoColor: TrafficColor;
  /** True when the family's color differed from the engine's and they
   *  confirmed their own choice anyway. */
  overridden: boolean;
  reasons: string[];
}

export interface QuickFood {
  id: string;
  memberId: MemberId | "shared";
  name: string;
  brand: string;
  useCount: number;
  lastUsedAt: number;
  facts: FoodFacts;
}
