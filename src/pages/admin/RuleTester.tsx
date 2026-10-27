import { useMemo, useState } from "react";
import { FOOD_GROUPS, type FoodGroup } from "../../lib/foodGroups";
import type { Classification, FoodFacts, RuleSet } from "../../lib/types";
import { EMPTY_NUTRIENTS } from "../../lib/types";
import { Banner, Button, Field, Input, Modal, Select } from "../../components/ui";
import { ColorMark, COLOR_WORD } from "../../components/TrafficLight";
import CategoryInput from "../../components/CategoryInput";

interface Example {
  name: string;
  usdaCategory: string;
  cats: string[];
  isBeverage: boolean;
  kcal100: number;
  sugars100: number;
}

/** Worked examples, the first two from the client's own walkthrough. */
const PRESETS: Example[] = [
  { name: "Cheese, Cheddar", usdaCategory: "Dairy and Egg Products", cats: [], isBeverage: false, kcal100: 403, sugars100: 0.5 },
  { name: "Carrots, Raw", usdaCategory: "Vegetables and Vegetable Products", cats: ["vegetables"], isBeverage: false, kcal100: 41, sugars100: 4.7 },
  { name: "Apples, Raw, With Skin", usdaCategory: "Fruits and Fruit Juices", cats: ["fruits"], isBeverage: false, kcal100: 52, sugars100: 10.4 },
  { name: "Cereals Ready-To-Eat, Frosted Flakes", usdaCategory: "Breakfast Cereals", cats: ["breakfast-cereals"], isBeverage: false, kcal100: 375, sugars100: 35 },
  { name: "Cola", usdaCategory: "Beverages", cats: ["beverages", "sodas"], isBeverage: true, kcal100: 39, sugars100: 10.6 },
  { name: "Water, Tap", usdaCategory: "Beverages", cats: ["beverages", "waters"], isBeverage: true, kcal100: 0, sugars100: 0 },
  { name: "Pizza, Pepperoni", usdaCategory: "Fast Foods", cats: [], isBeverage: false, kcal100: 270, sugars100: 3.6 },
];

const numOrNull = (raw: string): number | null => {
  const v = raw.trim() === "" ? null : Number(raw);
  return v === null || Number.isNaN(v) ? null : v;
};

/**
 * Lets an admin run a food through the *unsaved* draft table and see each
 * step: which group, which serving, how many calories, which line. Tuning
 * figures blind is how a protocol quietly breaks, so this is the safety net
 * for every edit on the rules screen.
 */
export default function RuleTester({
  ruleSet, onClose, classify,
}: {
  ruleSet: RuleSet;
  onClose: () => void;
  classify: (f: FoodFacts, r: RuleSet, group?: FoodGroup | null) => Classification;
}) {
  const [name, setName] = useState("Cheese, Cheddar");
  const [usdaCategory, setUsdaCategory] = useState("Dairy and Egg Products");
  const [cats, setCats] = useState<string[]>([]);
  const [isBeverage, setIsBeverage] = useState(false);
  const [kcal100, setKcal100] = useState<number | null>(403);
  const [sugars100, setSugars100] = useState<number | null>(0.5);
  const [labelG, setLabelG] = useState<number | null>(null);
  const [sweetened, setSweetened] = useState(false);
  const [override, setOverride] = useState<FoodGroup | "">("");

  const facts = useMemo<FoodFacts>(() => ({
    name: name || "Test food",
    brand: "",
    cats,
    isBeverage,
    per100: { ...EMPTY_NUTRIENTS, kcal: kcal100, sugars: sugars100 },
    serv: { ...EMPTY_NUTRIENTS },
    servingLabel: "",
    source: "rule tester",
    code: "",
    usdaCategory,
    sweetened,
    servQtyG: labelG,
  }), [name, cats, isBeverage, kcal100, sugars100, usdaCategory, sweetened, labelG]);

  const detected = useMemo(() => classify(facts, ruleSet), [facts, ruleSet, classify]);
  const verdict = useMemo(
    () => (override ? classify(facts, ruleSet, override) : detected),
    [facts, ruleSet, classify, override, detected],
  );
  const g = verdict.group ? ruleSet.groups[verdict.group] : null;

  const applyPreset = (p: Example) => {
    setName(p.name);
    setUsdaCategory(p.usdaCategory);
    setCats(p.cats);
    setIsBeverage(p.isBeverage);
    setKcal100(p.kcal100);
    setSugars100(p.sugars100);
    setLabelG(null);
    setSweetened(false);
    setOverride("");
  };

  const line = !g ? "–"
    : g.kind === "alwaysRed" ? "always red"
    : g.kind === "free" ? "no color"
    : g.kind === "combo" ? "no range"
    : `${g.green != null ? `green to ${g.green}, ` : ""}yellow to ${g.yellow}`;

  const steps: [string, string][] = [
    ["1. Group", g ? g.label : "Not detected"],
    ["2. Serving", g && verdict.servG ? `about ${verdict.servG} g${verdict.servG === g.servG ? `, ${g.serv}` : ""}` : "–"],
    ["Calories in it", verdict.kcalServ != null ? String(Math.round(verdict.kcalServ)) : "–"],
    ["3. The line", line],
  ];

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

        {/* Verdict, step by step */}
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {steps.map(([k, v]) => (
              <div key={k} className="flex gap-3 px-3 py-2">
                <dt className="w-32 shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="min-w-0 font-medium text-slate-900 dark:text-slate-100">{v}</dd>
              </div>
            ))}
            <div
              className="flex items-center gap-3 px-3 py-2.5"
              style={verdict.color ? { backgroundColor: `var(--tl-${verdict.color}-soft)` } : undefined}
            >
              <dt className="w-32 shrink-0 text-slate-500 dark:text-slate-400">Verdict</dt>
              <dd className="flex min-w-0 items-center gap-2 font-semibold">
                {verdict.color ? (
                  <>
                    <ColorMark color={verdict.color} size={20} />
                    <span style={{ color: `var(--tl-${verdict.color})` }}>{COLOR_WORD[verdict.color]}</span>
                  </>
                ) : (
                  <span className="text-slate-700 dark:text-slate-200">None: the family's choice stands</span>
                )}
              </dd>
            </div>
          </dl>
          <ul className="space-y-1 border-t border-slate-100 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
            {verdict.reasons.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Food name" hint="Group detection reads the words in it">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="USDA category" hint="Blank for barcode and hand-entered foods">
            <Input
              value={usdaCategory}
              onChange={(e) => setUsdaCategory(e.target.value)}
              placeholder="e.g. Dairy and Egg Products"
            />
          </Field>
          <Field label="Food or drink">
            <Select value={isBeverage ? "drink" : "food"} onChange={(e) => setIsBeverage(e.target.value === "drink")}>
              <option value="food">Food</option>
              <option value="drink">Drink</option>
            </Select>
          </Field>
          <Field label="Group" hint={override ? `Detected: ${detected.group ? ruleSet.groups[detected.group].label : "none"}` : undefined}>
            <Select value={override} onChange={(e) => setOverride(e.target.value as FoodGroup | "")}>
              <option value="">Work it out</option>
              {FOOD_GROUPS.map((k) => (
                <option key={k} value={k}>{ruleSet.groups[k].label}</option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Not a <Field>: a <label> would forward clicks on a chip to its remove button. */}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Food categories
          </span>
          <CategoryInput values={cats} onChange={setCats} placeholder="e.g. fruits" />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field label={`Calories per 100${isBeverage ? "ml" : "g"}`}>
            <Input type="number" step="0.1" inputMode="decimal" value={kcal100 ?? ""} onChange={(e) => setKcal100(numOrNull(e.target.value))} />
          </Field>
          <Field label={`Sugars per 100${isBeverage ? "ml" : "g"}`}>
            <Input type="number" step="0.1" inputMode="decimal" value={sugars100 ?? ""} onChange={(e) => setSugars100(numOrNull(e.target.value))} />
          </Field>
          <Field label="Label serving (g)" hint="Used for yogurt cups, bars, patties">
            <Input type="number" step="1" inputMode="decimal" value={labelG ?? ""} onChange={(e) => setLabelG(numOrNull(e.target.value))} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox" checked={sweetened}
            onChange={(e) => setSweetened(e.target.checked)}
            className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Ingredients list an artificial sweetener
        </label>

        {kcal100 === null && (
          <Banner tone="info">
            With no calories the food gets no verdict, unless its group is
            always red or has no color.
          </Banner>
        )}

        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
