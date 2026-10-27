import { detectGroup, type FoodGroup } from "./foodGroups";
import type { Classification, EntryColor, FoodFacts, RuleSet } from "./types";

/**
 * The traffic-light engine: Epstein, The Food & Activity Reference Guide
 * (2012), as the client's prototype implements it. Three questions:
 *
 *  1. Which food group? (detectGroup, from the name, USDA category and tags)
 *  2. How many calories in the guide's serving for that group? Often not the
 *     package's serving: cheese is judged at 1 oz whatever the label says.
 *  3. Which side of the group's line? Only vegetables have a green line.
 *
 * Juice, dried fruit and the fats/oils/sweets group are red whatever the
 * calories; water, plain tea/coffee and seasonings have no color; cold cereal
 * is also red above 25% of calories from sugar. Combination foods get no
 * verdict: the guide gives them no calorie range, so the family's own choice
 * stands. This mirrors classify() in the prototype, except that it abstains
 * (color `null`) where the prototype asks the clinician to decide or falls
 * back to yellow: an undetected group, a combination food, or no calories.
 * The app's verdict only ever questions the family's choice, and a guess is
 * no grounds to question it.
 */

const fmt0 = (v: number) => String(Math.round(v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function classify(food: FoodFacts, ruleSet: RuleSet, groupOverride?: FoodGroup | null): Classification {
  const det = detectGroup(food);
  const group = groupOverride || det.group;
  const g = group ? ruleSet.groups[group] : null;
  const reasons: string[] = [];
  const p = food.per100, s = food.serv;
  const kcal100 = num(p.kcal), sug100 = num(p.sugars);
  let servG: number | null = null, kcalServ: number | null = null;
  const done = (color: EntryColor | null): Classification => ({ color, group: group ?? null, servG, kcalServ, reasons });
  // The detected reason and serving apply only to the detected group.
  const own = det.group === group;

  if (!group || !g) {
    reasons.push("Food group not detected, so the guide gives no color for it here");
    return done(null);
  }
  if (g.kind === "free") {
    reasons.push(own ? det.why : `${g.label}: no Traffic Light color`);
    return done("none");
  }
  if (g.kind === "combo") {
    reasons.push(own ? det.why : g.label);
    reasons.push("The guide gives combination foods no calorie range (p.8): it is red if it holds a full serving of any red food");
    return done(null);
  }
  if (g.kind === "alwaysRed") {
    reasons.push(own ? det.why : `${g.label}: always red in the guide`);
    // The color never depends on the calories here, but they are still shown.
    servG = (own && det.servG) || g.servG || null;
    if (kcal100 != null && servG) kcalServ = kcal100 * servG / 100;
    else if (num(s.kcal) != null) kcalServ = num(s.kcal);
    if (kcalServ != null) reasons.push(`${fmt0(kcalServ)} cal per serving (about ${servG} g, ${g.serv})`);
    return done("red");
  }

  reasons.push(own && det.why ? det.why : g.label);
  servG = (own && det.servG) || g.servG;
  let basis = "";
  if (kcal100 != null && servG) {
    kcalServ = kcal100 * servG / 100;
    basis = `${fmt0(kcalServ)} cal per guide serving (about ${servG} g${servG === g.servG ? `, ${g.serv}` : ""})`;
  } else if (num(s.kcal) != null) {
    kcalServ = num(s.kcal);
    basis = `${fmt0(kcalServ!)} cal per serving as entered (the guide's serving is ${g.serv})`;
  }
  if (kcalServ == null || g.yellow == null) {
    reasons.push(`No calorie data, so it cannot be placed in the ${g.label.toLowerCase()} range`);
    return done(null);
  }

  // The guide's lines are whole calories, and labels round to whole
  // calories, so 120.4 is 120 and yellow.
  const kc = Math.round(kcalServ);
  let color: EntryColor;
  if (g.green != null && kc <= g.green) color = "green";
  else if (kc <= g.yellow) color = "yellow";
  else color = "red";
  reasons.push(`${basis} → ${g.green != null ? `green ≤ ${g.green}, ` : ""}yellow ≤ ${g.yellow}, red > ${g.yellow}`);

  if (g.sugarPct != null) {
    const kB = kcal100 != null ? kcal100 : num(s.kcal);
    const sB = kcal100 != null ? sug100 : num(s.sugars);
    if (kB != null && sB != null && kB > 0) {
      const pct = sB * 4 / kB * 100;
      if (pct > g.sugarPct) {
        color = "red";
        reasons.push(`${fmt0(pct)}% of calories from sugar: red above ${g.sugarPct}% (the guide's cereal rule)`);
      } else reasons.push(`${fmt0(pct)}% of calories from sugar (${g.sugarPct}% allowed)`);
    } else reasons.push("Sugar rule not checked: sugars unknown");
  }
  return done(color);
}
