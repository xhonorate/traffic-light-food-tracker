/**
 * Cloud Functions for the Traffic Light Food Tracker.
 *
 * Everything that must not be trusted to a browser lives here: minting
 * sessions from family codes, creating and deleting accounts, "login as",
 * and proxying the USDA lookup so the API key stays server-side.
 */

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions";

initializeApp();
const db = getFirestore();
const auth = getAuth();

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

/** USDA FoodData Central key. Set with:
 *  `firebase functions:secrets:set USDA_API_KEY` */
const USDA_API_KEY = defineSecret("USDA_API_KEY");

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

/** Validate goals from an untrusted client, with the same defaults the app uses. */
function readGoals(v: unknown, who: string): MemberGoals {
  const g = (v ?? {}) as Record<string, unknown>;
  return {
    dailyRed: nonNegInt(g.dailyRed ?? 2, `${who} daily red food budget`, 100),
    dailyGreen: nonNegInt(g.dailyGreen ?? 5, `${who} daily green food goal`, 100),
    dailyKcal: nonNegInt(g.dailyKcal ?? 2000, `${who} daily calorie budget`, 20000),
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

export const createCoach = onCall(async (req) => {
  requireRole(req, "admin");

  const email = str(req.data?.email, "Email").toLowerCase();
  const name = str(req.data?.name, "Name", 120);
  const role = req.data?.role === "admin" ? "admin" : "coach";

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new HttpsError("invalid-argument", "That does not look like an email address.");
  }

  let uid: string;
  try {
    // No password is set here. The client follows up with Firebase Auth's own
    // password-reset email, which is how the coach chooses their own.
    const user = await auth.createUser({ email, displayName: name, emailVerified: false });
    uid = user.uid;
  } catch (e) {
    if ((e as { code?: string }).code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "An account with that email already exists.");
    }
    throw e;
  }

  await auth.setCustomUserClaims(uid, { role });
  await db.doc(`users/${uid}`).set({
    email, name, role, disabled: false, createdAt: Date.now(), lastLoginAt: null,
  });

  logger.info("Account created", { uid, email, role });
  return { uid, email };
});

export const deleteCoach = onCall(async (req) => {
  const caller = requireRole(req, "admin");
  const uid = str(req.data?.uid, "User id");

  if (uid === caller.uid) {
    throw new HttpsError("failed-precondition", "You cannot delete your own account.");
  }

  // Never orphan data silently: detach the families first so they remain
  // visible to other admins and can be reassigned.
  const owned = await db.collection("families").where("coachId", "==", uid).get();
  const batch = db.batch();
  owned.docs.forEach((d) => batch.update(d.ref, { coachId: "" }));
  batch.delete(db.doc(`users/${uid}`));
  await batch.commit();

  await auth.deleteUser(uid).catch((e) => {
    logger.warn("Auth user already gone", { uid, error: (e as Error).message });
  });

  logger.info("Account deleted", { uid, detachedFamilies: owned.size });
  return { ok: true as const };
});

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

export const createFamily = onCall(async (req) => {
  const caller = requireRole(req, "admin", "coach");
  await assertEnabled(caller.uid);

  const label = str(req.data?.label, "Family name", 120);
  const parentName = str(req.data?.parent?.name, "Parent name", 80);
  const childName = str(req.data?.child?.name, "Child name", 80);
  const parentGoals = readGoals(req.data?.parent?.goals, "Parent");
  const childGoals = readGoals(req.data?.child?.goals, "Child");

  // An admin may create on a coach's behalf; a coach always owns their own.
  const coachId = caller.role === "admin" && typeof req.data?.coachId === "string" && req.data.coachId
    ? req.data.coachId
    : caller.uid;

  const ref = db.collection("families").doc();
  const code = await allocateCode(ref.id);

  await ref.set({
    code, coachId, label, active: true,
    createdAt: Date.now(), lastActiveAt: null,
    members: {
      parent: { name: parentName, goals: parentGoals },
      child: { name: childName, goals: childGoals },
    },
  });

  // A real Auth user backs the family so its role claim survives token
  // refreshes rather than living only inside one custom token.
  await auth.createUser({ uid: familyUid(ref.id), displayName: label }).catch(() => undefined);
  await auth.setCustomUserClaims(familyUid(ref.id), { role: "family", familyId: ref.id });

  logger.info("Family created", { familyId: ref.id, coachId });
  return { familyId: ref.id, code };
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

  // Firestore does not cascade; remove subcollections explicitly.
  for (const sub of ["entries", "quickFoods"]) {
    // eslint-disable-next-line no-await-in-loop
    await db.recursiveDelete(snap.ref.collection(sub));
  }

  const code = snap.data()?.code as string | undefined;
  const batch = db.batch();
  if (code) batch.delete(db.doc(`codes/${code}`));
  batch.delete(snap.ref);
  await batch.commit();

  await auth.deleteUser(familyUid(familyId)).catch(() => undefined);

  logger.info("Family deleted", { familyId });
  return { ok: true as const };
});

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

  // An admin keeps admin authority even while viewing as a coach.
  const rootSnap = root === caller.uid ? null : await db.doc(`users/${root}`).get();
  const rootIsAdmin = rootSnap ? rootSnap.data()?.role === "admin" : caller.role === "admin";

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
  for (const gtin of new Set([code, padded])) {
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

