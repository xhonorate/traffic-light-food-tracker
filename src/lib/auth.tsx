import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import {
  GoogleAuthProvider, onIdTokenChanged, signInWithCustomToken, signInWithEmailAndPassword,
  signInWithPopup, signOut as fbSignOut, sendPasswordResetEmail, type User,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions, isConfigured } from "./firebase";
import { isIdleExpired, markActive, noteIdleSignOut } from "./idle";
import type { Role } from "./types";

/** Claims minted by Cloud Functions and carried on the ID token. */
export interface Claims {
  role: Role;
  /** Present for family sessions. */
  familyId?: string;
  /** Set while an admin or coach is viewing the app as someone else. */
  impersonatedBy?: string;
  /** Human label for the account being viewed. */
  viewingAs?: string;
}

interface AuthState {
  user: User | null;
  claims: Claims | null;
  loading: boolean;
  /** Non-null when the current session is a "login as" session. */
  impersonating: boolean;
  error: string | null;
}

interface AuthApi extends AuthState {
  signInEmail: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInFamilyCode: (code: string) => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  impersonate: (target: { type: "coach" | "family"; id: string }) => Promise<void>;
  endImpersonation: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshClaims: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

function readClaims(token: { claims: Record<string, unknown> }): Claims | null {
  const role = token.claims.role;
  if (role !== "admin" && role !== "coach" && role !== "family") return null;
  return {
    role,
    familyId: typeof token.claims.familyId === "string" ? token.claims.familyId : undefined,
    impersonatedBy: typeof token.claims.impersonatedBy === "string" ? token.claims.impersonatedBy : undefined,
    viewingAs: typeof token.claims.viewingAs === "string" ? token.claims.viewingAs : undefined,
  };
}

/** Firebase error codes are not user-facing; map the ones people actually hit. */
function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  const message = (e as { message?: string })?.message ?? "Something went wrong.";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password combination was not recognised.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/popup-closed-by-user":
      return "Sign-in window was closed before finishing.";
    case "auth/network-request-failed":
      return "Could not reach the server. Check your connection.";
    case "functions/not-found":
      return "That code was not recognised. Check it and try again.";
    case "functions/permission-denied":
      return "That account is not active. Ask your coach for help.";
    default:
      return message.replace(/^Firebase:\s*/, "");
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null, claims: null, loading: true, impersonating: false, error: null,
  });

  useEffect(() => {
    if (!isConfigured) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    // onIdTokenChanged (rather than onAuthStateChanged) so that a claims
    // refresh after impersonation propagates without a reload.
    return onIdTokenChanged(auth, async (user) => {
      if (!user) {
        setState({ user: null, claims: null, loading: false, impersonating: false, error: null });
        return;
      }
      // A session Firebase restored after the page was closed, or a phone was
      // asleep, past the inactivity limit. End it before anything renders;
      // the resulting null user lands on the sign-in screen. Fresh sign-ins
      // never trip this because signing in marks activity first.
      if (isIdleExpired()) {
        noteIdleSignOut();
        sessionStorage.removeItem("activeMember");
        await fbSignOut(auth);
        return;
      }
      const token = await user.getIdTokenResult();
      const claims = readClaims(token);
      setState({
        user, claims, loading: false,
        impersonating: Boolean(claims?.impersonatedBy),
        error: null,
      });

      // Stamp "last signed in" for staff, once per session. Fire-and-forget:
      // a failure here must never keep anyone out of the app.
      if ((claims?.role === "admin" || claims?.role === "coach") && !claims.impersonatedBy) {
        const marker = `loginRecorded:${user.uid}`;
        if (!sessionStorage.getItem(marker)) {
          sessionStorage.setItem(marker, "1");
          httpsCallable(functions, "recordLogin")({}).catch(() => undefined);
        }
      }
    });
  }, []);

  const wrap = useCallback(async (fn: () => Promise<unknown>) => {
    setState((s) => ({ ...s, error: null }));
    // Start the inactivity clock before the new session arrives, so a stale
    // timestamp from an earlier session cannot sign it straight back out.
    markActive();
    try {
      await fn();
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: friendlyError(e) }));
      throw e;
    }
  }, []);

  const refreshClaims = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    const token = await user.getIdTokenResult(true);
    const claims = readClaims(token);
    setState((s) => ({ ...s, claims, impersonating: Boolean(claims?.impersonatedBy) }));
  }, []);

  const api = useMemo<AuthApi>(() => ({
    ...state,
    signInEmail: (email, password) =>
      wrap(() => signInWithEmailAndPassword(auth, email.trim(), password)),

    signInGoogle: () =>
      wrap(() => signInWithPopup(auth, new GoogleAuthProvider())),

    signInFamilyCode: (code) => wrap(async () => {
      const redeem = httpsCallable<{ code: string }, { token: string }>(functions, "redeemFamilyCode");
      const { data } = await redeem({ code: code.trim().toUpperCase() });
      await signInWithCustomToken(auth, data.token);
    }),

    sendReset: (email) => wrap(() => sendPasswordResetEmail(auth, email.trim())),

    impersonate: (target) => wrap(async () => {
      const fn = httpsCallable<typeof target, { token: string }>(functions, "impersonate");
      const { data } = await fn(target);
      await signInWithCustomToken(auth, data.token);
    }),

    endImpersonation: () => wrap(async () => {
      const fn = httpsCallable<Record<string, never>, { token: string }>(functions, "endImpersonation");
      const { data } = await fn({});
      await signInWithCustomToken(auth, data.token);
    }),

    signOut: () => wrap(async () => {
      sessionStorage.removeItem("activeMember");
      await fbSignOut(auth);
    }),

    refreshClaims,
  }), [state, wrap, refreshClaims]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
