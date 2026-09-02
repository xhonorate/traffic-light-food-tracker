import { useEffect, useMemo, useState } from "react";
import { useFamily } from "./FamilyApp";
import {
  addEntry,
  bumpQuickFood,
  deleteEntry,
  subscribeAppConfig,
  subscribeEntries,
  subscribeQuickFoods,
} from "../../lib/data";
import {
  formatDayLabel,
  formatTime,
  isFuture,
  isToday,
  todayKey,
  weekWindow,
} from "../../lib/dates";
import { n0, formatServings, pluralize } from "../../lib/format";
import {
  DEFAULT_APP_CONFIG,
  resolveGoals,
  type AppConfig,
  type LogEntry,
  type QuickFood,
} from "../../lib/types";
import { Layout } from "../../components/Layout";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Skeleton,
  Toast,
} from "../../components/ui";
import {
  ColorMark,
  COLOR_ORDER,
  COLOR_WORD,
} from "../../components/TrafficLight";
import { WeekChart } from "../../components/WeekChart";
import GoalsPanel from "../../components/GoalsPanel";
import AddFoodSheet, {
  type AddFoodPayload,
} from "../../components/AddFoodSheet";
import WeekStrip from "../../components/WeekStrip";
import { Squares2X2Icon } from "@heroicons/react/24/outline";

export default function Logger() {
  const { family, rules, member, setMember } = useFamily();

  const [date, setDate] = useState(todayKey());
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [quickFoods, setQuickFoods] = useState<QuickFood[]>([]);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<{
    msg: string;
    tone: "success" | "info";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const week = useMemo(() => weekWindow(date), [date]);

  // One subscription covers both the selected day and the 7-day graph.
  useEffect(() => {
    setEntries(null);
    return subscribeEntries(
      family.id,
      member,
      week[0],
      week[6],
      setEntries,
      (e) => {
        setError(e.message);
        setEntries([]);
      },
    );
  }, [family.id, member, week]);

  useEffect(() => subscribeQuickFoods(family.id, setQuickFoods), [family.id]);
  useEffect(() => subscribeAppConfig(setConfig), []);

  const dayEntries = useMemo(
    () => (entries ?? []).filter((e) => e.date === date),
    [entries, date],
  );

  const dayTotals = useMemo(() => {
    const t = { kcal: null as number | null, green: 0, yellow: 0, red: 0 };
    for (const e of dayEntries) {
      if (e.kcal !== null && e.kcal !== undefined)
        t.kcal = (t.kcal ?? 0) + e.kcal;
      t[e.color] += e.servings;
    }
    return t;
  }, [dayEntries]);

  const goals = useMemo(
    () => resolveGoals(family.members[member]),
    [family.members, member],
  );

  const memberName =
    family.members[member]?.name?.trim() ||
    (member === "parent" ? "Parent" : "Child");

  const handleAdd = async (p: AddFoodPayload) => {
    await addEntry(family.id, {
      memberId: member,
      date,
      createdAt: Date.now(),
      name: p.facts.name,
      brand: p.facts.brand,
      servings: p.servings,
      kcal: p.facts.serv.kcal,
      fat: p.facts.serv.fat,
      sat: p.facts.serv.sat,
      sugars: p.facts.serv.sugars,
      added: p.facts.serv.added,
      protein: p.facts.serv.protein,
      servingLabel: p.facts.servingLabel,
      source: p.facts.source,
      code: p.facts.code,
      color: p.color,
      autoColor: p.autoColor,
      overridden: p.overridden,
      reasons: p.reasons,
    });
    void bumpQuickFood(family.id, member, p.original);

    // Requirement 11.2: affirm a correct guess.
    setToast(
      p.overridden
        ? { msg: "Logged with your color.", tone: "info" }
        : { msg: "Good job — that matches our guide!", tone: "success" },
    );
  };

  const nav = [
    {
      to: "/family",
      label: "Log",
      icon: <ColorMark color="green" size={20} />,
      end: true,
    },
  ];

  return (
    <Layout nav={nav}>
      {/* Who is logging. A dropdown implied switching person was routine; it
          is not -- one person logs at a time, so this states who that is and
          offers the switch quietly. */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Welcome, {memberName}
          <span className="ml-1.5 text-sm font-normal text-slate-500 dark:text-slate-400">
            ({member})
          </span>
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Not {memberName}?{" "}
          <button
            onClick={() => setMember(null)}
            className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
          >
            Switch
          </button>
        </p>
      </div>

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {/* Date navigation */}
      <Card className="mb-4 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {formatDayLabel(date)}
          </span>
          {!isToday(date) && (
            <button
              onClick={() => setDate(todayKey())}
              className="text-xs font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300"
            >
              Back to today
            </button>
          )}
        </div>
        <WeekStrip value={date} onChange={setDate} />
      </Card>

      {/* Day summary */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {n0(dayTotals.kcal)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            calories
          </div>
        </div>
        {COLOR_ORDER.map((c) => (
          <div
            key={c}
            className="rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-center dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-center gap-1">
              <ColorMark color={c} size={13} />
              <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                {formatServings(dayTotals[c])}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {COLOR_WORD[c].toLowerCase()}
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="primary"
        size="lg"
        full
        className="mb-4"
        onClick={() => setSheetOpen(true)}
        disabled={isFuture(date)}
      >
        <svg
          viewBox="0 0 20 20"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" />
        </svg>
        Add a food
      </Button>

      {/* Day log */}
      <Card className="mb-4">
        <CardHeader
          title={`${formatDayLabel(date)}'s foods`}
          subtitle={
            dayEntries.length
              ? `${dayEntries.length} ${pluralize(dayEntries.length, "item")}`
              : undefined
          }
        />
        {entries === null ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : dayEntries.length === 0 ? (
          <EmptyState
            icon={<Squares2X2Icon className="size-6" />}
            title="Nothing logged yet"
            body={
              isToday(date)
                ? "Add the first food of the day to get started."
                : "No foods were logged on this day."
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {dayEntries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                onDelete={() =>
                  deleteEntry(family.id, e.id).catch((err) =>
                    setError(err.message),
                  )
                }
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Week view */}
      <Card className="mb-4 p-4">
        <GoalsPanel
          days={week}
          entries={entries ?? []}
          goals={goals}
          className="mb-5"
        />
        <WeekChart days={week} entries={entries ?? []} />
      </Card>

      <AddFoodSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        rules={rules}
        quickFoods={quickFoods}
        foodGuideUrl={config.foodGuideUrl}
        onAdd={handleAdd}
      />

      {toast && (
        <Toast
          message={toast.msg}
          tone={toast.tone}
          onDone={() => setToast(null)}
        />
      )}
    </Layout>
  );
}

function EntryRow({
  entry,
  onDelete,
}: {
  entry: LogEntry;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <ColorMark color={entry.color} size={22} />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900 dark:text-slate-100">
          {entry.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
          {formatServings(entry.servings)} × {entry.servingLabel || "serving"}
          {entry.kcal !== null && <> · {n0(entry.kcal)} kcal</>}
          {" · "}
          {formatTime(entry.createdAt)}
        </p>
        {entry.overridden && (
          <p className="mt-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              your choice · guide said {entry.autoColor}
            </span>
          </p>
        )}
      </div>

      {confirming ? (
        <div className="flex shrink-0 gap-1">
          <Button size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${entry.name}`}
          className="tap shrink-0 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950 dark:hover:text-rose-400"
        >
          <svg
            viewBox="0 0 20 20"
            className="size-4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path
              d="M4 6h12M8 6V4.5h4V6M6.5 6l.6 9.5a1 1 0 0 0 1 .95h3.8a1 1 0 0 0 1-.95L13.5 6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </li>
  );
}
