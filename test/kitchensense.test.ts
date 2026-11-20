// Unit tests for KitchenSense's pure logic, run with Node's built-in test
// runner (no extra dependencies):  npm test
//
// matchRecipes() is exercised end to end against a tiny in-memory stand-in
// for the Postgres pool that answers the four queries it makes, applying the
// same "inventory name contains match_term" rule the real SQL uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

import { planSwaps, SUBSTITUTIONS } from '../src/substitutions';
import { deriveDietaryTags, deriveProteinTypes, SEED_RECIPES } from '../src/seedRecipes';
import { estimateExpiryDate, DEFAULT_SHELF_LIFE_DAYS } from '../src/expiry';
import { computePreferenceScore, matchRecipes } from '../src/recipeMatch';
import { Preferences } from '../src/preferences';

const ing = (name: string, matchTerm: string, inStock: boolean) => ({ name, matchTerm, inStock });
const NO_RULES = { restrictions: [], avoidTerms: [] };

// ---------------------------------------------------------------- swaps

test('missing butter is covered by olive oil on the shelf', () => {
  const swaps = planSwaps(
    [ing('Pasta', 'pasta', true), ing('Butter', 'butter', false)],
    ['Pasta (penne)', 'Extra virgin olive oil'],
    NO_RULES,
  );
  assert.deepEqual(swaps.map((s) => [s.missing, s.use]), [['Butter', 'Extra virgin olive oil']]);
  assert.match(swaps[0].note, /olive oil/);
});

test('no swap is offered when no substitute is in stock', () => {
  assert.deepEqual(planSwaps([ing('Butter', 'butter', false)], ['Milk'], NO_RULES), []);
});

test('in-stock ingredients are never swapped', () => {
  assert.deepEqual(planSwaps([ing('Lemon', 'lemon', true)], ['Lime'], NO_RULES), []);
});

test('a substitute the recipe already uses is not double-counted', () => {
  // The recipe already calls for olive oil, so olive oil can't also cover
  // the butter — the next option (vegetable oil) is chosen instead.
  const swaps = planSwaps(
    [ing('Olive oil', 'olive oil', true), ing('Butter', 'butter', false)],
    ['Olive oil', 'Vegetable oil'],
    NO_RULES,
  );
  assert.equal(swaps[0].use, 'Vegetable oil');
});

test('one inventory item covers at most one missing ingredient', () => {
  // Vegetable oil could stand in for butter OR olive oil, not both.
  const swaps = planSwaps(
    [ing('Butter', 'butter', false), ing('Olive oil', 'olive oil', false)],
    ['Vegetable oil'],
    NO_RULES,
  );
  assert.equal(swaps.length, 1);
  assert.equal(swaps[0].missing, 'Butter');
});

test('dairy-free users are never told to use heavy cream', () => {
  const swaps = planSwaps([ing('Coconut milk', 'coconut milk', false)], ['Heavy cream'],
    { restrictions: ['dairy-free'], avoidTerms: [] });
  assert.deepEqual(swaps, []);
  // ...but without the restriction the same swap is offered
  assert.equal(planSwaps([ing('Coconut milk', 'coconut milk', false)], ['Heavy cream'], NO_RULES).length, 1);
});

test('gluten-free users are never told to thicken with flour', () => {
  const swaps = planSwaps([ing('Cornstarch', 'cornstarch', false)], ['All-purpose flour'],
    { restrictions: ['gluten-free'], avoidTerms: [] });
  assert.deepEqual(swaps, []);
});

test('a vegetarian recipe never gets a meat swap', () => {
  // lentil -> chickpea is fine; beef -> turkey would never be proposed for a
  // vegetarian because the swapped recipe fails the vegetarian tag.
  const swaps = planSwaps([ing('Beef', 'beef', false)], ['Turkey breast'],
    { restrictions: ['vegetarian'], avoidTerms: [] });
  assert.deepEqual(swaps, []);
});

test('free-text avoid terms block a substitute', () => {
  const swaps = planSwaps([ing('Lemon', 'lemon', false)], ['Lime'],
    { restrictions: [], avoidTerms: ['lime'] });
  assert.deepEqual(swaps, []);
});

test('every substitution key is a real ingredient in the catalog', () => {
  const catalogTerms = new Set(SEED_RECIPES.flatMap((r) => r.ingredients.map((i) => i.matchTerm)));
  for (const key of Object.keys(SUBSTITUTIONS)) {
    assert.ok(catalogTerms.has(key), `substitution for '${key}' matches no recipe ingredient`);
  }
});

// ---------------------------------------------------------- catalog/tags

test('dietary tags are derived from ingredients', () => {
  const tags = (terms: string[]) =>
    deriveDietaryTags(terms.map((t) => ({ name: t, matchTerm: t, amount: '' })));
  assert.ok(tags(['tomato', 'pepper']).includes('vegan'));
  assert.ok(!tags(['chicken']).includes('vegetarian'));
  assert.ok(tags(['salmon']).includes('pescatarian'));
  assert.ok(!tags(['salmon']).includes('vegetarian'));
  assert.ok(tags(['coconut milk']).includes('dairy-free'), 'coconut milk is not dairy');
  assert.ok(!tags(['bread']).includes('gluten-free'));
});

test('protein types come from known protein ingredients', () => {
  const types = deriveProteinTypes([
    { name: 'Steak', matchTerm: 'steak', amount: '' },
    { name: 'Rice', matchTerm: 'rice', amount: '' },
  ]);
  assert.deepEqual(types, ['beef']);
});

test('every catalog recipe has ingredients and steps, and names are unique', () => {
  const names = new Set<string>();
  for (const r of SEED_RECIPES) {
    assert.ok(r.ingredients.length > 0, `${r.name} has no ingredients`);
    assert.ok(r.steps.length > 0, `${r.name} has no steps`);
    assert.ok(!names.has(r.name), `duplicate recipe ${r.name}`);
    names.add(r.name);
  }
});

// --------------------------------------------------------------- expiry

test('expiry estimates use the category shelf life', () => {
  const from = new Date('2026-01-01T12:00:00Z');
  assert.equal(estimateExpiryDate('protein', from), '2026-01-04');
  assert.equal(estimateExpiryDate('dairy', from), '2026-01-11');
});

test('unknown categories fall back to "other"', () => {
  const from = new Date('2026-01-01T12:00:00Z');
  const expected = new Date(from);
  expected.setUTCDate(expected.getUTCDate() + DEFAULT_SHELF_LIFE_DAYS.other);
  assert.equal(estimateExpiryDate('mystery', from), expected.toISOString().slice(0, 10));
});

// ---------------------------------------------------- preference score

const EMPTY_PREFS: Preferences = {
  restrictions: [], avoidTerms: [], customRestrictions: [], highProtein: false,
  favoriteProteins: [], customFavoriteProteins: [], quickSimple: false, customTasteTerms: [],
};

test('preference score stacks protein, simplicity and taste signals', () => {
  const recipe = {
    dietaryTags: ['high-protein'], proteinTypes: ['chicken'], totalIngredients: 3,
    ingredients: [{ name: 'Chicken', amount: null, inStock: true }, { name: 'Garlic', amount: null, inStock: true }],
  };
  assert.equal(computePreferenceScore(recipe, EMPTY_PREFS), 0);
  const prefs = { ...EMPTY_PREFS, highProtein: true, favoriteProteins: ['chicken'], quickSimple: true, customTasteTerms: ['garlic'] };
  assert.equal(computePreferenceScore(recipe, prefs), 2 + 1 + 2 + 1);
});

// ------------------------------------------------ matchRecipes end to end

interface FakeRecipe { id: number; name: string; tags: string[]; ings: [string, string][] }

function fakePool(inventory: string[], recipes: FakeRecipe[], prefs: Partial<Record<string, unknown>> = {}): Pool {
  const has = (term: string) => inventory.some((n) => n.toLowerCase().includes(term));
  const query = async (sql: string) => {
    if (sql.includes('COUNT(*) FROM inventory_items')) return { rows: [{ count: String(inventory.length) }] };
    if (sql.includes('FROM preferences')) return { rows: Object.keys(prefs).length ? [prefs] : [] };
    if (sql.includes('SELECT name FROM inventory_items')) return { rows: inventory.map((name) => ({ name })) };
    if (sql.includes('JOIN recipe_ingredients')) {
      return {
        rows: recipes.flatMap((r) => r.ings.map(([name, term]) => ({
          recipe_id: r.id, recipe_name: r.name, recipe_description: null,
          dietary_tags: r.tags, protein_types: [], ingredient_name: name,
          match_term: term, amount: null, in_stock: has(term),
        }))),
      };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  return { query } as unknown as Pool;
}

test('a recipe whose only gaps are swappable ranks first as "ready with swaps"', async () => {
  const pool = fakePool(['Spaghetti pasta', 'Garlic', 'Olive oil', 'Lime', 'Tomato'], [
    { id: 1, name: 'Needs Shopping', tags: [], ings: [['Tomato', 'tomato'], ['Basil', 'basil']] },
    { id: 2, name: 'Lemon Garlic Pasta', tags: [], ings: [['Pasta', 'pasta'], ['Garlic', 'garlic'], ['Butter', 'butter'], ['Lemon', 'lemon']] },
  ]);
  const { readyToMake, almostThere } = await matchRecipes(pool);
  assert.equal(readyToMake.length, 0);
  assert.equal(almostThere[0].name, 'Lemon Garlic Pasta');
  assert.equal(almostThere[0].missingCount, 2);
  assert.equal(almostThere[0].missingAfterSwaps, 0);
  assert.deepEqual(almostThere[0].swaps.map((s) => s.use).sort(), ['Lime', 'Olive oil']);
  assert.equal(almostThere[1].missingAfterSwaps, 1);
});

test('active restrictions suppress unsafe swaps inside matchRecipes', async () => {
  const pool = fakePool(['Rice', 'Heavy cream'], [
    { id: 1, name: 'Coconut Rice', tags: ['dairy-free', 'vegan'], ings: [['Rice', 'rice'], ['Coconut milk', 'coconut milk']] },
  ], { restrictions: ['dairy-free'] });
  const { almostThere } = await matchRecipes(pool);
  assert.equal(almostThere[0].swaps.length, 0);
  assert.equal(almostThere[0].missingAfterSwaps, 1);
});

test('an empty inventory still returns empty lists', async () => {
  const pool = fakePool([], [{ id: 1, name: 'X', tags: [], ings: [['Egg', 'egg']] }]);
  assert.deepEqual(await matchRecipes(pool), { readyToMake: [], almostThere: [] });
});
