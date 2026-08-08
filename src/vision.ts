import sharp from 'sharp';
import { ImageProcessingError, VisionAPIError, VisionParseError } from './errors';
import { VALID_CATEGORY_VALUES } from './categories';

export interface DetectedItem {
  name: string;
  quantity: number;
  unit: string;
  category: string;
  // 'low' means the model itself wasn't confident about the identification
  // or the count — surfaced to the user as a review flag rather than
  // silently trusted. Also forced to 'low' defensively whenever the model's
  // quantity value didn't parse cleanly, regardless of what it self-reported.
  confidence: 'high' | 'low';
}

export type ImageQuality = 'ok' | 'blurry' | 'no_food';

export interface VisionResult {
  imageQuality: ImageQuality;
  items: DetectedItem[];
  // Clearly non-food objects the model noticed but deliberately excluded
  // from `items` (toiletries, cleaning products, kitchenware, etc.) — kept
  // separate so the caller can flag them instead of silently mixing them
  // into the food inventory.
  nonFoodItems: string[];
}

const VISION_MODEL = 'claude-haiku-4-5-20251001';
const MAX_EDGE_PX = 1024;

const PROMPT = `You are a kitchen inventory assistant. Look at this photo of a fridge or pantry and identify each distinct FOOD or GROCERY item visible — this app only tracks things you eat or drink.

If you see a clearly non-food PRODUCT placed in the fridge/pantry — toiletries, cleaning supplies, kitchenware/utensils, storage containers, electronics, or any other item that isn't food or drink — do NOT put it in "items". Instead list its name in a separate "nonFoodItems" array so the app can flag it as skipped rather than silently mixing it into the food inventory. Use the same specific-naming discipline for these too (e.g. "dish soap", not "bottle"; "sponge", not "cleaning supplies") — just a plain name string, no quantity/unit/category needed.

Do NOT report the fridge or pantry's own built-in structure — shelves, drawers, door bins, dividers, liners, ice trays, racks. These are part of the appliance itself, not objects someone placed there — ignore them completely (don't put them in "items" OR "nonFoodItems"). "nonFoodItems" is only for distinct, movable non-food products, never for the furniture holding everything. When no such product is visible, "nonFoodItems" must be an empty array.

First, assess the photo itself. Set "imageQuality" to one of:
- "ok" — you can make out at least one item with reasonable confidence
- "blurry" — the image is too out of focus, dark, or low-resolution to identify items confidently
- "no_food" — the photo is clear but shows no food, groceries, fridge, or pantry contents (e.g. an empty shelf, a wall, an unrelated object/scene)

When imageQuality is "blurry" or "no_food", "items" must be an empty array — do not guess at items you can't actually make out.

When imageQuality is "ok", for each item commit to your single best, most specific guess at what it actually is. Use every visible cue — label text, brand markings, jar/bottle/package shape, cap color, contents color — to name the specific food, not a vague description of its container.

Never hedge in the name with words like "or", "unidentified", "unspecified", "similar", or "possibly". Pick one specific answer and commit to it even under uncertainty — a home inventory app needs an actionable guess, not a disclaimer.

Correct:
- "pickles" (not "jarred items")
- "ketchup" (not "condiment bottle")
- "cola" (not "cola (or dark soda)")
- "canned black beans" (not "canned goods (unidentified)")
- "apple juice" (not "apple juice (or similar pale juice)")
- "jam" (not "jam (or preserves)" — pick the single more likely one)
- "leafy greens (lettuce/spinach)" — this parenthetical form is ONLY for a genuine 50/50 call between two SPECIFIC named foods, always leading with the more likely one

Wrong — never produce names shaped like these:
- "canned goods (unidentified)"
- "apple juice (or similar pale juice)"
- "cola (or dark soda)"
- anything pairing a specific guess with a vague fallback via "or"

If the same kind of item appears more than once in the photo, name every occurrence with the exact identical string — don't vary the wording between duplicates.

This exact name is what gets stored and displayed everywhere downstream, including matching against recipe ingredients — precision and consistency matter more than hedging.

For each item, count carefully rather than defaulting to 1. Actually look for count/volume cues: how many individual units are visible (bottles, cans, eggs, apples, yogurt cups), stack height, whether a carton/bag/jar is full, half-full, or nearly empty, and any printed size/weight on the label. Only report quantity 1 when you can genuinely see just one unit — never as a fallback for "didn't look closely".

If the same item type appears more than once in the photo (e.g. three yogurt cups, a six-pack of soda, two heads of lettuce), report it as ONE entry in "items" with "quantity" set to the total count you can see — do not create separate entries for each occurrence of the same item.

For each item, also set "confidence" to one of:
- "high" — you can clearly identify the item AND confidently count/estimate its quantity
- "low" — the identification is a genuine guess, the count is obscured/stacked/partially hidden, or you're otherwise not confident in the name or the quantity you reported

Be honest about "low" confidence — it's shown to the user as a "please double-check this" flag, not a failure. Guessing "high" to seem more useful is worse than an honest "low".

For each item, estimate an approximate quantity and a short unit (e.g. quantity 6 unit "pcs" for eggs; quantity 1 unit "carton" for milk; quantity 500 unit "g" for a bag of rice).

Respond with ONLY a JSON object, no prose, no markdown code fences, in exactly this shape:
{"imageQuality": "ok", "items": [{"name": "eggs", "quantity": 6, "unit": "pcs", "category": "dairy", "confidence": "high"}, {"name": "yogurt", "quantity": 3, "unit": "cups", "category": "dairy", "confidence": "low"}], "nonFoodItems": ["dish soap"]}

"category" must be exactly one of: produce, dairy, protein, pantry, condiment, beverage, frozen, other.
- produce: fresh fruits and vegetables
- dairy: milk, cheese, yogurt, butter, eggs
- protein: meat, poultry, fish, tofu, beans/legumes as a main protein source
- pantry: dry goods, canned goods, grains, pasta, rice, cereal, baking staples
- condiment: sauces, dressings, spreads, jams, ketchup, mustard
- beverage: drinks — juice, soda, water, coffee, tea (unless frozen)
- frozen: anything frozen, regardless of what it would otherwise be categorized as
- other: anything that doesn't clearly fit one of the above`;

// Downscales to ~1024px on the long edge and re-encodes as JPEG before the
// vision call — cuts image tokens substantially with no meaningful loss for
// identifying items in a fridge/pantry photo. The original (uncompressed)
// bytes are what's kept in object storage; this resized copy exists only
// in memory for the API request.
async function resizeForVision(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer)
      .rotate() // apply EXIF orientation before resizing, then drop it
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    // sharp throws on truncated/corrupt data or bytes that don't actually
    // decode as an image, regardless of what the upload claimed to be.
    throw new ImageProcessingError();
  }
}

// Calls the Claude Messages API with the resized image inlined as base64.
// Each call is a single, standalone request — no prior turns, no server-
// side conversation state carried between scans.
export async function identifyItems(imageBuffer: Buffer): Promise<VisionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new VisionAPIError('Vision service is not configured (missing API key).');
  }

  const resized = await resizeForVision(imageBuffer);
  const base64 = resized.toString('base64');

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 1024,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
              },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new VisionAPIError(`Could not reach the vision service: ${message}`);
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`Claude API error ${res.status}: ${body}`);
    throw new VisionAPIError(`Vision service returned an error (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const content = data.content?.find((block) => block.type === 'text')?.text ?? '';

  // The model is instructed to return bare JSON; strip markdown fences
  // defensively in case it wraps the object anyway.
  const jsonText = content.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new VisionParseError(`Vision response was not valid JSON: ${jsonText.slice(0, 500)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VisionParseError('Vision response JSON was not an object with the expected shape.');
  }

  const obj = parsed as Record<string, unknown>;
  const imageQuality: ImageQuality =
    obj.imageQuality === 'blurry' || obj.imageQuality === 'no_food' ? obj.imageQuality : 'ok';

  const rawItems = Array.isArray(obj.items) ? obj.items : [];

  const items = rawItems
    .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object' && typeof (it as Record<string, unknown>).name === 'string')
    .map((it) => {
      const rawQuantity = Number(it.quantity);
      // A quantity that didn't parse cleanly is itself a reason not to
      // trust this detection — forced to low regardless of what the model
      // self-reported for confidence.
      const quantityValid = Number.isFinite(rawQuantity) && rawQuantity > 0;
      const selfReported = it.confidence === 'high' || it.confidence === 'low' ? it.confidence : 'low';
      return {
        name: String(it.name).slice(0, 200),
        quantity: quantityValid ? rawQuantity : 1,
        unit: typeof it.unit === 'string' ? it.unit.slice(0, 50) : 'pcs',
        category: typeof it.category === 'string' && VALID_CATEGORY_VALUES.has(it.category) ? it.category : 'other',
        confidence: (quantityValid ? selfReported : 'low') as 'high' | 'low',
      };
    });

  const rawNonFood = Array.isArray(obj.nonFoodItems) ? obj.nonFoodItems : [];
  const nonFoodItems = rawNonFood
    .filter((it): it is string => typeof it === 'string' && it.trim().length > 0)
    .map((it) => it.trim().slice(0, 200));

  return { imageQuality, items: aggregateDuplicates(items), nonFoodItems };
}

// Defensive backstop for the prompt's "one entry per item type" instruction
// — if the model still returns the same item name+unit more than once in a
// single response, merge them into one row with a summed quantity rather
// than letting duplicate rows reach the inventory. A merge across a low-
// confidence detection keeps the row flagged.
function aggregateDuplicates(items: DetectedItem[]): DetectedItem[] {
  const byKey = new Map<string, DetectedItem>();
  for (const item of items) {
    const key = `${item.name.toLowerCase()}|${item.unit.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      if (item.confidence === 'low') existing.confidence = 'low';
    } else {
      byKey.set(key, { ...item });
    }
  }
  return Array.from(byKey.values());
}

export interface ReanalyzeResult {
  found: boolean;
  quantity: number;
  unit: string;
  confidence: 'high' | 'low';
  note: string | null;
}

const REANALYZE_PROMPT_PREFIX = (itemName: string) => `You are a kitchen inventory assistant helping double-check ONE specific item a previous scan flagged as low-confidence. Look carefully at this photo and focus specifically on: "${itemName}".

Look for the same count/volume cues as before: individual visible units, stack height, fill level, printed size on the label. Give your best current quantity and a short unit.

If you genuinely cannot find this item in the photo, or still can't confidently determine its quantity, say so honestly rather than guessing to seem helpful.

Respond with ONLY a JSON object, no prose, no markdown code fences, in exactly this shape:
{"found": true, "quantity": 3, "unit": "pcs", "confidence": "high", "note": null}

"found" is false if the item isn't visible in this photo at all. "confidence" is "high" only if you're now confident in both the identification and the count. "note" is a short (<100 char) explanation ONLY when found is false or confidence is "low" — otherwise null.`;

// Re-runs vision against the item's already-stored photo, but narrowed to
// a single named item — lets a user resolve one flagged detection without
// a full re-scan of everything else already in the inventory.
export async function reanalyzeSingleItem(imageBuffer: Buffer, itemName: string): Promise<ReanalyzeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new VisionAPIError('Vision service is not configured (missing API key).');
  }

  const resized = await resizeForVision(imageBuffer);
  const base64 = resized.toString('base64');

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 512,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              { type: 'text', text: REANALYZE_PROMPT_PREFIX(itemName) },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new VisionAPIError(`Could not reach the vision service: ${message}`);
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`Claude API error ${res.status}: ${body}`);
    throw new VisionAPIError(`Vision service returned an error (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const content = data.content?.find((block) => block.type === 'text')?.text ?? '';
  const jsonText = content.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new VisionParseError(`Re-analysis response was not valid JSON: ${jsonText.slice(0, 500)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VisionParseError('Re-analysis response JSON was not an object with the expected shape.');
  }

  const obj = parsed as Record<string, unknown>;
  const found = obj.found !== false;
  const rawQuantity = Number(obj.quantity);
  const quantityValid = Number.isFinite(rawQuantity) && rawQuantity > 0;

  return {
    found,
    quantity: quantityValid ? rawQuantity : 1,
    unit: typeof obj.unit === 'string' && obj.unit.trim() ? obj.unit.trim().slice(0, 50) : 'pcs',
    confidence: found && quantityValid && obj.confidence === 'high' ? 'high' : 'low',
    note: typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim().slice(0, 200) : null,
  };
}
