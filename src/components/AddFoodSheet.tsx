import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { classify } from "../lib/rules";
import {
  PORTION_OPTIONS,
  customFood,
  lookupBarcode,
  nutritionFor,
  resolvePortion,
  searchFoods,
  type CustomFoodInput,
  type FoodSearchResult,
} from "../lib/foodApi";
import { n0, n1, formatServings } from "../lib/format";
import {
  MEALS,
  type FoodFacts,
  type Meal,
  type QuickFood,
  type RuleSet,
  type TrafficColor,
} from "../lib/types";
import { Banner, Button, Field, Input, Modal, Spinner, cx } from "./ui";
import { ColorMark, ColorPicker, ColorWordHelp } from "./TrafficLight";
import { MEAL_STYLE } from "./meals";
// The barcode decoding library is a few hundred KB and most sessions never
// scan, so it is fetched only when the camera is actually opened.
const BarcodeScanner = lazy(() => import("./BarcodeScanner"));

type Step = "find" | "scan" | "custom" | "detail";

export interface AddFoodPayload {
  /** Nutrition for the amount actually eaten (per serving x servings). */
  facts: FoodFacts;
  /** The food as looked up, at one serving. Quick-add must remember this one:
   *  storing the scaled version would double the nutrition every time the
   *  chip was reused. */
  original: FoodFacts;
  servings: number;
  meal: Meal;
  color: TrafficColor;
  autoColor: TrafficColor;
  reasons: string[];
  overridden: boolean;
}

const FIND_TITLE: Record<Meal, string> = {
  breakfast: "Add to breakfast",
  lunch: "Add to lunch",
  dinner: "Add to dinner",
  snack: "Add a snack",
};

export default function AddFoodSheet({
  open,
  meal: initialMeal,
  onClose,
  rules,
  quickFoods,
  foodGuideUrl,
  onAdd,
}: {
  open: boolean;
  /** The meal button that opened the sheet. The family can still change it
   *  on the portion step if they tapped the wrong one. */
  meal: Meal;
  onClose: () => void;
  rules: RuleSet;
  quickFoods: QuickFood[];
  foodGuideUrl: string;
  onAdd: (payload: AddFoodPayload) => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("find");
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [facts, setFacts] = useState<FoodFacts | null>(null);
  const [servings, setServings] = useState(1);
  const [guess, setGuess] = useState<TrafficColor | null>(null);
  const [challenge, setChallenge] = useState<{
    auto: TrafficColor;
    reasons: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("find");
    setFacts(null);
    setServings(1);
    setGuess(null);
    setChallenge(null);
    setSaving(false);
    setError(null);
    setResolving(false);
    setLookingUp(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    setMeal(initialMeal);
  }, [open, initialMeal, reset]);

  /**
   * Move to the portion step. Foods that arrived on a bare 100g basis get a
   * real household serving resolved first, so the numbers a family sees are
   * never the 100g placeholder.
   */
  const choose = async (f: FoodFacts, key?: string) => {
    setServings(1);
    setGuess(null);
    setChallenge(null);
    setError(null);
    setFacts(f);
    setStep("detail");

    if (key && f.serv.kcal === null) {
      setResolving(true);
      try {
        const withServing = await resolvePortion(f, key);
        // Ignore a late response if the family already moved on.
        setFacts((current) => (current === f ? withServing : current));
      } finally {
        setResolving(false);
      }
    }
  };

  /**
   * Requirement 11 option 2. The family commits to a color, then the engine
   * responds: agreement is affirmed, disagreement is questioned but never
   * enforced. Their answer is always what gets logged.
   */
  const submit = async (finalColor: TrafficColor, forced = false) => {
    if (!facts) return;
    const scaled: FoodFacts = { ...facts, serv: nutritionFor(facts, servings) };
    const verdict = classify(facts, rules);

    if (!forced && finalColor !== verdict.color) {
      setChallenge({ auto: verdict.color, reasons: verdict.reasons });
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onAdd({
        facts: scaled,
        original: facts,
        servings,
        meal,
        color: finalColor,
        autoColor: verdict.color,
        reasons: verdict.reasons,
        overridden: finalColor !== verdict.color,
      });
      onClose();
    } catch (e) {
      setError(
        (e as Error).message || "Could not save that. Please try again.",
      );
      setSaving(false);
    }
  };

  const titles: Record<Step, string> = {
    find: FIND_TITLE[meal],
    scan: "Scan a barcode",
    custom: "Enter a food yourself",
    detail: "How much, and what color?",
  };

  return (
    <Modal open={open} onClose={onClose} title={titles[step]} size="md">
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {/* The lookup takes a second or two; without this the sheet appears to
          have ignored the scan. */}
      {step === "find" && lookingUp && (
        <Banner tone="info" className="mb-3">
          <span className="flex items-center gap-2">
            <Spinner className="size-4 shrink-0" />
            Found barcode {lookingUp}. Looking it up…
          </span>
        </Banner>
      )}

      {step === "find" && (
        <FindStep
          quickFoods={quickFoods}
          onPick={choose}
          onScan={() => setStep("scan")}
          onCustom={() => setStep("custom")}
        />
      )}

      {step === "scan" && (
        <Suspense
          fallback={
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Spinner className="size-4" /> Loading scanner…
            </div>
          }
        >
          <BarcodeScanner
            onCancel={() => setStep("find")}
            onDetected={async (code) => {
              setStep("find");
              setError(null);
              setLookingUp(code);
              try {
                const hit = await lookupBarcode(code);
                if (hit) void choose(hit.facts, hit.key);
                else
                  setError(
                    `No product found for barcode ${code}. Try searching by name, or enter it yourself.`,
                  );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setLookingUp(null);
              }
            }}
          />
        </Suspense>
      )}

      {step === "custom" && (
        <CustomStep
          onCancel={() => setStep("find")}
          onSubmit={(f) => choose(f)}
        />
      )}

      {step === "detail" && facts && (
        <DetailStep
          resolving={resolving}
          facts={facts}
          servings={servings}
          setServings={(n) => {
            setServings(n);
            // A changed portion is a new answer, so the "Are you sure?"
            // prompt clears exactly as it does when the color changes.
            setChallenge(null);
          }}
          meal={meal}
          setMeal={setMeal}
          guess={guess}
          setGuess={(c) => {
            setGuess(c);
            setChallenge(null);
          }}
          challenge={challenge}
          saving={saving}
          foodGuideUrl={foodGuideUrl}
          onBack={() => setStep("find")}
          onSubmit={submit}
        />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Step 1: find a food
// ---------------------------------------------------------------------------

function FindStep({
  quickFoods,
  onPick,
  onScan,
  onCustom,
}: {
  quickFoods: QuickFood[];
  onPick: (f: FoodFacts, key?: string) => void;
  onScan: () => void;
  onCustom: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const seq = useRef(0);

  // Debounced search; a stale response must never overwrite a newer one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await searchFoods(q);
        if (seq.current === mine) {
          setResults(r);
          setSearchError(null);
        }
      } catch (e) {
        if (seq.current === mine) {
          setResults([]);
          setSearchError(
            (e as Error).message || "Search is unavailable right now.",
          );
        }
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" onClick={onScan}>
          <svg
            viewBox="0 0 20 20"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path
              d="M3 7V4.5a1 1 0 0 1 1-1h2.5M17 7V4.5a1 1 0 0 0-1-1h-2.5M3 13v2.5a1 1 0 0 0 1 1h2.5M17 13v2.5a1 1 0 0 1-1 1h-2.5"
              strokeLinecap="round"
            />
            <path d="M6 7v6M8.5 7v6M11.5 7v6M14 7v6" strokeLinecap="round" />
          </svg>
          Scan barcode
        </Button>
        <Button size="lg" onClick={onCustom}>
          <svg
            viewBox="0 0 20 20"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" />
          </svg>
          Enter myself
        </Button>
      </div>

      <Field label="Search foods">
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="apple, greek yogurt, cheerios…"
            autoComplete="off"
            className="pr-10"
          />
          {searching && (
            <span className="absolute top-1/2 right-3 -translate-y-1/2">
              <Spinner className="size-4 text-slate-400" />
            </span>
          )}
        </div>
      </Field>

      {searchError && <Banner tone="warn">{searchError}</Banner>}

      {results.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {results.map((r) => (
            <li key={r.key}>
              <button
                onClick={() => onPick(r.facts, r.key)}
                className="tap w-full px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span className="block truncate font-medium text-slate-900 dark:text-slate-100">
                  {r.label}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                  {r.sublabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length >= 2 &&
        !searching &&
        results.length === 0 &&
        !searchError && (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Nothing found. Try a simpler word, or{" "}
            <button
              onClick={onCustom}
              className="tap font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300"
            >
              enter it yourself
            </button>
            .
          </p>
        )}

      {quickFoods.length > 0 && query.trim().length < 2 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Foods you log often
          </h3>
          <div className="flex flex-wrap gap-2">
            {quickFoods.map((q) => (
              <button
                key={q.id}
                onClick={() => onPick(q.facts)}
                className="tap max-w-full truncate rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-brand-700 dark:hover:bg-brand-950"
              >
                {q.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom entry
// ---------------------------------------------------------------------------

const CUSTOM_FIELDS = [
  { key: "kcal", label: "Calories per serving", unit: "kcal" },
  { key: "fat", label: "Total fat", unit: "g" },
  { key: "sat", label: "Saturated fat", unit: "g" },
  { key: "added", label: "Added sugar", unit: "g" },
  { key: "protein", label: "Protein", unit: "g" },
] as const;

function CustomStep({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (f: FoodFacts) => void;
}) {
  const [name, setName] = useState("");
  const [servingLabel, setServingLabel] = useState("");
  const [isBeverage, setIsBeverage] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const missing = (k: string) =>
    values[k] === undefined ||
    values[k].trim() === "" ||
    Number.isNaN(Number(values[k]));
  const invalid =
    !name.trim() ||
    !servingLabel.trim() ||
    CUSTOM_FIELDS.some((f) => missing(f.key));

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    const input: CustomFoodInput = {
      name,
      servingLabel,
      isBeverage,
      kcal: Number(values.kcal),
      fat: Number(values.fat),
      sat: Number(values.sat),
      added: Number(values.added),
      protein: Number(values.protein),
    };
    onSubmit(customFood(input));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Copy these from the nutrition label, for a single serving. All fields
        are needed to work out the color.
      </p>

      <Field
        label="Food name"
        required
        error={touched && !name.trim() ? "Required" : undefined}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Grandma's banana bread"
        />
      </Field>

      <Field
        label="Serving size"
        required
        hint="However the label describes it, e.g. “1 slice (60g)”"
        error={touched && !servingLabel.trim() ? "Required" : undefined}
      >
        <Input
          value={servingLabel}
          onChange={(e) => setServingLabel(e.target.value)}
          placeholder="1 slice (60g)"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        {CUSTOM_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={`${f.label} (${f.unit})`}
            required
            error={touched && missing(f.key) ? "Required" : undefined}
          >
            <Input
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={values[f.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
            />
          </Field>
        ))}
      </div>

      <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <input
          type="checkbox"
          checked={isBeverage}
          onChange={(e) => setIsBeverage(e.target.checked)}
          className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <span className="text-sm text-slate-700 dark:text-slate-300">
          This is a drink
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Drinks are judged by different rules
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <Button full onClick={onCancel}>
          Back
        </Button>
        <Button variant="primary" full onClick={submit}>
          Continue
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: portion + color guess
// ---------------------------------------------------------------------------

function DetailStep({
  resolving,
  facts,
  servings,
  setServings,
  meal,
  setMeal,
  guess,
  setGuess,
  challenge,
  saving,
  foodGuideUrl,
  onBack,
  onSubmit,
}: {
  resolving: boolean;
  facts: FoodFacts;
  servings: number;
  setServings: (n: number) => void;
  meal: Meal;
  setMeal: (m: Meal) => void;
  guess: TrafficColor | null;
  setGuess: (c: TrafficColor) => void;
  challenge: { auto: TrafficColor; reasons: string[] } | null;
  saving: boolean;
  foodGuideUrl: string;
  onBack: () => void;
  onSubmit: (color: TrafficColor, forced?: boolean) => void;
}) {
  const n = nutritionFor(facts, servings);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
        <p className="font-semibold text-slate-900 dark:text-slate-100">
          {facts.name}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="min-w-0 truncate">
            {[facts.brand, facts.servingLabel].filter(Boolean).join(" · ")}
          </span>
          {resolving && (
            <span className="flex shrink-0 items-center gap-1 text-slate-400">
              <Spinner className="size-3" />
              finding serving size…
            </span>
          )}
        </p>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[
            { l: "kcal", v: n0(n.kcal) },
            { l: "fat g", v: n1(n.fat) },
            { l: "sugars g", v: n1(n.sugars) },
            { l: "protein g", v: n1(n.protein) },
          ].map((x) => (
            <div
              key={x.l}
              className="rounded-lg bg-white py-1.5 dark:bg-slate-900"
            >
              <dd className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {x.v}
              </dd>
              <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                {x.l}
              </dt>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Meal
        </span>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {MEALS.map((m) => (
            <button
              key={m.value}
              onClick={() => setMeal(m.value)}
              aria-pressed={meal === m.value}
              className={cx(
                "tap flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-1 py-2 text-sm font-medium transition",
                meal === m.value
                  ? cx("border-transparent font-semibold shadow-sm", MEAL_STYLE[m.value].fill)
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
              )}
            >
              {meal === m.value ? (
                <svg viewBox="0 0 20 20" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                  <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", MEAL_STYLE[m.value].dot)} />
              )}
              <span className="truncate">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
          How many servings?
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PORTION_OPTIONS.map((p) => (
            <button
              key={p}
              onClick={() => setServings(p)}
              className={cx(
                "tap min-w-12 rounded-lg border px-2.5 py-2 text-sm font-medium transition-colors",
                servings === p
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
              )}
            >
              {formatServings(p)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            What color do you think this is?
          </span>
          <ColorWordHelp foodGuideUrl={foodGuideUrl} />
        </div>
        <ColorPicker value={guess} onChange={setGuess} disabled={saving} />
      </div>

      {/* The engine only speaks up after a guess has been made. */}
      {challenge && guess && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-100">
            <svg
              viewBox="0 0 20 20"
              className="size-5 shrink-0"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M10 2.5a1.2 1.2 0 0 1 1.05.62l6.3 11.25A1.2 1.2 0 0 1 16.3 16.2H3.7a1.2 1.2 0 0 1-1.05-1.83l6.3-11.25A1.2 1.2 0 0 1 10 2.5Zm0 4.3a.9.9 0 0 0-.9.98l.3 3.2a.6.6 0 0 0 1.2 0l.3-3.2a.9.9 0 0 0-.9-.98Zm0 5.9a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z" />
            </svg>
            Are you sure?
          </p>
          <p className="mt-1.5 text-sm text-amber-900/90 dark:text-amber-100/90">
            Our guide would call this one{" "}
            <span className="inline-flex items-center gap-1 font-semibold">
              <ColorMark color={challenge.auto} size={13} />
              {challenge.auto}
            </span>
            :
          </p>
          <ul className="mt-1.5 space-y-0.5 text-sm text-amber-900/80 dark:text-amber-100/80">
            {challenge.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
          <p className="mt-2.5 text-sm font-medium text-amber-900 dark:text-amber-100">
            It is your call — what would you like to do?
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button
              full
              onClick={() => onSubmit(guess, true)}
              disabled={saving}
            >
              Keep {guess}
            </Button>
            <Button
              variant="primary"
              full
              onClick={() => onSubmit(challenge.auto, true)}
              disabled={saving}
            >
              Change to {challenge.auto}
            </Button>
          </div>
        </div>
      )}

      {!challenge && (
        <div className="flex gap-2">
          <Button full onClick={onBack} disabled={saving}>
            Back
          </Button>
          <Button
            variant="primary"
            full
            loading={saving}
            disabled={!guess}
            onClick={() => guess && onSubmit(guess)}
          >
            Add to log
          </Button>
        </div>
      )}
    </div>
  );
}
