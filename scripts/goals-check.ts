// Checks for the daily-goal evaluation, focused on the cases where the
// "obvious" answer is wrong. Run with `npm run test:goals`.
import { evaluateDays, missDistance, summariseGoals } from "../src/lib/goals";
import { resolveGoals, type LogEntry, type MemberGoals } from "../src/lib/types";

// Calorie band 1500-1800.
const GOALS: MemberGoals = { dailyRed: 2, dailyGreen: 5, dailyKcal: 1650 };

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

const DAYS = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"];

const entries: LogEntry[] = [
  // Day 1: 5 green, 2 red, 1800 kcal -> all three met (boundaries exact)
  entry(DAYS[0], "green", 5, 400),
  entry(DAYS[0], "red", 2, 1400),
  // Day 2: 4 green, 3 red, 2500 kcal -> all three missed
  entry(DAYS[1], "green", 4, 1000),
  entry(DAYS[1], "red", 3, 1500),
  // Day 3: 6 green, 0 red, calories unknown -> green+red met, calories not
  entry(DAYS[2], "green", 6, null),
  // Day 4: nothing logged
  // Day 5: 1500 kcal exactly -> calories met (lower boundary)
  entry(DAYS[4], "yellow", 1, 1500),
  // Day 6: 1499 kcal -> calories missed for eating too little
  entry(DAYS[5], "yellow", 1, 1499),
];

const results = evaluateDays(DAYS, entries, GOALS);
const failures: string[] = [];
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) failures.push(`  ${label}: got ${a}, expected ${e}`);
}

check("day1 met (exact upper calorie boundary counts as met)", results[0].met, { red: true, green: true, kcal: true });
check("day2 met (all over/under)", results[1].met, { red: false, green: false, kcal: false });
check("day3 met (unknown calories must not pass)", results[2].met, { red: true, green: true, kcal: false });
check("day4 met (unlogged day never counts)", results[3].met, { red: false, green: false, kcal: false });
check("day4 logged flag", results[3].logged, false);
check("day3 kcal stays null", results[2].kcal, null);
check("day5 kcal (exact lower boundary counts as met)", results[4].met.kcal, true);
check("day6 kcal (below the band is a miss)", results[5].met.kcal, false);

// Calories are green or red: no amber near miss, above or below.
check("over the band is a clear miss", missDistance(results[1], "kcal", GOALS), "far");
check("under the band is a clear miss", missDistance(results[5], "kcal", GOALS), "far");
check("unknown calories stay amber", missDistance(results[2], "kcal", GOALS), "near");

const summary = summariseGoals(DAYS, entries, GOALS);
const counts = Object.fromEntries(summary.map((s) => [s.key, s.metCount]));
check("summary counts", counts, { green: 2, red: 4, kcal: 2 });
check("calorie target text", summary.find((s) => s.key === "kcal")?.target, "1,500–1,800 a day");

// Defaults, and the child's fixed target.
check("parent default calories", resolveGoals(undefined, "parent").dailyKcal, 1650);
check("child default calories", resolveGoals(undefined, "child").dailyKcal, 1350);
check("coach-set parent calories kept",
  resolveGoals({ name: "p", goals: { dailyRed: 1, dailyGreen: 6, dailyKcal: 2000 } }, "parent"),
  { dailyRed: 1, dailyGreen: 6, dailyKcal: 2000 });
check("stored child calories overridden",
  resolveGoals({ name: "c", goals: { dailyRed: 1, dailyGreen: 6, dailyKcal: 2000 } }, "child"),
  { dailyRed: 1, dailyGreen: 6, dailyKcal: 1350 });

if (failures.length) {
  console.log(`Goals: ${failures.length} check(s) FAILED`);
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log(`Goals: all ${checks} checks pass`);
