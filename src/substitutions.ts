import { deriveDietaryTags } from './seedRecipes';

// Ingredient substitutions.
//
// "Almost There" used to treat every missing ingredient as a hard gap — a
// recipe missing butter needed a trip to the store even with a bottle of
// olive oil on the shelf. A real cook just swaps. This module finds, for each
// missing ingredient, something already in the inventory that can stand in
// for it, so a recipe whose only gaps are swappable becomes "ready with
// swaps" instead of "go shopping".
//
// Two rules keep a swap from ever doing harm:
//   1. Dietary restrictions are re-derived for the recipe WITH the swap
//      applied, through the same deriveDietaryTags() the catalog uses. A
//      dairy-free user is never told to use heavy cream; a gluten-free user
//      is never told to thicken with flour. Free-text avoid terms are checked against the
//      substitute's inventory name as well.
//   2. A substitute the recipe already uses (or that an earlier swap in the
//      same recipe already claimed) is skipped — one bottle of olive oil
//      can't cover both the olive oil and the butter.

export interface Substitute {
  /** Lowercase substring searched for in inventory item names. */
  find: string;
  /**
   * Catalog match terms the substitute counts as for dietary derivation.
   * Sour cream counts as 'cream' so the dairy-free check sees it.
   */
  asTerms: string[];
  /** One short instruction shown to the cook. */
  note: string;
}

// Keyed by the recipe ingredient's match term. Ordered best-first.
export const SUBSTITUTIONS: Record<string, Substitute[]> = {
  butter: [
    { find: 'olive oil', asTerms: ['olive oil'], note: 'use ¾ the amount of olive oil' },
    { find: 'vegetable oil', asTerms: ['vegetable oil'], note: 'use ¾ the amount of vegetable oil' },
    { find: 'coconut oil', asTerms: ['coconut oil'], note: 'swap 1:1 for coconut oil' },
  ],
  'olive oil': [
    { find: 'vegetable oil', asTerms: ['vegetable oil'], note: 'swap 1:1 for vegetable oil' },
    { find: 'avocado oil', asTerms: ['avocado oil'], note: 'swap 1:1 for avocado oil' },
    { find: 'butter', asTerms: ['butter'], note: 'use melted butter, about 1¼ the amount' },
  ],
  lemon: [{ find: 'lime', asTerms: ['lime'], note: 'same amount of lime juice' }],
  lime: [{ find: 'lemon', asTerms: ['lemon'], note: 'same amount of lemon juice' }],
  yogurt: [{ find: 'sour cream', asTerms: ['cream'], note: 'swap 1:1 for sour cream' }],
  // No entry for plain 'milk': inventory matching is by substring, so
  // "Oat milk" or "Almond milk" already counts as milk before swaps run.
  'coconut milk': [
    { find: 'cream', asTerms: ['cream'], note: 'use heavy cream thinned with a splash of water' },
  ],
  cheese: [{ find: 'parmesan', asTerms: ['parmesan'], note: 'use grated parmesan, a little less' }],
  parmesan: [{ find: 'cheese', asTerms: ['cheese'], note: 'any hard cheese, finely grated' }],
  honey: [
    { find: 'maple', asTerms: ['maple syrup'], note: 'swap 1:1 for maple syrup' },
    { find: 'brown sugar', asTerms: ['brown sugar'], note: 'use brown sugar plus a splash of water' },
  ],
  sugar: [{ find: 'honey', asTerms: ['honey'], note: 'use ¾ the amount of honey' }],
  'brown sugar': [{ find: 'sugar', asTerms: ['sugar'], note: 'white sugar works; add a drizzle of honey if you have it' }],
  cilantro: [{ find: 'parsley', asTerms: ['parsley'], note: 'parsley instead, same amount' }],
  parsley: [{ find: 'cilantro', asTerms: ['cilantro'], note: 'cilantro instead, same amount' }],
  beef: [{ find: 'turkey', asTerms: ['turkey'], note: 'ground turkey, cooked the same way' }],
  steak: [{ find: 'beef', asTerms: ['beef'], note: 'another cut of beef, adjust the cook time' }],
  chicken: [{ find: 'turkey', asTerms: ['turkey'], note: 'turkey instead, same cook time' }],
  lentil: [{ find: 'chickpea', asTerms: ['chickpea'], note: 'canned chickpeas, rinsed' }],
  chickpea: [{ find: 'lentil', asTerms: ['lentil'], note: 'cooked lentils instead' }],
  lettuce: [{ find: 'spinach', asTerms: ['spinach'], note: 'baby spinach instead' }],
  spinach: [{ find: 'kale', asTerms: ['kale'], note: 'chopped kale, cook a minute longer' }],
  onion: [
    { find: 'shallot', asTerms: ['shallot'], note: 'shallots, about the same volume' },
    { find: 'leek', asTerms: ['leek'], note: 'leek, white part only' },
  ],
  cornstarch: [{ find: 'flour', asTerms: ['flour'], note: 'use twice as much flour to thicken' }],
  'chili powder': [{ find: 'paprika', asTerms: ['paprika'], note: 'paprika plus a pinch of cumin' }],
  zucchini: [{ find: 'squash', asTerms: ['squash'], note: 'yellow squash, same prep' }],
};

export interface SwapIngredient {
  name: string;
  matchTerm: string;
  inStock: boolean;
}

export interface Swap {
  /** Display name of the missing recipe ingredient. */
  missing: string;
  /** The inventory item to use instead, as the user named it. */
  use: string;
  note: string;
}

export interface SwapRules {
  restrictions: string[];
  avoidTerms: string[];
}

function asSeed(terms: string[]) {
  return terms.map((t) => ({ name: t, matchTerm: t, amount: '' }));
}

function satisfies(terms: string[], restrictions: string[]): boolean {
  if (restrictions.length === 0) return true;
  const tags = deriveDietaryTags(asSeed(terms));
  return restrictions.every((r) => tags.includes(r));
}

/**
 * For each missing ingredient, pick the first substitute that is in the
 * inventory, not already used by the recipe, and keeps the recipe within
 * every active restriction. Missing ingredients with no safe substitute are
 * simply left out of the result.
 */
export function planSwaps(
  ingredients: SwapIngredient[],
  inventoryNames: string[],
  rules: SwapRules,
): Swap[] {
  const inventory = inventoryNames.map((n) => ({ name: n, lower: n.toLowerCase() }));
  const avoid = rules.avoidTerms.map((t) => t.toLowerCase()).filter(Boolean);
  let terms = ingredients.map((i) => i.matchTerm.toLowerCase());
  const usedItems = new Set<string>();
  const swaps: Swap[] = [];

  for (const ing of ingredients) {
    if (ing.inStock) continue;
    const missingTerm = ing.matchTerm.toLowerCase();

    for (const sub of SUBSTITUTIONS[missingTerm] ?? []) {
      if (sub.asTerms.some((t) => terms.includes(t))) continue; // recipe already uses it
      const item = inventory.find((i) => i.lower.includes(sub.find) && !usedItems.has(i.lower));
      if (!item) continue;
      if (avoid.some((a) => item.lower.includes(a) || sub.asTerms.some((t) => t.includes(a)))) continue;

      const swapped = [...terms.filter((t) => t !== missingTerm), ...sub.asTerms];
      if (!satisfies(swapped, rules.restrictions)) continue;

      terms = swapped;
      usedItems.add(item.lower);
      swaps.push({ missing: ing.name, use: item.name, note: sub.note });
      break;
    }
  }
  return swaps;
}
