import { useAuth } from "../../lib/auth";
import { initials } from "../../lib/format";
import { resolveGoals, type FamilyDoc, type MemberId } from "../../lib/types";
import { CenterPage, ImpersonationBanner, Logo } from "../../components/Layout";
import { Card, cx } from "../../components/ui";

const MEMBERS: { id: MemberId; role: string }[] = [
  { id: "parent", role: "Parent" },
  { id: "child", role: "Child" },
];

/**
 * Requirement 5: after the family signs in, pick who is logging. Either person
 * can see and edit the other's log, so this is a "who is this?" switch rather
 * than a permission boundary.
 */
export default function MemberSelect({
  family, onSelect,
}: { family: FamilyDoc; onSelect: (m: MemberId) => void }) {
  const { signOut } = useAuth();

  return (
    <>
      <ImpersonationBanner />
      <CenterPage>
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <Logo className="justify-center text-lg text-slate-900 dark:text-slate-100" />
            <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              Who is logging today?
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {family.label} · code {family.code}
            </p>
          </div>

          <div className="grid gap-3">
            {MEMBERS.map(({ id, role }) => {
              const m = family.members[id];
              return (
                <Card key={id} className="overflow-hidden">
                  <button
                    onClick={() => onSelect(id)}
                    className={cx(
                      "tap flex w-full items-center gap-4 px-4 py-4 text-left transition-colors",
                      "hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-700",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cx(
                        "grid size-12 shrink-0 place-items-center rounded-full text-base font-semibold",
                        id === "parent"
                          ? "bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                          : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
                      )}
                    >
                      {initials(m?.name || role)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">
                        {m?.name || role}
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
                        {role}
                        {` · ${resolveGoals(m).dailyGreen} green, ${resolveGoals(m).dailyRed} red a day`}
                      </span>
                    </span>
                    <svg viewBox="0 0 20 20" className="size-5 shrink-0 text-slate-400" fill="none"
                      stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                      <path d="m7.5 4.5 6 5.5-6 5.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </Card>
              );
            })}
          </div>

          <p className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
            You can switch between people at any time.{" "}
            <button
              onClick={signOut}
              className="tap font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300"
            >
              Sign out
            </button>
          </p>
        </div>
      </CenterPage>
    </>
  );
}
