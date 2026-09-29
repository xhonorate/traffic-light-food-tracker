import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { isConfigured } from "./lib/firebase";
import { CenterPage, Logo } from "./components/Layout";
import { Card, Spinner } from "./components/ui";

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
    case "admin":
      return <Navigate to="/admin" replace />;
    case "coach":
      return <Navigate to="/coach" replace />;
    case "family":
      return <Navigate to="/family" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
}

/** A signed-in account with no recognised role claim -- almost always the very
 *  first sign-in, before an admin has been bootstrapped. */
function NoRole() {
  const { user, signOut } = useAuth();

  return (
    <CenterPage>
      <Card className="w-full max-w-md p-6">
        <Logo className="text-slate-900 dark:text-slate-100" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          This account has no access yet
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          You are signed in as{" "}
          <strong className="font-medium">{user?.email}</strong>, but no role
          has been assigned to it. Ask an administrator to add you as a coach.
        </p>

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

        {claims.role === "family" && (
          <Route path="/family/*" element={<FamilyApp />} />
        )}
        {claims.role === "coach" && (
          <Route path="/coach/*" element={<CoachApp />} />
        )}
        {claims.role === "admin" && (
          <Route path="/admin/*" element={<AdminApp />} />
        )}

        <Route path="*" element={<RoleHome />} />
      </Routes>
    </Suspense>
  );
}
