import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "tlft-theme";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Read and apply the stored preference before React paints, so there is no
 *  light-mode flash. Called from main.tsx. */
export function initTheme(): void {
  let stored: ThemeChoice = "system";
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") stored = v;
  } catch {
    // Private browsing can throw on access; the default is fine.
  }
  apply(stored);
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "light" || v === "dark" || v === "system") return v;
    } catch { /* ignore */ }
    return "system";
  });

  useEffect(() => {
    apply(choice);
    try { localStorage.setItem(KEY, choice); } catch { /* ignore */ }
  }, [choice]);

  // Follow the OS while the preference is "system".
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  return [choice, useCallback((c: ThemeChoice) => setChoice(c), [])];
}
