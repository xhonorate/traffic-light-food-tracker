import { useRef, useState, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import { useAuth } from "../lib/auth";
import { CenterPage, Logo } from "../components/Layout";
import { Banner, Button, Card, Field, Input, cx } from "../components/ui";

const CODE_LENGTH = 6;

/**
 * Six single-character boxes. Families are given a short code on paper, and
 * this makes it obvious how many characters to expect, keeps the input in
 * uppercase, and supports pasting the whole code at once.
 */
function CodeInput({
  value, onChange, onComplete, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = value.padEnd(CODE_LENGTH, " ").slice(0, CODE_LENGTH).split("");

  const setChar = (i: number, ch: string) => {
    const next = value.padEnd(CODE_LENGTH, " ").split("");
    next[i] = ch;
    const joined = next.join("").replace(/\s+$/, "");
    onChange(joined);
    return joined;
  };

  const handleChange = (i: number, raw: string) => {
    const ch = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(-1);
    if (!ch) return;
    const joined = setChar(i, ch);
    if (i < CODE_LENGTH - 1) refs.current[i + 1]?.focus();
    if (joined.trim().length === CODE_LENGTH) onComplete?.(joined);
  };

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (chars[i].trim()) setChar(i, " ");
      else if (i > 0) { setChar(i - 1, " "); refs.current[i - 1]?.focus(); }
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) refs.current[i + 1]?.focus();
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, CODE_LENGTH);
    if (!text) return;
    onChange(text);
    refs.current[Math.min(text.length, CODE_LENGTH - 1)]?.focus();
    if (text.length === CODE_LENGTH) onComplete?.(text);
  };

  return (
    <div className="flex justify-between gap-1.5" onPaste={handlePaste}>
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={ch.trim()}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoCorrect="off"
          spellCheck={false}
          maxLength={1}
          aria-label={`Code character ${i + 1}`}
          className={cx(
            "h-14 w-full min-w-0 rounded-xl border-2 border-slate-300 bg-white text-center",
            "text-xl font-semibold uppercase text-slate-900 transition-colors",
            "focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none",
            "disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
            "dark:disabled:bg-slate-800",
          )}
        />
      ))}
    </div>
  );
}

export default function Login() {
  const { signInFamilyCode, signInEmail, signInGoogle, sendReset, error } = useAuth();
  const [mode, setMode] = useState<"family" | "staff">("family");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submitCode = async (value: string) => {
    if (value.trim().length !== CODE_LENGTH || busy) return;
    setBusy(true);
    try { await signInFamilyCode(value); } catch { /* surfaced via error */ }
    finally { setBusy(false); }
  };

  const submitStaff = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try { await signInEmail(email, password); } catch { /* surfaced via error */ }
    finally { setBusy(false); }
  };

  const doReset = async () => {
    if (!email.trim()) { setNotice("Enter your email address first, then choose Forgot password."); return; }
    setBusy(true);
    try {
      await sendReset(email);
      setNotice(`If an account exists for ${email}, a password reset link is on its way.`);
    } catch { /* surfaced via error */ }
    finally { setBusy(false); }
  };

  return (
    <CenterPage>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo className="justify-center text-lg text-slate-900 dark:text-slate-100" />
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Traffic-light food logging
          </p>
        </div>

        <Card className="p-5">
          {/* Two genuinely different doors, so make the choice explicit. */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {(["family", "staff"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setNotice(null); }}
                className={cx(
                  "tap rounded-lg py-2 text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200",
                )}
              >
                {m === "family" ? "Family" : "Coach or admin"}
              </button>
            ))}
          </div>

          {mode === "family" ? (
            <div className="space-y-4">
              <div>
                <h1 className="font-semibold text-slate-900 dark:text-slate-100">Enter your family code</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  The {CODE_LENGTH}-character code your coach gave you. No password needed.
                </p>
              </div>

              <CodeInput value={code} onChange={setCode} onComplete={submitCode} disabled={busy} />

              {error && <Banner tone="error">{error}</Banner>}

              <Button
                variant="primary" size="lg" full loading={busy}
                disabled={code.trim().length !== CODE_LENGTH}
                onClick={() => submitCode(code)}
              >
                Open our food log
              </Button>

              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                Lost your code? Ask your coach to send it again.
              </p>
            </div>
          ) : (
            <form onSubmit={submitStaff} className="space-y-4">
              <div>
                <h1 className="font-semibold text-slate-900 dark:text-slate-100">Sign in</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  For coaches and program administrators.
                </p>
              </div>

              <Field label="Email">
                <Input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email" required placeholder="you@example.org"
                />
              </Field>

              <Field label="Password">
                <Input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" required
                />
              </Field>

              {error && <Banner tone="error">{error}</Banner>}
              {notice && <Banner tone="success">{notice}</Banner>}

              <Button type="submit" variant="primary" size="lg" full loading={busy}>
                Sign in
              </Button>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                <span className="text-xs text-slate-400">or</span>
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              </div>

              <Button
                type="button" size="lg" full disabled={busy}
                onClick={() => signInGoogle().catch(() => { /* surfaced via error */ })}
              >
                <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
                  <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6Z" />
                  <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z" />
                  <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z" />
                  <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.3A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z" />
                </svg>
                Continue with Google
              </Button>

              <button
                type="button" onClick={doReset} disabled={busy}
                className="tap w-full text-center text-sm font-medium text-brand-700 underline underline-offset-2 disabled:opacity-60 dark:text-brand-300"
              >
                Forgot password?
              </button>
            </form>
          )}
        </Card>
      </div>
    </CenterPage>
  );
}
