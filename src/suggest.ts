import { Pool } from 'pg';
import { matchRecipes, RecipeMatch } from './recipeMatch';
import { computeUrgency } from './urgency';

export interface CookSuggestion {
  recipe: RecipeMatch;
  urgencyDays: number | null;
}

// The single best recipe to cook right now: fully ready to make (already
// respects active dietary preferences via matchRecipes), prioritizing
// whichever uses ingredients closest to expiring — same urgency signal the
// meal planner uses, just picking the single best day-0 answer instead of
// a whole week. Ties broken alphabetically for a stable, non-random pick
// (this is the deliberate counterpart to "Surprise Me", not a duplicate).
export async function getBestRecipeToCook(pool: Pool): Promise<CookSuggestion | null> {
  const { readyToMake } = await matchRecipes(pool);
  if (readyToMake.length === 0) return null;

  const urgencyMap = await computeUrgency(pool);
  const scored = readyToMake.map((recipe) => ({ recipe, urgencyDays: urgencyMap.get(recipe.id) ?? null }));

  scored.sort((a, b) => {
    const aUrgency = a.urgencyDays === null ? Infinity : a.urgencyDays;
    const bUrgency = b.urgencyDays === null ? Infinity : b.urgencyDays;
    if (aUrgency !== bUrgency) return aUrgency - bUrgency;
    // Same expiry-closest tie unresolved by urgency alone: let taste
    // preference break it before falling back to name.
    if (b.recipe.preferenceScore !== a.recipe.preferenceScore) return b.recipe.preferenceScore - a.recipe.preferenceScore;
    return a.recipe.name.localeCompare(b.recipe.name);
  });

  return scored[0];
}
