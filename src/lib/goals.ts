import { KCAL_BAND, type LogEntry, type MemberGoals } from "./types";

/**
 * Goal evaluation.
 *
 * A deliberate decision runs through this file: **a day with nothing logged
 * counts as not met, for every goal.** The red target is a ceiling ("at most
 * 2 red"), and an empty day trivially satisfies it -- so counting blank days
 * as successes would score not using the app higher than using it honestly.
 * Unlogged days are reported separately as `logged: false` so the UI can show
 * them as "no data" rather than failure.
 */

export type GoalKey = "red" | "green" | "kcal";

export interface DayGoalResult {
  date: string;
  /** Whether anything at all was logged that day. */
  logged: boolean;
  red: number;
  green: number;
  kcal: number | null;
  met: Record<GoalKey, boolean>;
}

export interface GoalSummary {
  key: GoalKey;
  /** Short label, e.g. "Red foods". */
  label: string;
  /** How the target reads, e.g. "2 or fewer a day". */
  target: string;
  /** Days met, out of `days.length`. */
  metCount: number;
  days: DayGoalResult[];
}

/** The calorie band that counts as met, inclusive at both ends. */
export function kcalRange(goals: MemberGoals): { min: number; max: number } {
  return {
    min: Math.max(0, goals.dailyKcal - KCAL_BAND),
    max: goals.dailyKcal + KCAL_BAND,
  };
}

/** "1,500–1,800", for labels. */
export function formatKcalRange(goals: MemberGoals): string {
  const { min, max } = kcalRange(goals);
  return `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}`;
}

/** Per-day totals and per-goal outcomes across a window of dates. */
export function evaluateDays(
  days: string[],
  entries: LogEntry[],
  goals: MemberGoals,
): DayGoalResult[] {
  const byDate = new Map<string, DayGoalResult>(
    days.map((d) => [d, {
      date: d, logged: false, red: 0, green: 0, kcal: null,
      met: { red: false, green: false, kcal: false },
    }]),
  );

  for (const e of entries) {
    const row = byDate.get(e.date);
    if (!row) continue;
    row.logged = true;
    if (e.color === "red") row.red += e.servings;
    if (e.color === "green") row.green += e.servings;
    if (e.kcal !== null && e.kcal !== undefined) row.kcal = (row.kcal ?? 0) + e.kcal;
  }

  const { min, max } = kcalRange(goals);
  for (const row of byDate.values()) {
    if (!row.logged) continue;
    row.met.red = row.red <= goals.dailyRed;
    row.met.green = row.green >= goals.dailyGreen;
    // Calories are only judged when some were actually recorded; a day of
    // foods with unknown energy should not silently pass.
    row.met.kcal = row.kcal !== null && row.kcal >= min && row.kcal <= max;
  }

  return days.map((d) => byDate.get(d)!);
}

export function summariseGoals(
  days: string[],
  entries: LogEntry[],
  goals: MemberGoals,
): GoalSummary[] {
  const evaluated = evaluateDays(days, entries, goals);
  const spec: { key: GoalKey; label: string; target: string }[] = [
    { key: "green", label: "Green foods", target: `${goals.dailyGreen} or more a day` },
    { key: "red", label: "Red foods", target: `${goals.dailyRed} or fewer a day` },
    { key: "kcal", label: "Calories", target: `${formatKcalRange(goals)} a day` },
  ];
  return spec.map((s) => ({
    ...s,
    metCount: evaluated.filter((d) => d.met[s.key]).length,
    days: evaluated,
  }));
}

/**
 * How badly a missed goal was missed.
 *
 * "near" is within 20% of the target, which reads as a slip rather than a
 * blow-out and is coloured amber; anything further is red.
 *
 * Calories have no near miss: the band already is the tolerance, so a day
 * outside it -- too low or too high -- is simply missed. The one exception is
 * calories that were never recorded, which count as "near": the day failed for
 * lack of evidence, not because we know the band was broken, and colouring
 * that red would accuse a family of something unmeasured.
 */
export type MissDistance = "near" | "far";

const NEAR_TOLERANCE = 0.2;

export function missDistance(
  day: DayGoalResult, key: GoalKey, goals: MemberGoals,
): MissDistance {
  switch (key) {
    case "red": {
      // Ceiling: how far above it did they go?
      const limit = goals.dailyRed;
      if (limit <= 0) return day.red === 0 ? "near" : "far";
      return day.red <= limit * (1 + NEAR_TOLERANCE) ? "near" : "far";
    }
    case "kcal":
      return day.kcal === null ? "near" : "far";
    case "green": {
      // Floor: how far below it did they fall?
      const target = goals.dailyGreen;
      if (target <= 0) return "near";
      return day.green >= target * (1 - NEAR_TOLERANCE) ? "near" : "far";
    }
  }
}

/** What a given day actually scored, for the goal's tooltip. */
export function dayValueFor(day: DayGoalResult, key: GoalKey): string {
  if (!day.logged) return "nothing logged";
  switch (key) {
    case "red": return `${day.red} red`;
    case "green": return `${day.green} green`;
    case "kcal": return day.kcal === null ? "calories unknown" : `${Math.round(day.kcal)} kcal`;
  }
}
