import { Pool } from 'pg';

// For every recipe, the soonest expiry among inventory items matching any
// of its ingredients — reuses the same substring match_term logic the
// recipe matcher itself uses, just aggregated down to a single MIN per
// recipe instead of per-ingredient in_stock booleans. Shared by the meal
// planner and the "what should I cook right now" suggestion so both agree
// on what counts as urgent.
export async function computeUrgency(pool: Pool): Promise<Map<number, number>> {
  const result = await pool.query<{ recipe_id: number; min_days: number }>(`
    SELECT ri.recipe_id, MIN(ii.expiry_date - CURRENT_DATE) AS min_days
    FROM recipe_ingredients ri
    JOIN inventory_items ii ON ii.name ILIKE '%' || ri.match_term || '%' AND ii.expiry_date IS NOT NULL
    GROUP BY ri.recipe_id
  `);
  return new Map(result.rows.map((r) => [r.recipe_id, r.min_days]));
}
