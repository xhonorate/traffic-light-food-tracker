import {
  forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes,
  type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
} from "react";

/** Tiny classnames joiner -- avoids pulling in a dependency for this. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm disabled:bg-brand-300 dark:disabled:bg-brand-900",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 active:bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-700",
  ghost: "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
  danger: "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm disabled:bg-rose-300",
  subtle: "bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm rounded-lg gap-1.5",
  md: "h-11 px-4 text-sm rounded-xl gap-2",
  lg: "h-13 px-5 text-base rounded-xl gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, full, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "tap inline-flex items-center justify-center font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-70",
        BUTTON_VARIANTS[variant], BUTTON_SIZES[size], full && "w-full", className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "size-5")} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

const FIELD_BASE =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 " +
  "placeholder:text-slate-400 transition-colors " +
  "focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none " +
  "disabled:bg-slate-100 disabled:text-slate-500 " +
  "dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 " +
  "dark:disabled:bg-slate-800";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(FIELD_BASE, className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx(FIELD_BASE, "appearance-none pr-9 bg-no-repeat", className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-width='1.75' d='m6 8 4 4 4-4'/%3E%3C/svg%3E\")",
          backgroundPosition: "right 0.6rem center",
          backgroundSize: "1.25rem",
        }}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

export function Field({
  label, hint, error, required, children, className,
}: {
  label: string; hint?: string; error?: string; required?: boolean;
  children: ReactNode; className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="text-rose-500" aria-hidden="true">*</span>}
      </span>
      {children}
      {error
        ? <span className="mt-1 block text-sm text-rose-600 dark:text-rose-400">{error}</span>
        : hint
          ? <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
          : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children, className, as: As = "div",
}: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return (
    <As className={cx(
      "rounded-2xl border border-slate-200 bg-white shadow-sm",
      "dark:border-slate-800 dark:bg-slate-900", className,
    )}>
      {children}
    </As>
  );
}

export function CardHeader({
  title, subtitle, action, className,
}: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800", className)}>
      <div className="min-w-0">
        <h2 className="truncate font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon, title, body, action,
}: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && (
        <div
          className="mb-3 grid size-12 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <p className="font-medium text-slate-800 dark:text-slate-200">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Banner({
  tone = "info", children, className,
}: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode; className?: string }) {
  const tones = {
    info: "bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950 dark:text-sky-100 dark:border-sky-900",
    warn: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-900",
    error: "bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950 dark:text-rose-100 dark:border-rose-900",
    success: "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-900",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"}
      className={cx("rounded-xl border px-3.5 py-2.5 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open, onClose, title, children, footer, size = "md",
}: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode;
  footer?: ReactNode; size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    // Prevent the page behind the sheet from scrolling on mobile.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cx(
          "relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl outline-none",
          "sm:rounded-2xl dark:bg-slate-900", widths[size],
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button onClick={onClose} aria-label="Close"
            className="tap -mr-1 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Badge({
  children, className, tone = "neutral",
}: { children: ReactNode; className?: string; tone?: "neutral" | "brand" | "warn" | "danger" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    brand: "bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200",
    warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    danger: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  };
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Stat({
  label, value, sub, className,
}: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900", className)}>
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800", className)} />;
}

/** Confirm dialog that requires typing a phrase, for destructive actions. */
export function ConfirmDialog({
  open, onClose, onConfirm, title, body, confirmLabel = "Delete", requirePhrase, loading,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string;
  body: ReactNode; confirmLabel?: string; requirePhrase?: string; loading?: boolean;
}) {
  const [ok, setOk] = useState(!requirePhrase);

  // Re-arm the confirm gate each time the dialog opens.
  useEffect(() => { setOk(!requirePhrase); }, [open, requirePhrase]);

  return (
    <Modal
      open={open} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={!ok} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
        <div>{body}</div>
        {requirePhrase && (
          <Field label={`Type “${requirePhrase}” to confirm`}>
            <Input autoComplete="off" autoFocus
              onChange={(e) => setOk(e.target.value.trim() === requirePhrase)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** Transient confirmation, anchored above the mobile nav bar. */
export function Toast({
  message, tone = "success", onDone, duration = 3200,
}: {
  message: ReactNode;
  tone?: "success" | "info";
  onDone: () => void;
  duration?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [onDone, duration, message]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "fixed inset-x-4 bottom-20 z-50 mx-auto max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-lg",
        "sm:bottom-6",
        tone === "success"
          ? "bg-emerald-600 text-white"
          : "bg-slate-800 text-white dark:bg-slate-700",
      )}
    >
      {message}
    </div>
  );
}
