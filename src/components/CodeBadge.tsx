import { useState } from "react";
import { cx } from "./ui";

/**
 * A family access code. Codes get read aloud, written on paper and typed by
 * hand, so they are shown letter-spaced in a monospace face and copy in one
 * tap.
 */
export default function CodeBadge({
  code, onCopied, className,
}: { code: string; onCopied?: () => void; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API needs a secure context and permission; fall back to a
      // hidden textarea so copy still works over plain http on a LAN.
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* give up silently */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      onClick={copy}
      title="Copy code"
      className={cx(
        "tap group inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5",
        "hover:border-brand-400 hover:bg-brand-50",
        "dark:border-slate-700 dark:bg-slate-800 dark:hover:border-brand-700 dark:hover:bg-brand-950",
        className,
      )}
    >
      <span className="font-mono text-base font-semibold tracking-[0.2em] text-slate-900 dark:text-slate-100">
        {code}
      </span>
      <span className="text-slate-400 group-hover:text-brand-600 dark:group-hover:text-brand-400" aria-hidden="true">
        {copied ? (
          <svg viewBox="0 0 20 20" className="size-4 text-brand-600 dark:text-brand-400" fill="none"
            stroke="currentColor" strokeWidth="2">
            <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="7" y="7" width="9" height="9" rx="1.5" />
            <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
          </svg>
        )}
      </span>
      <span className="sr-only">{copied ? "Copied" : "Copy code"}</span>
    </button>
  );
}
