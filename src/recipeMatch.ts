import { Pool } from 'pg';

export interface RecipeMatch {
  id: number;
  name: string;
  description: string | null;
  totalIngredients: number;
  matchedIngredients: string[];
  missingIngredients: string[];
  missingCount: number;
}

interface Row {
  recipe_id: number;
  recipe_name: string;
  recipe_description: string | null;
  ingredient_name: string;
  in_stock: boolean;
}

// Splits the recipe catalog into "ready to make" (every ingredient is in
// stock) and "almost there" (missing 1+ ingredients), the latter ranked by
// fewest missing first so the closest matches surface at the top.
export async function matchRecipes(
  pool: Pool,
): Promise<{ readyToMake: RecipeMatch[]; almostThere: RecipeMatch[] }> {
  // A single query drives the whole match: for every recipe ingredient,
  // check whether any inventory item name contains its match term.
  const result = await pool.query<Row>(`
    SELECT
      r.id AS recipe_id,
      r.name AS recipe_name,
      r.description AS recipe_description,
      ri.ingredient_name,
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
      };
      byRecipe.set(row.recipe_id, recipe);
    }
    recipe.totalIngredients += 1;
    if (row.in_stock) {
      recipe.matchedIngredients.push(row.ingredient_name);
    } else {
      recipe.missingIngredients.push(row.ingredient_name);
    }
  }

  const all = Array.from(byRecipe.values()).map((r) => ({ ...r, missingCount: r.missingIngredients.length }));

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
