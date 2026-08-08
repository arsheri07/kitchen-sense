import { Pool } from 'pg';

export const DIETARY_RESTRICTIONS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free'] as const;
export type DietaryRestriction = (typeof DIETARY_RESTRICTIONS)[number];
const VALID_RESTRICTIONS = new Set<string>(DIETARY_RESTRICTIONS);

export interface Preferences {
  restrictions: string[];
  avoidTerms: string[];
}

const EMPTY: Preferences = { restrictions: [], avoidTerms: [] };

// Singleton row (id = 1) — one household, one preference set. Reads never
// throw on a missing row; a fresh install with no row yet behaves exactly
// like "no restrictions" rather than failing recipe matching.
export async function getPreferences(pool: Pool): Promise<Preferences> {
  const result = await pool.query<{ restrictions: string[]; avoid_terms: string[] }>(
    'SELECT restrictions, avoid_terms FROM preferences WHERE id = 1',
  );
  if (result.rows.length === 0) return EMPTY;
  return {
    restrictions: result.rows[0].restrictions ?? [],
    avoidTerms: result.rows[0].avoid_terms ?? [],
  };
}

export async function setPreferences(pool: Pool, input: { restrictions: unknown; avoidTerms: unknown }): Promise<Preferences> {
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

  await pool.query(
    `INSERT INTO preferences (id, restrictions, avoid_terms, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET restrictions = EXCLUDED.restrictions, avoid_terms = EXCLUDED.avoid_terms, updated_at = now()`,
    [restrictions, avoidTerms],
  );

  return { restrictions, avoidTerms };
}
