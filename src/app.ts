import express from 'express';
import multer from 'multer';
import path from 'path';
import { pool } from './db';
import { uploadPhoto, getPhoto } from './storage';
import { identifyItems, reanalyzeSingleItem } from './vision';
import { matchRecipes, getRecipeDetail } from './recipeMatch';
import { estimateExpiryDate } from './expiry';
import {
  listShoppingList,
  generateFromRecipe,
  generateFromMealPlan,
  addManualItem,
  setChecked,
  deleteShoppingItem,
  clearChecked,
} from './shoppingList';
import { generateMealPlan, getMealPlan } from './mealPlan';
import { UnsupportedFileTypeError, ImageProcessingError } from './errors';
import { VALID_CATEGORY_VALUES } from './categories';
import { getPreferences, setPreferences, DIETARY_RESTRICTIONS, PROTEIN_TYPES } from './preferences';
import { getBestRecipeToCook } from './suggest';

const USE_SOON_WINDOW_DAYS = 3;

// sharp (and Claude's vision input) reliably handles these — reject
// anything else up front rather than letting it fail deeper in the pipeline.
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(new UnsupportedFileTypeError(file.mimetype));
      return;
    }
    cb(null, true);
  },
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Scan a fridge/pantry photo: store it in object storage, run the vision
// call to identify items, persist the results, and return them.
app.post('/api/inventory/scan', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No photo uploaded (field name must be "photo")' });
      return;
    }

    const { buffer, mimetype } = req.file;

    // Store the original photo in object storage so the API container
    // itself holds no image bytes — any container can serve any request.
    // Uploaded (and photoKey returned) regardless of what happens next, so
    // a failed or empty vision call never loses the photo itself.
    const photoKey = await uploadPhoto(buffer, mimetype);

    let vision;
    try {
      vision = await identifyItems(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Vision call failed:', message);

      if (err instanceof ImageProcessingError) {
        res.status(400).json({ photoKey, error: message });
        return;
      }
      // VisionAPIError / VisionParseError / anything unexpected from the
      // vision layer: don't leak upstream detail to the client, just
      // point them at retry-or-manual-add. Full detail is already logged.
      res.status(502).json({
        photoKey,
        error: 'We could not analyze this photo right now. Try again, or add items manually below.',
      });
      return;
    }

    const { imageQuality, items, nonFoodItems } = vision;

    if (imageQuality === 'blurry') {
      res.status(200).json({
        photoKey,
        imageQuality,
        items: [],
        skippedNonFood: [],
        message: 'This photo looks too blurry or dark to identify items confidently. Try retaking it with better light and focus, or add items manually below.',
      });
      return;
    }

    // Non-food objects (toiletries, cleaning products, kitchenware, etc.)
    // are never inserted — just reported back so nothing food-only ends
    // up silently mixed into the inventory.
    const nonFoodNote =
      nonFoodItems.length > 0
        ? `${nonFoodItems.length} non-food item${nonFoodItems.length > 1 ? 's' : ''} detected and not added: ${nonFoodItems.join(', ')}.`
        : null;

    if (items.length === 0) {
      const message = nonFoodNote
        ? `No food items were detected in this photo. ${nonFoodNote}`
        : 'No food items were detected in this photo. If that seems wrong, try a clearer photo, or add items manually below.';
      res.status(200).json({ photoKey, imageQuality, items: [], skippedNonFood: nonFoodItems, message });
      return;
    }

    const inserted = [];
    for (const item of items) {
      // Re-scanning the same fridge/pantry commonly re-detects items
      // already tracked — merge into the existing row (case-insensitive
      // exact name match) instead of creating a duplicate. The new scan
      // reflects what's there right now, so quantity/unit/category/photo
      // are refreshed to this observation; an existing expiry estimate is
      // left as-is rather than overwritten just because the item was
      // seen again (don't clobber a manual edit). Checking the DB before
      // each insert (not batching) also naturally merges duplicate names
      // detected within this same scan.
      const existing = await pool.query<{ id: number }>('SELECT id FROM inventory_items WHERE lower(name) = lower($1) LIMIT 1', [
        item.name,
      ]);

      let result;
      const merged = existing.rows.length > 0;
      if (merged) {
        result = await pool.query(
          `UPDATE inventory_items
           SET quantity = $1, unit = $2, category = $3, photo_key = $4, confidence = $5, updated_at = now()
           WHERE id = $6
           RETURNING id, name, quantity, unit, category, photo_key, expiry_date, confidence, created_at, updated_at`,
          [item.quantity, item.unit, item.category, photoKey, item.confidence, existing.rows[0].id],
        );
      } else {
        // No expiry comes back from the vision call — seed a per-category
        // estimate so the item is immediately eligible for "use soon".
        const expiryDate = estimateExpiryDate(item.category);
        result = await pool.query(
          `INSERT INTO inventory_items (name, quantity, unit, category, photo_key, expiry_date, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, name, quantity, unit, category, photo_key, expiry_date, confidence, created_at, updated_at`,
          [item.name, item.quantity, item.unit, item.category, photoKey, expiryDate, item.confidence],
        );
      }
      inserted.push({ ...result.rows[0], merged });
    }

    res.status(201).json({
      photoKey,
      imageQuality,
      items: inserted,
      skippedNonFood: nonFoodItems,
      ...(nonFoodNote ? { message: nonFoodNote } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Scan failed unexpectedly:', message);
    res.status(500).json({ error: 'Something went wrong while scanning this photo. Try again, or add items manually below.' });
  }
});

// Manual fallback for when the vision call fails, misreads something, or
// the user just prefers typing — same table, same shape as scanned items.
app.post('/api/inventory', async (req, res) => {
  try {
    const body = req.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    if (!name) {
      res.status(400).json({ error: 'Item name is required.' });
      return;
    }

    const quantityNum = Number(body.quantity);
    const quantity = Number.isFinite(quantityNum) && quantityNum > 0 ? quantityNum : 1;
    const unit = typeof body.unit === 'string' && body.unit.trim() ? body.unit.trim().slice(0, 50) : 'pcs';
    const category = typeof body.category === 'string' && VALID_CATEGORY_VALUES.has(body.category) ? body.category : 'other';
    const expiryDate =
      typeof body.expiryDate === 'string' && body.expiryDate ? body.expiryDate : estimateExpiryDate(category);

    // Manually typed items are always full-confidence — a human chose the
    // name and quantity directly, nothing to flag for review.
    const result = await pool.query(
      `INSERT INTO inventory_items (name, quantity, unit, category, expiry_date, confidence)
       VALUES ($1, $2, $3, $4, $5, 'high')
       RETURNING id, name, quantity, unit, category, photo_key, expiry_date, confidence, created_at, updated_at`,
      [name, quantity, unit, category, expiryDate],
    );

    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Manual add failed:', message);
    res.status(500).json({ error: 'Failed to add item. Please try again.' });
  }
});

// Re-runs vision against a single item's already-stored photo, narrowed to
// just that item — lets a low-confidence detection get resolved without a
// full re-scan of everything else already in the inventory. The manual-edit
// PUT above remains the other correction path for when the user just knows
// the right answer without needing the model to look again.
app.post('/api/inventory/:id/reanalyze', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid item id' });
      return;
    }

    const itemResult = await pool.query<{ id: number; name: string; photo_key: string | null }>(
      'SELECT id, name, photo_key FROM inventory_items WHERE id = $1',
      [id],
    );
    if (itemResult.rows.length === 0) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    const { name, photo_key: photoKey } = itemResult.rows[0];
    if (!photoKey) {
      res.status(400).json({ error: 'No photo on file for this item — it was added manually. Edit it directly instead.' });
      return;
    }

    const photoBuffer = await getPhoto(photoKey);
    const analysis = await reanalyzeSingleItem(photoBuffer, name);

    if (!analysis.found) {
      res.status(200).json({
        found: false,
        message: analysis.note || `"${name}" was not clearly visible in its photo on a second look. Edit it manually if needed.`,
      });
      return;
    }

    const result = await pool.query(
      `UPDATE inventory_items
       SET quantity = $1, unit = $2, confidence = $3, updated_at = now()
       WHERE id = $4
       RETURNING id, name, quantity, unit, category, photo_key, expiry_date, confidence, created_at, updated_at`,
      [analysis.quantity, analysis.unit, analysis.confidence, id],
    );

    res.status(200).json({ found: true, item: result.rows[0], note: analysis.note });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Item re-analysis failed:', message);
    res.status(502).json({ error: 'Could not re-analyze this item right now. Try again, or edit it manually.' });
  }
});

// Clears the whole inventory plus any shopping list state AND the stored
// meal plan — both were derived from recipe matches against that
// inventory, so both are stale the moment the inventory is gone. Leaving
// the meal plan in place was a bug: its days keep pointing at whatever
// recipes were picked against the old inventory, so the Meal Plan tab
// kept showing a plan built from data that no longer exists. Confirmation
// happens client-side; this endpoint just executes.
app.delete('/api/inventory', async (_req, res) => {
  try {
    const itemsResult = await pool.query('DELETE FROM inventory_items');
    const shoppingResult = await pool.query('DELETE FROM shopping_list_items');
    const mealPlanResult = await pool.query('DELETE FROM meal_plan_days');
    res.status(200).json({
      itemsRemoved: itemsResult.rowCount ?? 0,
      shoppingListItemsRemoved: shoppingResult.rowCount ?? 0,
      mealPlanDaysRemoved: mealPlanResult.rowCount ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Reset inventory failed:', message);
    res.status(500).json({ error: 'Failed to reset inventory. Please try again.' });
  }
});

app.get('/api/inventory', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, quantity, unit, category, photo_key, expiry_date, confidence, created_at, updated_at FROM inventory_items ORDER BY created_at DESC',
    );
    res.status(200).json({ items: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

// Anything already past its expiry estimate or landing within the next
// USE_SOON_WINDOW_DAYS days — ordered soonest-first.
app.get('/api/inventory/use-soon', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, quantity, unit, category, expiry_date,
              (expiry_date - CURRENT_DATE) AS days_until_expiry
       FROM inventory_items
       WHERE expiry_date IS NOT NULL
         AND expiry_date <= CURRENT_DATE + $1::int
       ORDER BY expiry_date ASC`,
      [USE_SOON_WINDOW_DAYS],
    );
    res.status(200).json({ items: result.rows, windowDays: USE_SOON_WINDOW_DAYS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body ?? {};
    const { name, quantity, unit, category, expiryDate } = body;
    // Distinguish "field omitted" (leave expiry alone) from "field sent
    // as null" (explicitly clear it) — COALESCE alone can't do that.
    const hasExpiryDate = Object.prototype.hasOwnProperty.call(body, 'expiryDate');

    // A manual save through the edit form is a human reviewing/correcting
    // this row directly — always clears any low-confidence review flag,
    // independent of which fields actually changed.
    const result = await pool.query(
      `UPDATE inventory_items
       SET name = COALESCE($1, name),
           quantity = COALESCE($2, quantity),
           unit = COALESCE($3, unit),
           category = COALESCE($4, category),
           expiry_date = CASE WHEN $6 THEN $5::date ELSE expiry_date END,
           confidence = 'high',
           updated_at = now()
       WHERE id = $7
       RETURNING id, name, quantity, unit, category, photo_key, expiry_date, confidence, created_at, updated_at`,
      [name ?? null, quantity ?? null, unit ?? null, category ?? null, expiryDate ?? null, hasExpiryDate, id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    res.status(200).json({ item: result.rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM inventory_items WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

// Dietary preferences: hard restrictions + free-text avoid terms (exclude
// outright) plus soft taste/nutrition signals — high-protein and favorite
// protein types (rank higher, never exclude). Applied inside
// matchRecipes() itself, so every surface built on top of it — the match
// lists below, the meal planner, and the cook suggestion — automatically
// respects and ranks by whatever is saved here.
app.get('/api/preferences', async (_req, res) => {
  try {
    const prefs = await getPreferences(pool);
    res.status(200).json({ ...prefs, availableRestrictions: DIETARY_RESTRICTIONS, availableProteinTypes: PROTEIN_TYPES });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

app.put('/api/preferences', async (req, res) => {
  try {
    const body = req.body ?? {};
    const prefs = await setPreferences(pool, {
      restrictions: body.restrictions,
      avoidTerms: body.avoidTerms,
      highProtein: body.highProtein,
      favoriteProteins: body.favoriteProteins,
      quickSimple: body.quickSimple,
    });
    res.status(200).json(prefs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Saving preferences failed:', message);
    res.status(500).json({ error: 'Failed to save preferences. Please try again.' });
  }
});

app.get('/api/recipes/match', async (_req, res) => {
  try {
    const result = await matchRecipes(pool);
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

// The single best recipe to cook right now — fully ready, closest to
// expiring, respecting active preferences. Distinct from a random
// "Surprise Me" pick. Registered before /api/recipes/:id so "suggest"
// isn't swallowed as an :id value.
app.get('/api/recipes/suggest', async (_req, res) => {
  try {
    const suggestion = await getBestRecipeToCook(pool);
    if (!suggestion) {
      res.status(200).json({
        recipe: null,
        message: 'Nothing is fully ready to make right now — scan more items or check Almost There.',
      });
      return;
    }
    res.status(200).json(suggestion);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Cook suggestion failed:', message);
    res.status(503).json({ error: message });
  }
});

// Full single-recipe detail (steps, ingredient amounts, dish photo) —
// fetched lazily when a recipe card is expanded, not part of the bulk
// list above. Registered after /match so that literal path isn't
// shadowed by this :id param route.
app.get('/api/recipes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid recipe id' });
      return;
    }

    const detail = await getRecipeDetail(pool, id);
    if (!detail) {
      res.status(404).json({ error: 'Recipe not found' });
      return;
    }

    res.status(200).json(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Recipe detail fetch failed:', message);
    res.status(503).json({ error: message });
  }
});

// Generates a 5-7 day meal plan: recipes tied to soon-expiring inventory
// are placed first, remaining days greedily minimize new shopping.
// Replaces any previously stored plan.
app.post('/api/meal-plan/generate', async (req, res) => {
  try {
    const days = await generateMealPlan(pool, req.body?.days);
    res.status(201).json({ days });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Meal plan generation failed:', message);
    res.status(503).json({ error: message });
  }
});

app.get('/api/meal-plan', async (_req, res) => {
  try {
    const days = await getMealPlan(pool);
    res.status(200).json({ days });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

// Generates a shopping list from a recipe's missing ingredients. Merges
// into the existing list (case-insensitive dedup) rather than replacing it.
app.post('/api/shopping-list/generate', async (req, res) => {
  try {
    const recipeId = Number(req.body?.recipeId);
    if (!Number.isInteger(recipeId)) {
      res.status(400).json({ error: 'recipeId (integer) is required' });
      return;
    }

    const result = await generateFromRecipe(pool, recipeId);
    if (!result) {
      res.status(404).json({ error: 'Recipe not found' });
      return;
    }

    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

// Same as /generate, but pulls missing ingredients across every day of
// the current meal plan at once, tagging shared ingredients with each
// day's recipe.
app.post('/api/shopping-list/generate-from-plan', async (_req, res) => {
  try {
    const result = await generateFromMealPlan(pool);
    if (!result) {
      res.status(404).json({ error: 'No meal plan yet — generate one first.' });
      return;
    }

    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

// User-typed addition, independent of any recipe — kept separate from
// /generate so the frontend can show a plain text input.
app.post('/api/shopping-list', async (req, res) => {
  try {
    const name = typeof req.body?.ingredientName === 'string' ? req.body.ingredientName.trim().slice(0, 200) : '';
    if (!name) {
      res.status(400).json({ error: 'Item name is required.' });
      return;
    }

    const item = await addManualItem(pool, name);
    if (!item) {
      res.status(200).json({ item: null, message: 'Already on the list.' });
      return;
    }

    res.status(201).json({ item });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Manual shopping-list add failed:', message);
    res.status(500).json({ error: 'Failed to add item. Please try again.' });
  }
});

app.get('/api/shopping-list', async (_req, res) => {
  try {
    const items = await listShoppingList(pool);
    res.status(200).json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

app.put('/api/shopping-list/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const checked = Boolean(req.body?.checked);
    const item = await setChecked(pool, id, checked);
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.status(200).json({ item });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

// Registered ahead of DELETE /api/shopping-list/:id so "checked" isn't
// swallowed as an :id value.
app.delete('/api/shopping-list/checked', async (_req, res) => {
  try {
    const removed = await clearChecked(pool);
    res.status(200).json({ removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

app.delete('/api/shopping-list/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deleted = await deleteShoppingItem(pool, id);
    if (!deleted) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'OK' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ status: `ERROR: ${message}` });
  }
});

// Express-recognized error middleware (4-arg signature required) — catches
// multer's fileFilter/size rejections thrown from upload.single('photo')
// before a route handler ever runs, so a bad upload gets a clean JSON
// response instead of Express's default HTML error page.
const errorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof UnsupportedFileTypeError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'Photo is too large — please upload an image under 8MB.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong processing your request.' });
};
app.use(errorHandler);

export default app;
