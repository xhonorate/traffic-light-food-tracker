/** Small display helpers shared across dashboards. */

/** One decimal place, em-dash for unknown. */
export function n1(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return (Math.round(v * 10) / 10).toString();
}

/** Whole number, em-dash for unknown. */
export function n0(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return Math.round(v).toLocaleString();
}

/** Multiply a possibly-unknown nutrient by a serving count. */
export function scale(v: number | null | undefined, mult: number): number | null {
  return v === null || v === undefined || Number.isNaN(v) ? null : v * mult;
}

/** Sum nutrients, ignoring unknowns. Returns null only if nothing was known. */
export function sumKnown(values: (number | null | undefined)[]): number | null {
  let total = 0;
  let any = false;
  for (const v of values) {
    if (v !== null && v !== undefined && !Number.isNaN(v)) { total += v; any = true; }
  }
  return any ? total : null;
}

/** "1", "1.5", "0.25" -- servings render without trailing zeros. */
export function formatServings(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? singular + "s");
}

/** Title-case an ALL CAPS USDA description without mangling mixed-case ones. */
export function titleCase(s: string): string {
  if (s === s.toUpperCase()) {
    return s.toLowerCase().replace(/(^|\s|[("\-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  }
  return s;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
}
