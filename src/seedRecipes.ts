export interface SeedIngredient {
  /** Display name shown to the user. */
  name: string;
  /**
   * Lowercase substring matched against inventory_items.name (ILIKE
   * '%term%'). Vision-detected item names are noisy free text (e.g.
   * "leafy greens (lettuce/herbs)"), so matching is deliberately loose —
   * a substring match rather than an exact-name match.
   */
  matchTerm: string;
  /** Proportion/amount, e.g. "2 cups", "1 tsp", "3 cloves". */
  amount: string;
}

export interface SeedRecipe {
  name: string;
  description: string;
  ingredients: SeedIngredient[];
  /** Numbered cooking instructions, one string per step. */
  steps: string[];
}

// Dietary restrictions a recipe SATISFIES, derived from its ingredient
// match terms rather than hand-tagged per recipe — keeps the tagging
// consistent and means a newly added recipe is classified automatically
// instead of silently defaulting to "fits everything" if a tag is
// forgotten. Matching is exact-term (not substring) specifically so e.g.
// "coconut milk" doesn't collide with the dairy term "milk".
//
// Split into red-meat/poultry vs. fish/shellfish specifically so
// pescatarian (allows fish, not other meat) can be derived as its own
// tag rather than being an alias for vegetarian.
const RED_MEAT_POULTRY_TERMS = new Set([
  'chicken', 'beef', 'steak', 'bacon', 'pork', 'turkey', 'ham', 'sausage', 'lamb',
]);
const FISH_SHELLFISH_TERMS = new Set(['shrimp', 'salmon', 'fish']);
const NON_VEGAN_EXTRA_TERMS = new Set([
  'egg', 'milk', 'cheese', 'butter', 'yogurt', 'parmesan', 'honey', 'ice cream', 'caesar', 'cream',
]);
const GLUTEN_TERMS = new Set([
  'bread', 'pasta', 'flour', 'taco shell', 'crouton', 'soy sauce', 'oat', 'cracker', 'granola',
]);
const DAIRY_TERMS = new Set([
  'milk', 'cheese', 'butter', 'yogurt', 'parmesan', 'ice cream', 'caesar', 'cream',
]);
const NUT_TERMS = new Set([
  'peanut', 'peanut butter', 'almond', 'cashew', 'walnut', 'pecan', 'hazelnut', 'pistachio',
]);
// Coarse "meaningful carbohydrate source" list — grains, starches, sugars.
// Same heuristic spirit as the rest of this file: no real nutrition data,
// just ingredient-name signal, documented as an approximation.
const HIGH_CARB_TERMS = new Set([
  'bread', 'pasta', 'flour', 'taco shell', 'crouton', 'rice', 'oat', 'granola', 'cracker',
  'sugar', 'brown sugar', 'chocolate chip', 'cornstarch', 'honey', 'ice cream', 'soda',
]);
// Keto is low-carb plus excluding legumes and higher-sugar fruit — both
// carry meaningfully more carbs than typical keto guidance allows, even
// though they don't trip the coarser low-carb list above.
const KETO_EXTRA_EXCLUDE_TERMS = new Set(['chickpea', 'lentil', 'can', 'orange', 'banana', 'grape']);

export function deriveDietaryTags(ingredients: SeedIngredient[]): string[] {
  const terms = ingredients.map((i) => i.matchTerm.toLowerCase());
  const hasAny = (set: Set<string>) => terms.some((t) => set.has(t));

  const pescatarian = !hasAny(RED_MEAT_POULTRY_TERMS);
  const vegetarian = pescatarian && !hasAny(FISH_SHELLFISH_TERMS);
  const vegan = vegetarian && !hasAny(NON_VEGAN_EXTRA_TERMS);
  const glutenFree = !hasAny(GLUTEN_TERMS);
  const dairyFree = !hasAny(DAIRY_TERMS);
  const nutFree = !hasAny(NUT_TERMS);
  const lowCarb = !hasAny(HIGH_CARB_TERMS);
  const keto = lowCarb && !hasAny(KETO_EXTRA_EXCLUDE_TERMS);

  const tags: string[] = [];
  if (vegetarian) tags.push('vegetarian');
  if (vegan) tags.push('vegan');
  if (pescatarian) tags.push('pescatarian');
  if (glutenFree) tags.push('gluten-free');
  if (dairyFree) tags.push('dairy-free');
  if (nutFree) tags.push('nut-free');
  if (lowCarb) tags.push('low-carb');
  if (keto) tags.push('keto');
  return tags;
}

// Canonical protein type a recipe is considered to feature, keyed by exact
// ingredient match term — used for the "favorite proteins" preference
// (rank recipes using a protein the user favors higher) and to derive a
// coarse "high-protein" tag (any recognized protein source present at
// all). This is a heuristic, not real nutrition data: no macro counts are
// available, so "high protein" means "features a recognized protein
// source" rather than a gram threshold.
const PROTEIN_TYPE_MAP: Record<string, string> = {
  chicken: 'chicken',
  beef: 'beef',
  steak: 'beef',
  shrimp: 'shrimp',
  salmon: 'fish',
  fish: 'fish',
  egg: 'egg',
  tofu: 'tofu',
  chickpea: 'legumes',
  lentil: 'legumes',
  can: 'legumes', // "Canned beans" — the only recipes using the bare 'can' match term
  pork: 'pork',
  turkey: 'turkey',
  lamb: 'lamb',
};

export function deriveProteinTypes(ingredients: SeedIngredient[]): string[] {
  const types = new Set<string>();
  for (const ingredient of ingredients) {
    const type = PROTEIN_TYPE_MAP[ingredient.matchTerm.toLowerCase()];
    if (type) types.add(type);
  }
  return Array.from(types);
}

// A mix of simple (2-3 common ingredients) and more complex recipes, so a
// small starter inventory has a realistic shot at fully matching several
// of them while others land as close-but-missing-a-few.
export const SEED_RECIPES: SeedRecipe[] = [
  // --- simple: 2-3 ingredients ---
  {
    name: 'Tomato & Pepper Salad',
    description: 'A quick raw salad of sliced tomato and red pepper.',
    ingredients: [
      { name: 'Tomato', matchTerm: 'tomato', amount: '2 medium, sliced' },
      { name: 'Red pepper', matchTerm: 'pepper', amount: '1, sliced' },
    ],
    steps: [
      'Slice the tomato and red pepper into thin rounds or strips.',
      'Arrange on a plate, slightly overlapping.',
      'Drizzle with olive oil and a pinch of salt just before serving.',
    ],
  },
  {
    name: 'Garden Veggie Salad',
    description: 'Tomato, red pepper and lettuce tossed together.',
    ingredients: [
      { name: 'Tomato', matchTerm: 'tomato', amount: '1 cup, diced' },
      { name: 'Red pepper', matchTerm: 'pepper', amount: '1/2, diced' },
      { name: 'Lettuce', matchTerm: 'lettuce', amount: '2 cups, torn' },
    ],
    steps: [
      'Tear the lettuce into bite-sized pieces and place in a large bowl.',
      'Dice the tomato and red pepper and add to the bowl.',
      'Toss everything together with your favorite dressing.',
    ],
  },
  {
    name: 'Citrus Greens Salad',
    description: 'Orange segments over lettuce with tomato.',
    ingredients: [
      { name: 'Orange', matchTerm: 'orange', amount: '1, segmented' },
      { name: 'Lettuce', matchTerm: 'lettuce', amount: '2 cups, torn' },
      { name: 'Tomato', matchTerm: 'tomato', amount: '1/2 cup, diced' },
    ],
    steps: [
      'Peel the orange and separate into segments, removing any pith.',
      'Toss the lettuce and tomato together in a bowl.',
      'Top with orange segments and serve immediately.',
    ],
  },
  {
    name: 'Pickled Veggie Plate',
    description: 'Jarred pickles served with fresh tomato.',
    ingredients: [
      { name: 'Pickles (jarred)', matchTerm: 'jar', amount: '1/2 cup, sliced' },
      { name: 'Tomato', matchTerm: 'tomato', amount: '1, sliced' },
    ],
    steps: [
      'Slice the tomato into wedges.',
      'Arrange the tomato and pickles together on a plate.',
      'Serve as a light snack or side.',
    ],
  },
  {
    name: 'Canned Bean & Tomato Salad',
    description: 'Canned beans with tomato and red pepper.',
    ingredients: [
      { name: 'Canned beans', matchTerm: 'can', amount: '1 can (15 oz), drained and rinsed' },
      { name: 'Tomato', matchTerm: 'tomato', amount: '1 cup, diced' },
      { name: 'Red pepper', matchTerm: 'pepper', amount: '1/2, diced' },
    ],
    steps: [
      'Drain and rinse the canned beans.',
      'Combine the beans, diced tomato, and red pepper in a bowl.',
      'Season with salt, pepper, and a squeeze of lemon if available.',
    ],
  },
  {
    name: 'Soda & Pickle Snack Plate',
    description: 'Cold soda with a side of jarred pickles.',
    ingredients: [
      { name: 'Soda', matchTerm: 'soda', amount: '1 can, chilled' },
      { name: 'Pickles (jarred)', matchTerm: 'jar', amount: '1/2 cup' },
    ],
    steps: [
      "Chill the soda if it isn't cold already.",
      'Arrange the pickles on a small plate.',
      'Serve together as a quick snack.',
    ],
  },

  // --- near misses: missing 1-2 ingredients ---
  {
    name: 'Orange Sugar Refresher',
    description: 'Fresh orange sweetened with a little sugar.',
    ingredients: [
      { name: 'Orange', matchTerm: 'orange', amount: '1, juiced' },
      { name: 'Sugar', matchTerm: 'sugar', amount: '1 tsp' },
    ],
    steps: [
      'Juice the orange into a glass.',
      'Stir in the sugar until dissolved.',
      'Add ice and top with water or soda water if desired.',
    ],
  },
  {
    name: 'Soda Float',
    description: 'A scoop of ice cream dropped into cold soda.',
    ingredients: [
      { name: 'Soda', matchTerm: 'soda', amount: '1 can (12 oz), chilled' },
      { name: 'Ice cream', matchTerm: 'ice cream', amount: '2 scoops' },
    ],
    steps: [
      'Add two scoops of ice cream to a tall glass.',
      'Slowly pour the soda over the ice cream.',
      'Serve immediately with a spoon and straw.',
    ],
  },
  {
    name: 'Tomato & Cheese Toast',
    description: 'Toasted bread topped with cheese and tomato.',
    ingredients: [
      { name: 'Bread', matchTerm: 'bread', amount: '2 slices' },
      { name: 'Cheese', matchTerm: 'cheese', amount: '2 slices' },
      { name: 'Tomato', matchTerm: 'tomato', amount: '1, sliced' },
    ],
    steps: [
      'Toast the bread until golden.',
      'Layer cheese and tomato slices on top.',
      'Broil briefly until the cheese melts, then serve warm.',
    ],
  },
  {
    name: 'Pepper & Onion Fajita Base',
    description: 'Sauteed red pepper, onion and garlic for a fajita base.',
    ingredients: [
      { name: 'Red pepper', matchTerm: 'pepper', amount: '1, sliced' },
      { name: 'Onion', matchTerm: 'onion', amount: '1, sliced' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
    ],
    steps: [
      'Heat oil in a pan over medium-high heat.',
      'Add the sliced pepper and onion, and saute for 5-6 minutes until softened.',
      'Stir in the minced garlic and cook for 1 more minute.',
      'Use as a base for fajitas, tacos, or rice bowls.',
    ],
  },

  // --- more complex: 5+ ingredients ---
  {
    name: 'Vegetable Stir Fry',
    description: 'Tomato and pepper stir-fried with onion, garlic and soy sauce.',
    ingredients: [
      { name: 'Tomato', matchTerm: 'tomato', amount: '1, cut into wedges' },
      { name: 'Red pepper', matchTerm: 'pepper', amount: '1, sliced' },
      { name: 'Onion', matchTerm: 'onion', amount: '1/2, sliced' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
      { name: 'Soy sauce', matchTerm: 'soy sauce', amount: '2 tbsp' },
    ],
    steps: [
      'Heat oil in a wok or large pan over high heat.',
      'Add the onion and garlic, stir-frying for 1-2 minutes until fragrant.',
      'Add the pepper and tomato, stir-frying for another 3-4 minutes.',
      'Pour in the soy sauce, toss to coat, and cook for 1 more minute.',
      'Serve hot over rice.',
    ],
  },
  {
    name: 'Simple Pasta Aglio e Olio',
    description: 'Pasta tossed with garlic and olive oil.',
    ingredients: [
      { name: 'Pasta', matchTerm: 'pasta', amount: '200g' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '4 cloves, thinly sliced' },
      { name: 'Olive oil', matchTerm: 'olive oil', amount: '1/4 cup' },
    ],
    steps: [
      'Cook the pasta in salted boiling water until al dente; reserve 1/2 cup pasta water.',
      'While the pasta cooks, gently warm the olive oil in a pan and add the sliced garlic.',
      'Cook the garlic over low heat until golden, being careful not to burn it.',
      'Toss the drained pasta into the pan with the garlic oil, adding a splash of pasta water to loosen.',
      'Season with salt, red pepper flakes, and parsley if available, then serve.',
    ],
  },
  {
    name: 'Chicken Caesar Salad',
    description: 'Grilled chicken over lettuce with parmesan, croutons and caesar dressing.',
    ingredients: [
      { name: 'Chicken', matchTerm: 'chicken', amount: '1 breast, cooked and sliced' },
      { name: 'Lettuce', matchTerm: 'lettuce', amount: '4 cups, chopped' },
      { name: 'Parmesan', matchTerm: 'parmesan', amount: '1/4 cup, shaved' },
      { name: 'Croutons', matchTerm: 'crouton', amount: '1/2 cup' },
      { name: 'Caesar dressing', matchTerm: 'caesar', amount: '3 tbsp' },
    ],
    steps: [
      'Chop the lettuce and place in a large bowl.',
      'Add the sliced chicken, croutons, and shaved parmesan.',
      'Drizzle with caesar dressing and toss to coat evenly.',
      'Serve immediately while the croutons are still crisp.',
    ],
  },
  {
    name: 'Fruit & Cheese Board',
    description: 'Orange, cheese, crackers, grapes and honey.',
    ingredients: [
      { name: 'Orange', matchTerm: 'orange', amount: '1, sliced' },
      { name: 'Cheese', matchTerm: 'cheese', amount: '150g, cubed or sliced' },
      { name: 'Crackers', matchTerm: 'cracker', amount: '1 cup' },
      { name: 'Grapes', matchTerm: 'grape', amount: '1 cup' },
      { name: 'Honey', matchTerm: 'honey', amount: '2 tbsp, for drizzling' },
    ],
    steps: [
      'Arrange the cheese, crackers, orange slices, and grapes on a board.',
      'Drizzle honey over the cheese just before serving.',
      'Serve at room temperature for the best flavor.',
    ],
  },
  {
    name: 'Ratatouille',
    description: 'A slow-cooked medley of tomato, pepper, zucchini, eggplant, onion, garlic and olive oil.',
    ingredients: [
      { name: 'Tomato', matchTerm: 'tomato', amount: '3, diced' },
      { name: 'Red pepper', matchTerm: 'pepper', amount: '1, diced' },
      { name: 'Zucchini', matchTerm: 'zucchini', amount: '1, sliced' },
      { name: 'Eggplant', matchTerm: 'eggplant', amount: '1, cubed' },
      { name: 'Onion', matchTerm: 'onion', amount: '1, diced' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '3 cloves, minced' },
      { name: 'Olive oil', matchTerm: 'olive oil', amount: '3 tbsp' },
    ],
    steps: [
      'Heat the olive oil in a large pot over medium heat.',
      'Add the onion and garlic, cooking until softened, about 3 minutes.',
      'Add the eggplant and cook for 5 minutes, stirring occasionally.',
      'Stir in the zucchini, pepper, and tomato.',
      'Cover and simmer for 25-30 minutes, stirring occasionally, until the vegetables are tender.',
      'Season with salt, pepper, and fresh herbs, then serve warm or at room temperature.',
    ],
  },
  {
    name: 'Orange Chicken',
    description: 'Chicken glazed in an orange, soy and ginger sauce.',
    ingredients: [
      { name: 'Orange', matchTerm: 'orange', amount: '1, juiced and zested' },
      { name: 'Chicken', matchTerm: 'chicken', amount: '500g, cut into bite-sized pieces' },
      { name: 'Soy sauce', matchTerm: 'soy sauce', amount: '3 tbsp' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
      { name: 'Ginger', matchTerm: 'ginger', amount: '1 tsp, grated' },
      { name: 'Cornstarch', matchTerm: 'cornstarch', amount: '2 tbsp' },
    ],
    steps: [
      'Toss the chicken pieces in cornstarch until lightly coated.',
      'Heat oil in a pan and fry the chicken until golden and cooked through; set aside.',
      'In the same pan, saute the garlic and ginger for 30 seconds.',
      'Add the orange juice, zest, and soy sauce, stirring to combine into a sauce.',
      'Simmer for 2-3 minutes until slightly thickened.',
      'Return the chicken to the pan and toss to coat in the sauce, then serve.',
    ],
  },
  {
    name: 'Minestrone Soup',
    description: 'A hearty soup of tomato, canned beans, carrot, celery, onion, garlic, pasta and parmesan.',
    ingredients: [
      { name: 'Tomato', matchTerm: 'tomato', amount: '2 cups, diced (or 1 can)' },
      { name: 'Canned beans', matchTerm: 'can', amount: '1 can (15 oz), drained' },
      { name: 'Carrot', matchTerm: 'carrot', amount: '2, diced' },
      { name: 'Celery', matchTerm: 'celery', amount: '2 stalks, diced' },
      { name: 'Onion', matchTerm: 'onion', amount: '1, diced' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
      { name: 'Pasta', matchTerm: 'pasta', amount: '1 cup, small shapes' },
      { name: 'Parmesan', matchTerm: 'parmesan', amount: '1/4 cup, grated, for serving' },
    ],
    steps: [
      'Heat oil in a large pot and saute the onion, carrot, and celery until softened, about 5 minutes.',
      'Add the garlic and cook for 1 more minute.',
      'Stir in the tomatoes and beans, then add enough vegetable stock or water to cover.',
      'Bring to a boil, then simmer for 15-20 minutes.',
      'Add the pasta and cook until al dente, about 8-10 minutes.',
      'Ladle into bowls and top with grated parmesan before serving.',
    ],
  },

  // --- breakfast / quick (2-4 ingredients) ---
  {
    name: 'Classic Scrambled Eggs',
    description: 'Soft scrambled eggs finished with butter and a splash of milk.',
    ingredients: [
      { name: 'Eggs', matchTerm: 'egg', amount: '3, beaten' },
      { name: 'Butter', matchTerm: 'butter', amount: '1 tbsp' },
      { name: 'Milk', matchTerm: 'milk', amount: '1 tbsp' },
    ],
    steps: [
      'Whisk the eggs with the milk and a pinch of salt until fully combined.',
      'Melt the butter in a nonstick pan over low-medium heat.',
      'Pour in the eggs and stir gently and continuously with a spatula.',
      'Remove from heat while still slightly glossy — they finish cooking off the pan. Serve immediately.',
    ],
  },
  {
    name: 'Peanut Butter Banana Toast',
    description: 'Toasted bread with peanut butter and fresh banana slices.',
    ingredients: [
      { name: 'Bread', matchTerm: 'bread', amount: '2 slices' },
      { name: 'Peanut butter', matchTerm: 'peanut butter', amount: '2 tbsp' },
      { name: 'Banana', matchTerm: 'banana', amount: '1, sliced' },
    ],
    steps: [
      'Toast the bread until golden and crisp.',
      'Spread peanut butter evenly over each slice.',
      'Top with banana slices and serve right away.',
    ],
  },
  {
    name: 'Greek Yogurt Parfait',
    description: 'Layered yogurt with honey and crunchy granola.',
    ingredients: [
      { name: 'Greek yogurt', matchTerm: 'yogurt', amount: '1 cup' },
      { name: 'Honey', matchTerm: 'honey', amount: '1 tbsp, for drizzling' },
      { name: 'Granola', matchTerm: 'granola', amount: '1/3 cup' },
    ],
    steps: [
      'Spoon a layer of yogurt into a glass or bowl.',
      'Sprinkle a layer of granola on top.',
      'Repeat the layers, finishing with granola on top.',
      'Drizzle with honey just before serving.',
    ],
  },
  {
    name: 'Garlic Butter Rice',
    description: 'Simple fluffy rice sauteed in garlic butter.',
    ingredients: [
      { name: 'Rice', matchTerm: 'rice', amount: '1 cup, cooked' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
      { name: 'Butter', matchTerm: 'butter', amount: '2 tbsp' },
    ],
    steps: [
      'Melt the butter in a pan over medium heat.',
      'Add the garlic and cook until fragrant, about 30 seconds — do not let it brown.',
      'Add the cooked rice and toss to coat evenly, warming through for 2-3 minutes.',
      'Season with salt and serve.',
    ],
  },
  {
    name: 'Avocado Toast',
    description: 'Mashed avocado on toast with a squeeze of lemon.',
    ingredients: [
      { name: 'Bread', matchTerm: 'bread', amount: '2 slices' },
      { name: 'Avocado', matchTerm: 'avocado', amount: '1, ripe' },
      { name: 'Lemon', matchTerm: 'lemon', amount: '1/2, juiced' },
    ],
    steps: [
      'Toast the bread until crisp.',
      'Mash the avocado in a bowl with the lemon juice, salt, and pepper.',
      'Spread generously over the toast and serve immediately.',
    ],
  },

  // --- moderate (5 ingredients) ---
  {
    name: 'Veggie Omelette',
    description: 'A fluffy omelette folded around melted cheese, pepper and onion.',
    ingredients: [
      { name: 'Eggs', matchTerm: 'egg', amount: '3, beaten' },
      { name: 'Cheese', matchTerm: 'cheese', amount: '1/3 cup, shredded' },
      { name: 'Red pepper', matchTerm: 'pepper', amount: '1/4, diced' },
      { name: 'Onion', matchTerm: 'onion', amount: '2 tbsp, diced' },
    ],
    steps: [
      'Saute the diced pepper and onion in a pan over medium heat until softened, about 4 minutes; set aside.',
      'Pour the beaten eggs into a lightly oiled nonstick pan over medium-low heat.',
      'As the edges set, sprinkle the pepper, onion, and cheese over half the omelette.',
      'Fold the empty half over the filling and cook 1 more minute until the cheese melts, then serve.',
    ],
  },
  {
    name: 'Chickpea Salad',
    description: 'Canned chickpeas tossed with cucumber, tomato, olive oil and lemon.',
    ingredients: [
      { name: 'Canned chickpeas', matchTerm: 'chickpea', amount: '1 can (15 oz), drained and rinsed' },
      { name: 'Cucumber', matchTerm: 'cucumber', amount: '1, diced' },
      { name: 'Tomato', matchTerm: 'tomato', amount: '1, diced' },
      { name: 'Olive oil', matchTerm: 'olive oil', amount: '2 tbsp' },
      { name: 'Lemon', matchTerm: 'lemon', amount: '1/2, juiced' },
    ],
    steps: [
      'Drain and rinse the chickpeas well.',
      'Combine the chickpeas, cucumber, and tomato in a large bowl.',
      'Whisk together the olive oil and lemon juice, then pour over the salad.',
      'Toss to coat, season with salt and pepper, and serve chilled or at room temperature.',
    ],
  },
  {
    name: 'Beef Tacos',
    description: 'Seasoned ground beef in taco shells with cheese, lettuce and tomato.',
    ingredients: [
      { name: 'Ground beef', matchTerm: 'beef', amount: '400g' },
      { name: 'Taco shells', matchTerm: 'taco shell', amount: '8' },
      { name: 'Cheese', matchTerm: 'cheese', amount: '1/2 cup, shredded' },
      { name: 'Lettuce', matchTerm: 'lettuce', amount: '1 cup, shredded' },
      { name: 'Tomato', matchTerm: 'tomato', amount: '1, diced' },
      { name: 'Onion', matchTerm: 'onion', amount: '1/2, diced' },
    ],
    steps: [
      'Brown the ground beef in a pan over medium-high heat, breaking it up as it cooks, about 6-8 minutes.',
      'Season with salt, pepper, and any taco seasoning on hand; drain excess fat.',
      'Warm the taco shells according to package directions.',
      'Fill each shell with beef, then top with cheese, lettuce, tomato, and onion.',
      'Serve immediately while the shells are still crisp.',
    ],
  },
  {
    name: 'Shrimp Garlic Pasta',
    description: 'Pasta tossed with garlicky sauteed shrimp in olive oil.',
    ingredients: [
      { name: 'Pasta', matchTerm: 'pasta', amount: '250g' },
      { name: 'Shrimp', matchTerm: 'shrimp', amount: '300g, peeled and deveined' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '4 cloves, minced' },
      { name: 'Olive oil', matchTerm: 'olive oil', amount: '3 tbsp' },
      { name: 'Parsley', matchTerm: 'parsley', amount: '2 tbsp, chopped' },
    ],
    steps: [
      'Cook the pasta in salted boiling water until al dente; reserve 1/2 cup pasta water and drain.',
      'Heat the olive oil in a large pan over medium heat and add the garlic, cooking until fragrant, about 30 seconds.',
      'Add the shrimp and cook for 2-3 minutes per side until pink and opaque.',
      'Toss in the drained pasta and a splash of pasta water, mixing to coat.',
      'Stir in the parsley, season with salt and pepper, and serve hot.',
    ],
  },
  {
    name: 'Lentil Soup',
    description: 'A hearty, warming soup of lentils with carrot, celery and onion.',
    ingredients: [
      { name: 'Lentils', matchTerm: 'lentil', amount: '1 cup, rinsed' },
      { name: 'Carrot', matchTerm: 'carrot', amount: '2, diced' },
      { name: 'Celery', matchTerm: 'celery', amount: '2 stalks, diced' },
      { name: 'Onion', matchTerm: 'onion', amount: '1, diced' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
    ],
    steps: [
      'Heat oil in a large pot and saute the onion, carrot, and celery until softened, about 5 minutes.',
      'Add the garlic and cook for 1 more minute.',
      'Stir in the lentils and enough vegetable stock or water to cover by 2 inches.',
      'Bring to a boil, then reduce heat and simmer for 25-30 minutes until the lentils are tender.',
      'Season with salt, pepper, and a squeeze of lemon, then serve warm.',
    ],
  },

  // --- more involved (6+ ingredients) ---
  {
    name: 'Chicken Fried Rice',
    description: 'Day-old rice fried with chicken, egg, carrot and soy sauce.',
    ingredients: [
      { name: 'Rice', matchTerm: 'rice', amount: '3 cups, cooked and cooled' },
      { name: 'Chicken', matchTerm: 'chicken', amount: '1 breast, diced' },
      { name: 'Eggs', matchTerm: 'egg', amount: '2, beaten' },
      { name: 'Carrot', matchTerm: 'carrot', amount: '1, diced' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
      { name: 'Soy sauce', matchTerm: 'soy sauce', amount: '3 tbsp' },
    ],
    steps: [
      'Heat oil in a large wok or pan over high heat and cook the diced chicken until golden and cooked through; set aside.',
      'Push to one side, add the carrot and garlic, and stir-fry for 2 minutes.',
      'Push everything aside, pour in the beaten eggs, and scramble until just set.',
      'Add the cold rice, breaking up any clumps, and toss everything together.',
      'Pour in the soy sauce and stir-fry for 2-3 more minutes until heated through, then serve.',
    ],
  },
  {
    name: 'Beef Stir Fry with Broccoli',
    description: 'Sliced beef and broccoli in a garlic-ginger soy sauce, thickened with cornstarch.',
    ingredients: [
      { name: 'Beef', matchTerm: 'beef', amount: '400g, thinly sliced' },
      { name: 'Broccoli', matchTerm: 'broccoli', amount: '2 cups, florets' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '3 cloves, minced' },
      { name: 'Ginger', matchTerm: 'ginger', amount: '1 tsp, grated' },
      { name: 'Soy sauce', matchTerm: 'soy sauce', amount: '3 tbsp' },
      { name: 'Cornstarch', matchTerm: 'cornstarch', amount: '1 tbsp, mixed with 2 tbsp water' },
    ],
    steps: [
      'Heat oil in a wok over high heat and sear the beef in batches until browned; set aside.',
      'Add the broccoli to the wok with a splash of water and stir-fry for 2-3 minutes until bright green and just tender.',
      'Add the garlic and ginger, cooking for 30 seconds until fragrant.',
      'Return the beef to the wok and add the soy sauce.',
      'Stir in the cornstarch slurry and cook for 1-2 minutes until the sauce thickens and coats everything, then serve over rice.',
    ],
  },
  {
    name: 'Baked Salmon with Lemon',
    description: 'Oven-baked salmon with garlic, olive oil, lemon and asparagus.',
    ingredients: [
      { name: 'Salmon', matchTerm: 'salmon', amount: '2 fillets' },
      { name: 'Lemon', matchTerm: 'lemon', amount: '1, sliced' },
      { name: 'Olive oil', matchTerm: 'olive oil', amount: '2 tbsp' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
      { name: 'Asparagus', matchTerm: 'asparagus', amount: '1 bunch, trimmed' },
    ],
    steps: [
      'Preheat the oven to 200°C (400°F).',
      'Place the salmon and asparagus on a lined baking sheet.',
      'Drizzle with olive oil, scatter the garlic over the top, and season with salt and pepper.',
      'Top the salmon with lemon slices.',
      'Bake for 12-15 minutes until the salmon flakes easily and the asparagus is tender.',
    ],
  },
  {
    name: 'Vegetable Curry',
    description: 'A fragrant coconut curry with chickpeas, spinach and warming spices.',
    ingredients: [
      { name: 'Canned chickpeas', matchTerm: 'chickpea', amount: '1 can (15 oz), drained' },
      { name: 'Coconut milk', matchTerm: 'coconut milk', amount: '1 can (14 oz)' },
      { name: 'Curry powder', matchTerm: 'curry powder', amount: '2 tbsp' },
      { name: 'Onion', matchTerm: 'onion', amount: '1, diced' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
      { name: 'Ginger', matchTerm: 'ginger', amount: '1 tsp, grated' },
      { name: 'Spinach', matchTerm: 'spinach', amount: '2 cups' },
    ],
    steps: [
      'Heat oil in a large pot and saute the onion until softened, about 4 minutes.',
      'Add the garlic, ginger, and curry powder, cooking for 1 minute until fragrant.',
      'Stir in the coconut milk and chickpeas, then bring to a simmer.',
      'Cook for 10-12 minutes, stirring occasionally, until slightly thickened.',
      'Stir in the spinach and cook for 2 more minutes until wilted, then serve over rice.',
    ],
  },
  {
    name: 'Banana Oat Pancakes',
    description: 'Simple oat-and-banana pancakes with a hint of cinnamon.',
    ingredients: [
      { name: 'Oats', matchTerm: 'oat', amount: '1 cup' },
      { name: 'Banana', matchTerm: 'banana', amount: '2, ripe' },
      { name: 'Eggs', matchTerm: 'egg', amount: '2' },
      { name: 'Milk', matchTerm: 'milk', amount: '1/4 cup' },
      { name: 'Cinnamon', matchTerm: 'cinnamon', amount: '1/2 tsp' },
    ],
    steps: [
      'Blend the oats, banana, eggs, milk, and cinnamon together until smooth.',
      'Heat a lightly oiled nonstick pan or griddle over medium heat.',
      'Pour small circles of batter onto the pan and cook for 2-3 minutes until bubbles form on top.',
      'Flip and cook for another 1-2 minutes until golden.',
      'Stack and serve warm, with extra banana or honey if desired.',
    ],
  },
  {
    name: 'Classic Guacamole',
    description: 'Fresh mashed avocado with lime, onion, tomato and cilantro.',
    ingredients: [
      { name: 'Avocado', matchTerm: 'avocado', amount: '3, ripe' },
      { name: 'Lime', matchTerm: 'lime', amount: '1, juiced' },
      { name: 'Onion', matchTerm: 'onion', amount: '1/4, finely diced' },
      { name: 'Tomato', matchTerm: 'tomato', amount: '1, diced' },
      { name: 'Cilantro', matchTerm: 'cilantro', amount: '2 tbsp, chopped' },
    ],
    steps: [
      'Halve and pit the avocados, then scoop the flesh into a bowl.',
      'Mash to your preferred texture with a fork.',
      'Stir in the lime juice, onion, tomato, and cilantro.',
      'Season with salt to taste and serve immediately with tortilla chips.',
    ],
  },
  {
    name: 'Chocolate Chip Cookies',
    description: 'Classic soft-baked chocolate chip cookies.',
    ingredients: [
      { name: 'Flour', matchTerm: 'flour', amount: '2 1/4 cups' },
      { name: 'Butter', matchTerm: 'butter', amount: '1 cup, softened' },
      { name: 'Sugar', matchTerm: 'sugar', amount: '3/4 cup' },
      { name: 'Chocolate chips', matchTerm: 'chocolate chip', amount: '2 cups' },
      { name: 'Eggs', matchTerm: 'egg', amount: '2' },
      { name: 'Vanilla extract', matchTerm: 'vanilla', amount: '1 tsp' },
    ],
    steps: [
      'Preheat the oven to 190°C (375°F) and line a baking sheet with parchment.',
      'Cream the butter and sugar together until light and fluffy.',
      'Beat in the eggs and vanilla extract.',
      'Mix in the flour until just combined, then fold in the chocolate chips.',
      'Drop spoonfuls of dough onto the baking sheet, spaced apart.',
      'Bake for 9-11 minutes until the edges are golden; cool on the sheet for a few minutes before serving.',
    ],
  },
  {
    name: 'Coffee-Rubbed Steak',
    description: 'Pan-seared steak with a smoky coffee and brown sugar crust.',
    ingredients: [
      { name: 'Steak', matchTerm: 'steak', amount: '2 (8oz) steaks' },
      { name: 'Coffee grounds', matchTerm: 'coffee', amount: '1 tbsp, finely ground' },
      { name: 'Brown sugar', matchTerm: 'brown sugar', amount: '1 tbsp' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '1 clove, minced (for the pan)' },
      { name: 'Butter', matchTerm: 'butter', amount: '2 tbsp' },
    ],
    steps: [
      'Mix the coffee grounds, brown sugar, salt, and pepper together and rub evenly over both sides of the steak.',
      'Let the steaks sit at room temperature for 15-20 minutes.',
      'Heat a heavy pan over high heat until very hot, then sear the steaks for 3-4 minutes per side for medium-rare.',
      'In the last minute, add the butter and garlic to the pan and spoon the melted butter over the steaks.',
      'Rest the steaks for 5 minutes before slicing and serving.',
    ],
  },

  // --- pork / turkey / lamb: give the newer favorite-protein options
  // (and pescatarian, by contrast) real recipes to actually rank/filter ---
  {
    name: 'Turkey Chili',
    description: 'A hearty chili of ground turkey, beans and tomato, warmed with chili powder.',
    ingredients: [
      { name: 'Ground turkey', matchTerm: 'turkey', amount: '500g' },
      { name: 'Canned beans', matchTerm: 'can', amount: '1 can (15 oz), drained' },
      { name: 'Tomato', matchTerm: 'tomato', amount: '2, diced (or 1 can crushed)' },
      { name: 'Onion', matchTerm: 'onion', amount: '1, diced' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
      { name: 'Chili powder', matchTerm: 'chili powder', amount: '2 tbsp' },
    ],
    steps: [
      'Heat oil in a large pot and cook the onion until softened, about 4 minutes.',
      'Add the garlic and ground turkey, breaking it up as it browns, about 6-8 minutes.',
      'Stir in the chili powder and cook for 1 minute until fragrant.',
      'Add the tomato and beans, then bring to a simmer.',
      'Simmer uncovered for 20-25 minutes, stirring occasionally, until thickened.',
      'Season with salt and pepper to taste, then serve hot.',
    ],
  },
  {
    name: 'Herb-Crusted Pork Chops',
    description: 'Pan-seared pork chops finished with garlic, rosemary and butter.',
    ingredients: [
      { name: 'Pork chops', matchTerm: 'pork', amount: '2 chops, bone-in' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, smashed' },
      { name: 'Rosemary', matchTerm: 'rosemary', amount: '2 sprigs' },
      { name: 'Butter', matchTerm: 'butter', amount: '2 tbsp' },
      { name: 'Olive oil', matchTerm: 'olive oil', amount: '1 tbsp' },
    ],
    steps: [
      'Pat the pork chops dry and season generously with salt and pepper.',
      'Heat the olive oil in a heavy pan over medium-high heat and sear the chops for 3-4 minutes per side until golden.',
      'Reduce the heat to medium, add the butter, garlic, and rosemary to the pan.',
      'Tilt the pan and continuously spoon the melted herb butter over the chops for 1-2 minutes.',
      'Rest for 5 minutes before serving, spooning any remaining pan butter on top.',
    ],
  },
  {
    name: 'Lamb Kofta with Yogurt Sauce',
    description: 'Spiced ground lamb skewers with a cool garlic-yogurt sauce.',
    ingredients: [
      { name: 'Ground lamb', matchTerm: 'lamb', amount: '400g' },
      { name: 'Onion', matchTerm: 'onion', amount: '1/2, finely grated' },
      { name: 'Garlic', matchTerm: 'garlic', amount: '2 cloves, minced' },
      { name: 'Cumin', matchTerm: 'cumin', amount: '1 tsp' },
      { name: 'Greek yogurt', matchTerm: 'yogurt', amount: '1/2 cup, for the sauce' },
      { name: 'Lemon', matchTerm: 'lemon', amount: '1/2, juiced' },
    ],
    steps: [
      'Combine the lamb, grated onion, half the garlic, and cumin in a bowl; mix and season with salt and pepper.',
      'Shape the mixture into small oval patties or press onto skewers.',
      'Heat a pan or grill over medium-high heat and cook the koftas for 3-4 minutes per side until browned and cooked through.',
      'While they cook, stir the remaining garlic and lemon juice into the yogurt to make the sauce.',
      'Serve the koftas hot with the yogurt sauce spooned over or alongside.',
    ],
  },
];
