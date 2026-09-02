import type { TrafficColor } from "../lib/types";
import { cx } from "./ui";

/**
 * Traffic-light presentation.
 *
 * color alone never carries meaning here: every mark pairs the hue with a
 * distinct shape (circle / triangle / hexagon) and, wherever there is room,
 * the written word. That is what makes the palette safe for red-green color
 * blindness -- roughly 1 in 12 men -- in an app whose entire vocabulary is
 * red versus green.
 */

export const COLOR_ORDER: TrafficColor[] = ["green", "yellow", "red"];

export const COLOR_WORD: Record<TrafficColor, string> = {
  green: "Green",
  yellow: "Yellow",
  red: "Red",
};

export const COLOR_VAR: Record<TrafficColor, string> = {
  green: "var(--tl-green)",
  yellow: "var(--tl-yellow)",
  red: "var(--tl-red)",
};

export const COLOR_SOFT_VAR: Record<TrafficColor, string> = {
  green: "var(--tl-green-soft)",
  yellow: "var(--tl-yellow-soft)",
  red: "var(--tl-red-soft)",
};

/** Plain-language guidance shown next to each choice. */
export const COLOR_BLURB: Record<TrafficColor, string> = {
  green: "Go foods — eat freely. Most fruits and vegetables.",
  yellow: "Slow foods — everyday staples in sensible portions.",
  red: "Whoa foods — high in added sugar or fat. These use your weekly budget.",
};

/**
 * The shape channel. Distinct silhouettes, not just distinct fills, so the
 * three states stay separable in greyscale and for CVD readers.
 */
export function ColorMark({
  color,
  size = 16,
  className,
  withRing,
}: {
  color: TrafficColor;
  size?: number;
  className?: string;
  withRing?: boolean;
}) {
  const fill = COLOR_VAR[color];
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      className={cx("shrink-0", className)}
      role="img"
      aria-label={COLOR_WORD[color]}
    >
      {withRing && (
        <circle
          cx="12"
          cy="12"
          r="11.25"
          fill="none"
          stroke={fill}
          strokeWidth="1.5"
          opacity="0.35"
        />
      )}
      {color === "green" && <circle cx="12" cy="12" r="8" fill={fill} />}
      {color === "yellow" && <path d="M12 3.5 21 19.5H3z" fill={fill} />}
      {color === "red" && (
        <path d="M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3z" fill={fill} />
      )}
    </svg>
  );
}

/** Compact labelled chip: shape + word. Used in logs and summaries. */
export function ColorChip({
  color,
  size = "md",
  className,
}: {
  color: TrafficColor;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className,
      )}
      style={{
        color: COLOR_VAR[color],
        backgroundColor: COLOR_SOFT_VAR[color],
        borderColor: COLOR_VAR[color],
      }}
    >
      <ColorMark color={color} size={size === "sm" ? 12 : 14} />
      {COLOR_WORD[color]}
    </span>
  );
}

/**
 * The family-facing color picker. Requirement 11 option 2: the family commits
 * to a guess first, then the app reacts -- so this is deliberately a plain
 * choice with no hint of the "right" answer until after they pick.
 */
export function ColorPicker({
  value,
  onChange,
  disabled,
  showBlurbs = true,
}: {
  value: TrafficColor | null;
  onChange: (c: TrafficColor) => void;
  disabled?: boolean;
  showBlurbs?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="What color is this food?"
      className="grid gap-2"
    >
      {COLOR_ORDER.map((c) => {
        const selected = value === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(c)}
            className={cx(
              "tap flex items-center gap-3 rounded-xl border-2 px-3 py-3 text-left transition-all",
              "disabled:opacity-60",
              selected
                ? "shadow-sm"
                : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600",
            )}
            style={
              selected
                ? {
                    borderColor: COLOR_VAR[c],
                    backgroundColor: COLOR_SOFT_VAR[c],
                  }
                : undefined
            }
          >
            <ColorMark color={c} size={26} />
            <span className="min-w-0 flex-1">
              <span
                className="block font-semibold"
                style={{ color: selected ? COLOR_VAR[c] : undefined }}
              >
                {COLOR_WORD[c]}
              </span>
              {showBlurbs && (
                <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-slate-400">
                  {COLOR_BLURB[c]}
                </span>
              )}
            </span>
            <span
              aria-hidden="true"
              className={cx(
                "grid size-5 shrink-0 place-items-center rounded-full border-2",
                selected ? "" : "border-slate-300 dark:border-slate-600",
              )}
              style={
                selected
                  ? { borderColor: COLOR_VAR[c], backgroundColor: COLOR_VAR[c] }
                  : undefined
              }
            >
              {selected && (
                <svg viewBox="0 0 12 12" className="size-3 text-white">
                  <path
                    d="m2.5 6.2 2.3 2.3 4.7-4.9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Legend used above charts. Always present -- three series means identity
 *  must never rest on color alone. */
export function ColorLegend({ className }: { className?: string }) {
  return (
    <ul
      className={cx("flex flex-wrap items-center gap-x-4 gap-y-1", className)}
    >
      {COLOR_ORDER.map((c) => (
        <li
          key={c}
          className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"
        >
          <ColorMark color={c} size={12} />
          {COLOR_WORD[c]}
        </li>
      ))}
    </ul>
  );
}

/**
 * "Help me choose" (requirement 10.1). Opens the program's searchable food
 * guide in a new tab. The URL is set by an admin -- the guide is the
 * program's own document, not something bundled with the app -- so when it is
 * missing the button explains that rather than opening a dead link.
 */
export function ColorWordHelp({ foodGuideUrl }: { foodGuideUrl: string }) {
  const has = Boolean(foodGuideUrl?.trim());
  if (!has) {
    return (
      <span
        className="text-xs text-slate-400 dark:text-slate-500"
        title="An administrator has not added the food guide link yet"
      >
        Guide unavailable
      </span>
    );
  }
  return (
    <a
      href={foodGuideUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="tap inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950"
    >
      <svg
        viewBox="0 0 20 20"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.25" />
        <path
          d="M8.1 8a2 2 0 1 1 2.5 2c-.4.2-.6.6-.6 1v.4"
          strokeLinecap="round"
        />
        <circle cx="10" cy="14" r="0.85" fill="currentColor" stroke="none" />
      </svg>
      Help me choose
    </a>
  );
}
