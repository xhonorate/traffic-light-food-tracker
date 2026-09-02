// Checks for the daily-goal evaluation, focused on the cases where the
// "obvious" answer is wrong. Run with `npm run test:goals`.
import { evaluateDays, summariseGoals } from "../src/lib/goals";
import type { LogEntry, MemberGoals } from "../src/lib/types";

const GOALS: MemberGoals = { dailyRed: 2, dailyGreen: 5, dailyKcal: 2000 };

let id = 0;
function entry(date: string, color: "green" | "yellow" | "red", servings: number, kcal: number | null): LogEntry {
  return {
    id: `e${id++}`, memberId: "child", date, createdAt: Date.now(),
    name: "test", brand: "", servings,
    kcal, fat: null, sat: null, sugars: null, added: null, protein: null,
    servingLabel: "", source: "test", code: "",
    color, autoColor: color, overridden: false, reasons: [],
  };
}

const DAYS = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"];

const entries: LogEntry[] = [
  // Day 1: 5 green, 2 red, 1800 kcal -> all three met (both boundaries exact)
  entry(DAYS[0], "green", 5, 400),
  entry(DAYS[0], "red", 2, 1400),
  // Day 2: 4 green, 3 red, 2500 kcal -> all three missed
  entry(DAYS[1], "green", 4, 1000),
  entry(DAYS[1], "red", 3, 1500),
  // Day 3: 6 green, 0 red, calories unknown -> green+red met, calories not
  entry(DAYS[2], "green", 6, null),
  // Day 4: nothing logged
];

const results = evaluateDays(DAYS, entries, GOALS);
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) failures.push(`  ${label}: got ${a}, expected ${e}`);
}

check("day1 met (exact boundaries count as met)", results[0].met, { red: true, green: true, kcal: true });
check("day2 met (all over/under)", results[1].met, { red: false, green: false, kcal: false });
check("day3 met (unknown calories must not pass a ceiling)", results[2].met, { red: true, green: true, kcal: false });
check("day4 met (unlogged day never counts)", results[3].met, { red: false, green: false, kcal: false });
check("day4 logged flag", results[3].logged, false);
check("day3 kcal stays null", results[2].kcal, null);

const summary = summariseGoals(DAYS, entries, GOALS);
const counts = Object.fromEntries(summary.map((s) => [s.key, s.metCount]));
check("summary counts", counts, { green: 2, red: 2, kcal: 1 });

if (failures.length) {
  console.log(`Goals: ${failures.length} check(s) FAILED`);
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log(`Goals: all ${7} checks pass`);
