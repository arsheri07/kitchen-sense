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
  // 'gluten-free') — used to filter against active preferences below.
  dietaryTags: string[];
}

interface Row {
  recipe_id: number;
  recipe_name: string;
  recipe_description: string | null;
  dietary_tags: string[] | null;
  ingredient_name: string;
  amount: string | null;
  in_stock: boolean;
}

// A recipe is excluded once ANY active preference conflicts: a checked
// restriction the recipe doesn't satisfy, or a free-text avoid term
// matching one of its ingredient names.
function violatesPreferences(recipe: RecipeMatch, prefs: Preferences): boolean {
  if (prefs.restrictions.some((restriction) => !recipe.dietaryTags.includes(restriction))) {
    return true;
  }
  if (prefs.avoidTerms.length > 0) {
    const names = recipe.ingredients.map((i) => i.name.toLowerCase());
    for (const term of prefs.avoidTerms) {
      if (names.some((name) => name.includes(term) || term.includes(name))) return true;
    }
  }
  return false;
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
  const prefs = await getPreferences(pool);

  // A single query drives the whole match: for every recipe ingredient,
  // check whether any inventory item name contains its match term.
  const result = await pool.query<Row>(`
    SELECT
      r.id AS recipe_id,
      r.name AS recipe_name,
      r.description AS recipe_description,
      r.dietary_tags,
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
    .filter((r) => !violatesPreferences(r, prefs));

  const readyToMake = all.filter((r) => r.missingCount === 0).sort((a, b) => a.name.localeCompare(b.name));

  const almostThere = all
    .filter((r) => r.missingCount > 0)
    .sort((a, b) => {
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
