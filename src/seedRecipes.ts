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
];
