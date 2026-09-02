import { Suspense, lazy, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { claimFirstAdmin } from "./lib/data";
import { isConfigured } from "./lib/firebase";
import { CenterPage, Logo } from "./components/Layout";
import { Banner, Button, Card, Spinner } from "./components/ui";

import Login from "./pages/Login";
import SetupNeeded from "./pages/SetupNeeded";

// Each role loads only its own screens. A family on a phone should never pay
// to download the rule editor.
const FamilyApp = lazy(() => import("./pages/family/FamilyApp"));
const CoachApp = lazy(() => import("./pages/coach/CoachApp"));
const AdminApp = lazy(() => import("./pages/admin/AdminApp"));

function Loading() {
  return (
    <CenterPage>
      <Logo className="text-slate-400 dark:text-slate-500" />
      <Spinner className="size-6 text-brand-600" />
    </CenterPage>
  );
}

/** Sends a signed-in user to the right app for their role. */
function RoleHome() {
  const { claims } = useAuth();
  switch (claims?.role) {
    case "admin": return <Navigate to="/admin" replace />;
    case "coach": return <Navigate to="/coach" replace />;
    case "family": return <Navigate to="/family" replace />;
    default: return <Navigate to="/login" replace />;
  }
}

/** A signed-in account with no recognised role claim -- almost always the very
 *  first sign-in, before an admin has been bootstrapped. */
function NoRole() {
  const { user, signOut, refreshClaims } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  /**
   * First-run bootstrap. Safe to expose as a button because the server is the
   * gate: `claimFirstAdmin` refuses outright once any admin exists, so this
   * cannot be used to escalate later. It is only ever useful once, on a
   * brand-new deployment.
   */
  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      await claimFirstAdmin({ name: user?.displayName || user?.email || "Administrator" });
      setClaimed(true);
      // The role lives in a custom claim, which is baked into the ID token.
      // Force a refresh so the new role applies without a manual re-login.
      await refreshClaims();
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Could not claim the account.";
      setError(msg);
      setBusy(false);
    }
  };

  if (claimed) {
    return (
      <CenterPage>
        <Card className="w-full max-w-md p-6">
          <Logo className="text-slate-900 dark:text-slate-100" />
          <Banner tone="success" className="mt-4">
            You are now the program administrator.
          </Banner>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            If the dashboard does not appear on its own, sign out and back in to pick up the
            new permissions.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => window.location.assign("/")}>
              Go to my dashboard
            </Button>
            <Button onClick={signOut}>Sign out</Button>
          </div>
        </Card>
      </CenterPage>
    );
  }

  return (
    <CenterPage>
      <Card className="w-full max-w-md p-6">
        <Logo className="text-slate-900 dark:text-slate-100" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          This account has no access yet
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          You are signed in as <strong className="font-medium">{user?.email}</strong>, but no role has
          been assigned to it. Ask an administrator to add you as a coach.
        </p>

        <div className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Setting this program up for the first time?
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            If no administrator exists yet, you can claim that role now. This works exactly once —
            afterwards, admins are added from the Coaches screen.
          </p>
          {error && <Banner tone="error" className="mt-3">{error}</Banner>}
          <Button variant="primary" className="mt-3" onClick={claim} loading={busy} full>
            Claim this account as administrator
          </Button>
        </div>

        <button
          onClick={signOut}
          className="tap mt-4 text-sm font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300"
        >
          Sign out
        </button>
      </Card>
    </CenterPage>
  );
}

export default function App() {
  const { user, claims, loading } = useAuth();

  if (!isConfigured) return <SetupNeeded />;
  if (loading) return <Loading />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!claims) return <NoRole />;

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<RoleHome />} />
        <Route path="/login" element={<RoleHome />} />

        {claims.role === "family" && <Route path="/family/*" element={<FamilyApp />} />}
        {claims.role === "coach" && <Route path="/coach/*" element={<CoachApp />} />}
        {claims.role === "admin" && <Route path="/admin/*" element={<AdminApp />} />}

        <Route path="*" element={<RoleHome />} />
      </Routes>
    </Suspense>
  );
}
