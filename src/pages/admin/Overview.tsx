import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchEntriesRange,
  subscribeCoaches,
  subscribeFamilies,
} from "../../lib/data";
import { addDays, formatDateTime, todayKey, weekWindow } from "../../lib/dates";
import { n0, formatServings, pluralize } from "../../lib/format";
import type { FamilyDoc, LogEntry, UserDoc } from "../../lib/types";
import { Layout } from "../../components/Layout";
import { ADMIN_NAV } from "../../components/navs";
import { AcademicCapIcon } from "@heroicons/react/24/outline";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Skeleton,
  Stat,
  cx,
} from "../../components/ui";
import {
  ColorMark,
  COLOR_ORDER,
  COLOR_WORD,
} from "../../components/TrafficLight";

const WINDOW_DAYS = 29;

export default function Overview() {
  const [coaches, setCoaches] = useState<UserDoc[] | null>(null);
  const [families, setFamilies] = useState<FamilyDoc[] | null>(null);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = todayKey();
  const from = addDays(today, -WINDOW_DAYS);
  const week = useMemo(() => weekWindow(today), [today]);

  useEffect(() => subscribeCoaches(setCoaches, (e) => setError(e.message)), []);
  useEffect(
    () => subscribeFamilies(setFamilies, {}, (e) => setError(e.message)),
    [],
  );

  // Pull the window's entries once the family list is known. At this
  // programme's scale (tens of families) a straightforward fan-out is far
  // simpler than maintaining rollup documents, and stays well inside quota.
  useEffect(() => {
    if (!families) return;
    let live = true;
    setEntries(null);
    (async () => {
      const all: LogEntry[] = [];
      try {
        for (const f of families) {
          all.push(...(await fetchEntriesRange(f.id, from, today)));
        }
        if (live) setEntries(all);
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setEntries([]);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [families, from, today]);

  const stats = useMemo(() => {
    const e = entries ?? [];
    const weekEntries = e.filter((x) => x.date >= week[0] && x.date <= week[6]);
    const colors = { green: 0, yellow: 0, red: 0 };
    let overridden = 0;
    for (const x of e) {
      colors[x.color] += x.servings;
      if (x.overridden) overridden += 1;
    }
    const totalcolor = colors.green + colors.yellow + colors.red;
    return {
      entries: e.length,
      weekEntries: weekEntries.length,
      colors,
      totalcolor,
      overrideRate: e.length ? overridden / e.length : 0,
    };
  }, [entries, week]);

  const activeFamilies = useMemo(
    () =>
      (families ?? []).filter(
        (f) => f.lastActiveAt && f.lastActiveAt > Date.now() - 7 * 86_400_000,
      ).length,
    [families],
  );

  const neverUsed = useMemo(
    () => (families ?? []).filter((f) => !f.lastActiveAt),
    [families],
  );

  const loading = coaches === null || families === null;

  return (
    <Layout
      nav={ADMIN_NAV}
      title="Program overview"
      headerRight={
        <Link
          to="/admin/settings"
          title="Settings"
          className="tap rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <svg
            viewBox="0 0 20 20"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="10" cy="10" r="2.6" />
            <path
              d="M10 2.6v1.8M10 15.6v1.8M17.4 10h-1.8M4.4 10H2.6M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1 4.8 4.8"
              strokeLinecap="round"
            />
          </svg>
        </Link>
      }
    >
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Coaches" value={coaches.length} />
            <Stat
              label="Families"
              value={families.length}
              sub={`${activeFamilies} active this week`}
            />
            <Stat
              label="Foods logged"
              value={n0(stats.entries)}
              sub={`last ${WINDOW_DAYS + 1} days`}
            />
            <Stat
              label="Own color kept"
              value={`${Math.round(stats.overrideRate * 100)}%`}
              sub="differed from guide"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="color mix across the program"
                subtitle={`All families · last ${WINDOW_DAYS + 1} days`}
              />
              <div className="p-4">
                {entries === null ? (
                  <Skeleton className="h-24" />
                ) : stats.totalcolor === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No foods have been logged in this window yet.
                  </p>
                ) : (
                  <>
                    <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                      {COLOR_ORDER.filter((c) => stats.colors[c] > 0).map(
                        (c) => (
                          <div
                            key={c}
                            style={{
                              width: `${(stats.colors[c] / stats.totalcolor) * 100}%`,
                              backgroundColor: `var(--tl-${c})`,
                            }}
                            className="first:rounded-l-full last:rounded-r-full"
                          />
                        ),
                      )}
                    </div>
                    <ul className="mt-4 grid grid-cols-3 gap-2">
                      {COLOR_ORDER.map((c) => (
                        <li key={c} className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <ColorMark color={c} size={13} />
                            <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {Math.round(
                                (stats.colors[c] / stats.totalcolor) * 100,
                              )}
                              %
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {formatServings(stats.colors[c])}{" "}
                            {COLOR_WORD[c].toLowerCase()}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Coaches"
                action={
                  <Link to="/admin/coaches">
                    <Button size="sm">Manage</Button>
                  </Link>
                }
              />
              {coaches.length === 0 ? (
                <EmptyState
                  icon={<AcademicCapIcon className="size-6" />}
                  title="No coaches yet"
                  body="Add a coach so they can start enrolling families."
                  action={
                    <Link to="/admin/coaches">
                      <Button variant="primary">Add a coach</Button>
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {coaches.slice(0, 6).map((c) => {
                    const owned = (families ?? []).filter(
                      (f) => f.coachId === c.uid,
                    ).length;
                    return (
                      <li
                        key={c.uid}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                            {c.name || c.email}
                          </p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {owned} {pluralize(owned, "family", "families")}
                            {c.lastLoginAt
                              ? ` · last in ${formatDateTime(c.lastLoginAt)}`
                              : " · never signed in"}
                          </p>
                        </div>
                        {c.disabled && <Badge tone="warn">Disabled</Badge>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          {neverUsed.length > 0 && (
            <Card className="mt-4">
              <CardHeader
                title="Families who have not signed in"
                subtitle="Their code has been issued but never used"
                action={
                  <Link to="/admin/families">
                    <Button size="sm">All families</Button>
                  </Link>
                }
              />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {neverUsed.slice(0, 8).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <Link
                      to={`/admin/family/${f.id}`}
                      className={cx(
                        "min-w-0 flex-1 truncate text-sm font-medium",
                        "text-slate-900 hover:underline dark:text-slate-100",
                      )}
                    >
                      {f.label}
                    </Link>
                    <span className="shrink-0 font-mono text-xs tracking-widest text-slate-500 dark:text-slate-400">
                      {f.code}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Layout>
  );
}
