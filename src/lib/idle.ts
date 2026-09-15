/**
 * Sign-out after inactivity.
 *
 * The time of the last user interaction lives in localStorage rather than
 * memory for two reasons. It is shared across tabs, so working in one tab
 * keeps the others signed in. And it survives the page closing: Firebase keeps
 * a session across restarts, so without a stored timestamp a phone left on
 * the counter overnight would reopen straight into the family's log.
 */

export const IDLE_LIMIT_MS = 10 * 60_000;

/** How long before sign-out the "Still there?" prompt appears. */
export const IDLE_WARNING_MS = 60_000;

const ACTIVITY_KEY = "lastActivityAt";
const SIGNED_OUT_KEY = "signedOutForInactivity";

export function markActive(now = Date.now()): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now));
  } catch {
    // Storage blocked (private mode): the in-tab timer still works.
  }
}

export function lastActiveAt(): number | null {
  try {
    const v = Number(localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** True once the limit has passed. No record yet means not expired. */
export function isIdleExpired(now = Date.now()): boolean {
  const t = lastActiveAt();
  return t !== null && now - t >= IDLE_LIMIT_MS;
}

/** Leave a note for the sign-in screen to explain why it is showing. */
export function noteIdleSignOut(): void {
  try {
    sessionStorage.setItem(SIGNED_OUT_KEY, "1");
  } catch {
    // Only the explanation is lost.
  }
}

/** Read and clear that note. */
export function takeIdleSignOutNote(): boolean {
  try {
    const hit = sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
    sessionStorage.removeItem(SIGNED_OUT_KEY);
    return hit;
  } catch {
    return false;
  }
}
