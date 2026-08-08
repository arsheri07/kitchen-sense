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
}

export interface SeedRecipe {
  name: string;
  description: string;
  ingredients: SeedIngredient[];
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
      { name: 'Tomato', matchTerm: 'tomato' },
      { name: 'Red pepper', matchTerm: 'pepper' },
    ],
  },
  {
    name: 'Garden Veggie Salad',
    description: 'Tomato, red pepper and lettuce tossed together.',
    ingredients: [
      { name: 'Tomato', matchTerm: 'tomato' },
      { name: 'Red pepper', matchTerm: 'pepper' },
      { name: 'Lettuce', matchTerm: 'lettuce' },
    ],
  },
  {
    name: 'Citrus Greens Salad',
    description: 'Orange segments over lettuce with tomato.',
    ingredients: [
      { name: 'Orange', matchTerm: 'orange' },
      { name: 'Lettuce', matchTerm: 'lettuce' },
      { name: 'Tomato', matchTerm: 'tomato' },
    ],
  },
  {
    name: 'Pickled Veggie Plate',
    description: 'Jarred pickles served with fresh tomato.',
    ingredients: [
      { name: 'Pickles (jarred)', matchTerm: 'jar' },
      { name: 'Tomato', matchTerm: 'tomato' },
    ],
  },
  {
    name: 'Canned Bean & Tomato Salad',
    description: 'Canned beans with tomato and red pepper.',
    ingredients: [
      { name: 'Canned beans', matchTerm: 'can' },
      { name: 'Tomato', matchTerm: 'tomato' },
      { name: 'Red pepper', matchTerm: 'pepper' },
    ],
  },
  {
    name: 'Soda & Pickle Snack Plate',
    description: 'Cold soda with a side of jarred pickles.',
    ingredients: [
      { name: 'Soda', matchTerm: 'soda' },
      { name: 'Pickles (jarred)', matchTerm: 'jar' },
    ],
  },

  // --- near misses: missing 1-2 ingredients ---
  {
    name: 'Orange Sugar Refresher',
    description: 'Fresh orange sweetened with a little sugar.',
    ingredients: [
      { name: 'Orange', matchTerm: 'orange' },
      { name: 'Sugar', matchTerm: 'sugar' },
    ],
  },
  {
    name: 'Soda Float',
    description: 'A scoop of ice cream dropped into cold soda.',
    ingredients: [
      { name: 'Soda', matchTerm: 'soda' },
      { name: 'Ice cream', matchTerm: 'ice cream' },
    ],
  },
  {
    name: 'Tomato & Cheese Toast',
    description: 'Toasted bread topped with cheese and tomato.',
    ingredients: [
      { name: 'Bread', matchTerm: 'bread' },
      { name: 'Cheese', matchTerm: 'cheese' },
      { name: 'Tomato', matchTerm: 'tomato' },
    ],
  },
  {
    name: 'Pepper & Onion Fajita Base',
    description: 'Sauteed red pepper, onion and garlic for a fajita base.',
    ingredients: [
      { name: 'Red pepper', matchTerm: 'pepper' },
      { name: 'Onion', matchTerm: 'onion' },
      { name: 'Garlic', matchTerm: 'garlic' },
    ],
  },

  // --- more complex: 5+ ingredients ---
  {
    name: 'Vegetable Stir Fry',
    description: 'Tomato and pepper stir-fried with onion, garlic and soy sauce.',
    ingredients: [
      { name: 'Tomato', matchTerm: 'tomato' },
      { name: 'Red pepper', matchTerm: 'pepper' },
      { name: 'Onion', matchTerm: 'onion' },
      { name: 'Garlic', matchTerm: 'garlic' },
      { name: 'Soy sauce', matchTerm: 'soy sauce' },
    ],
  },
  {
    name: 'Simple Pasta Aglio e Olio',
    description: 'Pasta tossed with garlic and olive oil.',
    ingredients: [
      { name: 'Pasta', matchTerm: 'pasta' },
      { name: 'Garlic', matchTerm: 'garlic' },
      { name: 'Olive oil', matchTerm: 'olive oil' },
    ],
  },
  {
    name: 'Chicken Caesar Salad',
    description: 'Grilled chicken over lettuce with parmesan, croutons and caesar dressing.',
    ingredients: [
      { name: 'Chicken', matchTerm: 'chicken' },
      { name: 'Lettuce', matchTerm: 'lettuce' },
      { name: 'Parmesan', matchTerm: 'parmesan' },
      { name: 'Croutons', matchTerm: 'crouton' },
      { name: 'Caesar dressing', matchTerm: 'caesar' },
    ],
  },
  {
    name: 'Fruit & Cheese Board',
    description: 'Orange, cheese, crackers, grapes and honey.',
    ingredients: [
      { name: 'Orange', matchTerm: 'orange' },
      { name: 'Cheese', matchTerm: 'cheese' },
      { name: 'Crackers', matchTerm: 'cracker' },
      { name: 'Grapes', matchTerm: 'grape' },
      { name: 'Honey', matchTerm: 'honey' },
    ],
  },
  {
    name: 'Ratatouille',
    description: 'A slow-cooked medley of tomato, pepper, zucchini, eggplant, onion, garlic and olive oil.',
    ingredients: [
      { name: 'Tomato', matchTerm: 'tomato' },
      { name: 'Red pepper', matchTerm: 'pepper' },
      { name: 'Zucchini', matchTerm: 'zucchini' },
      { name: 'Eggplant', matchTerm: 'eggplant' },
      { name: 'Onion', matchTerm: 'onion' },
      { name: 'Garlic', matchTerm: 'garlic' },
      { name: 'Olive oil', matchTerm: 'olive oil' },
    ],
  },
  {
    name: 'Orange Chicken',
    description: 'Chicken glazed in an orange, soy and ginger sauce.',
    ingredients: [
      { name: 'Orange', matchTerm: 'orange' },
      { name: 'Chicken', matchTerm: 'chicken' },
      { name: 'Soy sauce', matchTerm: 'soy sauce' },
      { name: 'Garlic', matchTerm: 'garlic' },
      { name: 'Ginger', matchTerm: 'ginger' },
      { name: 'Cornstarch', matchTerm: 'cornstarch' },
    ],
  },
  {
    name: 'Minestrone Soup',
    description: 'A hearty soup of tomato, canned beans, carrot, celery, onion, garlic, pasta and parmesan.',
    ingredients: [
      { name: 'Tomato', matchTerm: 'tomato' },
      { name: 'Canned beans', matchTerm: 'can' },
      { name: 'Carrot', matchTerm: 'carrot' },
      { name: 'Celery', matchTerm: 'celery' },
      { name: 'Onion', matchTerm: 'onion' },
      { name: 'Garlic', matchTerm: 'garlic' },
      { name: 'Pasta', matchTerm: 'pasta' },
      { name: 'Parmesan', matchTerm: 'parmesan' },
    ],
  },
];
