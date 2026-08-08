import express from 'express';
import multer from 'multer';
import path from 'path';
import { pool } from './db';
import { uploadPhoto } from './storage';
import { identifyItems } from './vision';
import { matchRecipes } from './recipeMatch';
import { estimateExpiryDate } from './expiry';
import { listShoppingList, generateFromRecipe, setChecked, deleteShoppingItem, clearChecked } from './shoppingList';
import { UnsupportedFileTypeError, ImageProcessingError } from './errors';
import { VALID_CATEGORY_VALUES } from './categories';

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
      // No expiry comes back from the vision call — seed a per-category
      // estimate so the item is immediately eligible for "use soon".
      const expiryDate = estimateExpiryDate(item.category);
      const result = await pool.query(
        `INSERT INTO inventory_items (name, quantity, unit, category, photo_key, expiry_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, quantity, unit, category, photo_key, expiry_date, created_at, updated_at`,
        [item.name, item.quantity, item.unit, item.category, photoKey, expiryDate],
      );
      inserted.push(result.rows[0]);
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

    const result = await pool.query(
      `INSERT INTO inventory_items (name, quantity, unit, category, expiry_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, quantity, unit, category, photo_key, expiry_date, created_at, updated_at`,
      [name, quantity, unit, category, expiryDate],
    );

    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Manual add failed:', message);
    res.status(500).json({ error: 'Failed to add item. Please try again.' });
  }
});

app.get('/api/inventory', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, quantity, unit, category, photo_key, expiry_date, created_at, updated_at FROM inventory_items ORDER BY created_at DESC',
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

    const result = await pool.query(
      `UPDATE inventory_items
       SET name = COALESCE($1, name),
           quantity = COALESCE($2, quantity),
           unit = COALESCE($3, unit),
           category = COALESCE($4, category),
           expiry_date = CASE WHEN $6 THEN $5::date ELSE expiry_date END,
           updated_at = now()
       WHERE id = $7
       RETURNING id, name, quantity, unit, category, photo_key, expiry_date, created_at, updated_at`,
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

app.get('/api/recipes/match', async (_req, res) => {
  try {
    const result = await matchRecipes(pool);
    res.status(200).json(result);
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
