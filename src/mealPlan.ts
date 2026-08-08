import { Pool } from 'pg';
import { matchRecipes, RecipeMatch } from './recipeMatch';
import { computeUrgency } from './urgency';

export interface MealPlanDay {
  day: number; // 0-indexed
  recipeId: number;
  recipeName: string;
  description: string | null;
  missingCount: number;
  missingIngredients: string[];
  // Soonest days-until-expiry among this recipe's in-stock ingredients
  // that are actually linked to an inventory item with an expiry date.
  // null = nothing time-sensitive about this pick.
  urgencyDays: number | null;
}

const MIN_DAYS = 5;
const MAX_DAYS = 7;

function clampDays(requested: unknown): number {
  const n = Number(requested);
  if (Number.isInteger(n) && n >= MIN_DAYS && n <= MAX_DAYS) return n;
  return MAX_DAYS;
}

// Greedy two-phase selection:
//   1. Recipes tied to soon-expiring stock go first, soonest first — using
//      up ingredients before they spoil is the point of a meal plan.
//   2. Remaining days are filled by picking, one at a time, whichever
//      not-yet-used recipe adds the FEWEST new distinct missing
//      ingredients on top of what's already been committed to buy —
//      the standard greedy approximation for minimizing total shopping
//      across a selected set (ties broken by lower missingCount, then name).
export async function generateMealPlan(pool: Pool, requestedDays: unknown): Promise<MealPlanDay[]> {
  const days = clampDays(requestedDays);

  const { readyToMake, almostThere } = await matchRecipes(pool);
  const allRecipes = [...readyToMake, ...almostThere];
  const urgencyMap = await computeUrgency(pool);

  const candidates = allRecipes.map((r) => ({ ...r, urgencyDays: urgencyMap.get(r.id) ?? null }));

  // "Urgent" means expiring within the plan's own horizon (a 7-day plan
  // cares about the next 7 days) — not just "has any expiry data at all",
  // which would be nearly every recipe (every item gets a default expiry
  // estimate) and would starve the shopping-minimization phase below of
  // anything to do.
  const urgent = candidates
    .filter((c) => c.urgencyDays !== null && c.urgencyDays <= days)
    .sort((a, b) => {
      if (a.urgencyDays! !== b.urgencyDays!) return a.urgencyDays! - b.urgencyDays!;
      if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
      return a.name.localeCompare(b.name);
    });

  const selected: (RecipeMatch & { urgencyDays: number | null })[] = [];
  const usedIds = new Set<number>();
  const cumulativeMissing = new Set<string>();

  for (const c of urgent) {
    if (selected.length >= days) break;
    selected.push(c);
    usedIds.add(c.id);
    for (const m of c.missingIngredients) cumulativeMissing.add(m.toLowerCase());
  }

  while (selected.length < days) {
    const remaining = candidates.filter((c) => !usedIds.has(c.id));
    if (remaining.length === 0) break;

    const scored = remaining.map((c) => ({
      c,
      newMissing: c.missingIngredients.filter((m) => !cumulativeMissing.has(m.toLowerCase())).length,
    }));
    scored.sort((a, b) => {
      if (a.newMissing !== b.newMissing) return a.newMissing - b.newMissing;
      if (a.c.missingCount !== b.c.missingCount) return a.c.missingCount - b.c.missingCount;
      return a.c.name.localeCompare(b.c.name);
    });

    const pick = scored[0].c;
    selected.push(pick);
    usedIds.add(pick.id);
    for (const m of pick.missingIngredients) cumulativeMissing.add(m.toLowerCase());
  }

  await pool.query('DELETE FROM meal_plan_days');
  for (let i = 0; i < selected.length; i++) {
    await pool.query('INSERT INTO meal_plan_days (day_index, recipe_id) VALUES ($1, $2)', [i, selected[i].id]);
  }

  return selected.map((r, i) => ({
    day: i,
    recipeId: r.id,
    recipeName: r.name,
    description: r.description,
    missingCount: r.missingCount,
    missingIngredients: r.missingIngredients,
    urgencyDays: r.urgencyDays,
  }));
}

export async function getMealPlan(pool: Pool): Promise<MealPlanDay[]> {
  const stored = await pool.query<{ day_index: number; recipe_id: number }>(
    'SELECT day_index, recipe_id FROM meal_plan_days ORDER BY day_index',
  );
  if (stored.rows.length === 0) return [];

  const { readyToMake, almostThere } = await matchRecipes(pool);
  const byId = new Map([...readyToMake, ...almostThere].map((r) => [r.id, r]));
  const urgencyMap = await computeUrgency(pool);

  const days: MealPlanDay[] = [];
  for (const row of stored.rows) {
    const r = byId.get(row.recipe_id);
    if (!r) continue; // recipe was removed from the catalog since the plan was generated
    days.push({
      day: row.day_index,
      recipeId: r.id,
      recipeName: r.name,
      description: r.description,
      missingCount: r.missingCount,
      missingIngredients: r.missingIngredients,
      urgencyDays: urgencyMap.get(r.id) ?? null,
    });
  }
  return days;
}
