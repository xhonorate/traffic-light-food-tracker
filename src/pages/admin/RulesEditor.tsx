import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { resetRules, saveRules, subscribeRules } from "../../lib/data";
import { DEFAULT_GROUPS, DEFAULT_RULE_SET } from "../../lib/defaultRules";
import { FOOD_GROUPS, type FoodGroup } from "../../lib/foodGroups";
import { classify } from "../../lib/rules";
import type { GroupRule, RuleSet } from "../../lib/types";
import { Layout } from "../../components/Layout";
import { ADMIN_NAV } from "../../components/navs";
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Skeleton,
  Toast,
} from "../../components/ui";
import { ColorMark } from "../../components/TrafficLight";
import RuleTester from "./RuleTester";

/** What is wrong with a row, if anything. A row with a problem cannot be
 *  saved, because a missing line would silently stop a group being scored. */
function rowProblem(g: GroupRule): string | null {
  if (g.kind === "free" || g.kind === "combo") return null;
  if (g.servG == null || g.servG <= 0) return "Enter the serving in grams.";
  if (g.kind === "alwaysRed") return null;
  if (g.yellow == null || g.yellow < 0) return "Enter the yellow line.";
  if (g.green != null && g.green > g.yellow) return "The green line must not be above the yellow line.";
  if (g.sugarPct != null && (g.sugarPct < 0 || g.sugarPct > 100)) return "The sugar share must be between 0 and 100%.";
  return null;
}

export default function RulesEditor() {
  const { user } = useAuth();

  const [saved, setSaved] = useState<RuleSet | null>(null);
  const [draft, setDraft] = useState<RuleSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [testing, setTesting] = useState(false);

  const seeded = useRef(false);
  useEffect(
    () =>
      subscribeRules(
        (r) => {
          setSaved(r);
          if (!seeded.current) {
            setDraft(structuredClone(r));
            seeded.current = true;
          }
        },
        (e) => setError(e.message),
      ),
    [],
  );

  const dirty = useMemo(
    () =>
      Boolean(saved && draft) &&
      JSON.stringify(saved?.groups) !== JSON.stringify(draft?.groups),
    [saved, draft],
  );

  const problems = useMemo(
    () => (draft ? FOOD_GROUPS.filter((k) => rowProblem(draft.groups[k])) : []),
    [draft],
  );

  // Warn before a refresh or tab close would discard edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const patchGroup = (key: FoodGroup, patch: Partial<GroupRule>) =>
    setDraft(
      (d) => d && { ...d, groups: { ...d.groups, [key]: { ...d.groups[key], ...patch } } },
    );

  if (!draft) {
    return (
      <Layout nav={ADMIN_NAV} title="color rules">
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout nav={ADMIN_NAV} title="color rules">
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      <Banner tone="info" className="mb-4">
        Every food is placed in one of the guide's {FOOD_GROUPS.length} food
        groups from its name and category. The calories in that group's serving
        then decide the color: <strong>only vegetables can be green</strong>.
        Changes take effect for every family as soon as you save, and only
        affect foods logged from then on — history is never re-scored.
      </Banner>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setTesting(true)}>
          Test a food
        </Button>
        <Button
          className="ml-auto"
          onClick={() => setResetting(true)}
          disabled={busy}
        >
          Reset to defaults
        </Button>
      </div>

      {/* Sticky save bar appears only when there is something to save. */}
      {dirty && (
        <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 shadow-sm dark:border-amber-800 dark:bg-amber-950">
          <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {problems.length
              ? `Fix ${problems.length} row${problems.length === 1 ? "" : "s"} before saving`
              : "You have unsaved changes"}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              onClick={() => saved && setDraft(structuredClone(saved))}
              disabled={busy}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={problems.length > 0}
              onClick={async () => {
                if (!user) return;
                setBusy(true);
                setError(null);
                try {
                  await saveRules(draft, user.uid);
                  setToast("Rules saved and live for all families");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save rules
            </Button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {FOOD_GROUPS.map((key) => (
          <li key={key}>
            <GroupRow
              rule={draft.groups[key]}
              defaults={DEFAULT_GROUPS[key]}
              onChange={(patch) => patchGroup(key, patch)}
            />
          </li>
        ))}
      </ul>

      <Card className="mt-3 border-dashed p-4 text-sm text-slate-600 dark:text-slate-300">
        <p className="font-medium text-slate-800 dark:text-slate-100">Also built in</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>
            Diet soda, sports and energy drinks, and anything artificially
            sweetened are in Fats, oils, sweets &amp; others, so they are red
            even at zero calories (FRG p.2).
          </li>
          <li>
            Calories are rounded to whole numbers before they are compared, as
            labels are: 120.4 is 120, and yellow at a line of 120.
          </li>
          <li>
            A food with no calorie data, or whose group cannot be worked out,
            gets no verdict. The family's choice is logged unchallenged.
          </li>
        </ul>
      </Card>

      {testing && (
        <RuleTester
          ruleSet={draft}
          onClose={() => setTesting(false)}
          classify={classify}
        />
      )}

      <ConfirmDialog
        open={resetting}
        onClose={() => setResetting(false)}
        loading={busy}
        title="Reset all rules?"
        requirePhrase="RESET"
        confirmLabel="Reset to defaults"
        body={
          <p>
            Every serving size and color line will go back to the guide's
            defaults. Anything you have retuned will be lost. Foods already
            logged keep the colors they were given.
          </p>
        }
        onConfirm={async () => {
          if (!user) return;
          setBusy(true);
          try {
            await resetRules(user.uid);
            setDraft(structuredClone(DEFAULT_RULE_SET));
            setToast("Rules reset to defaults");
            setResetting(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// One food group
// ---------------------------------------------------------------------------

/** A number box where empty means "not set". */
function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
}) {
  return (
    <Field label={suffix ? `${label} (${suffix})` : label}>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const v = raw === "" ? null : Number(raw);
          onChange(v === null || Number.isNaN(v) ? null : v);
        }}
      />
    </Field>
  );
}

const OUTCOME: Record<Exclude<GroupRule["kind"], "graded">, { mark: "red" | "none"; text: string }> = {
  alwaysRed: { mark: "red", text: "Always red" },
  free: { mark: "none", text: "No color" },
  combo: { mark: "none", text: "No range: the family decides" },
};

function GroupRow({
  rule,
  defaults,
  onChange,
}: {
  rule: GroupRule;
  /** Which lines the group has at all: only vegetables have a green line, and
   *  only cold cereal a sugar rule. Clearing one turns it off. */
  defaults: GroupRule;
  onChange: (patch: Partial<GroupRule>) => void;
}) {
  const problem = rowProblem(rule);
  const graded = rule.kind === "graded";
  const outcome = rule.kind === "graded" ? null : OUTCOME[rule.kind];

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-medium text-slate-900 dark:text-slate-100">
          {rule.label}
        </span>
        {!outcome ? (
          <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            {rule.green != null && (
              <>
                <ColorMark color="green" size={12} /> ≤ {rule.green}
              </>
            )}
            <ColorMark color="yellow" size={12} /> ≤ {rule.yellow ?? "?"}
            <ColorMark color="red" size={12} /> above
            {rule.sugarPct != null && <> · sugar &gt; {rule.sugarPct}% red</>}
          </span>
        ) : (
          <Badge tone={rule.kind === "alwaysRed" ? "danger" : "neutral"}>
            <span className="flex items-center gap-1">
              <ColorMark color={outcome.mark} size={12} />
              {outcome.text}
            </span>
          </Badge>
        )}
      </div>

      {rule.kind !== "free" && rule.kind !== "combo" && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Guide serving" className="col-span-2 sm:col-span-1">
            <Input value={rule.serv} onChange={(e) => onChange({ serv: e.target.value })} />
          </Field>
          <NumberField label="Serving used" suffix="g" value={rule.servG} onChange={(servG) => onChange({ servG })} />
          {graded && defaults.green != null && (
            <NumberField label="Green up to" suffix="cal" value={rule.green} onChange={(green) => onChange({ green })} />
          )}
          {graded && (
            <NumberField label="Yellow up to" suffix="cal" value={rule.yellow} onChange={(yellow) => onChange({ yellow })} />
          )}
          {graded && defaults.sugarPct != null && (
            <NumberField label="Red above sugar" suffix="% of cal" value={rule.sugarPct} onChange={(sugarPct) => onChange({ sugarPct })} />
          )}
        </div>
      )}

      {problem && <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{problem}</p>}
    </Card>
  );
}
