import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { subscribeFamily, subscribeRules, touchFamily } from "../../lib/data";
import { DEFAULT_RULE_SET } from "../../lib/defaultRules";
import type { FamilyDoc, MemberId, RuleSet } from "../../lib/types";
import { CenterPage, Logo } from "../../components/Layout";
import { Banner, Card, Spinner } from "../../components/ui";
import MemberSelect from "./MemberSelect";
import Logger from "./Logger";

interface FamilyCtx {
  family: FamilyDoc;
  rules: RuleSet;
  member: MemberId;
  setMember: (m: MemberId | null) => void;
}

const Ctx = createContext<FamilyCtx | null>(null);

export function useFamily(): FamilyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFamily must be used inside FamilyApp");
  return ctx;
}

const MEMBER_KEY = "activeMember";

export default function FamilyApp() {
  const { claims } = useAuth();
  const familyId = claims?.familyId;

  const [family, setFamily] = useState<FamilyDoc | null>(null);
  const [rules, setRules] = useState<RuleSet>(DEFAULT_RULE_SET);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which person is logging. Kept in sessionStorage so a refresh does not
  // bounce back to the picker, but a new tab or a fresh sign-in starts clean.
  const [member, setMemberState] = useState<MemberId | null>(() => {
    const v = sessionStorage.getItem(MEMBER_KEY);
    return v === "parent" || v === "child" ? v : null;
  });

  const setMember = (m: MemberId | null) => {
    if (m) sessionStorage.setItem(MEMBER_KEY, m);
    else sessionStorage.removeItem(MEMBER_KEY);
    setMemberState(m);
  };

  useEffect(() => {
    if (!familyId) { setLoading(false); return; }
    void touchFamily(familyId);
    const unsubFamily = subscribeFamily(
      familyId,
      (f) => { setFamily(f); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); },
    );
    const unsubRules = subscribeRules(setRules);
    return () => { unsubFamily(); unsubRules(); };
  }, [familyId]);

  const ctx = useMemo<FamilyCtx | null>(
    () => (family && member ? { family, rules, member, setMember } : null),
    // setMember is stable enough for this scope; family/rules/member drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [family, rules, member],
  );

  if (loading) {
    return (
      <CenterPage>
        <Logo className="text-slate-400 dark:text-slate-500" />
        <Spinner className="size-6 text-brand-600" />
      </CenterPage>
    );
  }

  if (error || !family) {
    return (
      <Fail>
        {error
          ? `Could not load your family account: ${error}`
          : "This family account no longer exists. Please ask your coach for a new code."}
      </Fail>
    );
  }

  if (!family.active) {
    return <Fail>This family account has been paused. Please contact your coach.</Fail>;
  }

  if (!member || !ctx) {
    return <MemberSelect family={family} onSelect={setMember} />;
  }

  return (
    <Ctx.Provider value={ctx}>
      <Routes>
        <Route index element={<Logger />} />
        <Route path="*" element={<Navigate to="/family" replace />} />
      </Routes>
    </Ctx.Provider>
  );
}

function Fail({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  return (
    <CenterPage>
      <Card className="w-full max-w-md p-6">
        <Logo className="text-slate-900 dark:text-slate-100" />
        <Banner tone="warn" className="mt-4">{children}</Banner>
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
