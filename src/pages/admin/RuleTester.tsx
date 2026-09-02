import { useMemo, useState } from "react";
import { readField, sortRules } from "../../lib/rules";
import type {
  Classification, FoodFacts, NumericField, Nutrients, RuleSet,
} from "../../lib/types";
import { EMPTY_NUTRIENTS } from "../../lib/types";
import { Badge, Banner, Button, Field, Input, Modal, Select, cx } from "../../components/ui";
import { ColorMark, COLOR_WORD } from "../../components/TrafficLight";

/** Worked examples so an admin can see the effect of a change immediately. */
const PRESETS: { name: string; facts: Omit<FoodFacts, "name"> }[] = [
  {
    name: "Apple, raw",
    facts: {
      brand: "", cats: ["en:fruits"], isBeverage: false,
      per100: { kcal: 52, fat: 0.2, sat: 0, sugars: 10.4, added: 0, protein: 0.3 },
      serv: { kcal: 95, fat: 0.4, sat: 0, sugars: 19, added: 0, protein: 0.5 },
      servingLabel: "1 medium (182g)", source: "preset", code: "",
    },
  },
  {
    name: "Chocolate chip cookie",
    facts: {
      brand: "", cats: ["en:sugary-snacks", "en:biscuits"], isBeverage: false,
      per100: { kcal: 488, fat: 24, sat: 8, sugars: 36, added: 30, protein: 5 },
      serv: { kcal: 146, fat: 7.2, sat: 2.4, sugars: 10.8, added: 9, protein: 1.5 },
      servingLabel: "1 cookie (30g)", source: "preset", code: "",
    },
  },
  {
    name: "Peanut butter",
    facts: {
      brand: "", cats: ["en:nut-butters"], isBeverage: false,
      per100: { kcal: 588, fat: 50, sat: 10, sugars: 9, added: 1, protein: 25 },
      serv: { kcal: 188, fat: 16, sat: 3.2, sugars: 2.9, added: 0.3, protein: 8 },
      servingLabel: "2 tbsp (32g)", source: "preset", code: "",
    },
  },
  {
    name: "Cola",
    facts: {
      brand: "", cats: ["en:beverages", "en:sodas"], isBeverage: true,
      per100: { kcal: 39, fat: 0, sat: 0, sugars: 10.6, added: 10.6, protein: 0 },
      serv: { kcal: 139, fat: 0, sat: 0, sugars: 37.6, added: 37.6, protein: 0 },
      servingLabel: "1 can (355ml)", source: "preset", code: "",
    },
  },
  {
    name: "Plain nonfat yogurt",
    facts: {
      brand: "", cats: ["en:dairies", "en:yogurts"], isBeverage: false,
      per100: { kcal: 59, fat: 0.4, sat: 0.1, sugars: 3.2, added: 0, protein: 10 },
      serv: { kcal: 100, fat: 0.7, sat: 0.2, sugars: 5.4, added: 0, protein: 17 },
      servingLabel: "1 cup (170g)", source: "preset", code: "",
    },
  },
];

const PER100_FIELDS: { key: keyof Nutrients; label: string }[] = [
  { key: "kcal", label: "Calories" },
  { key: "fat", label: "Total fat" },
  { key: "sat", label: "Saturated fat" },
  { key: "sugars", label: "Total sugars" },
  { key: "added", label: "Added sugar" },
  { key: "protein", label: "Protein" },
];

/**
 * Lets an admin run a food through the *unsaved* draft rules and see exactly
 * which rule fired and why. Tuning thresholds blind is how a protocol quietly
 * breaks, so this is the safety net for every edit on the rules screen.
 */
export default function RuleTester({
  ruleSet, onClose, classify,
}: {
  ruleSet: RuleSet;
  onClose: () => void;
  classify: (f: FoodFacts, r: RuleSet) => Classification;
}) {
  const [name, setName] = useState("Test food");
  const [cats, setCats] = useState("");
  const [isBeverage, setIsBeverage] = useState(false);
  const [per100, setPer100] = useState<Nutrients>({ ...EMPTY_NUTRIENTS });
  const [servingKnown, setServingKnown] = useState(false);
  const [serv, setServ] = useState<Nutrients>({ ...EMPTY_NUTRIENTS });

  const facts = useMemo<FoodFacts>(() => ({
    name: name || "Test food",
    brand: "",
    cats: cats.split(",").map((s) => s.trim()).filter(Boolean),
    isBeverage,
    per100,
    serv: servingKnown ? serv : { ...EMPTY_NUTRIENTS },
    servingLabel: "1 serving",
    source: "rule tester",
    code: "",
  }), [name, cats, isBeverage, per100, serv, servingKnown]);

  const verdict = useMemo(() => classify(facts, ruleSet), [facts, ruleSet, classify]);

  /** Show every rule that would fire, not just the decisive one, so an admin
   *  can spot rules shadowed by an earlier match. */
  const trace = useMemo(() => {
    const results: { id: string; label: string; fired: boolean; color: string }[] = [];
    for (const rule of sortRules(ruleSet.rules)) {
      if (!rule.enabled) continue;
      if (rule.scope === "food" && facts.isBeverage) continue;
      if (rule.scope === "beverage" && !facts.isBeverage) continue;
      const single = classify(facts, { ...ruleSet, rules: [rule] });
      results.push({
        id: rule.id,
        label: rule.label,
        fired: single.decidedBy === rule.id,
        color: rule.color,
      });
    }
    return results;
  }, [facts, ruleSet, classify]);

  const firedCount = trace.filter((t) => t.fired).length;

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setName(p.name);
    setCats(p.facts.cats.join(", "));
    setIsBeverage(p.facts.isBeverage);
    setPer100(p.facts.per100);
    setServ(p.facts.serv);
    setServingKnown(p.facts.serv.kcal !== null);
  };

  const setNutrient = (
    which: "per100" | "serv", key: keyof Nutrients, raw: string,
  ) => {
    const v = raw.trim() === "" ? null : Number(raw);
    const next = Number.isNaN(v as number) ? null : v;
    if (which === "per100") setPer100((p) => ({ ...p, [key]: next }));
    else setServ((p) => ({ ...p, [key]: next }));
  };

  return (
    <Modal open onClose={onClose} title="Test a food against these rules" size="lg">
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Start from an example
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                className="tap rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-brand-700 dark:hover:bg-brand-950"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Verdict */}
        <div
          className="rounded-xl border-2 p-4"
          style={{
            borderColor: `var(--tl-${verdict.color})`,
            backgroundColor: `var(--tl-${verdict.color}-soft)`,
          }}
        >
          <div className="flex items-center gap-3">
            <ColorMark color={verdict.color} size={32} />
            <div className="min-w-0">
              <p className="text-lg font-semibold" style={{ color: `var(--tl-${verdict.color})` }}>
                {COLOR_WORD[verdict.color]}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {verdict.decidedBy
                  ? `Decided by rule: ${verdict.decidedBy}`
                  : "No rule matched — the default applied"}
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-slate-700 dark:text-slate-200">
            {verdict.reasons.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Food name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Food or drink">
            <Select value={isBeverage ? "drink" : "food"} onChange={(e) => setIsBeverage(e.target.value === "drink")}>
              <option value="food">Food</option>
              <option value="drink">Drink</option>
            </Select>
          </Field>
        </div>

        <Field label="Category tags" hint="Comma separated, e.g. en:fruits, en:dried">
          <Input value={cats} onChange={(e) => setCats(e.target.value)} placeholder="en:sugary-snacks, en:biscuits" />
        </Field>

        <fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
            Per 100{isBeverage ? "ml" : "g"}
          </legend>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            Leave a box empty to mark that nutrient unknown — that is what triggers the fallback rules.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PER100_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input
                  type="number" step="0.1" inputMode="decimal"
                  value={per100[f.key] ?? ""}
                  onChange={(e) => setNutrient("per100", f.key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
            Per serving
          </legend>
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox" checked={servingKnown}
              onChange={(e) => setServingKnown(e.target.checked)}
              className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Serving figures are known
          </label>
          {servingKnown && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PER100_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <Input
                    type="number" step="0.1" inputMode="decimal"
                    value={serv[f.key] ?? ""}
                    onChange={(e) => setNutrient("serv", f.key, e.target.value)}
                  />
                </Field>
              ))}
            </div>
          )}
        </fieldset>

        {/* Which rules fired */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Rules that match this food
            </span>
            <Badge tone={firedCount ? "brand" : "neutral"}>
              {firedCount} of {trace.length}
            </Badge>
          </div>
          {firedCount === 0 ? (
            <Banner tone="info">
              No rule matches, so this food falls through to the default
              ({COLOR_WORD[ruleSet.defaultColor].toLowerCase()}).
            </Banner>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {trace.filter((t) => t.fired).map((t, i) => (
                <li key={t.id} className={cx(
                  "flex items-center gap-2.5 px-3 py-2 text-sm",
                  i === 0 && "bg-slate-50 dark:bg-slate-800/60",
                )}>
                  <ColorMark color={t.color as "green" | "yellow" | "red"} size={14} />
                  <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-200">{t.label}</span>
                  {i === 0
                    ? <Badge tone="brand">decides</Badge>
                    : <span className="shrink-0 text-xs text-slate-400">also matches</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* A quick readout of what the engine actually sees */}
        <details className="text-xs text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer underline underline-offset-2">
            Values the rules are reading
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono sm:grid-cols-3">
            {([
              "kcal_100", "fat_100", "sat_100", "sugars_100", "added_100", "protein_100",
              "kcal_serv", "fat_serv", "sat_serv", "sugars_serv", "added_serv", "protein_serv",
            ] as NumericField[]).map((f) => {
              const v = readField(facts, f);
              return (
                <div key={f} className="flex justify-between gap-2">
                  <span>{f}</span>
                  <span className={cx(v === null && "text-slate-400 dark:text-slate-600")}>
                    {v === null ? "unknown" : v}
                  </span>
                </div>
              );
            })}
          </div>
        </details>

        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
