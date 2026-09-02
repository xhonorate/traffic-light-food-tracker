import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchEntriesRange,
  setMemberGoals,
  subscribeFamily,
} from "../../lib/data";
import {
  addDays,
  formatDateTime,
  formatDayLabel,
  formatTime,
  todayKey,
  weekWindow,
} from "../../lib/dates";
import { n0, formatServings } from "../../lib/format";
import {
  resolveGoals,
  type FamilyDoc,
  type LogEntry,
  type MemberGoals,
  type MemberId,
} from "../../lib/types";
import { ClipboardDocumentListIcon } from "@heroicons/react/24/outline";
import { Layout } from "../../components/Layout";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Stat,
  Toast,
  cx,
} from "../../components/ui";
import {
  ColorMark,
  COLOR_ORDER,
  COLOR_WORD,
} from "../../components/TrafficLight";
import { WeekChart } from "../../components/WeekChart";
import GoalsPanel from "../../components/GoalsPanel";
import CodeBadge from "../../components/CodeBadge";
import { chromeFor } from "../../components/navs";

const LOOKBACK_DAYS = 29;

export default function FamilyDetail() {
  const { familyId } = useParams<{ familyId: string }>();
  const { impersonate, claims } = useAuth();
  const navigate = useNavigate();
  const { nav, familiesPath } = chromeFor(claims?.role);

  const [family, setFamily] = useState<FamilyDoc | null>(null);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [member, setMember] = useState<MemberId>("parent");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = todayKey();
  const from = addDays(today, -LOOKBACK_DAYS);
  const week = useMemo(() => weekWindow(today), [today]);

  useEffect(() => {
    if (!familyId) return;
    return subscribeFamily(familyId, setFamily, (e) => setError(e.message));
  }, [familyId]);

  useEffect(() => {
    if (!familyId) return;
    let live = true;
    setEntries(null);
    fetchEntriesRange(familyId, from, today)
      .then((r) => {
        if (live) setEntries(r);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setEntries([]);
        }
      });
    return () => {
      live = false;
    };
  }, [familyId, from, today]);

  const memberEntries = useMemo(
    () => (entries ?? []).filter((e) => e.memberId === member),
    [entries, member],
  );

  const stats = useMemo(() => {
    const s = {
      kcal: 0,
      days: new Set<string>(),
      green: 0,
      yellow: 0,
      red: 0,
      overridden: 0,
    };
    for (const e of memberEntries) {
      if (e.kcal) s.kcal += e.kcal;
      s.days.add(e.date);
      s[e.color] += e.servings;
      if (e.overridden) s.overridden += 1;
    }
    return s;
  }, [memberEntries]);

  const goals = useMemo(
    () => resolveGoals(family?.members?.[member]),
    [family, member],
  );

  if (error && !family) {
    return (
      <Layout nav={nav} title="Family">
        <Banner tone="error">{error}</Banner>
        <Link
          to={familiesPath}
          className="mt-3 inline-block text-sm font-medium text-brand-700 underline dark:text-brand-300"
        >
          Back to families
        </Link>
      </Layout>
    );
  }

  if (!family) {
    return (
      <Layout nav={nav} title="Family">
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
      </Layout>
    );
  }

  const info = family.members[member];
  const avgKcal = stats.days.size ? stats.kcal / stats.days.size : null;

  return (
    <Layout nav={nav}>
      <Link
        to={familiesPath}
        className="tap mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <path
            d="m11 4.5-5.5 5.5 5.5 5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All families
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            <span className="truncate">{family.label}</span>
            {!family.active && <Badge tone="warn">Paused</Badge>}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {family.lastActiveAt
              ? `Last active ${formatDateTime(family.lastActiveAt)}`
              : "Not signed in yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CodeBadge
            code={family.code}
            onCopied={() => setToast("Code copied")}
          />
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await impersonate({ type: "family", id: family.id });
                navigate("/family", { replace: true });
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Login as family
          </Button>
        </div>
      </div>

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {/* Member switch */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {(["parent", "child"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMember(m)}
            className={cx(
              "tap rounded-lg py-2 text-sm font-medium transition-colors",
              member === m
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200",
            )}
          >
            {family.members[m]?.name || (m === "parent" ? "Parent" : "Child")}
            <span className="ml-1 text-xs font-normal opacity-60">({m})</span>
          </button>
        ))}
      </div>

      {/* Goals */}
      <Card className="mb-4">
        <CardHeader
          title="Daily goals"
          subtitle={`What ${info?.name || member} is working to each day`}
        />
        <div className="p-4">
          <GoalsEditor
            key={`${family.id}-${member}`}
            value={goals}
            onSave={async (g) => {
              await setMemberGoals(family.id, member, g);
              setToast("Goals updated");
            }}
          />
          <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800">
            <GoalsPanel days={week} entries={memberEntries} goals={goals} />
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Days logged"
          value={stats.days.size}
          sub={`of last ${LOOKBACK_DAYS + 1}`}
        />
        <Stat label="Avg kcal/day" value={n0(avgKcal)} sub="on days logged" />
        <Stat
          label="Red foods"
          value={formatServings(stats.red)}
          sub={`last ${LOOKBACK_DAYS + 1} days`}
        />
        <Stat
          label="Own color kept"
          value={stats.overridden}
          sub="differed from guide"
        />
      </div>

      <Card className="mb-4 p-4">
        {entries === null ? (
          <Skeleton className="h-44" />
        ) : (
          <WeekChart days={week} entries={memberEntries} />
        )}
      </Card>

      {/* color mix over the lookback window */}
      <Card className="mb-4">
        <CardHeader title={`color mix · last ${LOOKBACK_DAYS + 1} days`} />
        <div className="p-4">
          <ColorMix green={stats.green} yellow={stats.yellow} red={stats.red} />
        </div>
      </Card>

      {/* Recent entries */}
      <Card>
        <CardHeader title="Recent foods" subtitle="Newest first" />
        {entries === null ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : memberEntries.length === 0 ? (
          <EmptyState
            icon={<ClipboardDocumentListIcon className="size-6" />}
            title="Nothing logged yet"
            body="This person has not added any foods in the last 30 days."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {[...memberEntries]
              .reverse()
              .slice(0, 40)
              .map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                  <ColorMark color={e.color} size={20} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {e.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {formatDayLabel(e.date)} · {formatTime(e.createdAt)} ·{" "}
                      {formatServings(e.servings)} ×{" "}
                      {e.servingLabel || "serving"}
                      {e.kcal !== null && <> · {n0(e.kcal)} kcal</>}
                    </p>
                  </div>
                  {e.overridden && (
                    <Badge className="shrink-0">guide said {e.autoColor}</Badge>
                  )}
                </li>
              ))}
          </ul>
        )}
      </Card>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </Layout>
  );
}

/** The three daily targets, edited together and saved as one document field. */
function GoalsEditor({
  value,
  onSave,
}: {
  value: MemberGoals;
  onSave: (g: MemberGoals) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    dailyRed: String(value.dailyRed),
    dailyGreen: String(value.dailyGreen),
    dailyKcal: String(value.dailyKcal),
  });
  const [busy, setBusy] = useState(false);

  const parsed: MemberGoals = {
    dailyRed: Math.max(0, Number(draft.dailyRed) || 0),
    dailyGreen: Math.max(0, Number(draft.dailyGreen) || 0),
    dailyKcal: Math.max(0, Number(draft.dailyKcal) || 0),
  };
  const dirty =
    parsed.dailyRed !== value.dailyRed ||
    parsed.dailyGreen !== value.dailyGreen ||
    parsed.dailyKcal !== value.dailyKcal;

  const fields = [
    {
      key: "dailyGreen" as const,
      label: "Green foods a day",
      hint: "At least this many",
      unit: "foods",
    },
    {
      key: "dailyRed" as const,
      label: "Red foods a day",
      hint: "At most this many",
      unit: "foods",
    },
    {
      key: "dailyKcal" as const,
      label: "Calories a day",
      hint: "At most this many",
      unit: "kcal",
    },
  ];

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={draft[f.key]}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant={dirty ? "primary" : "secondary"}
          disabled={!dirty || busy}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(parsed);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save goals
        </Button>
        {dirty && (
          <Button
            disabled={busy}
            onClick={() =>
              setDraft({
                dailyRed: String(value.dailyRed),
                dailyGreen: String(value.dailyGreen),
                dailyKcal: String(value.dailyKcal),
              })
            }
          >
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}

/** Proportional bar of the three colors. Percentages are direct-labelled so
 *  the split is readable without relying on hue. */
function ColorMix({
  green,
  yellow,
  red,
}: {
  green: number;
  yellow: number;
  red: number;
}) {
  const total = green + yellow + red;
  if (total === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No foods logged in this window.
      </p>
    );
  }
  const parts = [
    { c: "green" as const, v: green },
    { c: "yellow" as const, v: yellow },
    { c: "red" as const, v: red },
  ];
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {parts
          .filter((p) => p.v > 0)
          .map((p) => (
            <div
              key={p.c}
              style={{
                width: `${(p.v / total) * 100}%`,
                backgroundColor: `var(--tl-${p.c})`,
              }}
              className="first:rounded-l-full last:rounded-r-full"
            />
          ))}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {parts.map((p) => (
          <li key={p.c} className="text-center">
            <div className="flex items-center justify-center gap-1.5">
              <ColorMark color={p.c} size={12} />
              <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {Math.round((p.v / total) * 100)}%
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {formatServings(p.v)} {COLOR_WORD[p.c].toLowerCase()}
            </div>
          </li>
        ))}
      </ul>
      <p className="sr-only">
        {COLOR_ORDER.map(
          (c) => `${COLOR_WORD[c]}: ${parts.find((p) => p.c === c)?.v ?? 0}`,
        ).join(", ")}
      </p>
    </div>
  );
}
