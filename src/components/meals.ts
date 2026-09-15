import type { Meal } from "../lib/types";

/**
 * One shade of the brand green per meal, light to dark in the order the
 * buttons sit, so the four read as a set yet each meal is recognisable where
 * it reappears -- the add button, the meal picker and the log headings.
 *
 * Text flips from dark to white at the midpoint of the ramp to stay readable:
 * dark on the two light steps, white on the two dark ones.
 */
export const MEAL_STYLE: Record<Meal, { fill: string; dot: string }> = {
  breakfast: {
    fill: "bg-linear-to-br from-brand-200 to-brand-300 text-brand-950",
    dot: "bg-brand-300",
  },
  lunch: {
    fill: "bg-linear-to-br from-brand-400 to-brand-500 text-brand-950",
    dot: "bg-brand-500",
  },
  dinner: {
    fill: "bg-linear-to-br from-brand-600 to-brand-700 text-white",
    dot: "bg-brand-700",
  },
  snack: {
    fill: "bg-linear-to-br from-brand-800 to-brand-950 text-white",
    dot: "bg-brand-900",
  },
};
