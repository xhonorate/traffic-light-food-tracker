import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy,
  query, setDoc, updateDoc, where, limit as qLimit,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import type {
  AppConfig, FamilyDoc, FoodFacts, LogEntry, MemberGoals, MemberId, QuickFood,
  RuleSet, UserDoc,
} from "./types";
import { DEFAULT_APP_CONFIG } from "./types";
import { DEFAULT_RULE_SET } from "./defaultRules";

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RULES_DOC = doc(db, "config", "rules");

/** Live-subscribe to the rule set. Falls back to the built-in defaults until
 *  an admin has saved anything, so the app classifies correctly from day one. */
export function subscribeRules(cb: (rules: RuleSet) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    RULES_DOC,
    (snap) => cb(snap.exists() ? (snap.data() as RuleSet) : DEFAULT_RULE_SET),
    (e) => { onError?.(e); cb(DEFAULT_RULE_SET); },
  );
}

export async function saveRules(rules: RuleSet, uid: string): Promise<void> {
  await setDoc(RULES_DOC, { ...rules, updatedAt: Date.now(), updatedBy: uid });
}

export async function resetRules(uid: string): Promise<void> {
  await saveRules(DEFAULT_RULE_SET, uid);
}

// ---------------------------------------------------------------------------
// App config
// ---------------------------------------------------------------------------

const APP_DOC = doc(db, "config", "app");

export function subscribeAppConfig(cb: (cfg: AppConfig) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    APP_DOC,
    (snap) => cb(snap.exists() ? { ...DEFAULT_APP_CONFIG, ...(snap.data() as AppConfig) } : DEFAULT_APP_CONFIG),
    (e) => { onError?.(e); cb(DEFAULT_APP_CONFIG); },
  );
}

export async function saveAppConfig(cfg: AppConfig): Promise<void> {
  await setDoc(APP_DOC, cfg, { merge: true });
}

// ---------------------------------------------------------------------------
// Users (admins and coaches)
// ---------------------------------------------------------------------------

export function subscribeUsers(cb: (users: UserDoc[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "users"), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as UserDoc), uid: d.id }))),
    (e) => onError?.(e),
  );
}

export function subscribeCoaches(cb: (users: UserDoc[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "users"), where("role", "==", "coach")),
    (snap) => cb(
      snap.docs
        .map((d) => ({ ...(d.data() as UserDoc), uid: d.id }))
        .sort((a, b) => b.createdAt - a.createdAt),
    ),
    (e) => onError?.(e),
  );
}

export const createCoach = httpsCallable<
  { email: string; name: string; role: "coach" | "admin" },
  { uid: string; email: string }
>(functions, "createCoach");

export const deleteCoach = httpsCallable<{ uid: string }, { ok: true }>(functions, "deleteCoach");

/** Stamp a staff sign-in. Fire-and-forget: never block the UI on it. */
export const recordLogin = httpsCallable<Record<string, never>, { ok: true }>(functions, "recordLogin");

export async function updateUser(uid: string, patch: Partial<UserDoc>): Promise<void> {
  await updateDoc(doc(db, "users", uid), patch as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

export function subscribeFamilies(
  cb: (families: FamilyDoc[]) => void,
  opts: { coachId?: string } = {},
  onError?: (e: Error) => void,
) {
  const base = collection(db, "families");
  const q = opts.coachId
    ? query(base, where("coachId", "==", opts.coachId))
    : query(base);
  return onSnapshot(
    q,
    (snap) => cb(
      snap.docs
        .map((d) => ({ ...(d.data() as FamilyDoc), id: d.id }))
        .sort((a, b) => b.createdAt - a.createdAt),
    ),
    (e) => onError?.(e),
  );
}

export function subscribeFamily(
  familyId: string,
  cb: (family: FamilyDoc | null) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, "families", familyId),
    (snap) => cb(snap.exists() ? { ...(snap.data() as FamilyDoc), id: snap.id } : null),
    (e) => onError?.(e),
  );
}

export async function getFamily(familyId: string): Promise<FamilyDoc | null> {
  const snap = await getDoc(doc(db, "families", familyId));
  return snap.exists() ? { ...(snap.data() as FamilyDoc), id: snap.id } : null;
}

export const createFamily = httpsCallable<
  {
    label: string;
    coachId?: string;
    parent: { name: string; goals: MemberGoals };
    child: { name: string; goals: MemberGoals };
  },
  { familyId: string; code: string }
>(functions, "createFamily");

export const deleteFamily = httpsCallable<{ familyId: string }, { ok: true }>(functions, "deleteFamily");

export const regenerateCode = httpsCallable<{ familyId: string }, { code: string }>(functions, "regenerateCode");

export async function updateFamily(familyId: string, patch: Partial<FamilyDoc>): Promise<void> {
  await updateDoc(doc(db, "families", familyId), patch as Record<string, unknown>);
}

/** Write one member's daily goals. Coaches own this; families cannot change it. */
export async function setMemberGoals(
  familyId: string, memberId: MemberId, goals: MemberGoals,
): Promise<void> {
  await updateDoc(doc(db, "families", familyId), { [`members.${memberId}.goals`]: goals });
}

export async function setMemberName(
  familyId: string, memberId: MemberId, name: string,
): Promise<void> {
  await updateDoc(doc(db, "families", familyId), { [`members.${memberId}.name`]: name });
}

/** Stamp activity so coaches can see who is actually using the app. */
export async function touchFamily(familyId: string): Promise<void> {
  try {
    await updateDoc(doc(db, "families", familyId), { lastActiveAt: Date.now() });
  } catch {
    // Non-critical; never block logging on this.
  }
}

// ---------------------------------------------------------------------------
// Log entries
// ---------------------------------------------------------------------------

function entriesCol(familyId: string) {
  return collection(db, "families", familyId, "entries");
}

/** Entries for one member across an inclusive date range (`YYYY-MM-DD`). */
export function subscribeEntries(
  familyId: string,
  memberId: MemberId,
  fromDate: string,
  toDate: string,
  cb: (entries: LogEntry[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    entriesCol(familyId),
    where("memberId", "==", memberId),
    where("date", ">=", fromDate),
    where("date", "<=", toDate),
  );
  return onSnapshot(
    q,
    (snap) => cb(
      snap.docs
        .map((d) => ({ ...(d.data() as LogEntry), id: d.id }))
        .sort((a, b) => a.createdAt - b.createdAt),
    ),
    (e) => onError?.(e),
  );
}

/** All entries for a family in a range, both members -- used for exports. */
export async function fetchEntriesRange(
  familyId: string, fromDate: string, toDate: string,
): Promise<LogEntry[]> {
  const snap = await getDocs(query(
    entriesCol(familyId),
    where("date", ">=", fromDate),
    where("date", "<=", toDate),
  ));
  return snap.docs
    .map((d) => ({ ...(d.data() as LogEntry), id: d.id }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

export async function addEntry(
  familyId: string, entry: Omit<LogEntry, "id">,
): Promise<string> {
  const ref = await addDoc(entriesCol(familyId), entry);
  void touchFamily(familyId);
  return ref.id;
}

export async function deleteEntry(familyId: string, entryId: string): Promise<void> {
  await deleteDoc(doc(db, "families", familyId, "entries", entryId));
}

export async function updateEntry(
  familyId: string, entryId: string, patch: Partial<LogEntry>,
): Promise<void> {
  await updateDoc(doc(db, "families", familyId, "entries", entryId), patch as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Quick-add foods
// ---------------------------------------------------------------------------

function quickCol(familyId: string) {
  return collection(db, "families", familyId, "quickFoods");
}

export function subscribeQuickFoods(
  familyId: string,
  cb: (foods: QuickFood[]) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    query(quickCol(familyId), orderBy("useCount", "desc"), qLimit(12)),
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as QuickFood), id: d.id }))),
    (e) => onError?.(e),
  );
}

/** A stable id per food so repeat logs increment one counter. */
function quickId(facts: FoodFacts): string {
  const raw = `${facts.name}|${facts.brand}|${facts.code}`.toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "food";
}

/** Record that a food was logged, so it can surface as a quick-add. */
export async function bumpQuickFood(
  familyId: string, memberId: MemberId, facts: FoodFacts,
): Promise<void> {
  const id = quickId(facts);
  const ref = doc(db, "families", familyId, "quickFoods", id);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        useCount: ((snap.data() as QuickFood).useCount ?? 0) + 1,
        lastUsedAt: Date.now(),
      });
    } else {
      await setDoc(ref, {
        memberId, name: facts.name, brand: facts.brand,
        useCount: 1, lastUsedAt: Date.now(), facts,
      });
    }
  } catch {
    // Quick-add is a convenience; never fail a log over it.
  }
}

export async function removeQuickFood(familyId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, "families", familyId, "quickFoods", id));
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/** One-time claim of the first admin account. Server refuses once an admin
 *  exists, so this cannot be used to escalate later. */
export const claimFirstAdmin = httpsCallable<{ name: string }, { ok: true }>(functions, "claimFirstAdmin");
