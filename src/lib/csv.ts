import type { LogEntry, MemberId } from "./types";

/** RFC-4180 quoting: wrap in quotes when the value contains a delimiter,
 *  quote or newline, and double any embedded quotes. */
function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  // A leading BOM makes Excel open UTF-8 correctly on Windows.
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** The per-day summary row required by the spec. */
export interface DailySummaryRow {
  familyCode: string;
  memberId: MemberId;
  date: string;
  kcal: number | null;
  red: number;
  yellow: number;
  green: number;
}

export const DAILY_SUMMARY_HEADERS = [
  "Family code", "User type", "Date", "Kcal total", "#Red", "#Yellow", "#Green",
];

export function dailySummaryCsv(rows: DailySummaryRow[]): string {
  return toCsv(
    DAILY_SUMMARY_HEADERS,
    rows.map((r) => [
      r.familyCode,
      r.memberId === "parent" ? "Parent" : "Child",
      r.date,
      r.kcal === null ? "" : Math.round(r.kcal),
      r.red,
      r.yellow,
      r.green,
    ]),
  );
}

/**
 * Roll raw entries up into one row per member per day. Servings count toward
 * the color tallies -- two servings of a red food is two red foods, which is
 * how the weekly red budget is spent.
 */
export function summarise(
  entries: LogEntry[],
  familyCode: string,
): DailySummaryRow[] {
  const byKey = new Map<string, DailySummaryRow>();
  for (const e of entries) {
    const key = `${e.memberId}|${e.date}`;
    let row = byKey.get(key);
    if (!row) {
      row = { familyCode, memberId: e.memberId, date: e.date, kcal: null, red: 0, yellow: 0, green: 0 };
      byKey.set(key, row);
    }
    if (e.kcal !== null && e.kcal !== undefined) row.kcal = (row.kcal ?? 0) + e.kcal;
    row[e.color] += e.servings;
  }
  return [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.memberId.localeCompare(b.memberId),
  );
}

/** Full detail export -- one row per logged food. */
/**
 * Detail export columns, matching the traffic-light logger's own export so
 * files from either tool drop into the same analysis unchanged.
 *
 * Note this shape has no separate family/member columns -- the original was
 * single-client. `client` therefore carries both, as "CODE · Name", so a
 * multi-family export stays unambiguous without adding columns the downstream
 * format does not expect.
 */
export const ENTRY_HEADERS = [
  "date", "time", "client", "food", "brand", "portion", "color", "auto_color",
  "overridden", "kcal", "fat_g", "sugars_g", "protein_g",
];

/** Local wall-clock time, which is what the log actually means to a family. */
function clockTime(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/** One decimal, blank when unknown -- an empty cell reads as "no data" in
 *  every stats package, whereas 0 would be a measurement. */
const cellNum = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? "" : String(Math.round(v * 10) / 10);

export function entriesCsv(
  entries: LogEntry[],
  family: { code: string; members: Record<MemberId, { name: string }> },
): string {
  const client = (memberId: MemberId) => {
    const name = family.members?.[memberId]?.name?.trim();
    return `${family.code} · ${name || (memberId === "parent" ? "Parent" : "Child")}`;
  };

  return toCsv(
    ENTRY_HEADERS,
    entries.map((e) => [
      e.date,
      clockTime(e.createdAt),
      client(e.memberId),
      e.name,
      e.brand,
      e.servings,
      e.color,
      e.autoColor,
      e.overridden ? "yes" : "no",
      e.kcal === null ? "" : Math.round(e.kcal),
      cellNum(e.fat),
      cellNum(e.sugars),
      cellNum(e.protein),
    ]),
  );
}

/** Trigger a browser download of generated text. */
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so Safari has finished reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
