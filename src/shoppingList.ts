import { Pool } from 'pg';
import { matchRecipes } from './recipeMatch';

export interface ShoppingListItem {
  id: number;
  ingredientName: string;
  recipeName: string | null;
  checked: boolean;
  createdAt: string;
}

interface Row {
  id: number;
  ingredient_name: string;
  recipe_name: string | null;
  checked: boolean;
  created_at: string;
}

function toItem(row: Row): ShoppingListItem {
  return {
    id: row.id,
    ingredientName: row.ingredient_name,
    recipeName: row.recipe_name,
    checked: row.checked,
    createdAt: row.created_at,
  };
}

export async function listShoppingList(pool: Pool): Promise<ShoppingListItem[]> {
  const result = await pool.query<Row>(
    'SELECT id, ingredient_name, recipe_name, checked, created_at FROM shopping_list_items ORDER BY checked ASC, created_at ASC',
  );
  return result.rows.map(toItem);
}

// Adds a recipe's missing ingredients to the shopping list. Dedup is by
// ingredient name (case-insensitive, via a unique index) so picking a
// second recipe merges in rather than creating duplicate rows; an
// ingredient already on the list (checked or not) is left as-is.
export async function generateFromRecipe(
  pool: Pool,
  recipeId: number,
): Promise<{ recipeId: number; recipeName: string; added: ShoppingListItem[] } | null> {
  const { readyToMake, almostThere } = await matchRecipes(pool);
  const recipe = [...readyToMake, ...almostThere].find((r) => r.id === recipeId);
  if (!recipe) return null;

  const added: ShoppingListItem[] = [];
  for (const ingredientName of recipe.missingIngredients) {
    const result = await pool.query<Row>(
      `INSERT INTO shopping_list_items (ingredient_name, recipe_name)
       VALUES ($1, $2)
       ON CONFLICT (lower(ingredient_name)) DO NOTHING
       RETURNING id, ingredient_name, recipe_name, checked, created_at`,
      [ingredientName, recipe.name],
    );
    if (result.rows.length > 0) {
      added.push(toItem(result.rows[0]));
    }
  }

  return { recipeId: recipe.id, recipeName: recipe.name, added };
}

export async function setChecked(pool: Pool, id: number, checked: boolean): Promise<ShoppingListItem | null> {
  const result = await pool.query<Row>(
    'UPDATE shopping_list_items SET checked = $1 WHERE id = $2 RETURNING id, ingredient_name, recipe_name, checked, created_at',
    [checked, id],
  );
  return result.rows[0] ? toItem(result.rows[0]) : null;
}

export async function deleteShoppingItem(pool: Pool, id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM shopping_list_items WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function clearChecked(pool: Pool): Promise<number> {
  const result = await pool.query('DELETE FROM shopping_list_items WHERE checked = true');
  return result.rowCount ?? 0;
}
