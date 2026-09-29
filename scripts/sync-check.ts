// Checks for the Sync ID helpers behind the external API: ID validation, the
// API key comparison and the daily roll-up 3C receives. Run with
// `npm run test:sync`.
import {
  apiKeyMatches, readDateBound, readSyncId, rollUpDays, sameOwner,
} from "../functions/src/sync";

const failures: string[] = [];
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) failures.push(`  ${label}: got ${a}, expected ${e}`);
}

/** The error message, or "ok" when nothing was thrown. */
function outcome(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
}

// Sync ID validation.
check("hex id accepted", readSyncId("1234abcd", "Sync ID"), "1234abcd");
check("uuid accepted", readSyncId("0f8fad5b-d9cb-469f-a165-70867728950e", "Sync ID"),
  "0f8fad5b-d9cb-469f-a165-70867728950e");
check("whitespace trimmed", readSyncId("  ab12  ", "Sync ID"), "ab12");
check("case preserved", readSyncId("AbC123", "Sync ID"), "AbC123");
check("blank rejected", outcome(() => readSyncId("  ", "Sync ID")), "Sync ID is required.");
check("missing rejected", outcome(() => readSyncId(undefined, "parent.syncId")), "parent.syncId is required.");
check("slash rejected (would break the doc path)",
  outcome(() => readSyncId("ab/cd", "Sync ID")).startsWith("Sync ID may only contain"), true);
check("dot-dot rejected", outcome(() => readSyncId("..", "Sync ID")).startsWith("Sync ID may only"), true);
check("space inside rejected", outcome(() => readSyncId("ab cd", "Sync ID")).startsWith("Sync ID may only"), true);
check("129 chars rejected", outcome(() => readSyncId("a".repeat(129), "Sync ID")).startsWith("Sync ID may only"), true);
check("128 chars accepted", outcome(() => readSyncId("a".repeat(128), "Sync ID")), "ok");

// Owner comparison.
check("same staff", sameOwner({ kind: "staff", uid: "u1" }, { kind: "staff", uid: "u1" }), true);
check("different staff", sameOwner({ kind: "staff", uid: "u1" }, { kind: "staff", uid: "u2" }), false);
check("same member",
  sameOwner({ kind: "member", familyId: "f", memberId: "child" }, { kind: "member", familyId: "f", memberId: "child" }),
  true);
check("sibling member differs",
  sameOwner({ kind: "member", familyId: "f", memberId: "child" }, { kind: "member", familyId: "f", memberId: "parent" }),
  false);
check("staff vs member", sameOwner({ kind: "staff", uid: "f" }, { kind: "member", familyId: "f", memberId: "parent" }), false);

// API key.
check("key matches", apiKeyMatches("abc123xyz456", "abc123xyz456"), true);
check("wrong key", apiKeyMatches("abc123xyz457", "abc123xyz456"), false);
check("prefix of key", apiKeyMatches("abc123", "abc123xyz456"), false);
check("missing key", apiKeyMatches(undefined, "abc123xyz456"), false);
check("unset server key never matches", apiKeyMatches("", ""), false);

// Date bounds.
check("no bound", readDateBound(undefined, "from"), null);
check("valid bound", readDateBound("2026-09-01", "from"), "2026-09-01");
check("bad bound", outcome(() => readDateBound("9/1/2026", "from")), "from must be a date in YYYY-MM-DD format.");

// Daily roll-up: servings count, yellow ignored, unknown kcal is 0, newest first.
const days = rollUpDays([
  { date: "2026-09-23", color: "green", servings: 2, kcal: 300 },
  { date: "2026-09-24", color: "red", servings: 1, kcal: 1200 },
  { date: "2026-09-24", color: "green", servings: 4, kcal: 500 },
  { date: "2026-09-24", color: "red", servings: 4, kcal: 600.4 },
  { date: "2026-09-24", color: "yellow", servings: 1, kcal: null },
  { date: "2026-09-23", color: "green", servings: 0.1, kcal: null },
  { date: "2026-09-23", color: "green", servings: 0.2, kcal: 10 },
  { date: "2026-09-23", color: "red", servings: 1, kcal: 1400 },
]);
check("roll-up", days, [
  { isoDate: "2026-09-24 00:00:00", green: 4, red: 5, calories: 2300 },
  { isoDate: "2026-09-23 00:00:00", green: 2.3, red: 1, calories: 1710 },
]);
check("no entries, no days", rollUpDays([]), []);
check("entry without servings counts once",
  rollUpDays([{ date: "2026-01-01", color: "red", kcal: 100 }]),
  [{ isoDate: "2026-01-01 00:00:00", green: 0, red: 1, calories: 100 }]);

if (failures.length) {
  console.log(`Sync: ${failures.length} check(s) FAILED`);
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log(`Sync: all ${checks} checks pass`);
