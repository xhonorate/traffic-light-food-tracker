import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  createFamily,
  deleteFamily,
  regenerateCode,
  subscribeFamilies,
  updateFamily,
} from "../../lib/data";
import { formatDateTime } from "../../lib/dates";
import { initials } from "../../lib/format";
import { formatKcalRange } from "../../lib/goals";
import {
  CHILD_KCAL_TARGET,
  KCAL_BAND,
  defaultGoalsFor,
  resolveGoals,
  type FamilyDoc,
  type MemberGoals,
} from "../../lib/types";
import { Layout } from "../../components/Layout";
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  Toast,
  cx,
} from "../../components/ui";
import { chromeFor } from "../../components/navs";
import CodeBadge from "../../components/CodeBadge";
import { ChevronRightIcon, FireIcon } from "@heroicons/react/24/solid";
import { UsersIcon } from "@heroicons/react/24/outline";
import { ColorMark } from "../../components/TrafficLight";

export default function Families() {
  const { user, claims, impersonate } = useAuth();
  const navigate = useNavigate();

  const [families, setFamilies] = useState<FamilyDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FamilyDoc | null>(null);
  const [deleting, setDeleting] = useState<FamilyDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const isAdmin = claims?.role === "admin";
  const { nav, base } = chromeFor(claims?.role);

  useEffect(() => {
    if (!user) return;
    return subscribeFamilies(
      setFamilies,
      isAdmin ? {} : { coachId: user.uid },
      (e) => {
        setError(e.message);
        setFamilies([]);
      },
    );
  }, [user, isAdmin]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !families) return families ?? [];
    return families.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.code.toLowerCase().includes(q) ||
        f.members.parent?.name?.toLowerCase().includes(q) ||
        f.members.child?.name?.toLowerCase().includes(q),
    );
  }, [families, query]);

  const openAs = async (f: FamilyDoc) => {
    setBusy(true);
    try {
      await impersonate({ type: "family", id: f.id });
      navigate("/family", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Layout nav={nav} title="Families">
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or code"
          className="sm:max-w-xs"
        />
        <Button
          variant="primary"
          className="sm:ml-auto"
          onClick={() => setAdding(true)}
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
          Add family
        </Button>
      </div>

      {families === null ? (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersIcon className="size-6" />}
            title={query ? "No families match that search" : "No families yet"}
            body={
              query ? undefined : "Add a family to generate their access code."
            }
            action={
              !query && (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  Add your first family
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((f) => (
            <li key={f.id}>
              <Card className="flex h-full flex-col transition-shadow hover:shadow-md">
                {/* The whole upper card is the link to this family's stats --
                    the thing a coach actually wants most of the time. */}
                <Link
                  to={`${base}/family/${f.id}`}
                  className="group flex-1 rounded-t-2xl p-4 focus-visible:outline-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="flex items-center gap-1 font-semibold text-slate-900 group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-300">
                        <span className="truncate">{f.label}</span>
                        <ChevronRightIcon className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600 dark:group-hover:text-brand-400" />
                      </span>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {f.lastActiveAt
                          ? `Last active ${formatDateTime(f.lastActiveAt)}`
                          : "Not signed in yet"}
                      </p>
                    </div>
                    {!f.active && <Badge tone="warn">Paused</Badge>}
                  </div>

                  <ul className="mt-3 space-y-2">
                    {(["parent", "child"] as const).map((m) => {
                      const g = resolveGoals(f.members[m], m);
                      return (
                        <li key={m} className="flex items-center gap-2 text-sm">
                          <span
                            className={cx(
                              "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                              m === "parent"
                                ? "bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                                : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
                            )}
                          >
                            {initials(f.members[m]?.name || m)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-300">
                            {f.members[m]?.name ||
                              (m === "parent" ? "Parent" : "Child")}
                          </span>
                          <GoalSummaryChips goals={g} />
                        </li>
                      );
                    })}
                  </ul>
                </Link>

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                  <CodeBadge
                    code={f.code}
                    onCopied={() => setToast("Code copied to clipboard")}
                  />
                  <Button size="sm" onClick={() => setEditing(f)}>
                    Edit
                  </Button>
                  <Button size="sm" onClick={() => openAs(f)} disabled={busy}>
                    Login as family
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-rose-600 dark:text-rose-400"
                    onClick={() => setDeleting(f)}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Mounted only while open so the form starts blank each time. */}
      {adding && (
        <FamilyFormModal
          open
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const { data } = await createFamily(v);
            setToast(`Family created. Access code: ${data.code}`);
          }}
        />
      )}

      {editing && (
        <FamilyFormModal
          open
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            await updateFamily(editing.id, {
              label: v.label,
              members: {
                parent: v.parent,
                child: v.child,
              },
            });
            setToast("Family updated");
          }}
          onRegenerate={async () => {
            const { data } = await regenerateCode({ familyId: editing.id });
            setToast(`New code: ${data.code}. Share it with the family.`);
          }}
          onToggleActive={async () => {
            await updateFamily(editing.id, { active: !editing.active });
            setToast(editing.active ? "Family paused" : "Family reactivated");
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        loading={busy}
        title="Delete this family?"
        requirePhrase={deleting?.code}
        confirmLabel="Delete permanently"
        body={
          <>
            <p>
              <strong>{deleting?.label}</strong> and every food they have logged
              will be permanently removed. This cannot be undone.
            </p>
            <p className="mt-2">
              If you only want to stop access for now, use{" "}
              <strong>Edit &rarr; Pause</strong> instead.
            </p>
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await deleteFamily({ familyId: deleting.id });
            setToast("Family deleted");
            setDeleting(null);
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

/** The three daily targets at a glance: green, red, calories. Icons rather
 *  than "5G / 1R", which read as a code the viewer had to decipher. */
function GoalSummaryChips({ goals }: { goals: MemberGoals }) {
  const items = [
    {
      key: "green",
      node: <ColorMark color="green" size={11} />,
      value: goals.dailyGreen,
      title: `At least ${goals.dailyGreen} green foods a day`,
    },
    {
      key: "red",
      node: <ColorMark color="red" size={11} />,
      value: goals.dailyRed,
      title: `At most ${goals.dailyRed} red foods a day`,
    },
    {
      key: "kcal",
      node: (
        <FireIcon className="size-3" style={{ color: "var(--tl-yellow)" }} />
      ),
      value: goals.dailyKcal,
      title: `${formatKcalRange(goals)} calories a day`,
    },
  ];
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {items.map((i) => (
        <span
          key={i.key}
          title={i.title}
          className="flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {i.node}
          {i.value.toLocaleString()}
        </span>
      ))}
    </span>
  );
}

/** The three daily targets, in the order coaches read them: aim for, stay under. */
const GOAL_FIELDS = [
  { key: "dailyGreen" as const, label: "Green", hint: "at least" },
  { key: "dailyRed" as const, label: "Red", hint: "at most" },
  { key: "dailyKcal" as const, label: "Calories", hint: `target ±${KCAL_BAND}` },
];

interface FamilyFormValues {
  label: string;
  parent: { name: string; goals: MemberGoals };
  child: { name: string; goals: MemberGoals };
}

function FamilyFormModal({
  open,
  onClose,
  onSubmit,
  initial,
  onRegenerate,
  onToggleActive,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: FamilyFormValues) => Promise<void>;
  initial?: FamilyDoc;
  onRegenerate?: () => Promise<void>;
  onToggleActive?: () => Promise<void>;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [parentName, setParentName] = useState(
    initial?.members.parent?.name ?? "",
  );
  const [childName, setChildName] = useState(
    initial?.members.child?.name ?? "",
  );

  // Goals are edited as strings so a half-typed number does not snap back.
  const asDraft = (g: MemberGoals) => ({
    dailyGreen: String(g.dailyGreen),
    dailyRed: String(g.dailyRed),
    dailyKcal: String(g.dailyKcal),
  });
  const [parentGoals, setParentGoals] = useState(
    asDraft(initial ? resolveGoals(initial.members.parent, "parent") : defaultGoalsFor("parent")),
  );
  const [childGoals, setChildGoals] = useState(
    asDraft(initial ? resolveGoals(initial.members.child, "child") : defaultGoalsFor("child")),
  );

  const toGoals = (d: Record<string, string>): MemberGoals => ({
    dailyGreen: Math.max(0, Number(d.dailyGreen) || 0),
    dailyRed: Math.max(0, Number(d.dailyRed) || 0),
    dailyKcal: Math.max(0, Number(d.dailyKcal) || 0),
  });

  /** Live "1,500–1,800" under the calorie box, so the band is never a guess. */
  const kcalHint = (d: Record<string, string>) =>
    `green ${formatKcalRange(toGoals(d))}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = !label.trim() || !parentName.trim() || !childName.trim();

  const submit = async () => {
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        label: label.trim(),
        parent: { name: parentName.trim(), goals: toGoals(parentGoals) },
        child: { name: childName.trim(), goals: toGoals(childGoals) },
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit family" : "Add a family"}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={busy}
            disabled={invalid}
          >
            {initial ? "Save changes" : "Create family"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}

        <Field
          label="Family name or identifier"
          required
          hint="Shown to the family and in exports, e.g. “Smith family” or a study ID"
        >
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Smith family"
          />
        </Field>

        {(
          [
            {
              key: "parent",
              title: "Parent",
              name: parentName,
              setName: setParentName,
              goals: parentGoals,
              setGoals: setParentGoals,
            },
            {
              key: "child",
              title: "Child",
              name: childName,
              setName: setChildName,
              goals: childGoals,
              setGoals: setChildGoals,
            },
          ] as const
        ).map((m) => (
          <fieldset
            key={m.key}
            className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
          >
            <legend className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
              {m.title}
            </legend>
            <Field label="Name or initials" required>
              <Input
                value={m.name}
                onChange={(e) => m.setName(e.target.value)}
                placeholder={m.key === "parent" ? "e.g. J.S." : "e.g. A.S."}
              />
            </Field>
            <p className="mt-3 mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              Daily goals
            </p>
            <div className="grid grid-cols-3 gap-2">
              {GOAL_FIELDS.map((g) => {
                // The child's calorie target is fixed by the program.
                const locked = g.key === "dailyKcal" && m.key === "child";
                return (
                  <Field
                    key={g.key}
                    label={g.label}
                    hint={
                      g.key === "dailyKcal"
                        ? locked
                          ? `fixed · ${kcalHint(m.goals)}`
                          : kcalHint(m.goals)
                        : g.hint
                    }
                  >
                    <Input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={locked ? String(CHILD_KCAL_TARGET) : m.goals[g.key]}
                      disabled={locked}
                      title={
                        locked
                          ? "The child's calorie target is set by the program"
                          : undefined
                      }
                      onChange={(e) =>
                        m.setGoals({ ...m.goals, [g.key]: e.target.value })
                      }
                    />
                  </Field>
                );
              })}
            </div>
          </fieldset>
        ))}

        {initial && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Access code
              </p>
              <div className="mt-1.5">
                <CodeBadge code={initial.code} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {onRegenerate && (
                <Button
                  size="sm"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onRegenerate();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  Issue a new code
                </Button>
              )}
              {onToggleActive && (
                <Button
                  size="sm"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onToggleActive();
                      onClose();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  {initial.active ? "Pause access" : "Reactivate"}
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Issuing a new code immediately invalidates the old one. Their
              logged data is kept.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
