import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { resetRules, saveRules, subscribeRules } from "../../lib/data";
import { DEFAULT_RULE_SET } from "../../lib/defaultRules";
import { classify, sortRules } from "../../lib/rules";
import {
  NUMERIC_FIELDS,
  NUMERIC_OPS,
  type Condition,
  type MissingPolicy,
  type NumericField,
  type NumericOp,
  type Rule,
  type RuleSet,
  type TrafficColor,
} from "../../lib/types";
import { Layout } from "../../components/Layout";
import { ADMIN_NAV } from "../../components/navs";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Skeleton,
  Toast,
  cx,
} from "../../components/ui";
import {
  ColorMark,
  COLOR_ORDER,
  COLOR_WORD,
} from "../../components/TrafficLight";
import CategoryInput from "../../components/CategoryInput";
import RuleTester from "./RuleTester";

const MISSING_POLICIES: { value: MissingPolicy; label: string }[] = [
  { value: "skip", label: "the rule does not apply" },
  { value: "treatAsZero", label: "count it as 0" },
  { value: "pass", label: "the condition still passes" },
];

let idCounter = 0;
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export default function RulesEditor() {
  const { user } = useAuth();

  const [saved, setSaved] = useState<RuleSet | null>(null);
  const [draft, setDraft] = useState<RuleSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

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
      JSON.stringify(saved) !== JSON.stringify(draft),
    [saved, draft],
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

  const ordered = useMemo(() => (draft ? sortRules(draft.rules) : []), [draft]);

  const patchRule = (id: string, patch: Partial<Rule>) =>
    setDraft(
      (d) =>
        d && {
          ...d,
          rules: d.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        },
    );

  const removeRule = (id: string) =>
    setDraft((d) => d && { ...d, rules: d.rules.filter((r) => r.id !== id) });

  /** Swap a rule with its neighbour, then renumber so priorities stay tidy. */
  const move = (id: string, dir: -1 | 1) => {
    setDraft((d) => {
      if (!d) return d;
      const list = sortRules(d.rules);
      const i = list.findIndex((r) => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return {
        ...d,
        rules: list.map((r, k) => ({ ...r, priority: (k + 1) * 10 })),
      };
    });
  };

  const addRule = () => {
    const id = newId("rule");
    setDraft(
      (d) =>
        d && {
          ...d,
          rules: [
            ...d.rules,
            {
              id,
              enabled: true,
              priority: (sortRules(d.rules).length + 1) * 10,
              label: "New rule",
              scope: "food",
              color: "red",
              reason: "Describe why this food is scored this way",
              all: [
                {
                  kind: "numeric",
                  field: "kcal_100",
                  op: ">=",
                  value: 100,
                  whenMissing: "skip",
                },
              ],
            },
          ],
        },
    );
    setExpanded(id);
  };

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
        Rules run top to bottom;{" "}
        <strong>the first one that matches decides the color</strong>. Foods
        that match nothing fall through to the default at the bottom. Changes
        here take effect for every family as soon as you save, and only affect
        foods logged from then on — history is never re-scored.
      </Banner>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={addRule}>
          <svg
            viewBox="0 0 20 20"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" />
          </svg>
          Add rule
        </Button>
        <Button onClick={() => setTesting(true)}>Test a food</Button>
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
            You have unsaved changes
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
              onClick={async () => {
                if (!user) return;
                setBusy(true);
                setError(null);
                try {
                  // Renumber on save so priorities stay evenly spaced.
                  const normalised: RuleSet = {
                    ...draft,
                    rules: sortRules(draft.rules).map((r, i) => ({
                      ...r,
                      priority: (i + 1) * 10,
                    })),
                  };
                  await saveRules(normalised, user.uid);
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

      <ol className="space-y-2">
        {ordered.map((rule, i) => (
          <li key={rule.id}>
            <RuleCard
              rule={rule}
              index={i}
              total={ordered.length}
              expanded={expanded === rule.id}
              onToggleExpand={() =>
                setExpanded(expanded === rule.id ? null : rule.id)
              }
              onChange={(patch) => patchRule(rule.id, patch)}
              onRemove={() => removeRule(rule.id)}
              onMove={(dir) => move(rule.id, dir)}
            />
          </li>
        ))}
      </ol>

      {/* Fallback */}
      <Card className="mt-3 border-dashed">
        <CardHeader
          title="If nothing above matches"
          subtitle="The default outcome"
        />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="color">
            <Select
              value={draft.defaultColor}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  defaultColor: e.target.value as TrafficColor,
                })
              }
            >
              {COLOR_ORDER.map((c) => (
                <option key={c} value={c}>
                  {COLOR_WORD[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason shown for food">
            <Input
              value={draft.defaultReasonFood}
              onChange={(e) =>
                setDraft({ ...draft, defaultReasonFood: e.target.value })
              }
            />
          </Field>
          <Field label="Reason shown for drinks">
            <Input
              value={draft.defaultReasonBeverage}
              onChange={(e) =>
                setDraft({ ...draft, defaultReasonBeverage: e.target.value })
              }
            />
          </Field>
        </div>
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
            Every rule will be replaced with the {DEFAULT_RULE_SET.rules.length}{" "}
            built-in defaults. Any rules you have added or retuned will be lost.
            Foods already logged keep the colors they were given.
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
// One rule
// ---------------------------------------------------------------------------

function RuleCard({
  rule,
  index,
  total,
  expanded,
  onToggleExpand,
  onChange,
  onRemove,
  onMove,
}: {
  rule: Rule;
  index: number;
  total: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (patch: Partial<Rule>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card className={cx(!rule.enabled && "opacity-60")}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="w-6 shrink-0 text-center text-xs font-medium tabular-nums text-slate-400">
          {index + 1}
        </span>

        <ColorMark color={rule.color} size={20} />

        <button
          onClick={onToggleExpand}
          className="tap min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <span className="block truncate font-medium text-slate-900 dark:text-slate-100">
            {rule.label}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
            {rule.scope === "any"
              ? "Food & drinks"
              : rule.scope === "food"
                ? "Food only"
                : "Drinks only"}
            {" · "}
            {rule.all.length} condition{rule.all.length === 1 ? "" : "s"}
            {rule.except?.length
              ? `, ${rule.except.length} exception${rule.except.length === 1 ? "" : "s"}`
              : ""}
          </span>
        </button>

        {!rule.enabled && <Badge tone="warn">Off</Badge>}

        <div className="flex shrink-0 items-center">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move up"
            className="tap rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-slate-800"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="m5 12 5-5 5 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Move down"
            className="tap rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-slate-800"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="m5 8 5 5 5-5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            onClick={onToggleExpand}
            aria-label={expanded ? "Collapse" : "Edit"}
            className="tap rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg
              viewBox="0 0 20 20"
              className={cx(
                "size-4 transition-transform",
                expanded && "rotate-180",
              )}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="m5 8 5 5 5-5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-slate-200 p-4 dark:border-slate-800">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Rule name">
              <Input
                value={rule.label}
                onChange={(e) => onChange({ label: e.target.value })}
              />
            </Field>
            <Field label="Applies to">
              <Select
                value={rule.scope}
                onChange={(e) =>
                  onChange({ scope: e.target.value as Rule["scope"] })
                }
              >
                <option value="food">Food only</option>
                <option value="beverage">Drinks only</option>
                <option value="any">Food &amp; drinks</option>
              </Select>
            </Field>
            <Field label="Resulting color">
              <Select
                value={rule.color}
                onChange={(e) =>
                  onChange({ color: e.target.value as TrafficColor })
                }
              >
                {COLOR_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {COLOR_WORD[c]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label="Reason families see"
            hint="Use {value} for the measured amount and {limit} for the threshold"
          >
            <Input
              value={rule.reason}
              onChange={(e) => onChange({ reason: e.target.value })}
            />
          </Field>

          <ConditionList
            title="Applies when ALL of these are true"
            conditions={rule.all}
            onChange={(all) => onChange({ all })}
            allowEmpty={false}
          />

          <ConditionList
            title="…except when ALL of these are true"
            hint="Leave empty for no exceptions. Use this for carve-outs like “unless it is nuts”."
            conditions={rule.except ?? []}
            onChange={(except) =>
              onChange({ except: except.length ? except : undefined })
            }
            allowEmpty
          />

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => onChange({ enabled: e.target.checked })}
                className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Rule is active
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-rose-600 dark:text-rose-400"
              onClick={() => setConfirmDelete(true)}
            >
              Delete rule
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this rule?"
        confirmLabel="Delete rule"
        body={
          <p>
            “{rule.label}” will be removed. You can still discard all changes
            before saving.
          </p>
        }
        onConfirm={() => {
          setConfirmDelete(false);
          onRemove();
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

function ConditionList({
  title,
  hint,
  conditions,
  onChange,
  allowEmpty,
}: {
  title: string;
  hint?: string;
  conditions: Condition[];
  onChange: (c: Condition[]) => void;
  allowEmpty: boolean;
}) {
  const update = (i: number, c: Condition) =>
    onChange(conditions.map((x, k) => (k === i ? c : x)));

  return (
    <fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <legend className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
        {title}
      </legend>
      {hint && (
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}

      {conditions.length === 0 ? (
        <p className="mb-2 text-sm text-slate-400 dark:text-slate-500">
          No conditions.
        </p>
      ) : (
        <ul className="mb-2 space-y-2">
          {conditions.map((c, i) => (
            <li
              key={i}
              className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60"
            >
              <ConditionRow
                condition={c}
                onChange={(next) => update(i, next)}
                onRemove={() => onChange(conditions.filter((_, k) => k !== i))}
                canRemove={allowEmpty || conditions.length > 1}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          onClick={() =>
            onChange([
              ...conditions,
              {
                kind: "numeric",
                field: "kcal_100",
                op: ">=",
                value: 100,
                whenMissing: "skip",
              },
            ])
          }
        >
          + Nutrient
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onChange([
              ...conditions,
              { kind: "category", op: "includesAny", values: [] },
            ])
          }
        >
          + Category
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onChange([
              ...conditions,
              { kind: "missing", field: "added_100", missing: true },
            ])
          }
        >
          + Missing data
        </Button>
      </div>
    </fieldset>
  );
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
  canRemove,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const RemoveButton = (
    <button
      onClick={onRemove}
      disabled={!canRemove}
      aria-label="Remove condition"
      className="tap shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-25 dark:hover:bg-rose-950"
    >
      <svg
        viewBox="0 0 20 20"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
      </svg>
    </button>
  );

  if (condition.kind === "numeric") {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[2fr_1.3fr_0.8fr]">
            <Select
              value={condition.field}
              onChange={(e) =>
                onChange({
                  ...condition,
                  field: e.target.value as NumericField,
                })
              }
            >
              {NUMERIC_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
            <Select
              value={condition.op}
              onChange={(e) =>
                onChange({ ...condition, op: e.target.value as NumericOp })
              }
            >
              {NUMERIC_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={condition.value}
              onChange={(e) =>
                onChange({ ...condition, value: Number(e.target.value) })
              }
            />
          </div>
          {RemoveButton}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          If this nutrient is unknown,
          <Select
            className="w-auto py-1 text-xs"
            value={condition.whenMissing}
            onChange={(e) =>
              onChange({
                ...condition,
                whenMissing: e.target.value as MissingPolicy,
              })
            }
          >
            {MISSING_POLICIES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
    );
  }

  if (condition.kind === "missing") {
    return (
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
          <Select
            value={condition.field}
            onChange={(e) =>
              onChange({ ...condition, field: e.target.value as NumericField })
            }
          >
            {NUMERIC_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          <Select
            value={condition.missing ? "yes" : "no"}
            onChange={(e) =>
              onChange({ ...condition, missing: e.target.value === "yes" })
            }
          >
            <option value="yes">is unknown</option>
            <option value="no">is known</option>
          </Select>
        </div>
        {RemoveButton}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="grid min-w-0 flex-1 gap-2">
        <Select
          value={condition.op}
          onChange={(e) =>
            onChange({
              ...condition,
              op: e.target.value as "includesAny" | "excludesAll",
            })
          }
        >
          <option value="includesAny">Category is one of…</option>
          <option value="excludesAll">Category is none of…</option>
        </Select>
        <CategoryInput
          values={condition.values}
          onChange={(values) => onChange({ ...condition, values })}
          placeholder="Type or pick a category, e.g. sugary-snacks"
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Add as many as you need. Each is matched as partial text against the
          food's category tags, so{" "}
          <code className="rounded bg-white px-1 dark:bg-slate-900">
            fruits
          </code>{" "}
          matches{" "}
          <code className="rounded bg-white px-1 dark:bg-slate-900">
            en:fruits
          </code>{" "}
          and{" "}
          <code className="rounded bg-white px-1 dark:bg-slate-900">
            en:dried-fruits
          </code>
          . The suggestions are the 18 tags foods found by name search carry.
          Anything else you type only matches barcode-scanned foods.
        </p>
      </div>
      {RemoveButton}
    </div>
  );
}
