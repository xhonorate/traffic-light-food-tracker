import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  createCoach,
  deleteCoach,
  subscribeFamilies,
  subscribeUsers,
  updateUser,
} from "../../lib/data";
import { formatDateTime } from "../../lib/dates";
import { initials, pluralize } from "../../lib/format";
import type { FamilyDoc, UserDoc } from "../../lib/types";
import { Layout } from "../../components/Layout";
import { ADMIN_NAV } from "../../components/navs";
import { AcademicCapIcon } from "@heroicons/react/24/outline";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  Toast,
  cx,
} from "../../components/ui";

export default function Coaches() {
  const { user, impersonate, sendReset } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserDoc[] | null>(null);
  const [families, setFamilies] = useState<FamilyDoc[]>([]);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<UserDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeUsers(setUsers, (e) => {
        setError(e.message);
        setUsers([]);
      }),
    [],
  );
  useEffect(
    () => subscribeFamilies(setFamilies, {}, (e) => setError(e.message)),
    [],
  );

  const familiesFor = (uid: string) =>
    families.filter((f) => f.coachId === uid).length;

  return (
    <Layout nav={ADMIN_NAV} title="Coaches and administrators">
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      <div className="mb-4 flex justify-end">
        <Button variant="primary" onClick={() => setAdding(true)}>
          <svg
            viewBox="0 0 20 20"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" />
          </svg>
          Add coach
        </Button>
      </div>

      <Card>
        <CardHeader
          title="Accounts"
          subtitle="Coaches receive an email to set their own password"
        />

        {users === null ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            icon={<AcademicCapIcon className="size-6" />}
            title="No accounts yet"
            body="Add a coach to get started."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add coach
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((u) => {
              const isSelf = u.uid === user?.uid;
              const count = familiesFor(u.uid);
              return (
                <li
                  key={u.uid}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      "grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
                      u.role === "admin"
                        ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
                        : "bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200",
                    )}
                  >
                    {initials(u.name || u.email)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {u.name || u.email}
                      </span>
                      {u.role === "admin" && <Badge tone="brand">Admin</Badge>}
                      {u.disabled && <Badge tone="warn">Disabled</Badge>}
                      {isSelf && <Badge>You</Badge>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {u.email}
                      {u.role === "coach" &&
                        ` · ${count} ${pluralize(count, "family", "families")}`}
                      {u.lastLoginAt
                        ? ` · last in ${formatDateTime(u.lastLoginAt)}`
                        : " · has not signed in yet"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {u.role === "coach" && (
                      <Button
                        size="sm"
                        disabled={busy || u.disabled}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await impersonate({ type: "coach", id: u.uid });
                            navigate("/coach", { replace: true });
                          } catch (e) {
                            setError((e as Error).message);
                            setBusy(false);
                          }
                        }}
                      >
                        Open as coach
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await sendReset(u.email);
                          setToast(`Password setup email sent to ${u.email}`);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Resend invite
                    </Button>
                    {!isSelf && (
                      <>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await updateUser(u.uid, {
                                disabled: !u.disabled,
                              });
                              setToast(
                                u.disabled
                                  ? "Account enabled"
                                  : "Account disabled",
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {u.disabled ? "Enable" : "Disable"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 dark:text-rose-400"
                          onClick={() => setDeleting(u)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {adding && (
        <AddCoachModal
          onClose={() => setAdding(false)}
          onDone={(msg) => setToast(msg)}
          sendInvite={sendReset}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        loading={busy}
        title="Delete this account?"
        requirePhrase={deleting?.email}
        confirmLabel="Delete account"
        body={
          <>
            <p>
              <strong>{deleting?.name || deleting?.email}</strong> will lose
              access immediately.
            </p>
            {deleting && familiesFor(deleting.uid) > 0 && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                Their {familiesFor(deleting.uid)}{" "}
                {pluralize(familiesFor(deleting.uid), "family", "families")}{" "}
                will be kept and become unassigned. Reassign them to another
                coach afterwards.
              </p>
            )}
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await deleteCoach({ uid: deleting.uid });
            setToast("Account deleted");
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

function AddCoachModal({
  onClose,
  onDone,
  sendInvite,
}: {
  onClose: () => void;
  onDone: (msg: string) => void;
  /** Firebase Auth's own password-reset email doubles as the invite, so no
   *  third-party mail service is needed. */
  sendInvite: (email: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"coach" | "admin">("coach");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = !name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title="Add an account"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={invalid}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const address = email.trim().toLowerCase();
              try {
                await createCoach({ name: name.trim(), email: address, role });
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
                return;
              }
              // The account exists now; a failure to send must not read as a
              // failure to create, or an admin will try again and hit
              // "already exists".
              try {
                await sendInvite(address);
                onDone(`Invite sent to ${address}`);
              } catch {
                onDone(
                  `Account created, but the invite email to ${address} failed. Use "Resend invite".`,
                );
              }
              onClose();
            }}
          >
            Send invite
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}

        <Field label="Name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Rivera"
          />
        </Field>

        <Field
          label="Email"
          required
          hint="They will get a link to choose their own password"
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alex@example.org"
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Role
          </span>
          <div className="grid gap-2">
            {[
              {
                v: "coach" as const,
                t: "Coach",
                d: "Manages their own families, sets goals, exports their data",
              },
              {
                v: "admin" as const,
                t: "Administrator",
                d: "Everything a coach can do, plus managing coaches and the color rules",
              },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setRole(o.v)}
                className={cx(
                  "tap rounded-xl border-2 px-3 py-2.5 text-left transition-colors",
                  role === o.v
                    ? "border-brand-600 bg-brand-50 dark:bg-brand-950"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900",
                )}
              >
                <span className="block font-medium text-slate-900 dark:text-slate-100">
                  {o.t}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  {o.d}
                </span>
              </button>
            ))}
          </div>
        </div>

        <Banner tone="info">
          No password is set here. They receive an email with a secure link to
          create their own.
        </Banner>
      </div>
    </Modal>
  );
}
