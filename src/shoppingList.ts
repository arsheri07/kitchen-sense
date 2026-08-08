import { Pool } from 'pg';
import { matchRecipes } from './recipeMatch';
import { getMealPlan } from './mealPlan';

export interface ShoppingListItem {
  id: number;
  ingredientName: string;
  // Every recipe currently relying on this item — empty means manually
  // added, with no recipe source at all.
  recipeNames: string[];
  checked: boolean;
  createdAt: string;
}

interface Row {
  id: number;
  ingredient_name: string;
  checked: boolean;
  created_at: string;
  recipe_names: string[];
}

const SELECT_WITH_SOURCES = `
  SELECT si.id, si.ingredient_name, si.checked, si.created_at,
         COALESCE(
           array_agg(src.recipe_name ORDER BY src.recipe_name) FILTER (WHERE src.recipe_name IS NOT NULL),
           '{}'
         ) AS recipe_names
  FROM shopping_list_items si
  LEFT JOIN shopping_list_sources src ON src.shopping_list_item_id = si.id
`;

function toItem(row: Row): ShoppingListItem {
  return {
    id: row.id,
    ingredientName: row.ingredient_name,
    recipeNames: row.recipe_names,
    checked: row.checked,
    createdAt: row.created_at,
  };
}

export async function listShoppingList(pool: Pool): Promise<ShoppingListItem[]> {
  const result = await pool.query<Row>(
    `${SELECT_WITH_SOURCES} GROUP BY si.id ORDER BY si.checked ASC, si.created_at ASC`,
  );
  return result.rows.map(toItem);
}

async function getItemById(pool: Pool, id: number): Promise<ShoppingListItem | null> {
  const result = await pool.query<Row>(`${SELECT_WITH_SOURCES} WHERE si.id = $1 GROUP BY si.id`, [id]);
  return result.rows[0] ? toItem(result.rows[0]) : null;
}

// Upserts the underlying list item (case-insensitive dedup on name, so a
// second recipe needing "Garlic" reuses the same row instead of a
// duplicate) and tags it with the given recipe name. Safe to call
// repeatedly for the same (ingredient, recipe) pair — both the item
// upsert and the source tag are idempotent.
async function addOrTagItem(pool: Pool, ingredientName: string, recipeName: string | null): Promise<ShoppingListItem> {
  const upsert = await pool.query<{ id: number }>(
    `INSERT INTO shopping_list_items (ingredient_name)
     VALUES ($1)
     ON CONFLICT (lower(ingredient_name)) DO UPDATE SET ingredient_name = shopping_list_items.ingredient_name
     RETURNING id`,
    [ingredientName],
  );
  const itemId = upsert.rows[0].id;

  if (recipeName) {
    await pool.query(
      `INSERT INTO shopping_list_sources (shopping_list_item_id, recipe_name)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [itemId, recipeName],
    );
  }

  const item = await getItemById(pool, itemId);
  // getItemById can't actually return null here — the row was just
  // upserted in the same connection — but satisfy the type without `!`.
  if (!item) throw new Error(`Shopping list item ${itemId} vanished immediately after upsert`);
  return item;
}

// Adds a recipe's missing ingredients to the shopping list, tagging each
// with this recipe's name. An ingredient already on the list (from this
// recipe or another) gets this recipe added as an additional source
// rather than a duplicate row.
export async function generateFromRecipe(
  pool: Pool,
  recipeId: number,
): Promise<{ recipeId: number; recipeName: string; added: ShoppingListItem[] } | null> {
  const { readyToMake, almostThere } = await matchRecipes(pool);
  const recipe = [...readyToMake, ...almostThere].find((r) => r.id === recipeId);
  if (!recipe) return null;

  const added: ShoppingListItem[] = [];
  for (const ingredientName of recipe.missingIngredients) {
    added.push(await addOrTagItem(pool, ingredientName, recipe.name));
  }

  return { recipeId: recipe.id, recipeName: recipe.name, added };
}

// Same as generateFromRecipe but across every day of the current meal
// plan at once — an ingredient needed by two different days' recipes
// ends up as one shopping list row tagged with both recipe names.
export async function generateFromMealPlan(
  pool: Pool,
): Promise<{ recipeCount: number; added: ShoppingListItem[] } | null> {
  const plan = await getMealPlan(pool);
  if (plan.length === 0) return null;

  const addedById = new Map<number, ShoppingListItem>();
  for (const day of plan) {
    for (const ingredientName of day.missingIngredients) {
      const item = await addOrTagItem(pool, ingredientName, day.recipeName);
      addedById.set(item.id, item);
    }
  }

  return { recipeCount: plan.length, added: Array.from(addedById.values()) };
}

// User-typed addition, independent of any recipe — no source tags at all,
// so the frontend can visually distinguish it from generated items.
export async function addManualItem(pool: Pool, ingredientName: string): Promise<ShoppingListItem | null> {
  const existing = await pool.query('SELECT id FROM shopping_list_items WHERE lower(ingredient_name) = lower($1)', [
    ingredientName,
  ]);
  if (existing.rows.length > 0) return null; // already on the list under some source (or manually) — no-op

  const result = await pool.query<{ id: number }>(
    'INSERT INTO shopping_list_items (ingredient_name) VALUES ($1) RETURNING id',
    [ingredientName],
  );
  return getItemById(pool, result.rows[0].id);
}

export async function setChecked(pool: Pool, id: number, checked: boolean): Promise<ShoppingListItem | null> {
  const result = await pool.query('UPDATE shopping_list_items SET checked = $1 WHERE id = $2 RETURNING id', [
    checked,
    id,
  ]);
  if (result.rowCount === 0) return null;
  return getItemById(pool, id);
}

export async function deleteShoppingItem(pool: Pool, id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM shopping_list_items WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function clearChecked(pool: Pool): Promise<number> {
  const result = await pool.query('DELETE FROM shopping_list_items WHERE checked = true');
  return result.rowCount ?? 0;
}
