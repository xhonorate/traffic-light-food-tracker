import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { fetchEntriesRange, subscribeFamilies } from "../lib/data";
import { addDays, todayKey } from "../lib/dates";
import {
  DAILY_SUMMARY_HEADERS,
  ENTRY_HEADERS,
  dailySummaryCsv,
  downloadText,
  entriesCsv,
  summarise,
  type DailySummaryRow,
} from "../lib/csv";
import type { FamilyDoc, LogEntry } from "../lib/types";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Spinner,
  cx,
} from "./ui";

type Detail = "summary" | "entries";

const PRESETS = [
  { label: "Last 7 days", days: 6 },
  { label: "Last 30 days", days: 29 },
  { label: "Last 90 days", days: 89 },
];

/**
 * CSV export (requirement 13). The summary shape matches the columns the
 * spec asked for exactly, so the file drops straight into the program's
 * existing analysis; the detailed shape adds one row per logged food for
 * anyone who needs to audit or re-score the data.
 */
export default function ExportPanel({
  scope,
  familyId,
}: {
  scope: "coach" | "admin" | "family";
  familyId?: string;
}) {
  const { user, claims } = useAuth();

  const [families, setFamilies] = useState<FamilyDoc[]>([]);
  const [fromDate, setFromDate] = useState(addDays(todayKey(), -29));
  const [toDate, setToDate] = useState(todayKey());
  const [detail, setDetail] = useState<Detail>("summary");
  const [target, setTarget] = useState<string>(familyId ?? "all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    rows: number;
    families: number;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeFamilies(
      setFamilies,
      claims?.role === "admin" ? {} : { coachId: user.uid },
      (e) => setError(e.message),
    );
  }, [user, claims?.role]);

  const inScope = useMemo(
    () =>
      familyId
        ? families.filter((f) => f.id === familyId)
        : target === "all"
          ? families
          : families.filter((f) => f.id === target),
    [families, familyId, target],
  );

  const rangeInvalid = fromDate > toDate;

  const run = async (mode: "download" | "preview") => {
    if (rangeInvalid) return;
    setBusy(true);
    setError(null);
    try {
      const summaryRows: DailySummaryRow[] = [];
      const detailRows: { entries: LogEntry[]; family: FamilyDoc }[] = [];

      // Sequential rather than parallel: a coach may hold dozens of families
      // and Firestore is happier with a steady trickle than a burst.
      for (const f of inScope) {
        const entries = await fetchEntriesRange(f.id, fromDate, toDate);
        summaryRows.push(...summarise(entries, f.code));
        detailRows.push({ entries, family: f });
      }

      if (mode === "preview") {
        setPreview({
          rows:
            detail === "summary"
              ? summaryRows.length
              : detailRows.reduce((n, d) => n + d.entries.length, 0),
          families: inScope.length,
        });
        return;
      }

      const stamp = `${fromDate}_to_${toDate}`;
      if (detail === "summary") {
        downloadText(
          `food-log-summary_${stamp}.csv`,
          dailySummaryCsv(summaryRows),
        );
      } else {
        // Concatenate per family, keeping a single header row.
        const body = detailRows
          .map(({ entries, family }) =>
            entriesCsv(entries, family).split("\r\n").slice(1).join("\r\n"),
          )
          .filter((s) => s.trim())
          .join("\r\n");
        const header = ENTRY_HEADERS.join(",");
        downloadText(
          `food-log-detail_${stamp}.csv`,
          "﻿" + header + "\r\n" + body + "\r\n",
        );
      }
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Download a CSV"
          subtitle={`${inScope.length} ${inScope.length === 1 ? "family" : "families"} in range`}
        />
        <div className="space-y-4 p-4">
          {error && <Banner tone="error">{error}</Banner>}

          {!familyId && scope !== "family" && (
            <Field label="Families">
              <Select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="all">All my families ({families.length})</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} · {f.code}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Date range
            </span>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => {
                const active =
                  fromDate === addDays(todayKey(), -p.days) &&
                  toDate === todayKey();
                return (
                  <button
                    key={p.label}
                    onClick={() => {
                      setFromDate(addDays(todayKey(), -p.days));
                      setToDate(todayKey());
                    }}
                    className={cx(
                      "tap rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
                      active
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <Input
                  type="date"
                  value={fromDate}
                  max={toDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </Field>
              <Field label="To">
                <Input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  max={todayKey()}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </Field>
            </div>
            {rangeInvalid && (
              <p className="mt-1 text-sm text-rose-600 dark:text-rose-400">
                The start date must not be after the end date.
              </p>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              What to include
            </span>
            <div className="grid gap-2">
              {[
                {
                  v: "summary" as const,
                  title: "Daily summary",
                  body: DAILY_SUMMARY_HEADERS.join(" · "),
                },
                {
                  v: "entries" as const,
                  title: "Every logged food",
                  body: "One row per item, with full nutrition, the color chosen and the color the guide suggested",
                },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setDetail(o.v)}
                  className={cx(
                    "tap rounded-xl border-2 px-3 py-2.5 text-left transition-colors",
                    detail === o.v
                      ? "border-brand-600 bg-brand-50 dark:border-brand-600 dark:bg-brand-950"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900",
                  )}
                >
                  <span className="block font-medium text-slate-900 dark:text-slate-100">
                    {o.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    {o.body}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {preview && (
            <Banner tone="info">
              {preview.rows.toLocaleString()} row{preview.rows === 1 ? "" : "s"}{" "}
              across {preview.families}{" "}
              {preview.families === 1 ? "family" : "families"}.
            </Banner>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => run("preview")}
              disabled={busy || rangeInvalid}
            >
              {busy ? <Spinner className="size-4" /> : null}
              Count rows first
            </Button>
            <Button
              variant="primary"
              onClick={() => run("download")}
              disabled={busy || rangeInvalid || inScope.length === 0}
              loading={busy}
            >
              Download CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Getting this into another system" />
        <div className="space-y-2 p-4 text-sm text-slate-600 dark:text-slate-400">
          <p>
            The summary file uses exactly the columns the program specified, so
            it can be imported without reshaping.
          </p>
          <p>
            For an automated feed rather than a manual download, the same data
            is reachable programmatically — see the{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
              Programmatic export
            </code>{" "}
            section of <code className="text-xs">README.md</code>.
          </p>
        </div>
      </Card>
    </div>
  );
}
