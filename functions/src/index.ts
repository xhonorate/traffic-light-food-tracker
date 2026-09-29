/**
 * Cloud Functions for the Traffic Light Food Tracker.
 *
 * Everything that must not be trusted to a browser lives here: minting
 * sessions from family codes, creating and deleting accounts, "login as",
 * proxying the USDA lookup so the API key stays server-side, and the HTTP
 * API the external platform (3C) uses to roster people and read their data.
 */

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import {
  getFirestore, type DocumentReference, type DocumentSnapshot, type Query, type Transaction,
} from "firebase-admin/firestore";
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions";
import {
  apiKeyMatches, readDateBound, readSyncId, rollUpDays, sameOwner,
  type MemberId, type SyncOwner,
} from "./sync";

initializeApp();
const db = getFirestore();
const auth = getAuth();

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

/** USDA FoodData Central key. Set with:
 *  `firebase functions:secrets:set USDA_API_KEY` */
const USDA_API_KEY = defineSecret("USDA_API_KEY");

/** Shared key the external platform sends as `X-API-Key`. Each Firebase
 *  project (QA, prod) holds its own value. Set with:
 *  `firebase functions:secrets:set SYNC_API_KEY` */
const SYNC_API_KEY = defineSecret("SYNC_API_KEY");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Role = "admin" | "coach" | "family";

interface Caller {
  uid: string;
  role: Role;
  familyId?: string;
  impersonatedBy?: string;
  /** Actors that led to this session, oldest first. Empty for a real login. */
  impChain: string[];
}

function requireAuth(req: CallableRequest): Caller {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  const token = req.auth?.token as Record<string, unknown> | undefined;
  const role = token?.role;
  if (role !== "admin" && role !== "coach" && role !== "family") {
    throw new HttpsError("permission-denied", "This account has no role assigned.");
  }
  const chain = Array.isArray(token?.impChain)
    ? (token.impChain as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  return {
    uid,
    role,
    familyId: typeof token?.familyId === "string" ? token.familyId : undefined,
    impersonatedBy: typeof token?.impersonatedBy === "string" ? token.impersonatedBy : undefined,
    impChain: chain,
  };
}

/** The real human behind a session, following the impersonation stack back. */
const rootActor = (caller: Caller): string => caller.impChain[0] ?? caller.uid;

/** How deep "view as" may nest. Admin -> coach -> family is the real use case;
 *  the cap just stops a malformed client building an unbounded claim. */
const MAX_IMPERSONATION_DEPTH = 3;

function requireRole(req: CallableRequest, ...roles: Role[]): Caller {
  const caller = requireAuth(req);
  if (!roles.includes(caller.role)) {
    throw new HttpsError("permission-denied", "You do not have access to do that.");
  }
  return caller;
}

/**
 * Whether the human behind this session is an administrator. An admin keeps
 * admin authority while viewing as a coach; being more restricted there than
 * when signed in directly is surprising and gets in the way.
 */
async function actsAsAdmin(caller: Caller): Promise<boolean> {
  const root = rootActor(caller);
  if (root === caller.uid) return caller.role === "admin";
  const rootSnap = await db.doc(`users/${root}`).get();
  return rootSnap.data()?.role === "admin";
}

/** Reject an account an admin has switched off, even mid-session. */
async function assertEnabled(uid: string): Promise<void> {
  const snap = await db.doc(`users/${uid}`).get();
  if (snap.exists && snap.data()?.disabled === true) {
    throw new HttpsError("permission-denied", "This account has been disabled.");
  }
}

const str = (v: unknown, field: string, max = 200): string => {
  if (typeof v !== "string" || !v.trim()) {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  if (v.length > max) throw new HttpsError("invalid-argument", `${field} is too long.`);
  return v.trim();
};

const nonNegInt = (v: unknown, field: string, max = 1000): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    throw new HttpsError("invalid-argument", `${field} must be between 0 and ${max}.`);
  }
  return Math.round(n);
};

/** The three daily targets a coach sets per member. */
interface MemberGoals {
  dailyRed: number;
  dailyGreen: number;
  dailyKcal: number;
}

/** Must match DEFAULT_GOALS / CHILD_KCAL_TARGET in src/lib/types.ts. */
const PARENT_KCAL_DEFAULT = 1650;
const CHILD_KCAL_TARGET = 1350;

/** Validate goals from an untrusted client, with the same defaults the app
 *  uses. The child's calorie target is fixed by the program, so whatever the
 *  client sent for it is ignored. */
function readGoals(v: unknown, who: "Parent" | "Child"): MemberGoals {
  const g = (v ?? {}) as Record<string, unknown>;
  return {
    dailyRed: nonNegInt(g.dailyRed ?? 2, `${who} daily red food budget`, 100),
    dailyGreen: nonNegInt(g.dailyGreen ?? 5, `${who} daily green food goal`, 100),
    dailyKcal: who === "Child"
      ? CHILD_KCAL_TARGET
      : nonNegInt(g.dailyKcal ?? PARENT_KCAL_DEFAULT, `${who} daily calorie target`, 20000),
  };
}

/**
 * Code alphabet with look-alikes removed (no O/0, I/1/L). Codes get read out
 * loud and copied off paper, so ambiguity is a real support cost.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Claim a unique code transactionally; retries on the rare collision. */
async function allocateCode(familyId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode();
    const ref = db.doc(`codes/${code}`);
    try {
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) throw new Error("taken");
        tx.set(ref, { familyId, createdAt: Date.now() });
      });
      return code;
    } catch (e) {
      if ((e as Error).message !== "taken") throw e;
    }
  }
  throw new HttpsError("resource-exhausted", "Could not allocate a unique code. Try again.");
}

const familyUid = (familyId: string) => `fam_${familyId}`;

const syncRef = (syncId: string) => db.doc(`syncIds/${syncId}`);

const describeOwner = (o: SyncOwner) =>
  o.kind === "staff" ? "a coach or administrator" : "a family member";

interface SyncClaim {
  syncId: string;
  owner: SyncOwner;
}

/**
 * Fail if any of these Sync IDs already belongs to someone other than the
 * intended owner. Inside a transaction this is the uniqueness guarantee, and
 * it only reads -- call it before the transaction writes anything. Outside
 * one it is a fast pre-check, so a clash is reported before an Auth user or
 * access code gets created and has to be rolled back.
 */
async function assertSyncIdsFree(claims: SyncClaim[], tx?: Transaction): Promise<void> {
  if (new Set(claims.map((c) => c.syncId)).size !== claims.length) {
    throw new HttpsError("invalid-argument", "Each person needs a different Sync ID.");
  }
  const refs = claims.map((c) => syncRef(c.syncId));
  const snaps = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
  snaps.forEach((snap, i) => {
    const existing = snap.data() as SyncOwner | undefined;
    if (existing && !sameOwner(existing, claims[i].owner)) {
      throw new HttpsError(
        "already-exists",
        `Sync ID ${claims[i].syncId} is already linked to ${describeOwner(existing)}.`,
      );
    }
  });
}

/**
 * Mint a custom token, translating the one failure mode that is a deployment
 * problem rather than a caller problem.
 *
 * Signing a custom token needs `iam.serviceAccounts.signBlob`, which the
 * gen-2 runtime service account does NOT hold by default. Without the grant
 * every sign-in path that mints a session -- family codes and "open as" --
 * fails with an opaque INTERNAL. Surfacing it explicitly turns a confusing
 * 500 into something the operator can act on. See SETUP.md.
 */
async function mintToken(uid: string, claims: Record<string, unknown>): Promise<string> {
  try {
    return await auth.createCustomToken(uid, claims);
  } catch (e) {
    const code = (e as { errorInfo?: { code?: string } })?.errorInfo?.code ?? "";
    if (code === "auth/insufficient-permission") {
      logger.error(
        "createCustomToken failed: the runtime service account cannot sign. " +
        "Grant roles/iam.serviceAccountTokenCreator to the functions service account.",
        { uid },
      );
      throw new HttpsError(
        "failed-precondition",
        "Sign-in is not fully configured on the server yet. An administrator needs to grant " +
        "the Service Account Token Creator role to this project's functions service account.",
      );
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap: claim the first administrator
// ---------------------------------------------------------------------------

/**
 * Turns the calling account into the first administrator. Refuses once any
 * admin exists, so it cannot be replayed to escalate later.
 */
export const claimFirstAdmin = onCall(async (req) => {
  const uid = req.auth?.uid;
  const email = req.auth?.token?.email as string | undefined;
  if (!uid || !email) throw new HttpsError("unauthenticated", "Sign in with email first.");

  const existing = await db.collection("users").where("role", "==", "admin").limit(1).get();
  if (!existing.empty) {
    throw new HttpsError(
      "failed-precondition",
      "An administrator already exists. Ask them to add your account.",
    );
  }

  const name = str(req.data?.name ?? email, "Name");
  await auth.setCustomUserClaims(uid, { role: "admin" });
  await db.doc(`users/${uid}`).set({
    email, name, role: "admin", disabled: false,
    createdAt: Date.now(), lastLoginAt: Date.now(),
  });

  logger.info("First admin claimed", { uid, email });
  return { ok: true as const };
});

// ---------------------------------------------------------------------------
// Coach / admin accounts
// ---------------------------------------------------------------------------

const readEmail = (v: unknown, field = "Email"): string => {
  const email = str(v, field).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new HttpsError("invalid-argument", "That does not look like an email address.");
  }
  return email;
};

interface NewStaff {
  email: string;
  name: string;
  role: "coach" | "admin";
  /** Required for coaches; optional for administrators. */
  syncId: string | null;
  disabled?: boolean;
}

/** Create a coach or admin: Auth user, role claim, profile and Sync ID link.
 *  Shared by the admin screen and the external API. */
async function createStaffAccount(input: NewStaff): Promise<{ uid: string; email: string }> {
  const { email, name, role, syncId } = input;
  if (syncId) await assertSyncIdsFree([{ syncId, owner: { kind: "staff", uid: "" } }]);

  // A login for this email may already exist without dashboard access --
  // typically someone who tried "Sign in with Google" before being added.
  // That is not a conflict: take the login over rather than refuse. Only a
  // `users` profile means the person really has an account here already.
  const existing = await auth.getUserByEmail(email).catch((e) => {
    if ((e as { code?: string }).code === "auth/user-not-found") return null;
    throw e;
  });
  if (existing && (await db.doc(`users/${existing.uid}`).get()).exists) {
    throw new HttpsError(
      "already-exists",
      "An account with that email already has dashboard access.",
    );
  }

  let uid: string;
  if (existing) {
    uid = existing.uid;
    await secureAdoptedLogin(existing);
  } else {
    try {
      // No password is set here. The client follows up with Firebase Auth's own
      // password-reset email, which is how the coach chooses their own.
      const user = await auth.createUser({ email, displayName: name, emailVerified: false });
      uid = user.uid;
    } catch (e) {
      // Created in the moment since the lookup above. Rare enough to just ask
      // for a retry, which will take the new login over.
      if ((e as { code?: string }).code === "auth/email-already-exists") {
        throw new HttpsError("aborted", "That email was registered at the same moment. Try again.");
      }
      throw e;
    }
  }

  const userRef = db.doc(`users/${uid}`);
  let committed = false;
  try {
    await db.runTransaction(async (tx) => {
      const claims = syncId ? [{ syncId, owner: { kind: "staff" as const, uid } }] : [];
      if (syncId) await assertSyncIdsFree(claims, tx);
      // Re-checked inside the transaction so two requests cannot both take
      // over the same login.
      if ((await tx.get(userRef)).exists) {
        throw new HttpsError("already-exists", "An account with that email already has dashboard access.");
      }
      tx.set(userRef, {
        email, name, role, disabled: input.disabled === true,
        createdAt: Date.now(), lastLoginAt: null,
        ...(syncId ? { syncId } : {}),
      });
      if (syncId) tx.set(syncRef(syncId), { kind: "staff", uid, createdAt: Date.now() });
    });
    committed = true;
    await auth.setCustomUserClaims(uid, { role });
    if (existing) await auth.updateUser(uid, { displayName: name });
  } catch (e) {
    // Undo only what this call wrote. If the transaction itself failed, the
    // profile there (if any) belongs to someone else and must stay.
    if (committed) {
      const batch = db.batch();
      batch.delete(userRef);
      if (syncId) batch.delete(syncRef(syncId));
      await batch.commit().catch(() => undefined);
    }
    // A login this call created goes too; one it took over is left in place.
    if (!existing) await auth.deleteUser(uid).catch(() => undefined);
    throw e;
  }

  logger.info("Account created", { uid, email, role, syncId, adoptedExistingLogin: Boolean(existing) });
  return { uid, email };
}

/**
 * Make a login that predates the account safe to grant access to.
 *
 * Anyone can register an email/password login for an address they do not
 * own -- Firebase does not check until the address is verified. If we simply
 * gave coach access to such a login, whoever registered it first would be
 * signed in as the coach. So an unverified password is replaced with a random
 * one nobody knows; the real coach sets their own through the normal invite
 * or "Forgot password" email. Google and verified logins are kept: they prove
 * ownership of the address. Existing sessions are revoked either way.
 */
async function secureAdoptedLogin(user: UserRecord): Promise<void> {
  const hasPassword = user.providerData.some((p) => p.providerId === "password");
  if (hasPassword && !user.emailVerified) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    await auth.updateUser(user.uid, { password: Buffer.from(bytes).toString("base64url") });
  }
  await auth.revokeRefreshTokens(user.uid);
}

export const createCoach = onCall(async (req) => {
  requireRole(req, "admin");

  const email = readEmail(req.data?.email);
  const name = str(req.data?.name, "Name", 120);
  const role = req.data?.role === "admin" ? "admin" : "coach";
  // Coaches exist on the external platform first, so they always arrive with
  // a Sync ID. Administrators are local to this app and may have none.
  const syncId = role === "coach" || req.data?.syncId
    ? readSyncId(req.data?.syncId, "Sync ID")
    : null;

  return createStaffAccount({ email, name, role, syncId });
});

export const deleteCoach = onCall(async (req) => {
  const caller = requireRole(req, "admin");
  const uid = str(req.data?.uid, "User id");

  if (uid === caller.uid) {
    throw new HttpsError("failed-precondition", "You cannot delete your own account.");
  }

  await deleteStaffAccount(uid);
  return { ok: true as const };
});

/** Remove a coach or admin. Their families are kept, unassigned. Shared by
 *  the admin screen and the external API. */
async function deleteStaffAccount(uid: string): Promise<{ detachedFamilies: number }> {
  // Never orphan data silently: detach the families first so they remain
  // visible to other admins and can be reassigned.
  const owned = await db.collection("families").where("coachId", "==", uid).get();
  const userSnap = await db.doc(`users/${uid}`).get();
  const syncId = userSnap.data()?.syncId as string | undefined;
  const batch = db.batch();
  owned.docs.forEach((d) => batch.update(d.ref, { coachId: "" }));
  batch.delete(db.doc(`users/${uid}`));
  // Free the Sync ID so the external platform can link it again.
  if (syncId) batch.delete(syncRef(syncId));
  await batch.commit();

  await auth.deleteUser(uid).catch((e) => {
    logger.warn("Auth user already gone", { uid, error: (e as Error).message });
  });

  logger.info("Account deleted", { uid, detachedFamilies: owned.size });
  return { detachedFamilies: owned.size };
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

interface NewMember {
  name: string;
  goals: MemberGoals;
  syncId: string;
}

interface NewFamily {
  label: string;
  /** Owning coach's uid, or "" for unassigned. */
  coachId: string;
  active: boolean;
  parent: NewMember;
  child: NewMember;
}

const MEMBER_IDS: MemberId[] = ["parent", "child"];

/** Create a family with its access code and both members' Sync ID links.
 *  Shared by the in-app form and the external API. */
async function createFamilyRecord(f: NewFamily): Promise<{ familyId: string; code: string }> {
  const ref = db.collection("families").doc();
  const claims: SyncClaim[] = MEMBER_IDS.map((memberId) => ({
    syncId: f[memberId].syncId,
    owner: { kind: "member", familyId: ref.id, memberId },
  }));

  await assertSyncIdsFree(claims);
  const code = await allocateCode(ref.id);

  try {
    await db.runTransaction(async (tx) => {
      await assertSyncIdsFree(claims, tx);
      tx.set(ref, {
        code, coachId: f.coachId, label: f.label, active: f.active,
        createdAt: Date.now(), lastActiveAt: null,
        members: {
          parent: { name: f.parent.name, goals: f.parent.goals, syncId: f.parent.syncId },
          child: { name: f.child.name, goals: f.child.goals, syncId: f.child.syncId },
        },
      });
      for (const c of claims) tx.set(syncRef(c.syncId), { ...c.owner, createdAt: Date.now() });
    });
  } catch (e) {
    // Lost a race for a Sync ID: release the code rather than strand it.
    await db.doc(`codes/${code}`).delete().catch(() => undefined);
    throw e;
  }

  // A real Auth user backs the family so its role claim survives token
  // refreshes rather than living only inside one custom token.
  await auth.createUser({ uid: familyUid(ref.id), displayName: f.label }).catch(() => undefined);
  await auth.setCustomUserClaims(familyUid(ref.id), { role: "family", familyId: ref.id });

  logger.info("Family created", { familyId: ref.id, coachId: f.coachId });
  return { familyId: ref.id, code };
}

export const createFamily = onCall(async (req) => {
  const caller = requireRole(req, "admin", "coach");
  await assertEnabled(caller.uid);

  const label = str(req.data?.label, "Family name", 120);

  // An admin may create on a coach's behalf; a coach always owns their own.
  const coachId = caller.role === "admin" && typeof req.data?.coachId === "string" && req.data.coachId
    ? req.data.coachId
    : caller.uid;

  return createFamilyRecord({
    label, coachId, active: true,
    parent: {
      name: str(req.data?.parent?.name, "Parent name", 80),
      goals: readGoals(req.data?.parent?.goals, "Parent"),
      syncId: readSyncId(req.data?.parent?.syncId, "Parent Sync ID"),
    },
    child: {
      name: str(req.data?.child?.name, "Child name", 80),
      goals: readGoals(req.data?.child?.goals, "Child"),
      syncId: readSyncId(req.data?.child?.syncId, "Child Sync ID"),
    },
  });
});

/**
 * Link, or re-link, a coach or family member to a Sync ID. Admin only: this
 * is how records created before Sync IDs existed get connected, and how a
 * mistyped ID gets corrected. The old ID is released in the same transaction.
 */
export const setSyncId = onCall(async (req) => {
  const caller = requireRole(req, "admin", "coach");
  if (!(await actsAsAdmin(caller))) {
    throw new HttpsError("permission-denied", "Only administrators can change a Sync ID.");
  }
  // The human behind a "view as" session must still be active too.
  await assertEnabled(rootActor(caller));
  const syncId = readSyncId(req.data?.syncId, "Sync ID");
  const target = req.data?.target as Record<string, unknown> | undefined;

  let owner: SyncOwner;
  if (target?.kind === "staff") {
    owner = { kind: "staff", uid: str(target.uid, "User id") };
  } else if (target?.kind === "member" && (target.memberId === "parent" || target.memberId === "child")) {
    owner = { kind: "member", familyId: str(target.familyId, "Family id"), memberId: target.memberId };
  } else {
    throw new HttpsError("invalid-argument", "Unknown Sync ID target.");
  }

  const docRef = owner.kind === "staff"
    ? db.doc(`users/${owner.uid}`)
    : db.doc(`families/${owner.familyId}`);
  const field = owner.kind === "staff" ? "syncId" : `members.${owner.memberId}.syncId`;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) throw new HttpsError("not-found", "That record no longer exists.");
    const current = (owner.kind === "staff"
      ? snap.data()?.syncId
      : snap.data()?.members?.[owner.memberId]?.syncId) as string | undefined;
    if (current === syncId) return;

    await assertSyncIdsFree([{ syncId, owner }], tx);
    const old = current ? await tx.get(syncRef(current)) : null;

    if (old?.exists && sameOwner(old.data() as SyncOwner, owner)) tx.delete(old.ref);
    tx.set(syncRef(syncId), { ...owner, createdAt: Date.now() });
    tx.update(docRef, { [field]: syncId });
  });

  logger.info("Sync ID set", { owner, syncId });
  return { ok: true as const };
});

/**
 * A coach may only touch their own families; an admin may touch any.
 *
 * `treatAsAdmin` lets an admin who is currently viewing as a coach keep their
 * own authority. Without it an admin part-way down a "view as" chain would be
 * more restricted than when signed in directly -- which is surprising, and was
 * half of why admin -> coach -> family failed.
 */
async function assertFamilyAccess(caller: Caller, familyId: string, treatAsAdmin = false) {
  const snap = await db.doc(`families/${familyId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That family no longer exists.");
  const isAdmin = treatAsAdmin || caller.role === "admin";
  if (!isAdmin && snap.data()?.coachId !== caller.uid) {
    throw new HttpsError("permission-denied", "That family belongs to another coach.");
  }
  return snap;
}

export const regenerateCode = onCall(async (req) => {
  const caller = requireRole(req, "admin", "coach");
  const familyId = str(req.data?.familyId, "Family id");
  const snap = await assertFamilyAccess(caller, familyId);

  const oldCode = snap.data()?.code as string | undefined;
  const code = await allocateCode(familyId);

  const batch = db.batch();
  batch.update(snap.ref, { code });
  if (oldCode) batch.delete(db.doc(`codes/${oldCode}`));
  await batch.commit();

  logger.info("Code regenerated", { familyId });
  return { code };
});

export const deleteFamily = onCall(async (req) => {
  const caller = requireRole(req, "admin", "coach");
  const familyId = str(req.data?.familyId, "Family id");
  const snap = await assertFamilyAccess(caller, familyId);

  await deleteFamilyRecord(snap);
  return { ok: true as const };
});

/** Permanently remove a family, its whole log, its code and its members'
 *  Sync ID links. Shared by the app and the external API. */
async function deleteFamilyRecord(snap: DocumentSnapshot): Promise<void> {
  const familyId = snap.id;

  // Firestore does not cascade; remove subcollections explicitly.
  for (const sub of ["entries", "quickFoods"]) {
    // eslint-disable-next-line no-await-in-loop
    await db.recursiveDelete(snap.ref.collection(sub));
  }

  const code = snap.data()?.code as string | undefined;
  const batch = db.batch();
  if (code) batch.delete(db.doc(`codes/${code}`));
  // Free the members' Sync IDs so the external platform can link them again.
  for (const m of MEMBER_IDS) {
    const syncId = snap.data()?.members?.[m]?.syncId as string | undefined;
    if (syncId) batch.delete(syncRef(syncId));
  }
  batch.delete(snap.ref);
  await batch.commit();

  await auth.deleteUser(familyUid(familyId)).catch(() => undefined);

  logger.info("Family deleted", { familyId });
}

// ---------------------------------------------------------------------------
// Family code sign-in
// ---------------------------------------------------------------------------

/**
 * Exchange a family access code for a Firebase session. Deliberately callable
 * without auth -- the code *is* the credential. Codes are never readable from
 * the client, so the only way to test one is through this function.
 */
export const redeemFamilyCode = onCall(async (req) => {
  const raw = req.data?.code;
  if (typeof raw !== "string") throw new HttpsError("invalid-argument", "A code is required.");

  const code = raw.trim().toUpperCase();
  if (!new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code)) {
    throw new HttpsError("not-found", "That code was not recognised.");
  }

  const codeSnap = await db.doc(`codes/${code}`).get();
  if (!codeSnap.exists) {
    // Same message and shape as a wrong-but-well-formed code, so the response
    // does not distinguish "never existed" from "revoked".
    throw new HttpsError("not-found", "That code was not recognised.");
  }

  const familyId = codeSnap.data()?.familyId as string;
  const famSnap = await db.doc(`families/${familyId}`).get();
  if (!famSnap.exists) throw new HttpsError("not-found", "That code was not recognised.");
  if (famSnap.data()?.active === false) {
    throw new HttpsError("permission-denied", "This family account has been paused.");
  }

  const uid = familyUid(familyId);
  await auth.getUser(uid).catch(async () => {
    await auth.createUser({ uid, displayName: famSnap.data()?.label });
  });
  await auth.setCustomUserClaims(uid, { role: "family", familyId });

  const token = await mintToken(uid, { role: "family", familyId });
  await famSnap.ref.update({ lastActiveAt: Date.now() });

  logger.info("Family code redeemed", { familyId });
  return { token };
});

// ---------------------------------------------------------------------------
// "Login as"
// ---------------------------------------------------------------------------

export const impersonate = onCall(async (req) => {
  const caller = requireRole(req, "admin", "coach");

  // Both the account in use and the human behind it must still be active.
  const root = rootActor(caller);
  await assertEnabled(caller.uid);
  if (root !== caller.uid) await assertEnabled(root);

  if (caller.impChain.length >= MAX_IMPERSONATION_DEPTH) {
    throw new HttpsError(
      "failed-precondition",
      "You have switched accounts too many times. Return to your own account first.",
    );
  }

  const rootIsAdmin = await actsAsAdmin(caller);

  const type = req.data?.type;
  const id = str(req.data?.id, "Target id");
  const nextChain = [...caller.impChain, caller.uid];

  if (type === "coach") {
    if (!rootIsAdmin) {
      throw new HttpsError("permission-denied", "Only administrators can open a coach account.");
    }
    if (nextChain.includes(id)) {
      throw new HttpsError("failed-precondition", "You are already viewing that account.");
    }
    const target = await db.doc(`users/${id}`).get();
    if (!target.exists) throw new HttpsError("not-found", "That coach no longer exists.");
    if (target.data()?.role !== "coach") {
      throw new HttpsError("failed-precondition", "That account is not a coach.");
    }
    const token = await mintToken(id, {
      role: "coach",
      impersonatedBy: caller.uid,
      impChain: nextChain,
      viewingAs: target.data()?.name || target.data()?.email || "a coach",
    });
    logger.info("Impersonation started", {
      root, by: caller.uid, targetCoach: id, depth: nextChain.length,
    });
    return { token };
  }

  if (type === "family") {
    const snap = await assertFamilyAccess(caller, id, rootIsAdmin);
    const uid = familyUid(id);
    await auth.getUser(uid).catch(async () => {
      await auth.createUser({ uid, displayName: snap.data()?.label });
    });
    const token = await mintToken(uid, {
      role: "family",
      familyId: id,
      impersonatedBy: caller.uid,
      impChain: nextChain,
      viewingAs: snap.data()?.label || "a family",
    });
    logger.info("Impersonation started", {
      root, by: caller.uid, targetFamily: id, depth: nextChain.length,
    });
    return { token };
  }

  throw new HttpsError("invalid-argument", "Unknown target type.");
});

/** Hand the caller back a token for whoever started the impersonation. */
export const endImpersonation = onCall(async (req) => {
  const uid = req.auth?.uid;
  const token = req.auth?.token as Record<string, unknown> | undefined;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

  // Fall back to the single-step claim so sessions minted before chaining
  // existed can still return to their owner.
  const chain = Array.isArray(token?.impChain)
    ? (token.impChain as unknown[]).filter((x): x is string => typeof x === "string")
    : (typeof token?.impersonatedBy === "string" ? [token.impersonatedBy] : []);

  if (chain.length === 0) {
    throw new HttpsError("failed-precondition", "This session is not a 'view as' session.");
  }

  const backUid = chain[chain.length - 1];
  const remaining = chain.slice(0, -1);

  const back = await db.doc(`users/${backUid}`).get();
  if (!back.exists) throw new HttpsError("not-found", "Your original account no longer exists.");
  if (back.data()?.disabled === true) {
    throw new HttpsError("permission-denied", "Your account has been disabled.");
  }

  const role = back.data()?.role === "admin" ? "admin" : "coach";
  const claims: Record<string, unknown> = { role };

  // Still inside a chain: keep the rest of the stack so the banner and the
  // next "return" keep working.
  if (remaining.length > 0) {
    claims.impChain = remaining;
    claims.impersonatedBy = remaining[remaining.length - 1];
    claims.viewingAs = back.data()?.name || back.data()?.email || "an account";
  }

  const newToken = await mintToken(backUid, claims);
  logger.info("Impersonation stepped back", {
    back: backUid, remainingDepth: remaining.length,
  });
  return { token: newToken };
});

// ---------------------------------------------------------------------------
// Food lookup proxy (USDA FoodData Central + Open Food Facts)
// ---------------------------------------------------------------------------
import { foodFromFDC, foodFromOFF, portionFromDetail, rankFdcHits } from "./usda";

/**
 * Read the USDA key, defensively.
 *
 * Secrets get pasted and piped through shells that helpfully add a UTF-8 BOM
 * or a trailing newline. Either one silently invalidates the key -- USDA just
 * answers 403 -- so normalise rather than trust the stored bytes.
 */
function usdaKey(): string {
  const raw = USDA_API_KEY.value() || "";
  return raw.replace(/^﻿/, "").trim() || "DEMO_KEY";
}

interface JsonRequest {
  /** JSON body; when present the request is a POST. */
  body?: unknown;
  timeoutMs?: number;
}

/** One attempt. `html` flags the spurious gateway rejection described below. */
async function attemptJson(
  url: string, opts: JsonRequest,
): Promise<{ ok: true; data: any } | { ok: false; retryable: boolean; note: string }> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: opts.body === undefined ? "GET" : "POST",
      signal: controller.signal,
      headers: {
        "User-Agent": "traffic-light-food-tracker/1.0",
        ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      // A gateway that answers HTML rather than the API's JSON never saw the
      // application at all, so the same request may well succeed on a retry.
      const fromGateway = text.trimStart().startsWith("<");
      return {
        ok: false,
        retryable: fromGateway || r.status >= 500,
        note: `status ${r.status}${fromGateway ? " (gateway HTML)" : ""}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true, data: await r.json() };
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    return {
      ok: false,
      retryable: !aborted,
      note: aborted ? `timed out after ${timeoutMs}ms` : (e as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch JSON from an upstream, returning null on failure.
 *
 * Retries once on a transient failure. USDA sits behind a load balancer whose
 * nodes are not uniform: a request one node serves happily, another rejects
 * with a bare nginx "400 Bad Request" HTML page. Measured at roughly half of
 * all requests for certain parameter shapes, which is why food search failed
 * intermittently and appeared to "fix itself" when the user typed one more
 * letter and fired a fresh request.
 *
 * The parameter shape that provoked it is avoided outright (see usdaSearch),
 * but a single retry keeps the remaining flakiness out of the family's face.
 *
 * The URL is never logged -- it carries the API key -- so only the host is.
 */
async function fetchJson(url: string, opts: JsonRequest = {}): Promise<any> {
  const host = (() => { try { return new URL(url).host; } catch { return "unknown"; } })();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await attemptJson(url, opts);
    if (result.ok) {
      if (attempt > 1) logger.info("Upstream food lookup recovered on retry", { host });
      return result.data;
    }
    if (!result.retryable || attempt === 2) {
      logger.warn("Upstream food lookup failed", { host, attempts: attempt, note: result.note });
      return null;
    }
    // Brief pause so a retry is likely to land on a different backend.
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/**
 * USDA food search.
 *
 * Uses the POST form deliberately. The GET form needs `dataType` as a
 * comma-joined list, and those values contain spaces and parentheses
 * ("SR Legacy", "Survey (FNDDS)") which some USDA gateway nodes reject with a
 * 400 before the API sees the request -- about half the time, measured.
 * Sending the same filter as a JSON array sidesteps the query string entirely
 * and was clean across every trial.
 */
async function usdaSearch(
  key: string, body: Record<string, unknown>,
): Promise<any> {
  return fetchJson(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`,
    { body },
  );
}

/** How many search hits reach the family. */
const FOOD_RESULT_LIMIT = 12;

const OFF_FIELDS =
  "code,product_name,brands,serving_size,serving_quantity,nutriments,categories_tags,nutrition_data_per";

export const searchFoods = onCall({ secrets: [USDA_API_KEY] }, async (req) => {
  requireAuth(req);
  const query = str(req.data?.query, "Search text", 120);
  const key = usdaKey();

  const search = (q: string, pageSize: number) => usdaSearch(key, {
    query: q,
    pageSize,
    dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"],
  });

  // Collect candidates from up to two searches, keyed by fdcId so the two
  // never yield a duplicate row. `reached` distinguishes "USDA answered, with
  // nothing" from "USDA never answered".
  const byId = new Map<string, Record<string, any>>();
  let reached = false;
  const collect = (data: any) => {
    if (data) reached = true;
    for (const f of (data?.foods ?? []) as Record<string, any>[]) {
      const id = f?.fdcId != null ? String(f.fdcId) : null;
      if (id && !byId.has(id)) byId.set(id, f);
    }
  };

  // Exact phrase first. For "wheat thins" this asks USDA for rows that
  // actually contain the phrase, so the cracker is in the candidate pool
  // even though USDA's own ranking buries it under everything containing
  // "wheat". Pointless for a single word -- it is the word search below.
  const phrase = query.replace(/"/g, " ").trim();
  if (phrase.includes(" ")) collect(await search(`"${phrase}"`, 25));

  // Fall back to the loose word search when the phrase search did not turn
  // up a full page -- and always, for a single-word query.
  if (byId.size < FOOD_RESULT_LIMIT) collect(await search(query, 50));

  const results = rankFdcHits([...byId.values()], query)
    .slice(0, FOOD_RESULT_LIMIT)
    .map((f, i) => {
      const facts = foodFromFDC(f);
      return {
        key: `${f.fdcId ?? i}`,
        label: facts.name,
        sublabel: [facts.brand, facts.servingLabel].filter(Boolean).join(" · "),
        facts,
      };
    });

  if (results.length === 0 && !reached) {
    throw new HttpsError("unavailable", "Food search is temporarily unavailable. You can still enter foods yourself.");
  }

  return { results };
});

export const lookupBarcode = onCall({ secrets: [USDA_API_KEY] }, async (req) => {
  requireAuth(req);
  const code = str(req.data?.code, "Barcode", 20);
  if (!/^\d{6,14}$/.test(code)) {
    throw new HttpsError("invalid-argument", "That does not look like a barcode.");
  }

  // Open Food Facts first: its barcode coverage of everyday groceries is much
  // better than USDA's, which only indexes branded items it has ingested.
  const off = await fetchJson(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`,
  );
  if (off?.status === 1 && off.product?.product_name) {
    const facts = foodFromOFF(off.product);
    return {
      result: {
        key: code,
        label: facts.name,
        sublabel: [facts.brand, facts.servingLabel].filter(Boolean).join(" · "),
        facts,
      },
    };
  }

  const key = usdaKey();
  const padded = code.padStart(12, "0");
  // USDA stores US products as 12-digit UPC-A, but a scanner may report the
  // same code in its 13-digit EAN form with a leading zero.
  const upcA = code.length === 13 && code.startsWith("0") ? code.slice(1) : code;
  for (const gtin of new Set([code, padded, upcA])) {
    // eslint-disable-next-line no-await-in-loop
    const data = await usdaSearch(key, {
      query: `gtinUpc:${gtin}`,
      pageSize: 2,
      dataType: ["Branded"],
    });
    const hit = (data?.foods ?? [])[0];
    if (hit) {
      const facts = foodFromFDC(hit);
      return {
        result: {
          key: code,
          label: facts.name,
          sublabel: [facts.brand, facts.servingLabel].filter(Boolean).join(" · "),
          facts,
        },
      };
    }
  }

  return { result: null };
});

/**
 * Resolve a household portion for a food that arrived without one.
 *
 * Called only when a family actually picks such a food, so this costs one
 * extra USDA request per selection rather than one per search result.
 */
export const foodPortion = onCall({ secrets: [USDA_API_KEY] }, async (req) => {
  requireAuth(req);
  const fdcId = str(req.data?.fdcId, "Food id", 32);
  if (!/^[0-9]+$/.test(fdcId)) {
    throw new HttpsError("invalid-argument", "That is not a USDA food id.");
  }

  const detail = await fetchJson(
    `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(usdaKey())}`,
  );
  // A missing portion is a normal outcome, not an error -- the caller keeps
  // its 100g basis and says so.
  return { portion: detail ? portionFromDetail(detail) : null };
});

// ---------------------------------------------------------------------------
// Sign-in bookkeeping
// ---------------------------------------------------------------------------

/** Record a staff sign-in. Called by the client right after authenticating. */
export const recordLogin = onCall(async (req) => {
  const caller = requireAuth(req);
  if (caller.role === "family" || caller.impersonatedBy) return { ok: true as const };
  await db.doc(`users/${caller.uid}`)
    .set({ lastLoginAt: Date.now() }, { merge: true })
    .catch(() => undefined);
  return { ok: true as const };
});


// ---------------------------------------------------------------------------
// External platform API (3C)
//
// Served at /api/** through a Hosting rewrite. Every response carries
// `errorMessage`: null on success, a sentence on failure -- that field is the
// contract 3C checks. HTTP status codes are set too, for anything that looks.
//
//   GET  /api/data              every linked family member's daily totals
//   GET  /api/data/{syncId}     one family member's daily totals
//   POST /api/coaches           create or update a coach, keyed by syncId
//   POST /api/families          create or update a family, keyed by the
//                               members' syncIds
//   DELETE /api/coaches/{syncId}   delete a coach; families become unassigned
//   DELETE /api/families/{syncId}  delete the family either member belongs to
//
// The full contract is in openapi.yaml at the repo root.
//
// The data routes take optional `from` / `to` query bounds (YYYY-MM-DD).
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

const asBody = (v: unknown): Body =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {};

const optionalBool = (v: unknown, field: string): boolean | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new HttpsError("invalid-argument", `${field} must be true or false.`);
  return v;
};

async function fetchEntries(
  familyRef: DocumentReference,
  memberId: MemberId | null,
  from: string | null,
  to: string | null,
) {
  let q: Query = familyRef.collection("entries");
  if (memberId) q = q.where("memberId", "==", memberId);
  if (from) q = q.where("date", ">=", from);
  if (to) q = q.where("date", "<=", to);
  const snap = await q.select("memberId", "date", "color", "servings", "kcal").get();
  return snap.docs.map((d) => d.data());
}

/** Every family member that has a Sync ID. Members of families created
 *  before Sync IDs existed are left out: they cannot be linked yet. */
async function apiAllMembers(from: string | null, to: string | null) {
  const families = await db.collection("families").get();
  const perFamily = await Promise.all(families.docs.map(async (fam) => {
    const linked = MEMBER_IDS.filter((m) => fam.data().members?.[m]?.syncId);
    if (linked.length === 0) return [];
    const entries = await fetchEntries(fam.ref, null, from, to);
    return linked.map((m) => ({
      syncId: fam.data().members[m].syncId as string,
      days: rollUpDays(entries.filter((e) => e.memberId === m)),
    }));
  }));
  return perFamily.flat().sort((a, b) => a.syncId.localeCompare(b.syncId));
}

async function apiOneMember(syncId: string, from: string | null, to: string | null) {
  const owner = (await syncRef(syncId).get()).data() as SyncOwner | undefined;
  if (owner?.kind !== "member") {
    throw new HttpsError("not-found", `No family member has Sync ID ${syncId}.`);
  }
  const entries = await fetchEntries(db.doc(`families/${owner.familyId}`), owner.memberId, from, to);
  return { syncId, days: rollUpDays(entries) };
}

/** Resolve a coach's Sync ID to their uid. */
async function coachUidFor(syncId: string): Promise<string> {
  const owner = (await syncRef(syncId).get()).data() as SyncOwner | undefined;
  if (owner?.kind !== "staff") {
    throw new HttpsError("invalid-argument", `No coach has Sync ID ${syncId}.`);
  }
  return owner.uid;
}

/**
 * Create a coach, or update the one already linked to this Sync ID.
 *
 * Never links by email: an existing coach or admin profile with the same
 * address but no Sync ID is reported as a conflict, for an admin to link in
 * the app. A bare login with no profile (someone who tried to sign in before
 * being added) is not a conflict and is taken over. Administrators are out of
 * reach of this route entirely.
 */
async function apiUpsertCoach(body: Body) {
  const syncId = readSyncId(body.syncId, "syncId");
  const name = str(body.name, "name", 120);
  const email = readEmail(body.email, "email");
  const disabled = optionalBool(body.disabled, "disabled");
  const sendInvite = optionalBool(body.sendInvite, "sendInvite");

  const owner = (await syncRef(syncId).get()).data() as SyncOwner | undefined;
  if (!owner) {
    try {
      await createStaffAccount({ email, name, role: "coach", syncId, disabled });
    } catch (e) {
      if (e instanceof HttpsError && e.code === "already-exists" && e.message.includes("email")) {
        throw new HttpsError(
          "already-exists",
          "A coach or administrator with that email already has dashboard access but is not " +
          "linked to this Sync ID. An administrator can link it from the Coaches page.",
        );
      }
      throw e;
    }
    // Same invite the Coaches screen sends, so a new coach can choose a
    // password. Opt out with sendInvite: false.
    const inviteSent = sendInvite === false ? false : await sendPasswordSetupEmail(email);
    return { syncId, created: true, inviteSent };
  }
  if (owner.kind !== "staff") {
    throw new HttpsError("already-exists", `Sync ID ${syncId} belongs to a family member.`);
  }

  const userRef = db.doc(`users/${owner.uid}`);
  const user = (await userRef.get()).data();
  if (!user) throw new HttpsError("not-found", "That coach's account is missing. Ask an administrator.");
  if (user.role === "admin") {
    throw new HttpsError(
      "permission-denied",
      "That Sync ID belongs to an administrator, who can only be changed in the app.",
    );
  }

  try {
    await auth.updateUser(owner.uid, { email, displayName: name });
  } catch (e) {
    if ((e as { code?: string }).code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Another account already uses that email.");
    }
    throw e;
  }
  await userRef.update({ name, email, ...(disabled === undefined ? {} : { disabled }) });

  // An existing coach is only emailed on request -- the "Resend invite"
  // button, for 3C.
  const inviteSent = sendInvite === true ? await sendPasswordSetupEmail(email) : false;

  logger.info("Coach updated via API", { uid: owner.uid, syncId, inviteSent });
  return { syncId, created: false, inviteSent };
}

/**
 * Send Firebase Auth's password-reset email, which doubles as the coach
 * invite. It is the same email, from the same template, that the Coaches
 * screen sends from the browser with `sendPasswordResetEmail`.
 *
 * The Admin SDK can only *generate* that link, not send it, so this calls the
 * Identity Toolkit endpoint the SDK itself uses, authenticated as the
 * functions' service account, and leaves out `returnOobLink` so Firebase
 * delivers the email. Returns whether it was sent; a failure never undoes
 * the account, matching the Coaches screen, which reports it and offers
 * "Resend invite".
 */
async function sendPasswordSetupEmail(email: string): Promise<boolean> {
  try {
    const projectId = process.env.GCLOUD_PROJECT
      || (JSON.parse(process.env.FIREBASE_CONFIG || "{}") as { projectId?: string }).projectId;
    if (!projectId) throw new Error("project id unavailable");

    const { access_token: token } = await applicationDefault().getAccessToken();
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:sendOobCode`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
      },
    );
    if (!r.ok) throw new Error(`status ${r.status}: ${(await r.text()).slice(0, 300)}`);
    logger.info("Invite email sent", { email });
    return true;
  } catch (e) {
    logger.error("Invite email failed", { email, error: (e as Error).message });
    return false;
  }
}

/**
 * Create a family, or update the one both Sync IDs already point at. A
 * family is identified by its members: both IDs new means create, both
 * linked to the same family means update, anything else is a conflict.
 */
async function apiUpsertFamily(body: Body) {
  const label = str(body.label, "label", 120);
  const input = Object.fromEntries(MEMBER_IDS.map((m) => {
    const raw = asBody(body[m]);
    return [m, {
      syncId: readSyncId(raw.syncId, `${m}.syncId`),
      name: str(raw.name, `${m}.name`, 80),
      rawGoals: raw.goals,
    }];
  })) as Record<MemberId, { syncId: string; name: string; rawGoals: unknown }>;
  const coachId = typeof body.coachSyncId === "string" && body.coachSyncId
    ? await coachUidFor(readSyncId(body.coachSyncId, "coachSyncId"))
    : undefined;
  const active = optionalBool(body.active, "active");

  if (input.parent.syncId === input.child.syncId) {
    throw new HttpsError("invalid-argument", "parent.syncId and child.syncId must be different.");
  }

  const [p, c] = await db.getAll(syncRef(input.parent.syncId), syncRef(input.child.syncId));
  const pOwner = p.data() as SyncOwner | undefined;
  const cOwner = c.data() as SyncOwner | undefined;
  const goalsFor = (m: MemberId) => readGoals(input[m].rawGoals, m === "parent" ? "Parent" : "Child");

  if (!pOwner && !cOwner) {
    const { familyId, code } = await createFamilyRecord({
      label, coachId: coachId ?? "", active: active ?? true,
      parent: { name: input.parent.name, syncId: input.parent.syncId, goals: goalsFor("parent") },
      child: { name: input.child.name, syncId: input.child.syncId, goals: goalsFor("child") },
    });
    return { created: true, familyId, accessCode: code };
  }

  if (
    pOwner?.kind !== "member" || pOwner.memberId !== "parent"
    || cOwner?.kind !== "member" || cOwner.memberId !== "child"
    || pOwner.familyId !== cOwner.familyId
  ) {
    throw new HttpsError(
      "already-exists",
      "Those Sync IDs are already linked to different people. Both must be new, " +
      "or both must belong to the same existing family as parent and child.",
    );
  }

  const ref = db.doc(`families/${pOwner.familyId}`);
  const patch: Body = { label };
  for (const m of MEMBER_IDS) {
    patch[`members.${m}.name`] = input[m].name;
    // Goals are coach territory; only overwrite them when 3C sends some.
    if (input[m].rawGoals !== undefined) patch[`members.${m}.goals`] = goalsFor(m);
  }
  if (coachId !== undefined) patch.coachId = coachId;
  if (active !== undefined) patch.active = active;
  await ref.update(patch);

  const code = (await ref.get()).data()?.code as string;
  logger.info("Family updated via API", { familyId: ref.id });
  return { created: false, familyId: ref.id, accessCode: code };
}

/** Delete the coach linked to this Sync ID. Their families are kept and
 *  become unassigned, exactly as when an admin deletes a coach in the app. */
async function apiDeleteCoach(syncId: string) {
  const owner = (await syncRef(syncId).get()).data() as SyncOwner | undefined;
  if (owner?.kind !== "staff") {
    throw new HttpsError("not-found", `No coach has Sync ID ${syncId}.`);
  }
  const user = (await db.doc(`users/${owner.uid}`).get()).data();
  if (user?.role === "admin") {
    throw new HttpsError(
      "permission-denied",
      "That Sync ID belongs to an administrator, who can only be removed in the app.",
    );
  }
  const { detachedFamilies } = await deleteStaffAccount(owner.uid);
  return { syncId, deleted: true, detachedFamilies };
}

/**
 * Delete the whole family that either member's Sync ID belongs to: both
 * members, their entire food log and the access code. Both members' Sync IDs
 * are released. A family is one unit here -- there is no removing just the
 * parent or just the child.
 */
async function apiDeleteFamily(syncId: string) {
  const owner = (await syncRef(syncId).get()).data() as SyncOwner | undefined;
  if (owner?.kind !== "member") {
    throw new HttpsError("not-found", `No family member has Sync ID ${syncId}.`);
  }
  const snap = await db.doc(`families/${owner.familyId}`).get();
  if (!snap.exists) {
    // A dangling link: the family went some other way. Tidy up so the ID
    // can be reused, and report it as gone.
    await syncRef(syncId).delete();
    throw new HttpsError("not-found", `No family member has Sync ID ${syncId}.`);
  }
  const releasedSyncIds = MEMBER_IDS
    .map((m) => snap.data()?.members?.[m]?.syncId as string | undefined)
    .filter((s): s is string => Boolean(s));
  await deleteFamilyRecord(snap);
  return { familyId: snap.id, deleted: true, releasedSyncIds };
}

export const api = onRequest({ secrets: [SYNC_API_KEY] }, async (req, res) => {
  // Hosting's CDN would otherwise be free to cache one family's data.
  res.set("Cache-Control", "no-store");

  // Behind the Hosting rewrite the path keeps its /api prefix; called on the
  // function URL directly it does not. Accept both.
  let parts: string[];
  try {
    parts = req.path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    parts = [];
  }
  if (parts[0] === "api") parts.shift();
  const [resource, id, ...rest] = parts;

  // What an error response carries besides errorMessage, so each route's
  // failure has the same shape as its success.
  let emptyShape: Body = {};
  if (resource === "data") emptyShape = id ? { syncId: id, days: null } : { data: null };

  const fail = (status: number, message: string) => {
    res.status(status).json({ errorMessage: message, ...emptyShape });
  };

  try {
    const expected = SYNC_API_KEY.value().replace(/^﻿/, "").trim();
    if (!expected) {
      logger.error("SYNC_API_KEY is not set; the external API is refusing every request.");
      fail(503, "The API is not configured on this server.");
      return;
    }
    if (!apiKeyMatches(req.get("X-API-Key")?.trim(), expected)) {
      logger.warn("External API: bad or missing key", { path: req.path });
      fail(401, "Missing or invalid X-API-Key header.");
      return;
    }

    const allow = (method: string): boolean => {
      if (req.method === method) return true;
      res.set("Allow", method);
      fail(405, `Use ${method} for this route.`);
      return false;
    };

    if (resource === "data" && rest.length === 0) {
      if (!allow("GET")) return;
      const from = readDateBound(req.query.from, "from");
      const to = readDateBound(req.query.to, "to");
      const payload = id
        ? await apiOneMember(readSyncId(id, "Sync ID"), from, to)
        : { data: await apiAllMembers(from, to) };
      res.status(200).json({ errorMessage: null, ...payload });
      return;
    }

    if (resource === "coaches" && !id) {
      if (!allow("POST")) return;
      res.status(200).json({ errorMessage: null, ...(await apiUpsertCoach(asBody(req.body))) });
      return;
    }

    if (resource === "coaches" && id && rest.length === 0) {
      if (!allow("DELETE")) return;
      res.status(200).json({ errorMessage: null, ...(await apiDeleteCoach(readSyncId(id, "Sync ID"))) });
      return;
    }

    if (resource === "families" && !id) {
      if (!allow("POST")) return;
      res.status(200).json({ errorMessage: null, ...(await apiUpsertFamily(asBody(req.body))) });
      return;
    }

    if (resource === "families" && id && rest.length === 0) {
      if (!allow("DELETE")) return;
      res.status(200).json({ errorMessage: null, ...(await apiDeleteFamily(readSyncId(id, "Sync ID"))) });
      return;
    }

    fail(404, "No such API route.");
  } catch (e) {
    if (e instanceof HttpsError) {
      fail(e.httpErrorCode.status, e.message);
      return;
    }
    logger.error("External API failed", { path: req.path, error: (e as Error).message });
    fail(500, "Something went wrong on the server. Try again shortly.");
  }
});
