import { useMemo, useState } from "react";
import { FireIcon } from "@heroicons/react/24/solid";
import {
  summariseGoals, dayValueFor, missDistance,
  type GoalKey, type DayGoalResult,
} from "../lib/goals";
import { formatDayLetter, formatShort, isToday } from "../lib/dates";
import type { LogEntry, MemberGoals } from "../lib/types";
import { ColorMark } from "./TrafficLight";
import { cx } from "./ui";

/**
 * "How many of the last 7 days did we hit each goal?"
 *
 * Each goal gets a headline count plus a seven-cell strip, one per day. The
 * strip is the chart: it shows not just how many days were met but *which*,
 * so a coach can tell a bad run from a scattered miss.
 *
 * Cell colour encodes outcome, not which goal it belongs to -- success is
 * always green, a near miss amber, a clear miss red. Each state also carries
 * its own glyph (tick, dash, cross) so the panel still reads in greyscale and
 * for colour-blind users.
 */

/** Cell palette. Reuses the validated traffic-light tokens rather than
 *  introducing a fourth set of greens and reds. */
const CELL = {
  met: { bg: "var(--tl-green)", border: "var(--tl-green)" },
  near: { bg: "var(--tl-yellow)", border: "var(--tl-yellow)" },
  far: { bg: "var(--tl-red)", border: "var(--tl-red)" },
} as const;

type CellState = "met" | "near" | "far" | "none";

function GoalIcon({ goalKey, size = 14 }: { goalKey: GoalKey; size?: number }) {
  if (goalKey === "green") return <ColorMark color="green" size={size} />;
  if (goalKey === "red") return <ColorMark color="red" size={size} />;
  return (
    <FireIcon
      style={{ width: size, height: size, color: "var(--tl-yellow)" }}
      aria-hidden="true"
    />
  );
}

function CellGlyph({ state }: { state: CellState }) {
  if (state === "met") {
    return (
      <svg viewBox="0 0 14 14" className="size-3.5 text-white" aria-hidden="true">
        <path d="m3 7.3 2.7 2.7L11 4.4" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === "near") {
    return (
      <svg viewBox="0 0 14 14" className="size-3.5 text-white" aria-hidden="true">
        <path d="M3.5 7h7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === "far") {
    return (
      <svg viewBox="0 0 14 14" className="size-3 text-white" aria-hidden="true">
        <path d="M4 4l6 6M10 4l-6 6" fill="none" stroke="currentColor" strokeWidth="2.4"
          strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" className="size-3 text-slate-300 dark:text-slate-600" aria-hidden="true">
      <circle cx="7" cy="7" r="1.4" fill="currentColor" />
    </svg>
  );
}

const STATE_WORD: Record<CellState, string> = {
  met: "goal met",
  near: "just missed",
  far: "missed",
  none: "nothing logged",
};

function DayCell({
  day, state, goalKey,
}: { day: DayGoalResult; state: CellState; goalKey: GoalKey }) {
  const [open, setOpen] = useState(false);
  const tone = state === "none" ? null : CELL[state];

  return (
    <div className="relative flex flex-1 flex-col items-center gap-1">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        aria-label={`${formatShort(day.date)}: ${dayValueFor(day, goalKey)}, ${STATE_WORD[state]}`}
        className={cx(
          "grid aspect-square w-full max-w-9 place-items-center rounded-lg border-2 transition-colors",
          state === "none" && "border-dashed border-slate-300 bg-transparent dark:border-slate-700",
        )}
        style={tone ? { backgroundColor: tone.bg, borderColor: tone.border } : undefined}
      >
        <CellGlyph state={state} />
      </button>

      <span className={cx(
        "text-[10px] leading-none",
        isToday(day.date)
          ? "font-semibold text-slate-700 dark:text-slate-200"
          : "text-slate-400 dark:text-slate-500",
      )}>
        {formatDayLetter(day.date)}
      </span>

      {open && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-max -translate-x-1/2 rounded-lg bg-slate-900 px-2 py-1 text-[11px] whitespace-nowrap text-white shadow-lg dark:bg-slate-700">
          {formatShort(day.date)} · {dayValueFor(day, goalKey)}
        </div>
      )}
    </div>
  );
}

export default function GoalsPanel({
  days, entries, goals, className, heading = "Goals met in the last 7 days",
}: {
  days: string[];
  entries: LogEntry[];
  goals: MemberGoals;
  className?: string;
  heading?: string;
}) {
  const summaries = useMemo(
    () => summariseGoals(days, entries, goals),
    [days, entries, goals],
  );

  const anyLogged = summaries[0]?.days.some((d) => d.logged) ?? false;

  const stateFor = (day: DayGoalResult, key: GoalKey): CellState => {
    if (!day.logged) return "none";
    if (day.met[key]) return "met";
    return missDistance(day, key, goals);
  };

  return (
    <section className={className}>
      <h3 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">{heading}</h3>

      <div className="space-y-4">
        {summaries.map((s) => (
          <div key={s.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                <GoalIcon goalKey={s.key} />
                <span className="font-medium">{s.label}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{s.target}</span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-slate-600 dark:text-slate-400">
                <span className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {s.metCount}
                </span>
                {" "}/ {s.days.length} days
              </span>
            </div>

            <div className="flex gap-1.5">
              {s.days.map((d) => (
                <DayCell key={d.date} day={d} state={stateFor(d, s.key)} goalKey={s.key} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {!anyLogged && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Nothing logged in this window yet, so no goals are counted.
        </p>
      )}

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        {([
          { s: "met" as const, label: "met" },
          { s: "near" as const, label: "within 20%" },
          { s: "far" as const, label: "missed" },
          { s: "none" as const, label: "nothing logged" },
        ]).map(({ s, label }) => (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={cx(
                "grid size-4 place-items-center rounded border-2",
                s === "none" && "border-dashed border-slate-300 dark:border-slate-700",
              )}
              style={s === "none" ? undefined : { backgroundColor: CELL[s].bg, borderColor: CELL[s].border }}
            >
              <CellGlyph state={s} />
            </span>
            {label}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
        A day with nothing logged does not count as met — an empty day would
        otherwise pass the &ldquo;at most&rdquo; red goal automatically.
        Calories count as met only inside the range; too few misses it too.
      </p>
    </section>
  );
}
