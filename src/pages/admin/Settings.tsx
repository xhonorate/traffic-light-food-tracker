import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { saveAppConfig, subscribeAppConfig } from "../../lib/data";
import { DEFAULT_APP_CONFIG, type AppConfig } from "../../lib/types";
import { Layout } from "../../components/Layout";
import { ADMIN_NAV } from "../../components/navs";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Toast,
} from "../../components/ui";

export default function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Seed the editable draft once. Later snapshots update the saved baseline
  // (so the dirty check stays honest) but never clobber what is being typed.
  const seeded = useRef(false);
  useEffect(
    () =>
      subscribeAppConfig(
        (c) => {
          setConfig(c);
          if (!seeded.current) {
            setDraft(c);
            seeded.current = true;
          }
        },
        (e) => setError(e.message),
      ),
    [],
  );

  const dirty =
    config !== null && JSON.stringify(config) !== JSON.stringify(draft);
  const urlInvalid =
    Boolean(draft.foodGuideUrl.trim()) &&
    !/^https?:\/\/\S+$/i.test(draft.foodGuideUrl.trim());

  return (
    <Layout nav={ADMIN_NAV} title="Settings">
      <Link
        to="/admin"
        className="tap mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <path
            d="m11 4.5-5.5 5.5 5.5 5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Overview
      </Link>

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      <Card className="mb-4">
        <CardHeader
          title="Food guide"
          subtitle="Opened by the “Help me choose” link families see when picking a color"
        />
        <div className="space-y-4 p-4">
          <Field
            label="Food guide URL"
            hint="A link to your searchable food guide PDF. Leave blank to hide the help link."
            error={
              urlInvalid
                ? "Enter a full URL starting with http:// or https://"
                : undefined
            }
          >
            <Input
              type="url"
              value={draft.foodGuideUrl}
              onChange={(e) =>
                setDraft({ ...draft, foodGuideUrl: e.target.value })
              }
              placeholder="https://example.org/food-guide.pdf"
            />
          </Field>

          {draft.foodGuideUrl.trim() && !urlInvalid && (
            <a
              href={draft.foodGuideUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tap inline-block text-sm font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300"
            >
              Test this link
            </a>
          )}

          <Field label="Program name" hint="Shown in exports and page titles">
            <Input
              value={draft.programName}
              onChange={(e) =>
                setDraft({ ...draft, programName: e.target.value })
              }
            />
          </Field>

          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={!dirty || urlInvalid || busy}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await saveAppConfig({
                    ...draft,
                    foodGuideUrl: draft.foodGuideUrl.trim(),
                  });
                  setToast("Settings saved");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save settings
            </Button>
            {dirty && (
              <Button
                onClick={() => config && setDraft(config)}
                disabled={busy}
              >
                Discard changes
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="color rules"
          subtitle="How foods are scored red, yellow or green"
        />
        <div className="p-4">
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
            The scoring rules are edited on their own screen, where you can add,
            reorder, retune and test them against real foods.
          </p>
          <Link to="/admin/rules">
            <Button>Open the rule editor</Button>
          </Link>
        </div>
      </Card>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </Layout>
  );
}
