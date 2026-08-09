import { Pool } from 'pg';
import { fetchDishPhoto } from './pexels';
import { getPreferences, Preferences } from './preferences';

export interface RecipeIngredientMatch {
  name: string;
  amount: string | null;
  inStock: boolean;
}

export interface RecipeMatch {
  id: number;
  name: string;
  description: string | null;
  totalIngredients: number;
  // Name-only lists, kept for the compact collapsed-card tag display.
  matchedIngredients: string[];
  missingIngredients: string[];
  missingCount: number;
  // Full detail (name + amount + in-stock) for the expanded recipe view.
  ingredients: RecipeIngredientMatch[];
  // Dietary restrictions this recipe satisfies (e.g. 'vegetarian',
  // 'gluten-free'), plus a coarse 'high-protein' tag — used to filter
  // (restrictions) and rank (high-protein) against active preferences.
  dietaryTags: string[];
  // Canonical protein types this recipe features (chicken/beef/fish/...)
  // — used only for ranking against a "favorite proteins" preference,
  // never for exclusion.
  proteinTypes: string[];
  // How well this recipe matches the soft taste/nutrition preferences —
  // 0 when no preference is set or nothing matches. Purely a ranking
  // signal, computed fresh on every match/plan/suggest call.
  preferenceScore: number;
}

interface Row {
  recipe_id: number;
  recipe_name: string;
  recipe_description: string | null;
  dietary_tags: string[] | null;
  protein_types: string[] | null;
  ingredient_name: string;
  amount: string | null;
  in_stock: boolean;
}

// A recipe is excluded once ANY active preference conflicts: a checked
// restriction the recipe doesn't satisfy, or a free-text avoid/custom-
// restriction term matching one of its ingredient names. Hard filter —
// unlike preferenceScore below, this never lets a "bad" recipe stay
// visible. customRestrictions (free-text, from the Restrictions panel)
// shares the exact same ingredient-substring check as avoidTerms — a
// made-up dietary tag would match zero recipes and silently empty every
// list, so custom restrictions never touch dietaryTags at all.
function violatesPreferences(recipe: RecipeMatch, prefs: Preferences): boolean {
  if (prefs.restrictions.some((restriction) => !recipe.dietaryTags.includes(restriction))) {
    return true;
  }
  const excludeTerms = [...prefs.avoidTerms, ...prefs.customRestrictions];
  if (excludeTerms.length > 0) {
    const names = recipe.ingredients.map((i) => i.name.toLowerCase());
    for (const term of excludeTerms) {
      if (names.some((name) => name.includes(term) || term.includes(name))) return true;
    }
  }
  return false;
}

// A recipe with 3 or fewer total ingredients reads as "quick & simple"
// (the same threshold the seed catalog's own comments use for its
// "simple" tier); 4-5 gets a smaller nod; 6+ gets none. Real signal
// already computed from the recipe/ingredient join, not fabricated.
function quickSimpleBonus(totalIngredients: number): number {
  if (totalIngredients <= 3) return 2;
  if (totalIngredients <= 5) return 1;
  return 0;
}

// Soft ranking signal — higher is a better match for stated taste
// preferences. Never used to exclude a recipe (that's violatesPreferences
// above); a recipe scoring 0 here still shows up, just lower in the list.
export function computePreferenceScore(
  recipe: { dietaryTags: string[]; proteinTypes: string[]; totalIngredients: number; ingredients: RecipeIngredientMatch[] },
  prefs: Preferences,
): number {
  let score = 0;
  if (prefs.highProtein && recipe.dietaryTags.includes('high-protein')) score += 2;
  // customFavoriteProteins is free text with no validation against
  // PROTEIN_TYPES — unioned in here rather than excluded, since a term
  // that matches no recipe's proteinTypes simply contributes 0, exactly
  // like an unchecked canonical protein would.
  const favoriteProteins = [...prefs.favoriteProteins, ...prefs.customFavoriteProteins];
  if (favoriteProteins.length > 0) {
    score += recipe.proteinTypes.filter((type) => favoriteProteins.includes(type)).length;
  }
  if (prefs.quickSimple) score += quickSimpleBonus(recipe.totalIngredients);
  // Free-text taste terms — same ingredient-name substring matching as
  // avoidTerms/customRestrictions, just additive instead of exclusionary:
  // a recipe using a matching ingredient ranks a point higher per term,
  // nothing is ever hidden for not matching.
  if (prefs.customTasteTerms.length > 0) {
    const names = recipe.ingredients.map((i) => i.name.toLowerCase());
    for (const term of prefs.customTasteTerms) {
      if (names.some((name) => name.includes(term) || term.includes(name))) score += 1;
    }
  }
  return score;
}

// Splits the recipe catalog into "ready to make" (every ingredient is in
// stock) and "almost there" (missing 1+ ingredients), the latter ranked by
// fewest missing first so the closest matches surface at the top. Recipes
// that violate an active dietary preference (structured restriction or
// free-text avoid term) are excluded from both lists entirely — this is
// the single place recipe surfacing is filtered, so the meal planner and
// "what should I cook" suggestion inherit it automatically since both are
// built on top of this function.
export async function matchRecipes(
  pool: Pool,
): Promise<{ readyToMake: RecipeMatch[]; almostThere: RecipeMatch[] }> {
  // An empty inventory has nothing to match against — every recipe would
  // come back "almost there, missing everything," which isn't a match,
  // it's just the catalog restated. Recipes should only ever reflect what
  // has actually been scanned or entered, so a reset inventory means a
  // reset match list too, generated fresh the moment something's back in
  // stock. This also keeps the meal planner and "what should I cook"
  // suggestion (both built on this function) from proposing anything
  // against zero ingredients.
  const inventoryCount = await pool.query<{ count: string }>('SELECT COUNT(*) FROM inventory_items');
  if (Number(inventoryCount.rows[0].count) === 0) {
    return { readyToMake: [], almostThere: [] };
  }

  const prefs = await getPreferences(pool);

  // A single query drives the whole match: for every recipe ingredient,
  // check whether any inventory item name contains its match term.
  const result = await pool.query<Row>(`
    SELECT
      r.id AS recipe_id,
      r.name AS recipe_name,
      r.description AS recipe_description,
      r.dietary_tags,
      r.protein_types,
      ri.ingredient_name,
      ri.amount,
      EXISTS (
        SELECT 1 FROM inventory_items ii
        WHERE ii.name ILIKE '%' || ri.match_term || '%'
      ) AS in_stock
    FROM recipes r
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    ORDER BY r.id, ri.id
  `);

  const byRecipe = new Map<number, RecipeMatch>();

  for (const row of result.rows) {
    let recipe = byRecipe.get(row.recipe_id);
    if (!recipe) {
      recipe = {
        id: row.recipe_id,
        name: row.recipe_name,
        description: row.recipe_description,
        totalIngredients: 0,
        matchedIngredients: [],
        missingIngredients: [],
        missingCount: 0,
        ingredients: [],
        dietaryTags: row.dietary_tags ?? [],
        proteinTypes: row.protein_types ?? [],
        preferenceScore: 0,
      };
      byRecipe.set(row.recipe_id, recipe);
    }
    recipe.totalIngredients += 1;
    recipe.ingredients.push({ name: row.ingredient_name, amount: row.amount, inStock: row.in_stock });
    if (row.in_stock) {
      recipe.matchedIngredients.push(row.ingredient_name);
    } else {
      recipe.missingIngredients.push(row.ingredient_name);
    }
  }

  const all = Array.from(byRecipe.values())
    .map((r) => ({ ...r, missingCount: r.missingIngredients.length }))
    .filter((r) => !violatesPreferences(r, prefs))
    .map((r) => ({ ...r, preferenceScore: computePreferenceScore(r, prefs) }));

  // Preference score leads both lists — a recipe that better matches
  // stated taste preferences ranks higher even with more missing
  // ingredients (within Almost There) or just alphabetically otherwise
  // (within Ready to Make, which has no other meaningful ranking signal).
  // Non-matching, non-restricted recipes are never dropped — they just
  // sort lower, per the "influence ranking, not filtering" requirement.
  const readyToMake = all
    .filter((r) => r.missingCount === 0)
    .sort((a, b) => {
      if (b.preferenceScore !== a.preferenceScore) return b.preferenceScore - a.preferenceScore;
      return a.name.localeCompare(b.name);
    });

  const almostThere = all
    .filter((r) => r.missingCount > 0)
    .sort((a, b) => {
      if (b.preferenceScore !== a.preferenceScore) return b.preferenceScore - a.preferenceScore;
      if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
      if (b.matchedIngredients.length !== a.matchedIngredients.length) {
        return b.matchedIngredients.length - a.matchedIngredients.length;
      }
      return a.name.localeCompare(b.name);
    });

  return { readyToMake, almostThere };
}

export interface RecipeDetail {
  id: number;
  name: string;
  description: string | null;
  steps: string[];
  photoUrl: string | null;
  ingredients: RecipeIngredientMatch[];
  missingCount: number;
}

// Full single-recipe detail, fetched lazily when a recipe card is expanded
// (not part of the bulk match list, which stays lean). The dish photo is
// cached in recipes.photo_url on first request — every request after that
// reads the cached URL instead of calling Pexels again.
export async function getRecipeDetail(pool: Pool, recipeId: number): Promise<RecipeDetail | null> {
  const recipeResult = await pool.query<{
    id: number;
    name: string;
    description: string | null;
    steps: string[] | null;
    photo_url: string | null;
  }>('SELECT id, name, description, steps, photo_url FROM recipes WHERE id = $1', [recipeId]);

  if (recipeResult.rows.length === 0) return null;
  const recipe = recipeResult.rows[0];

  const ingredientsResult = await pool.query<{ ingredient_name: string; amount: string | null; in_stock: boolean }>(
    `SELECT ri.ingredient_name, ri.amount,
            EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.name ILIKE '%' || ri.match_term || '%') AS in_stock
     FROM recipe_ingredients ri
     WHERE ri.recipe_id = $1
     ORDER BY ri.id`,
    [recipeId],
  );

  const ingredients: RecipeIngredientMatch[] = ingredientsResult.rows.map((r) => ({
    name: r.ingredient_name,
    amount: r.amount,
    inStock: r.in_stock,
  }));

  let photoUrl = recipe.photo_url;
  if (!photoUrl) {
    photoUrl = await fetchDishPhoto(recipe.name);
    if (photoUrl) {
      await pool.query('UPDATE recipes SET photo_url = $1 WHERE id = $2', [photoUrl, recipeId]);
    }
  }

  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    steps: recipe.steps ?? [],
    photoUrl,
    ingredients,
    missingCount: ingredients.filter((i) => !i.inStock).length,
  };
}
