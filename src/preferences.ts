import { Pool } from 'pg';

// Hard filters — a recipe violating any of these is excluded outright,
// everywhere recipes are surfaced. Each value must correspond to a tag
// src/seedRecipes.ts's deriveDietaryTags() can actually produce for at
// least one recipe — an option here that matches nothing would silently
// exclude everything the moment it's checked.
export const DIETARY_RESTRICTIONS = [
  'vegetarian',
  'vegan',
  'pescatarian',
  'gluten-free',
  'dairy-free',
  'nut-free',
  'low-carb',
  'keto',
] as const;
const VALID_RESTRICTIONS = new Set<string>(DIETARY_RESTRICTIONS);

// Matches the canonical protein types recipes are tagged with in
// src/seedRecipes.ts (PROTEIN_TYPE_MAP) — kept as a fixed list here so the
// UI can offer known-good choices rather than free text that would never
// match anything.
export const PROTEIN_TYPES = [
  'chicken',
  'beef',
  'fish',
  'shrimp',
  'egg',
  'tofu',
  'legumes',
  'pork',
  'turkey',
  'lamb',
] as const;
const VALID_PROTEIN_TYPES = new Set<string>(PROTEIN_TYPES);

export interface Preferences {
  // Hard filters — a recipe violating any of these is excluded outright.
  restrictions: string[];
  avoidTerms: string[];
  // Soft ranking signals — never exclude a recipe, only reorder: a
  // matching recipe sorts higher, everything else stays visible.
  highProtein: boolean;
  favoriteProteins: string[];
  // Prefer recipes with fewer total ingredients — real signal already
  // computed from the recipe/ingredient join (recipeMatch.ts), not a
  // fabricated field.
  quickSimple: boolean;
}

const EMPTY: Preferences = {
  restrictions: [],
  avoidTerms: [],
  highProtein: false,
  favoriteProteins: [],
  quickSimple: false,
};

// Singleton row (id = 1) — one household, one preference set. Reads never
// throw on a missing row; a fresh install with no row yet behaves exactly
// like "no restrictions, no ranking preference" rather than failing
// recipe matching.
export async function getPreferences(pool: Pool): Promise<Preferences> {
  const result = await pool.query<{
    restrictions: string[];
    avoid_terms: string[];
    high_protein: boolean;
    favorite_proteins: string[];
    quick_simple: boolean;
  }>('SELECT restrictions, avoid_terms, high_protein, favorite_proteins, quick_simple FROM preferences WHERE id = 1');
  if (result.rows.length === 0) return EMPTY;
  const row = result.rows[0];
  return {
    restrictions: row.restrictions ?? [],
    avoidTerms: row.avoid_terms ?? [],
    highProtein: row.high_protein ?? false,
    favoriteProteins: row.favorite_proteins ?? [],
    quickSimple: row.quick_simple ?? false,
  };
}

export async function setPreferences(
  pool: Pool,
  input: {
    restrictions: unknown;
    avoidTerms: unknown;
    highProtein: unknown;
    favoriteProteins: unknown;
    quickSimple: unknown;
  },
): Promise<Preferences> {
  const restrictions = Array.isArray(input.restrictions)
    ? input.restrictions.filter((r): r is string => typeof r === 'string' && VALID_RESTRICTIONS.has(r))
    : [];

  const avoidTerms = Array.isArray(input.avoidTerms)
    ? Array.from(
        new Set(
          input.avoidTerms
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim().toLowerCase().slice(0, 100))
            .filter((t) => t.length > 0),
        ),
      )
    : [];

  const highProtein = input.highProtein === true;
  const quickSimple = input.quickSimple === true;

  const favoriteProteins = Array.isArray(input.favoriteProteins)
    ? input.favoriteProteins.filter((p): p is string => typeof p === 'string' && VALID_PROTEIN_TYPES.has(p))
    : [];

  await pool.query(
    `INSERT INTO preferences (id, restrictions, avoid_terms, high_protein, favorite_proteins, quick_simple, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       restrictions = EXCLUDED.restrictions,
       avoid_terms = EXCLUDED.avoid_terms,
       high_protein = EXCLUDED.high_protein,
       favorite_proteins = EXCLUDED.favorite_proteins,
       quick_simple = EXCLUDED.quick_simple,
       updated_at = now()`,
    [restrictions, avoidTerms, highProtein, favoriteProteins, quickSimple],
  );

  return { restrictions, avoidTerms, highProtein, favoriteProteins, quickSimple };
}
