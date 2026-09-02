import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRightIcon, FireIcon } from "@heroicons/react/24/solid";
import { useAuth } from "../../lib/auth";
import { fetchEntriesRange, subscribeFamilies } from "../../lib/data";
import { addDays, formatDateTime, formatShort, todayKey, weekWindow } from "../../lib/dates";
import { evaluateDays, type GoalKey } from "../../lib/goals";
import { n0, pluralize } from "../../lib/format";
import { resolveGoals, type FamilyDoc, type LogEntry, type MemberId } from "../../lib/types";
import { Layout } from "../../components/Layout";
import { chromeFor } from "../../components/navs";
import {
  Badge, Banner, Button, Card, CardHeader, EmptyState, Skeleton, Stat, cx,
} from "../../components/ui";
import { ColorMark } from "../../components/TrafficLight";

/** Four 7-day buckets, oldest first, ending today. */
const WEEKS = 4;
const WINDOW_DAYS = WEEKS * 7;

const MEMBERS: MemberId[] = ["parent", "child"];

interface GoalStat {
  key: GoalKey;
  label: string;
  /** Share of *logged* member-days that met this goal, 0..1. */
  rate: number;
  met: number;
  logged: number;
  /** Per-week rate, oldest first. `null` where nothing was logged that week. */
  trend: (number | null)[];
}

interface FamilyStat {
  family: FamilyDoc;
  loggedDays: number;
  possibleDays: number;
  metAll: number;
  rate: number | null;
}

function GoalIcon({ goalKey, size = 14 }: { goalKey: GoalKey; size?: number }) {
  if (goalKey === "green") return <ColorMark color="green" size={size} />;
  if (goalKey === "red") return <ColorMark color="red" size={size} />;
  return <FireIcon style={{ width: size, height: size, color: "var(--tl-yellow)" }} aria-hidden="true" />;
}

/** Small bar chart of a goal's weekly attainment. Values are percentages, so
 *  the axis is fixed at 0-100 and bars stay comparable between goals. */
function TrendBars({ trend, goalKey }: { trend: (number | null)[]; goalKey: GoalKey }) {
  const tint = goalKey === "green" ? "var(--tl-green)"
    : goalKey === "red" ? "var(--tl-red)" : "var(--tl-yellow)";
  return (
    <div className="flex h-10 items-end gap-1" role="img"
      aria-label={`Weekly attainment: ${trend.map((v, i) =>
        `week ${i + 1} ${v === null ? "no data" : Math.round(v * 100) + "%"}`).join(", ")}`}>
      {trend.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col justify-end" title={
          v === null ? "Nothing logged" : `${Math.round(v * 100)}% of logged days`
        }>
          {v === null ? (
            <div className="h-1 rounded-sm border-t-2 border-dashed border-slate-300 dark:border-slate-700" />
          ) : (
            <div
              className="rounded-t-sm"
              style={{ height: `${Math.max(v * 100, 3)}%`, backgroundColor: tint }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function CoachOverview() {
  const { user, claims } = useAuth();
  const { nav, familiesPath, base } = chromeFor(claims?.role);

  const [families, setFamilies] = useState<FamilyDoc[] | null>(null);
  const [entriesByFamily, setEntriesByFamily] = useState<Map<string, LogEntry[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = todayKey();
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const week = useMemo(() => weekWindow(today), [today]);

  useEffect(() => {
    if (!user) return;
    return subscribeFamilies(
      setFamilies,
      claims?.role === "admin" ? {} : { coachId: user.uid },
      (e) => { setError(e.message); setFamilies([]); },
    );
  }, [user, claims?.role]);

  useEffect(() => {
    if (!families) return;
    let live = true;
    setEntriesByFamily(null);
    (async () => {
      const map = new Map<string, LogEntry[]>();
      try {
        for (const f of families) {
          map.set(f.id, await fetchEntriesRange(f.id, from, today));
        }
        if (live) setEntriesByFamily(map);
      } catch (e) {
        if (live) { setError((e as Error).message); setEntriesByFamily(new Map()); }
      }
    })();
    return () => { live = false; };
  }, [families, from, today]);

  const allDays = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(from, i)),
    [from],
  );

  /** Week buckets, oldest first. */
  const weekBuckets = useMemo(
    () => Array.from({ length: WEEKS }, (_, w) => allDays.slice(w * 7, w * 7 + 7)),
    [allDays],
  );

  const { goalStats, familyStats, loggedDays, possibleDays, totalEntries } = useMemo(() => {
    const empty = {
      goalStats: [] as GoalStat[], familyStats: [] as FamilyStat[],
      loggedDays: 0, possibleDays: 0, totalEntries: 0,
    };
    if (!families || !entriesByFamily) return empty;

    const keys: { key: GoalKey; label: string }[] = [
      { key: "green", label: "Green foods" },
      { key: "red", label: "Red foods" },
      { key: "kcal", label: "Calories" },
    ];

    const totals: Record<GoalKey, { met: number; logged: number }> = {
      green: { met: 0, logged: 0 }, red: { met: 0, logged: 0 }, kcal: { met: 0, logged: 0 },
    };
    const weekly: Record<GoalKey, { met: number; logged: number }[]> = {
      green: weekBuckets.map(() => ({ met: 0, logged: 0 })),
      red: weekBuckets.map(() => ({ met: 0, logged: 0 })),
      kcal: weekBuckets.map(() => ({ met: 0, logged: 0 })),
    };

    let loggedDays = 0;
    let possibleDays = 0;
    let totalEntries = 0;
    const perFamily: FamilyStat[] = [];

    for (const f of families) {
      const rows = entriesByFamily.get(f.id) ?? [];
      totalEntries += rows.length;

      let famLogged = 0;
      let famMetAll = 0;

      for (const m of MEMBERS) {
        const goals = resolveGoals(f.members?.[m]);
        const mine = rows.filter((r) => r.memberId === m);

        const evaluated = evaluateDays(allDays, mine, goals);
        for (const d of evaluated) {
          possibleDays += 1;
          if (!d.logged) continue;
          loggedDays += 1;
          famLogged += 1;
          if (d.met.green && d.met.red && d.met.kcal) famMetAll += 1;
          for (const { key } of keys) {
            totals[key].logged += 1;
            if (d.met[key]) totals[key].met += 1;
          }
        }

        // Same evaluation, bucketed by week for the trend.
        weekBuckets.forEach((bucket, wi) => {
          const inWeek = evaluateDays(bucket, mine, goals);
          for (const d of inWeek) {
            if (!d.logged) continue;
            for (const { key } of keys) {
              weekly[key][wi].logged += 1;
              if (d.met[key]) weekly[key][wi].met += 1;
            }
          }
        });
      }

      perFamily.push({
        family: f,
        loggedDays: famLogged,
        possibleDays: allDays.length * MEMBERS.length,
        metAll: famMetAll,
        rate: famLogged > 0 ? famMetAll / famLogged : null,
      });
    }

    const goalStats: GoalStat[] = keys.map(({ key, label }) => ({
      key, label,
      met: totals[key].met,
      logged: totals[key].logged,
      rate: totals[key].logged > 0 ? totals[key].met / totals[key].logged : 0,
      trend: weekly[key].map((w) => (w.logged > 0 ? w.met / w.logged : null)),
    }));

    return { goalStats, familyStats: perFamily, loggedDays, possibleDays, totalEntries };
  }, [families, entriesByFamily, allDays, weekBuckets]);

  const activeThisWeek = useMemo(
    () => (families ?? []).filter(
      (f) => f.lastActiveAt && f.lastActiveAt > Date.now() - 7 * 86_400_000,
    ).length,
    [families],
  );

  const needsAttention = useMemo(
    () => [...familyStats]
      .filter((s) => s.loggedDays === 0 || (s.rate !== null && s.rate < 0.5))
      .sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1))
      .slice(0, 6),
    [familyStats],
  );

  const loading = families === null;
  const loggingRate = possibleDays > 0 ? loggedDays / possibleDays : 0;

  return (
    <Layout nav={nav} title="Overview">
      {error && <Banner tone="error" className="mb-3">{error}</Banner>}

      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : families.length === 0 ? (
        <Card>
          <EmptyState
            title="No families yet"
            body="Add a family to start seeing how they are doing against their goals."
            action={<Link to={familiesPath}><Button variant="primary">Add a family</Button></Link>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Families" value={families.length}
              sub={`${activeThisWeek} active this week`} />
            <Stat label="Days logged" value={`${Math.round(loggingRate * 100)}%`}
              sub={`${n0(loggedDays)} of ${n0(possibleDays)} person-days`} />
            <Stat label="Foods logged" value={n0(totalEntries)} sub={`last ${WINDOW_DAYS} days`} />
            <Stat
              label="All 3 goals met"
              value={loggedDays > 0
                ? `${Math.round((familyStats.reduce((n, s) => n + s.metAll, 0) / loggedDays) * 100)}%`
                : "–"}
              sub="of logged days"
            />
          </div>

          <Card className="mb-4">
            <CardHeader
              title="Goal attainment"
              subtitle={`Share of logged days each goal was met · last ${WINDOW_DAYS} days`}
            />
            <div className="p-4">
              {entriesByFamily === null ? (
                <Skeleton className="h-40" />
              ) : loggedDays === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No foods have been logged in this window yet.
                </p>
              ) : (
                <div className="grid gap-5 sm:grid-cols-3">
                  {goalStats.map((g) => (
                    <div key={g.key}>
                      <div className="mb-1 flex items-center gap-1.5">
                        <GoalIcon goalKey={g.key} />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {g.label}
                        </span>
                      </div>
                      <div className="mb-2 flex items-baseline gap-1.5">
                        <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                          {Math.round(g.rate * 100)}%
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {n0(g.met)} of {n0(g.logged)} days
                        </span>
                      </div>
                      <TrendBars trend={g.trend} goalKey={g.key} />
                      <div className="mt-1 flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
                        <span>{formatShort(weekBuckets[0][0])}</span>
                        <span>now</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-4 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                Percentages are of days that were actually logged, so a family who logs
                little is not counted as failing. Engagement is the separate
                &ldquo;Days logged&rdquo; figure above.
              </p>
            </div>
          </Card>

          {needsAttention.length > 0 && (
            <Card className="mb-4">
              <CardHeader
                title="Worth a check-in"
                subtitle="Not logging, or meeting under half their goals"
                action={<Link to={familiesPath}><Button size="sm">All families</Button></Link>}
              />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {needsAttention.map((s) => (
                  <li key={s.family.id}>
                    <Link
                      to={`${base}/family/${s.family.id}`}
                      className="group flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-300">
                          {s.family.label}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {s.loggedDays === 0
                            ? s.family.lastActiveAt
                              ? `No foods logged · last active ${formatDateTime(s.family.lastActiveAt)}`
                              : "Has never signed in"
                            : `${s.loggedDays} ${pluralize(s.loggedDays, "day")} logged · ` +
                              `${Math.round((s.rate ?? 0) * 100)}% met all three goals`}
                        </p>
                      </div>
                      {s.loggedDays === 0
                        ? <Badge tone="warn">No data</Badge>
                        : <Badge tone="danger">{Math.round((s.rate ?? 0) * 100)}%</Badge>}
                      <ChevronRightIcon className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader
              title="This week at a glance"
              subtitle={`${formatShort(week[0])} – ${formatShort(week[6])}`}
              action={<Link to={familiesPath}><Button size="sm">Manage families</Button></Link>}
            />
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {familyStats.slice(0, 8).map((s) => (
                <li key={s.family.id}>
                  <Link
                    to={`${base}/family/${s.family.id}`}
                    className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800 group-hover:text-brand-700 dark:text-slate-200 dark:group-hover:text-brand-300">
                      {s.family.label}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {s.loggedDays} / {s.possibleDays} days
                    </span>
                    <span className={cx(
                      "w-12 shrink-0 text-right text-xs font-semibold tabular-nums",
                      s.rate === null ? "text-slate-400"
                        : s.rate >= 0.7 ? "text-emerald-600 dark:text-emerald-400"
                          : s.rate >= 0.4 ? "text-amber-600 dark:text-amber-400"
                            : "text-rose-600 dark:text-rose-400",
                    )}>
                      {s.rate === null ? "–" : `${Math.round(s.rate * 100)}%`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </Layout>
  );
}
