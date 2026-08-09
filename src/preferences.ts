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
  // Free-text restrictions alongside the fixed checkbox list above. Never
  // checked against dietaryTags (a made-up tag would match nothing and
  // silently empty every list) — instead routed through the same
  // ingredient-name substring matching avoidTerms uses, so it excludes
  // something real. See violatesPreferences() in recipeMatch.ts.
  customRestrictions: string[];
  // Soft ranking signals — never exclude a recipe, only reorder: a
  // matching recipe sorts higher, everything else stays visible.
  highProtein: boolean;
  favoriteProteins: string[];
  // Free-text favorite proteins, unioned with favoriteProteins at ranking
  // time. Added as-is (no validation against PROTEIN_TYPES) — a term that
  // matches no recipe's proteinTypes just contributes 0, same as an
  // unchecked canonical type would.
  customFavoriteProteins: string[];
  // Prefer recipes with fewer total ingredients — real signal already
  // computed from the recipe/ingredient join (recipeMatch.ts), not a
  // fabricated field.
  quickSimple: boolean;
  // Free-text taste/nutrition terms, soft-ranked via the same
  // ingredient-name substring matching as avoidTerms/customRestrictions —
  // a recipe using a matching ingredient ranks higher, nothing is hidden.
  customTasteTerms: string[];
}

const EMPTY: Preferences = {
  restrictions: [],
  avoidTerms: [],
  customRestrictions: [],
  highProtein: false,
  favoriteProteins: [],
  customFavoriteProteins: [],
  quickSimple: false,
  customTasteTerms: [],
};

// Shared parser for every free-text preference list: trim, lowercase, cap
// length, dedupe, drop empties. Same normalization avoidTerms already used
// (recipeMatch.ts compares lowercased ingredient names against these).
function parseTermList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().toLowerCase().slice(0, 100))
        .filter((t) => t.length > 0),
    ),
  );
}

// Singleton row (id = 1) — one household, one preference set. Reads never
// throw on a missing row; a fresh install with no row yet behaves exactly
// like "no restrictions, no ranking preference" rather than failing
// recipe matching.
export async function getPreferences(pool: Pool): Promise<Preferences> {
  const result = await pool.query<{
    restrictions: string[];
    avoid_terms: string[];
    custom_restrictions: string[];
    high_protein: boolean;
    favorite_proteins: string[];
    custom_favorite_proteins: string[];
    quick_simple: boolean;
    custom_taste_terms: string[];
  }>(
    `SELECT restrictions, avoid_terms, custom_restrictions, high_protein,
            favorite_proteins, custom_favorite_proteins, quick_simple, custom_taste_terms
     FROM preferences WHERE id = 1`,
  );
  if (result.rows.length === 0) return EMPTY;
  const row = result.rows[0];
  return {
    restrictions: row.restrictions ?? [],
    avoidTerms: row.avoid_terms ?? [],
    customRestrictions: row.custom_restrictions ?? [],
    highProtein: row.high_protein ?? false,
    favoriteProteins: row.favorite_proteins ?? [],
    customFavoriteProteins: row.custom_favorite_proteins ?? [],
    quickSimple: row.quick_simple ?? false,
    customTasteTerms: row.custom_taste_terms ?? [],
  };
}

export async function setPreferences(
  pool: Pool,
  input: {
    restrictions: unknown;
    avoidTerms: unknown;
    customRestrictions: unknown;
    highProtein: unknown;
    favoriteProteins: unknown;
    customFavoriteProteins: unknown;
    quickSimple: unknown;
    customTasteTerms: unknown;
  },
): Promise<Preferences> {
  const restrictions = Array.isArray(input.restrictions)
    ? input.restrictions.filter((r): r is string => typeof r === 'string' && VALID_RESTRICTIONS.has(r))
    : [];

  const avoidTerms = parseTermList(input.avoidTerms);
  const customRestrictions = parseTermList(input.customRestrictions);
  const customTasteTerms = parseTermList(input.customTasteTerms);

  const highProtein = input.highProtein === true;
  const quickSimple = input.quickSimple === true;

  const favoriteProteins = Array.isArray(input.favoriteProteins)
    ? input.favoriteProteins.filter((p): p is string => typeof p === 'string' && VALID_PROTEIN_TYPES.has(p))
    : [];
  const customFavoriteProteins = parseTermList(input.customFavoriteProteins);

  await pool.query(
    `INSERT INTO preferences (
       id, restrictions, avoid_terms, custom_restrictions, high_protein,
       favorite_proteins, custom_favorite_proteins, quick_simple, custom_taste_terms, updated_at
     )
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (id) DO UPDATE SET
       restrictions = EXCLUDED.restrictions,
       avoid_terms = EXCLUDED.avoid_terms,
       custom_restrictions = EXCLUDED.custom_restrictions,
       high_protein = EXCLUDED.high_protein,
       favorite_proteins = EXCLUDED.favorite_proteins,
       custom_favorite_proteins = EXCLUDED.custom_favorite_proteins,
       quick_simple = EXCLUDED.quick_simple,
       custom_taste_terms = EXCLUDED.custom_taste_terms,
       updated_at = now()`,
    [
      restrictions,
      avoidTerms,
      customRestrictions,
      highProtein,
      favoriteProteins,
      customFavoriteProteins,
      quickSimple,
      customTasteTerms,
    ],
  );

  return {
    restrictions,
    avoidTerms,
    customRestrictions,
    highProtein,
    favoriteProteins,
    customFavoriteProteins,
    quickSimple,
    customTasteTerms,
  };
}
