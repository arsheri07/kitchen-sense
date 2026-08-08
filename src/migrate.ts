import { Client } from 'pg';
import { SEED_RECIPES } from './seedRecipes';

async function migrate(): Promise<void> {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        quantity    NUMERIC NOT NULL DEFAULT 1,
        unit        TEXT NOT NULL DEFAULT 'pcs',
        category    TEXT NOT NULL DEFAULT 'other',
        photo_key   TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Optional expiry tracking — nullable so existing rows (and any future
    // manual add without a known date) stay valid; the app fills a
    // per-category estimate at insert time when the caller doesn't supply one.
    await client.query(`
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS expiry_date DATE
    `);

    // Category taxonomy rename (meat -> protein, grain -> pantry) — safe to
    // run every deploy, becomes a no-op once existing rows are migrated.
    await client.query(`UPDATE inventory_items SET category = 'protein' WHERE category = 'meat'`);
    await client.query(`UPDATE inventory_items SET category = 'pantry' WHERE category = 'grain'`);

    // Backfill rows that predate this column (or otherwise have no
    // estimate) using the same per-category defaults the scan endpoint
    // applies to new items, anchored to when each item was actually added.
    await client.query(`
      UPDATE inventory_items
      SET expiry_date = created_at::date + (
        CASE category
          WHEN 'produce'   THEN 7
          WHEN 'dairy'     THEN 10
          WHEN 'protein'   THEN 3
          WHEN 'pantry'    THEN 180
          WHEN 'condiment' THEN 365
          WHEN 'beverage'  THEN 270
          WHEN 'frozen'    THEN 90
          ELSE 14
        END * INTERVAL '1 day'
      )
      WHERE expiry_date IS NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS recipes (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id              SERIAL PRIMARY KEY,
        recipe_id       INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        ingredient_name TEXT NOT NULL,
        match_term      TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_list_items (
        id              SERIAL PRIMARY KEY,
        ingredient_name TEXT NOT NULL,
        recipe_name     TEXT,
        checked         BOOLEAN NOT NULL DEFAULT false,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Case-insensitive de-dup — generating a shopping list from a second
    // recipe merges shared ingredients instead of duplicating them.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS shopping_list_items_ingredient_lower_idx
      ON shopping_list_items (lower(ingredient_name))
    `);

    // Seed (or re-sync) the recipe catalog. Upserting on the unique name
    // and re-inserting ingredients fresh each run keeps this idempotent —
    // safe to run on every deploy, and edits to SEED_RECIPES take effect
    // on the next one.
    for (const recipe of SEED_RECIPES) {
      const result = await client.query<{ id: number }>(
        `INSERT INTO recipes (name, description)
         VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
        [recipe.name, recipe.description],
      );
      const recipeId = result.rows[0].id;

      await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [recipeId]);

      for (const ingredient of recipe.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_name, match_term)
           VALUES ($1, $2, $3)`,
          [recipeId, ingredient.name, ingredient.matchTerm.toLowerCase()],
        );
      }
    }

    console.log(`Migration completed successfully (${SEED_RECIPES.length} recipes seeded)`);
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
