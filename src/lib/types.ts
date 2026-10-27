/** Shared domain types for the Traffic Light Food Tracker. */

import type { FoodGroup } from "./foodGroups";

export type TrafficColor = "green" | "yellow" | "red";

/** What a logged food can be: one of the three colors, or the guide's "no
 *  color" for water, plain tea/coffee and seasonings. A "none" entry counts
 *  toward no color total and no goal. */
export type EntryColor = TrafficColor | "none";

export type Role = "admin" | "coach" | "family";

export type MemberId = "parent" | "child";

/** Nutrient block. `null` means "unknown", never zero: a food with unknown
 *  calories gets no verdict rather than a guessed one. */
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
  /** USDA's own food category ("Dairy and Egg Products"), which food-group
   *  detection reads. Empty for other sources; absent on foods saved before
   *  it was recorded. */
  usdaCategory?: string;
  /** The ingredient list names an artificial sweetener, which makes a drink
   *  red whatever its calories (FRG p.2). */
  sweetened?: boolean;
  /** Grams in the label serving, when the label states one. */
  servQtyG?: number | null;
}

// ---------------------------------------------------------------------------
// Rules: the guide's food-group table
// ---------------------------------------------------------------------------

/**
 * How a group's color is decided.
 *  - `graded`    : calories in one serving against the group's lines
 *  - `alwaysRed` : red whatever the calories (juice, fats/oils/sweets)
 *  - `free`      : no color at all (water, plain tea/coffee, seasonings)
 *  - `combo`     : no calorie range; the family's own choice stands
 */
export type GroupKind = "graded" | "alwaysRed" | "free" | "combo";

/** One row of the rules table. */
export interface GroupRule {
  label: string;
  kind: GroupKind;
  /** The guide's serving in household words, shown in the reasons. */
  serv: string;
  /** This app's gram estimate of that serving; calories are measured in it. */
  servG: number | null;
  /** Green up to and including this many calories. Only vegetables have one. */
  green: number | null;
  /** Yellow up to and including this many calories; red above it. */
  yellow: number | null;
  /** Red when more than this share of calories comes from sugar (cold cereal). */
  sugarPct: number | null;
}

export interface RuleSet {
  /** 2 is the food-group table. Anything else is the retired rule list and is
   *  read as the defaults. */
  version: 2;
  groups: Record<FoodGroup, GroupRule>;
  updatedAt?: number;
  updatedBy?: string;
}

export interface Classification {
  /** `"none"` is the guide's "no color". `null` means the guide gives no
   *  verdict here (a combination food, a group it cannot detect, or no
   *  calorie data), so whatever the family chooses stands. */
  color: EntryColor | null;
  group: FoodGroup | null;
  /** Grams of the serving the calories were measured in. */
  servG: number | null;
  /** Calories in that serving. */
  kcalServ: number | null;
  /** Human-readable explanations, the deciding one first. */
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
  /** Links this person to the external platform (3C). Required for coaches;
   *  absent on accounts created before Sync IDs and optional for admins.
   *  Changed only through the `setSyncId` function. */
  syncId?: string;
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
  /** Links this member to the external platform (3C) and keys the data API.
   *  Absent on families created before Sync IDs. Changed only through the
   *  `setSyncId` function. */
  syncId?: string;
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
  /** color the family chose, or "none" for a food the guide gives no color.
   *  This is what counts -- always authoritative. */
  color: EntryColor;
  /** color the rule engine computed at log time. `null` when the guide gives
   *  no verdict (a combination food, an undetected group) and the family's
   *  choice stood unchallenged. */
  autoColor: EntryColor | null;
  /** The guide's food group the engine placed it in. Absent on entries logged
   *  before groups existed. */
  group?: FoodGroup | null;
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
