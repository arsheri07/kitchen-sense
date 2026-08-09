import { Client } from 'pg';
import { SEED_RECIPES, deriveDietaryTags, deriveProteinTypes } from './seedRecipes';

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

    // Per-item vision confidence ('high'/'low') — 'low' surfaces a review
    // flag in the UI instead of silently trusting an uncertain detection.
    // Manual adds and manually-edited items are always 'high' (a human
    // reviewed them); existing rows predating this column default to
    // 'high' too, since they were never flagged either way.
    await client.query(`
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'high'
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

    // steps: numbered cooking instructions. photo_url: Pexels image cached
    // per recipe on first request rather than re-fetched every page load —
    // nullable and deliberately left OUT of the seed upsert below so
    // re-seeding never clobbers an already-cached photo.
    await client.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS steps TEXT[]`);
    await client.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS photo_url TEXT`);

    // Dietary restrictions this recipe satisfies (vegetarian/vegan/
    // gluten-free/dairy-free/nut-free), plus a coarse 'high-protein' tag —
    // derived from ingredients at seed time below, not hand-authored, so
    // it can't drift out of sync.
    await client.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] DEFAULT '{}'`);

    // Canonical protein types this recipe features (chicken/beef/fish/
    // shrimp/egg/tofu/legumes) — used to rank recipes higher when they
    // use a protein the user marked as a favorite. Soft ranking signal,
    // not a filter: unlike dietary_tags/restrictions, no recipe is ever
    // excluded for missing a favorite protein.
    await client.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS protein_types TEXT[] DEFAULT '{}'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id              SERIAL PRIMARY KEY,
        recipe_id       INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        ingredient_name TEXT NOT NULL,
        match_term      TEXT NOT NULL
      )
    `);

    // amount: proportion shown alongside the ingredient name, e.g. "2 cups".
    await client.query(`ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS amount TEXT`);

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

    // Many-to-many: one shopping list item can be needed by several
    // recipes (e.g. a meal-plan week where two days both need garlic).
    // The old single recipe_name column on shopping_list_items predates
    // this and is left in place unused rather than dropped destructively —
    // this table is the source of truth going forward.
    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_list_sources (
        shopping_list_item_id INTEGER NOT NULL REFERENCES shopping_list_items(id) ON DELETE CASCADE,
        recipe_name            TEXT NOT NULL,
        PRIMARY KEY (shopping_list_item_id, recipe_name)
      )
    `);

    // One-time backfill: carry any existing single recipe_name tags over
    // into the new table so nothing already on a list loses its source.
    await client.query(`
      INSERT INTO shopping_list_sources (shopping_list_item_id, recipe_name)
      SELECT id, recipe_name FROM shopping_list_items
      WHERE recipe_name IS NOT NULL
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS meal_plan_days (
        day_index  INTEGER PRIMARY KEY,
        recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Singleton row (id = 1): dietary restrictions + free-text avoid terms
    // (hard filters), applied everywhere recipes are surfaced (matching,
    // meal plan, suggestions). Seeded once with no restrictions — never
    // overwritten on subsequent migration runs.
    await client.query(`
      CREATE TABLE IF NOT EXISTS preferences (
        id          INTEGER PRIMARY KEY DEFAULT 1,
        restrictions TEXT[] NOT NULL DEFAULT '{}',
        avoid_terms  TEXT[] NOT NULL DEFAULT '{}',
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT preferences_singleton CHECK (id = 1)
      )
    `);
    await client.query(`INSERT INTO preferences (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

    // Soft taste/nutrition signals — these never exclude a recipe the way
    // restrictions/avoid_terms do. They only influence ranking: a matching
    // recipe sorts higher, a non-matching one stays visible just lower.
    await client.query(`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS high_protein BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS favorite_proteins TEXT[] NOT NULL DEFAULT '{}'`);
    await client.query(`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS quick_simple BOOLEAN NOT NULL DEFAULT false`);

    // Free-text preference extensions, alongside the fixed checkbox lists
    // above. Unlike restrictions/favorite_proteins (validated against a
    // known-good tag list), these are never checked against dietary_tags —
    // a made-up tag would match zero recipes and silently empty every
    // list. Instead they're routed through the same ingredient-name
    // substring matching avoid_terms already uses (recipeMatch.ts):
    // custom_restrictions hard-excludes like avoid_terms does,
    // custom_taste_terms soft-ranks the same way, custom_favorite_proteins
    // is unioned into the favorite-proteins ranking check as free text —
    // safe because an unmatched protein type just contributes 0.
    await client.query(`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS custom_restrictions TEXT[] NOT NULL DEFAULT '{}'`);
    await client.query(`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS custom_taste_terms TEXT[] NOT NULL DEFAULT '{}'`);
    await client.query(`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS custom_favorite_proteins TEXT[] NOT NULL DEFAULT '{}'`);

    // Seed (or re-sync) the recipe catalog. Upserting on the unique name
    // and re-inserting ingredients fresh each run keeps this idempotent —
    // safe to run on every deploy, and edits to SEED_RECIPES take effect
    // on the next one.
    for (const recipe of SEED_RECIPES) {
      const proteinTypes = deriveProteinTypes(recipe.ingredients);
      const dietaryTags = deriveDietaryTags(recipe.ingredients);
      if (proteinTypes.length > 0) dietaryTags.push('high-protein');

      const result = await client.query<{ id: number }>(
        `INSERT INTO recipes (name, description, steps, dietary_tags, protein_types)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, steps = EXCLUDED.steps, dietary_tags = EXCLUDED.dietary_tags, protein_types = EXCLUDED.protein_types
         RETURNING id`,
        [recipe.name, recipe.description, recipe.steps, dietaryTags, proteinTypes],
      );
      const recipeId = result.rows[0].id;

      await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [recipeId]);

      for (const ingredient of recipe.ingredients) {
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_name, match_term, amount)
           VALUES ($1, $2, $3, $4)`,
          [recipeId, ingredient.name, ingredient.matchTerm.toLowerCase(), ingredient.amount],
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
