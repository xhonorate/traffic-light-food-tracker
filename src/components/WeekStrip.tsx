import { useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import {
  addDays, daysBetween, formatNumeric, formatShort, formatWeekdayShort,
  isFuture, isToday, todayKey,
} from "../lib/dates";
import { cx } from "./ui";

/**
 * Seven-day picker for the food log.
 *
 * Replaces a hidden `<input type="date">`, which browsers would not reliably
 * open and which asked people to think in a calendar when the real task is
 * "fix up yesterday". Every day in the window is one tap, and the arrows walk
 * the window one day at a time -- forward is capped at today, back has no
 * limit so a family can page through as much history as they like.
 */
export default function WeekStrip({
  value, onChange, className,
}: {
  value: string;
  onChange: (date: string) => void;
  className?: string;
}) {
  // The window's last day. Kept separate from the selection so a family can
  // look back through earlier weeks without changing the day they are editing.
  const [windowEnd, setWindowEnd] = useState<string>(todayKey);

  // Follow the selection when *it* moves (for example via "back to today"),
  // but only then -- tracking the previous value keeps the arrows free to
  // page the window away from the selected day without it snapping back.
  const prevValue = useRef<string | null>(null);
  useEffect(() => {
    if (prevValue.current === value) return;
    prevValue.current = value;
    const offset = daysBetween(value, windowEnd);
    if (offset < 0 || offset > 6) {
      setWindowEnd(isFuture(value) ? todayKey() : value);
    }
  }, [value, windowEnd]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(windowEnd, i - 6));
  const canGoForward = !isToday(windowEnd) && !isFuture(windowEnd);

  return (
    <div className={cx("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => setWindowEnd(addDays(windowEnd, -1))}
        aria-label="Show the previous day"
        className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <ChevronLeftIcon className="size-5" />
      </button>

      <div className="flex min-w-0 flex-1 gap-1">
        {days.map((d) => {
          const selected = d === value;
          const future = isFuture(d);
          return (
            <button
              key={d}
              type="button"
              disabled={future}
              onClick={() => onChange(d)}
              aria-current={selected ? "date" : undefined}
              aria-label={`${formatWeekdayShort(d)} ${formatShort(d)}${isToday(d) ? ", today" : ""}`}
              className={cx(
                "min-w-0 flex-1 rounded-lg border py-1.5 text-center transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-30",
                selected
                  ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                  : cx(
                    "border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50",
                    "dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-700 dark:hover:bg-brand-950",
                  ),
              )}
            >
              <span className={cx(
                "block text-[10px] leading-tight",
                selected ? "text-white/80" : "text-slate-500 dark:text-slate-400",
              )}>
                {formatWeekdayShort(d)}
              </span>
              <span className={cx(
                "block whitespace-nowrap px-0.5 text-[11px] leading-tight font-semibold sm:text-xs",
                selected ? "text-white" : "text-slate-800 dark:text-slate-100",
              )}>
                {/* Numeric on phones so "8/24" never clips; the spelled-out
                    month only appears where there is room for it. */}
                <span className="sm:hidden">{formatNumeric(d)}</span>
                <span className="hidden sm:inline">{formatShort(d)}</span>
              </span>
              {/* Today gets a marker so the strip stays orientable when the
                  selection is elsewhere. */}
              <span
                aria-hidden="true"
                className={cx(
                  "mx-auto mt-0.5 block size-1 rounded-full",
                  isToday(d)
                    ? selected ? "bg-white" : "bg-brand-600 dark:bg-brand-400"
                    : "bg-transparent",
                )}
              />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setWindowEnd(minKey(addDays(windowEnd, 1), todayKey()))}
        disabled={!canGoForward}
        aria-label="Show the next day"
        className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-25 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <ChevronRightIcon className="size-5" />
      </button>
    </div>
  );
}

// `YYYY-MM-DD` sorts lexicographically, so plain string comparison is correct.
const minKey = (a: string, b: string) => (a < b ? a : b);
