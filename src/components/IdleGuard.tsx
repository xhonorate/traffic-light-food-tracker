import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import {
  IDLE_LIMIT_MS,
  IDLE_WARNING_MS,
  lastActiveAt,
  markActive,
  noteIdleSignOut,
} from "../lib/idle";
import { Button, Modal } from "./ui";

const ACTIVITY_EVENTS = [
  "pointerdown", "keydown", "wheel", "touchstart", "mousemove", "scroll",
] as const;

/** Skip storage writes for rapid-fire events like mousemove and scroll. */
const WRITE_THROTTLE_MS = 5_000;

/**
 * Signs the user out after `IDLE_LIMIT_MS` without interaction, with a
 * one-minute "Still there?" prompt first. Any interaction anywhere, the prompt
 * included, resets the clock.
 */
export default function IdleGuard() {
  const { user, signOut } = useAuth();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  // signOut changes identity with every auth state change; the watcher below
  // should not be torn down and rebuilt for that.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    if (!user) {
      setRemainingMs(null);
      return;
    }
    if (lastActiveAt() === null) markActive();

    let lastWrite = 0;
    let signingOut = false;

    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite < WRITE_THROTTLE_MS) return;
      lastWrite = now;
      markActive(now);
    };

    const check = () => {
      if (signingOut) return;
      const idle = Date.now() - (lastActiveAt() ?? Date.now());
      if (idle >= IDLE_LIMIT_MS) {
        signingOut = true;
        setRemainingMs(null);
        noteIdleSignOut();
        signOutRef.current().catch(() => undefined);
        return;
      }
      const left = IDLE_LIMIT_MS - idle;
      setRemainingMs(left <= IDLE_WARNING_MS ? left : null);
    };

    for (const e of ACTIVITY_EVENTS) {
      window.addEventListener(e, onActivity, { capture: true, passive: true });
    }
    // Phones throttle timers in a background tab, so check the moment the
    // app is looked at again rather than waiting for the next tick.
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 1_000);
    check();

    return () => {
      for (const e of ACTIVITY_EVENTS) {
        window.removeEventListener(e, onActivity, { capture: true });
      }
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, [user]);

  const stay = useCallback(() => {
    markActive();
    setRemainingMs(null);
  }, []);

  if (remainingMs === null) return null;
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <Modal
      open
      onClose={stay}
      title="Still there?"
      size="sm"
      footer={
        <>
          <Button onClick={() => signOutRef.current().catch(() => undefined)}>
            Sign out
          </Button>
          <Button variant="primary" onClick={stay}>
            Stay signed in
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700 dark:text-slate-300" aria-live="polite">
        Nothing has happened for a while, so you will be signed out in{" "}
        <strong className="tabular-nums">{seconds}</strong>{" "}
        {seconds === 1 ? "second" : "seconds"}.
      </p>
    </Modal>
  );
}
