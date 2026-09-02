import { CenterPage, Logo } from "../components/Layout";
import { Banner, Card } from "../components/ui";

/** Shown when the Firebase web config has not been supplied. Without this the
 *  SDK throws an opaque error at first use, which is a poor first-run. */
export default function SetupNeeded() {
  return (
    <CenterPage>
      <Card className="w-full max-w-lg p-6">
        <Logo className="text-slate-900 dark:text-slate-100" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Firebase is not configured yet
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          The app needs your Firebase web credentials before it can sign anyone in.
        </p>

        <ol className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-300">
          <li className="flex gap-2">
            <span className="font-semibold text-brand-700 dark:text-brand-300">1.</span>
            Copy <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">.env.example</code> to{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">.env.local</code>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-brand-700 dark:text-brand-300">2.</span>
            Paste in the web app config from the Firebase console, under
            Project settings &rarr; Your apps
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-brand-700 dark:text-brand-300">3.</span>
            Restart the dev server
          </li>
        </ol>

        <Banner tone="info" className="mt-4">
          Full walkthrough, including the one-time administrator bootstrap, is in{" "}
          <code className="text-xs">SETUP.md</code>.
        </Banner>
      </Card>
    </CenterPage>
  );
}
