# KitchenSense

An AI-vision kitchen inventory assistant. Photograph your fridge or pantry, get a structured, editable inventory back, and let the app tell you what to cook, plan your week, and build your shopping list from there.

**Live app:** https://appstage-2adc-3000.prg1.zerops.app
**Dev environment:** https://appdev-2adc-3000.prg1.zerops.app

---

## What it does

**Photo → inventory.** Upload one or more photos of a fridge, freezer, or pantry shelf. A vision model identifies each distinct food/grocery item, estimates its quantity and unit, assigns a category, and flags anything it wasn't confident about. Non-food objects it notices (toiletries, cleaning supplies, kitchenware) are reported separately and never added to the inventory. Re-scanning a photo — or scanning several at once for different shelves — merges overlapping items by updating quantity rather than creating duplicate rows. A low-confidence item can be corrected two ways: edit it by hand, or hit "Re-analyze from photo," which re-runs vision against just that item using its already-stored photo.

**Recipe matching.** Every recipe in the catalog is checked against current inventory and split into **Ready to Make** (nothing missing) and **Almost There** (missing 1+ ingredients, with a user-chosen "Show" cap — 5/10/15/20/All — so the list stays scannable by default but nothing is ever hidden from anyone who wants the full list). A **"What should I cook right now?"** button gives one deterministic best pick: fully ready, prioritizing whatever uses ingredients closest to expiring, rendered as its own loading/result/nothing-ready panel on the Recipes tab.

**Dietary preferences.** A settings panel (gear icon) holds two kinds of preference, each with a fixed checklist plus a free-text field for anything not on it:
- *Hard restrictions* — vegetarian, vegan, pescatarian, gluten-free, dairy-free, nut-free, low-carb, keto, plus free-text ingredients to avoid and free-text custom restrictions (matched the same way, by ingredient name). Any recipe that violates one is excluded outright, everywhere recipes are surfaced.
- *Soft ranking signals* — "prefer high-protein recipes", "prefer quick & simple recipes (fewer ingredients)", a favorite-protein-types list (chicken, beef, fish, shrimp, egg, tofu, legumes, pork, turkey, lamb) plus free-text custom proteins, and free-text custom taste terms matched against ingredient names. These never hide a recipe; they just rank better matches higher while everything else stays visible — an unmatched custom term simply contributes nothing.

Both restrictions and dietary/protein tags are derived automatically from each recipe's ingredient list, not hand-authored, so the classification can't drift out of sync. Free-text preferences are never checked against those derived tags (a made-up tag would match nothing and silently empty every list) — they're routed through the same ingredient-substring matching as the avoid-ingredients field.

**Weekly meal plan.** Generates a 5–7 day plan from the recipe catalog and current inventory: days tied to soon-expiring stock are placed first (soonest expiry wins), remaining days are filled greedily to minimize additional shopping across the week, with dietary preference as a tie-breaker throughout. Each day expands into the full recipe (photo, ingredients with proportions, numbered steps) with a Start Cooking shortcut.

**Shopping list.** Auto-generated from a single recipe's missing ingredients or from the whole week's plan at once — items needed by more than one recipe get tagged with every recipe that needs them, not duplicated. View it as a flat checklist or grouped into collapsible per-dish sections. Manually-added items are visually distinct from recipe-generated ones. A "Copy list" button copies the current list as plain text.

**Cook Mode.** A full-screen, distraction-free step-by-step view for any recipe: one step at a time, large text, next/back navigation, a per-step done checkbox, and an automatically parsed countdown timer for any step that mentions a duration (e.g. "simmer 10 minutes").

**Reset Inventory.** Clears inventory, the shopping list, and the stored meal plan together (a two-step confirm to avoid accidental triggers) — every dependent view goes back to a genuine empty state, not stale leftovers.

---

## Architecture

Single Express + TypeScript service, one PostgreSQL database, one S3-compatible object store for photos, and a single static HTML/JS frontend with no build step or framework.

```
Browser (public/index.html — vanilla JS, no framework)
        │  fetch() JSON API
        ▼
Express app (src/app.ts) ── routes for inventory, recipes, meal plan,
        │                    shopping list, preferences
        ├──► PostgreSQL (src/db.ts)        — all structured data
        ├──► Object storage (src/storage.ts) — uploaded photos (S3 API)
        └──► Anthropic API (src/vision.ts)  — photo → item extraction
             Pexels API (src/pexels.ts)     — recipe photo lookup
```

### Backend modules (`src/`)

| File | Responsibility |
|---|---|
| `app.ts` | All HTTP routes — inventory CRUD/scan, recipe match/detail/suggest, meal plan, shopping list, preferences |
| `db.ts` | PostgreSQL connection pool |
| `storage.ts` | Upload/download photos to/from S3-compatible object storage |
| `vision.ts` | Claude vision calls — full-photo scan and single-item re-analysis |
| `pexels.ts` | Best-effort recipe photo lookup, cached per recipe |
| `categories.ts` | Inventory category taxonomy (Produce, Dairy, Protein, Pantry/Canned, Condiments, Beverages, Frozen, Other) |
| `expiry.ts` | Per-category default shelf-life estimates |
| `recipeMatch.ts` | Ready-to-make / almost-there matching, dietary-preference filtering and ranking |
| `preferences.ts` | Dietary preference storage — restrictions, avoid terms, high-protein, quick-simple, favorite proteins, plus their free-text custom counterparts |
| `urgency.ts` | Shared "soonest expiring ingredient per recipe" calculation |
| `mealPlan.ts` | Weekly meal plan generation (urgency-first, then shopping-minimizing greedy fill) |
| `suggest.ts` | "What should I cook right now?" single best pick |
| `shoppingList.ts` | Shopping list generation (per recipe / per plan), manual items, multi-recipe source tagging |
| `seedRecipes.ts` | The recipe catalog (38 recipes) plus derivation of dietary tags and protein types from ingredients |
| `migrate.ts` | Idempotent schema migration + recipe reseed, run once per deploy |
| `errors.ts` | Typed errors for the upload/vision pipeline |
| `index.ts` | HTTP server bootstrap |

### Data (PostgreSQL)

`inventory_items`, `recipes` (+ `recipe_ingredients`), `shopping_list_items` (+ `shopping_list_sources` for multi-recipe tagging), `meal_plan_days`, `preferences` (singleton row). Migrations are additive and idempotent (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), run automatically on every deploy via `zsc execOnce` so it's safe across repeated container starts.

### Frontend

`public/index.html` is a single static file — no React/Vue/build step. Vanilla JS, CSS custom properties for a dark-first theme (with a light-mode variant), and a consistent collapse/expand accordion pattern reused across inventory categories, recipe cards, meal plan days, and shopping-list dish groups.

---

## AI

- **Vision — [Claude Haiku 4.5](https://www.anthropic.com/claude) (`claude-haiku-4-5-20251001`)**, called directly via the Anthropic Messages API (`src/vision.ts`). Each photo is resized to ~1024px on the long edge (`sharp`) before sending, to keep image tokens down. Every call is stateless — no conversation history carried between scans. Used for two things: (1) full-photo inventory extraction (item name, quantity, unit, category, confidence, non-food flagging), and (2) narrowed single-item re-analysis when correcting a low-confidence detection.
- **Pexels API** — not AI, but the other external integration: looks up a representative photo per recipe by dish name, cached in the database after the first fetch so it's never re-queried.
- Built with **Claude Code** (Anthropic's agentic coding CLI) orchestrating development through **Zerops' control-plane MCP tools** — provisioning, deploys, env/secrets, and live verification were all driven through that integration rather than manual ops.

All API keys (`ANTHROPIC_API_KEY`, `PEXELS_API_KEY`) are stored as encrypted Zerops service secrets — never committed to source or written to `zerops.yaml`.

---

## Zerops

Two `nodejs@22` runtime services form a standard dev/stage pair, plus two managed dependencies:

| Service | Role |
|---|---|
| `appdev` (Ubuntu) | Development runtime — SSH-accessible, full source deployed, supervised `ts-node` process so it survives container cycles |
| `appstage` (Alpine) | Build target — compiled TypeScript, production dependencies only, the live app |
| `db` | Managed PostgreSQL |
| `storage` | Managed S3-compatible object storage (photo uploads) |

**Build & run** (`zerops.yaml`, two setups):
- `prod` (used by `appstage`): `npm ci && npm run build && npm prune --omit=dev`, deploys `dist/` + production `node_modules` + `public/`. Migration runs once per deploy version via `zsc execOnce ${appVersionId} --retryUntilSuccessful -- node dist/migrate.js`, kept atomic with the code deploy. Readiness and health checks both hit `/api/health`.
- `dev` (used by `appdev`): deploys full source, runs directly via `ts-node` (no compile step) so edits can be made and re-verified quickly over SSH.

**Delivery model:** git-push. Code is committed and pushed to GitHub from `appdev` (the push source); `appstage` is the build target. Every change ships as: commit → push → sync to the running containers → `zerops_verify`.

**Managed dependencies:** `db` and `storage` connection details are injected as environment variables (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) via Zerops' cross-service `${service_key}` references in `zerops.yaml` — never hardcoded.

---

## Setup

Requires a Zerops project with this repo's `appdev`/`appstage` pair plus `db` (PostgreSQL) and `storage` (object storage) provisioned.

**Environment** (set as service env vars / encrypted secrets):

```
DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME     — from the db service (auto-wired)
S3_ENDPOINT, S3_BUCKET, S3_REGION,
S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY          — from the storage service (auto-wired)
ANTHROPIC_API_KEY                               — encrypted secret, required for photo scanning
PEXELS_API_KEY                                  — encrypted secret, optional (recipe photos degrade gracefully without it)
```

**Local/dev commands** (run inside the `appdev` container):

```bash
npm install                 # install dependencies
npx ts-node src/migrate.ts  # apply schema + reseed the recipe catalog
npx ts-node src/index.ts    # start the dev server on :3000
```

**Production build:**

```bash
npm ci
npm run build                # compiles src/ -> dist/
npm prune --omit=dev
node dist/migrate.js         # migration (also runs automatically on Zerops deploy)
node dist/index.js           # start on :3000
```

No frontend build step — `public/index.html` is served as-is by `express.static`.
