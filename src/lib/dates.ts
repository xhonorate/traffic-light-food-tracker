/** Date helpers. Everything is keyed on the *local* calendar day as
 *  `YYYY-MM-DD` -- never on UTC -- so a food logged at 9pm stays on today. */

export function toDateKey(d: Date): string {
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

export function todayKey(): string {
  return toDateKey(new Date());
}

/** Parse `YYYY-MM-DD` into a local-midnight Date (not UTC midnight). */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(key: string, delta: number): string {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

export function isToday(key: string): boolean {
  return key === todayKey();
}

export function isFuture(key: string): boolean {
  return key > todayKey();
}

/**
 * The "week" for budgeting and the graph: the rolling 7-day span ending on
 * the selected day, per requirement 9 ("selected revolving 7 day span").
 * Returns oldest-first.
 */
export function weekWindow(endKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(endKey, i - 6));
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Yesterday", or "Tue, Aug 18". */
export function formatDayLabel(key: string): string {
  if (isToday(key)) return "Today";
  if (key === addDays(todayKey(), -1)) return "Yesterday";
  const d = fromDateKey(key);
  return `${DAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** "Aug 18" -- compact form for chart axes. */
export function formatShort(key: string): string {
  const d = fromDateKey(key);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** "8/18" -- numeric month/day for tight mobile layouts. */
export function formatNumeric(key: string): string {
  const d = fromDateKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** "Mon", "Tue" -- for the day picker, where a single letter is ambiguous. */
export function formatWeekdayShort(key: string): string {
  return DAY_SHORT[fromDateKey(key).getDay()];
}

/** "M", "T", "W" -- single letter for tight mobile chart axes. */
export function formatDayLetter(key: string): string {
  return DAY_SHORT[fromDateKey(key).getDay()].charAt(0);
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")}${ampm}`;
}

/** Days between two keys (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromDateKey(b).getTime() - fromDateKey(a).getTime()) / 86_400_000);
}
