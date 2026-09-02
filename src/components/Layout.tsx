import { type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { Button, cx } from "./ui";

/** App wordmark: the three states, in order, as the logo. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 44 16" className="h-4 w-11" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="var(--tl-green)" />
        <path d="M22 1.5 29 14.5H15z" fill="var(--tl-yellow)" />
        <path d="M36 1.2 42.3 4.8v7.4L36 15.8 29.7 12.2V4.8z" fill="var(--tl-red)" />
      </svg>
      <span className="font-semibold tracking-tight">Food Tracker</span>
    </span>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const label = { light: "Light", dark: "Dark", system: "System" }[theme];
  return (
    <button
      onClick={() => setTheme(next)}
      title={`Theme: ${label}. Click for ${next}.`}
      aria-label={`Theme: ${label}. Switch to ${next}.`}
      className="tap rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {theme === "light" && (
        <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
          <path d="M10 3.5a1 1 0 0 1 1 1V5a1 1 0 1 1-2 0v-.5a1 1 0 0 1 1-1Zm0 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 1.5a1 1 0 0 1 1 1v.5a1 1 0 1 1-2 0V16a1 1 0 0 1 1-1Zm6-5a1 1 0 0 1-1 1h-.5a1 1 0 1 1 0-2h.5a1 1 0 0 1 1 1Zm-10.5 1a1 1 0 1 0 0-2H5a1 1 0 1 0 0 2h.5Zm8.9-5.4a1 1 0 0 1 0 1.42l-.36.35a1 1 0 0 1-1.41-1.41l.35-.36a1 1 0 0 1 1.42 0ZM7.32 12.68a1 1 0 0 0-1.41 0l-.36.35a1 1 0 1 0 1.42 1.42l.35-.36a1 1 0 0 0 0-1.41Zm-1.77-7.1a1 1 0 0 1 1.42 0l.35.36a1 1 0 0 1-1.41 1.41l-.36-.35a1 1 0 0 1 0-1.42Zm7.13 7.1a1 1 0 0 1 1.41 0l.36.35a1 1 0 1 1-1.42 1.42l-.35-.36a1 1 0 0 1 0-1.41Z" />
        </svg>
      )}
      {theme === "dark" && (
        <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
          <path d="M16.3 12.6A6.8 6.8 0 0 1 7.4 3.7a6.8 6.8 0 1 0 8.9 8.9Z" />
        </svg>
      )}
      {theme === "system" && (
        <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="2.5" y="4" width="15" height="10" rx="1.5" />
          <path d="M7 16.5h6" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

/** Shown whenever an admin or coach is viewing the app as somebody else. */
export function ImpersonationBanner() {
  const { impersonating, claims, endImpersonation } = useAuth();
  const navigate = useNavigate();
  if (!impersonating) return null;

  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-3 py-2 text-center text-sm font-medium text-amber-950">
      <span className="flex items-center gap-1.5">
        <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="currentColor">
          <path d="M10 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-7 15a7 7 0 1 1 14 0 1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
        </svg>
        Viewing as {claims?.viewingAs ?? "another account"}
      </span>
      <button
        onClick={async () => { await endImpersonation(); navigate("/", { replace: true }); }}
        className="tap rounded-md bg-amber-950/15 px-2 py-0.5 underline-offset-2 hover:bg-amber-950/25"
      >
        Return to my account
      </button>
    </div>
  );
}

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

/**
 * App chrome. Navigation lives in a bottom bar on phones (thumb-reachable,
 * which matters most for the family logger) and a top bar from `sm` up.
 */
export function Layout({
  nav, title, children, headerRight,
}: {
  nav: NavItem[];
  title?: ReactNode;
  children: ReactNode;
  headerRight?: ReactNode;
}) {
  const { signOut, claims } = useAuth();
  const navigate = useNavigate();

  const roleLabel = claims?.role === "admin" ? "Administrator"
    : claims?.role === "coach" ? "Coach" : "Family";

  return (
    <div className="flex min-h-dvh flex-col">
      <ImpersonationBanner />

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Logo className="text-slate-900 dark:text-slate-100" />
          <span className="hidden text-xs text-slate-400 sm:inline dark:text-slate-500">{roleLabel}</span>

          {/* Desktop nav */}
          {nav.length > 1 && (
            <nav className="ml-4 hidden items-center gap-1 sm:flex">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cx(
                    "tap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-1">
            {headerRight}
            <ThemeToggle />
            <Button
              size="sm" variant="ghost"
              onClick={async () => { await signOut(); navigate("/login", { replace: true }); }}
            >
              Sign out
            </Button>
          </div>
        </div>
        {title && (
          <div className="mx-auto max-w-5xl px-4 pb-3">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
          </div>
        )}
      </header>

      <main className={cx("mx-auto w-full max-w-5xl flex-1 px-4 py-4", nav.length > 1 && "pb-24 sm:pb-6")}>
        {children}
      </main>

      {/* Mobile bottom nav */}
      {nav.length > 1 && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden dark:border-slate-800 dark:bg-slate-950/95"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="flex">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cx(
                  "tap flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors",
                  isActive ? "text-brand-700 dark:text-brand-300" : "text-slate-500 dark:text-slate-400",
                )}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

/** Full-page centred state, used for loading and errors. */
export function CenterPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-10">
      {children}
    </div>
  );
}

export const Icons = {
  log: (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 3.5h12v13H4z" strokeLinejoin="round" />
      <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" strokeLinecap="round" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 17h14" strokeLinecap="round" />
      <path d="M5.5 17V9M10 17V4.5M14.5 17v-5" strokeLinecap="round" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="7" r="3" />
      <path d="M2.5 17a5.5 5.5 0 0 1 11 0" strokeLinecap="round" />
      <path d="M14 5.2a3 3 0 0 1 0 5.6M15.5 17a5.6 5.6 0 0 0-1.2-3.4" strokeLinecap="round" />
    </svg>
  ),
  rules: (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" strokeLinecap="round" />
      <circle cx="7" cy="5.5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="14.5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 13.5v2a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2" strokeLinecap="round" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" strokeLinejoin="round" />
    </svg>
  ),
};
