import { useId, useMemo, useState } from "react";
import type { LogEntry, TrafficColor } from "../lib/types";
import { formatDayLetter, formatShort, isToday } from "../lib/dates";
import { n0 } from "../lib/format";
import {
  COLOR_ORDER,
  COLOR_VAR,
  COLOR_WORD,
  ColorLegend,
  ColorMark,
} from "./TrafficLight";
import { cx } from "./ui";

export interface DayTotals {
  date: string;
  green: number;
  yellow: number;
  red: number;
  kcal: number | null;
  total: number;
}

/** Roll entries into per-day color counts. Servings count individually --
 *  two servings of a red food count as two against the daily red goal. */
export function totalsByDay(days: string[], entries: LogEntry[]): DayTotals[] {
  const map = new Map<string, DayTotals>(
    days.map((d) => [
      d,
      { date: d, green: 0, yellow: 0, red: 0, kcal: null, total: 0 },
    ]),
  );
  for (const e of entries) {
    const row = map.get(e.date);
    if (!row) continue;
    row[e.color] += e.servings;
    row.total += e.servings;
    if (e.kcal !== null && e.kcal !== undefined)
      row.kcal = (row.kcal ?? 0) + e.kcal;
  }
  return days.map((d) => map.get(d)!);
}

/** Path for a bar segment with optionally rounded top corners. */
function segmentPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  if (rr <= 0.5) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return `M${x} ${y + rr}a${rr} ${rr} 0 0 1 ${rr} ${-rr}h${w - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${h - rr}h${-w}z`;
}

/** Round a max up to a friendly axis top. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  if (v <= 6) return 6;
  if (v <= 10) return 10;
  return Math.ceil(v / 5) * 5;
}

export function WeekChart({
  days,
  entries,
  className,
}: {
  days: string[];
  entries: LogEntry[];
  className?: string;
}) {
  const data = useMemo(() => totalsByDay(days, entries), [days, entries]);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  const max = niceMax(Math.max(...data.map((d) => d.total), 0));
  const anyData = data.some((d) => d.total > 0);

  // Geometry in a fixed viewBox; the SVG scales to its container.
  const W = 340,
    H = 168;
  const padL = 22,
    padR = 6,
    padT = 8,
    padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slot = plotW / days.length;
  const barW = Math.min(30, slot * 0.62);
  const GAP = 2; // surface gap between stacked segments

  const yFor = (v: number) => padT + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];

  return (
    <figure className={cx("m-0", className)}>
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Foods logged, last 7 days
        </span>
        <ColorLegend />
      </figcaption>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: "auto" }}
          role="img"
          aria-labelledby={titleId}
          onMouseLeave={() => setActive(null)}
        >
          <title id={titleId}>
            Stacked bar chart of green, yellow and red foods logged on each of
            the last seven days.
          </title>

          {/* Recessive gridlines */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yFor(t)}
                y2={yFor(t)}
                stroke="var(--tl-grid)"
                strokeWidth="1"
              />
              <text
                x={padL - 6}
                y={yFor(t) + 3.5}
                textAnchor="end"
                className="fill-slate-400 dark:fill-slate-500"
                style={{ fontSize: 9 }}
              >
                {t}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const cx0 = padL + slot * i + slot / 2;
            const x = cx0 - barW / 2;
            let cursorY = padT + plotH;

            // Stack green at the base, red on top so budget spend reads first.
            const segments = (["green", "yellow", "red"] as TrafficColor[])
              .map((color) => {
                const v = d[color];
                if (v <= 0) return null;
                const h = (v / max) * plotH;
                const y = cursorY - h;
                cursorY = y - GAP;
                return { color, y, h, v };
              })
              .filter(
                (
                  s,
                ): s is {
                  color: TrafficColor;
                  y: number;
                  h: number;
                  v: number;
                } => s !== null,
              );

            const topIndex = segments.length - 1;

            return (
              <g
                key={d.date}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                tabIndex={0}
                role="button"
                aria-label={`${formatShort(d.date)}: ${d.green} green, ${d.yellow} yellow, ${d.red} red`}
                className="focus:outline-none"
              >
                {/* Hit target wider than the mark */}
                <rect
                  x={padL + slot * i}
                  y={padT}
                  width={slot}
                  height={plotH}
                  fill={active === i ? "currentColor" : "transparent"}
                  className="text-slate-900/[0.04] dark:text-white/[0.06]"
                />
                {segments.map((s, si) => (
                  <path
                    key={s.color}
                    d={segmentPath(x, s.y, barW, s.h, si === topIndex ? 4 : 0)}
                    fill={COLOR_VAR[s.color]}
                  />
                ))}
                {/* Day axis label */}
                <text
                  x={cx0}
                  y={H - padB + 13}
                  textAnchor="middle"
                  className={cx(
                    isToday(d.date)
                      ? "fill-slate-900 font-semibold dark:fill-slate-100"
                      : "fill-slate-500 dark:fill-slate-400",
                  )}
                  style={{ fontSize: 10 }}
                >
                  {formatDayLetter(d.date)}
                </text>
                <text
                  x={cx0}
                  y={H - padB + 24}
                  textAnchor="middle"
                  className="fill-slate-400 dark:fill-slate-500"
                  style={{ fontSize: 8.5 }}
                >
                  {formatShort(d.date).split(" ")[1]}
                </text>
              </g>
            );
          })}

          {/* Baseline sits above the labels */}
          <line
            x1={padL}
            x2={W - padR}
            y1={padT + plotH}
            y2={padT + plotH}
            stroke="var(--tl-grid)"
            strokeWidth="1.5"
          />
        </svg>

        {!anyData && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
            No foods logged this week yet
          </p>
        )}

        {active !== null && data[active].total > 0 && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
            style={{ left: `${((active + 0.5) / days.length) * 100}%` }}
          >
            <div className="mb-1.5 font-semibold text-slate-900 dark:text-slate-100">
              {formatShort(data[active].date)}
            </div>
            <dl className="space-y-1">
              {COLOR_ORDER.map((c) => (
                <div
                  key={c}
                  className="flex items-center justify-between gap-3"
                >
                  <dt className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                    <ColorMark color={c} size={10} />
                    {COLOR_WORD[c]}
                  </dt>
                  <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {data[active][c]}
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-1 dark:border-slate-700">
                <dt className="text-slate-600 dark:text-slate-300">Calories</dt>
                <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                  {n0(data[active].kcal)}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Table alternative -- identity never rests on color alone. */}
      <details className="mt-2 group">
        <summary className="cursor-pointer list-none text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          <span className="underline underline-offset-2">View as table</span>
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500 dark:text-slate-400">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Day
                </th>
                {COLOR_ORDER.map((c) => (
                  <th key={c} scope="col" className="py-1 pr-3 font-medium">
                    {COLOR_WORD[c]}
                  </th>
                ))}
                <th scope="col" className="py-1 font-medium">
                  Kcal
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-800 dark:text-slate-200">
              {data.map((d) => (
                <tr
                  key={d.date}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <th
                    scope="row"
                    className="py-1 pr-3 font-normal whitespace-nowrap"
                  >
                    {formatShort(d.date)}
                  </th>
                  <td className="py-1 pr-3 tabular-nums">{d.green}</td>
                  <td className="py-1 pr-3 tabular-nums">{d.yellow}</td>
                  <td className="py-1 pr-3 tabular-nums">{d.red}</td>
                  <td className="py-1 tabular-nums">{n0(d.kcal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
