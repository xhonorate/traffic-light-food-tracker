/**
 * Sync IDs: the one identifier shared with the external platform (3C).
 *
 * Every coach and every family member is created on the external platform
 * first and carries a Sync ID from there. It is the only field that links a
 * person across the two systems -- never email, name or anything else -- so
 * it must be unique across coaches and members alike. Uniqueness is enforced
 * by an index collection, `syncIds/{syncId}`, written only by Cloud Functions
 * inside the same transaction as the record it points at.
 *
 * This file holds the pure pieces: validation, key checking and the daily
 * roll-up the data API returns. Nothing here touches Firestore directly.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";

export type MemberId = "parent" | "child";

/** What a Sync ID points at, as stored in `syncIds/{syncId}`. */
export type SyncOwner =
  | { kind: "staff"; uid: string }
  | { kind: "member"; familyId: string; memberId: MemberId };

export const sameOwner = (a: SyncOwner, b: SyncOwner): boolean =>
  a.kind === "staff"
    ? b.kind === "staff" && a.uid === b.uid
    : b.kind === "member" && a.familyId === b.familyId && a.memberId === b.memberId;

/**
 * The external platform generates these as hashes, so letters, digits and a
 * few separators cover every realistic format (hex, UUID, base64url). The
 * value is also a Firestore document id and a URL path segment, which rules
 * out `/` and the reserved `.` / `..` ids.
 */
const SYNC_ID_RE = /^[A-Za-z0-9._~:=+-]{1,128}$/;

/** Validate a Sync ID from an untrusted caller. Case is preserved: the
 *  external platform owns the value and it is matched exactly. */
export function readSyncId(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  const id = v.trim();
  if (!SYNC_ID_RE.test(id) || id === "." || id === "..") {
    throw new HttpsError(
      "invalid-argument",
      `${field} may only contain letters, numbers and . _ ~ : = + - (up to 128 characters).`,
    );
  }
  return id;
}

/** Constant-time API key check. Hashing first makes the comparison
 *  length-independent, so a wrong-length key leaks nothing either. */
export function apiKeyMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Daily roll-up for the data API
// ---------------------------------------------------------------------------

export interface ApiDay {
  /** Local calendar day in the format 3C asked for: `YYYY-MM-DD 00:00:00`. */
  isoDate: string;
  green: number;
  red: number;
  calories: number;
}

interface EntryLike {
  date?: unknown;
  color?: unknown;
  servings?: unknown;
  kcal?: unknown;
}

/**
 * Totals per logged day, newest first. Counts follow the app's own goal
 * scoring (src/lib/goals.ts): red and green are servings, not entries, so
 * "2 servings of chips" is 2 red. Unknown calories count as 0. Days with
 * nothing logged are omitted rather than reported as zeros.
 */
export function rollUpDays(entries: EntryLike[]): ApiDay[] {
  const byDate = new Map<string, { green: number; red: number; kcal: number }>();
  for (const e of entries) {
    if (typeof e.date !== "string") continue;
    const row = byDate.get(e.date) ?? { green: 0, red: 0, kcal: 0 };
    const servings = typeof e.servings === "number" ? e.servings : 1;
    if (e.color === "green") row.green += servings;
    if (e.color === "red") row.red += servings;
    if (typeof e.kcal === "number" && Number.isFinite(e.kcal)) row.kcal += e.kcal;
    byDate.set(e.date, row);
  }
  // Servings can be fractional (half a portion); two decimals is plenty and
  // keeps float noise like 2.3000000000000003 out of the payload.
  const tidy = (n: number) => Math.round(n * 100) / 100;
  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, r]) => ({
      isoDate: `${date} 00:00:00`,
      green: tidy(r.green),
      red: tidy(r.red),
      calories: Math.round(r.kcal),
    }));
}

/** Optional `from` / `to` query bounds, inclusive, `YYYY-MM-DD`. */
export function readDateBound(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new HttpsError("invalid-argument", `${name} must be a date in YYYY-MM-DD format.`);
  }
  return v;
}
