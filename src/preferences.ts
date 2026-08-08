import { Pool } from 'pg';

export const DIETARY_RESTRICTIONS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free'] as const;
const VALID_RESTRICTIONS = new Set<string>(DIETARY_RESTRICTIONS);

// Matches the canonical protein types recipes are tagged with in
// src/seedRecipes.ts (PROTEIN_TYPE_MAP) — kept as a fixed list here so the
// UI can offer known-good choices rather than free text that would never
// match anything.
export const PROTEIN_TYPES = ['chicken', 'beef', 'fish', 'shrimp', 'egg', 'tofu', 'legumes'] as const;
const VALID_PROTEIN_TYPES = new Set<string>(PROTEIN_TYPES);

export interface Preferences {
  // Hard filters — a recipe violating any of these is excluded outright.
  restrictions: string[];
  avoidTerms: string[];
  // Soft ranking signals — never exclude a recipe, only reorder: a
  // matching recipe sorts higher, everything else stays visible.
  highProtein: boolean;
  favoriteProteins: string[];
}

const EMPTY: Preferences = { restrictions: [], avoidTerms: [], highProtein: false, favoriteProteins: [] };

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
  }>('SELECT restrictions, avoid_terms, high_protein, favorite_proteins FROM preferences WHERE id = 1');
  if (result.rows.length === 0) return EMPTY;
  const row = result.rows[0];
  return {
    restrictions: row.restrictions ?? [],
    avoidTerms: row.avoid_terms ?? [],
    highProtein: row.high_protein ?? false,
    favoriteProteins: row.favorite_proteins ?? [],
  };
}

export async function setPreferences(
  pool: Pool,
  input: { restrictions: unknown; avoidTerms: unknown; highProtein: unknown; favoriteProteins: unknown },
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

  const favoriteProteins = Array.isArray(input.favoriteProteins)
    ? input.favoriteProteins.filter((p): p is string => typeof p === 'string' && VALID_PROTEIN_TYPES.has(p))
    : [];

  await pool.query(
    `INSERT INTO preferences (id, restrictions, avoid_terms, high_protein, favorite_proteins, updated_at)
     VALUES (1, $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       restrictions = EXCLUDED.restrictions,
       avoid_terms = EXCLUDED.avoid_terms,
       high_protein = EXCLUDED.high_protein,
       favorite_proteins = EXCLUDED.favorite_proteins,
       updated_at = now()`,
    [restrictions, avoidTerms, highProtein, favoriteProteins],
  );

  return { restrictions, avoidTerms, highProtein, favoriteProteins };
}
