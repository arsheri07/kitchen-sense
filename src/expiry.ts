// Reasonable default shelf-life estimates (in days), used to seed an
// item's expiry_date when the vision scan (or a manual add) doesn't set
// one explicitly. Deliberately coarse — per detected category, not per
// specific food — since that's all the scan pipeline gives us.
export const DEFAULT_SHELF_LIFE_DAYS: Record<string, number> = {
  produce: 7,
  dairy: 10,
  protein: 3,
  pantry: 180,
  condiment: 365,
  beverage: 270,
  frozen: 90,
  other: 14,
};

// Returns a 'YYYY-MM-DD' string (not a Date) so it round-trips cleanly
// into a Postgres DATE column regardless of driver/timezone settings.
export function estimateExpiryDate(category: string, fromDate: Date = new Date()): string {
  const days = DEFAULT_SHELF_LIFE_DAYS[category] ?? DEFAULT_SHELF_LIFE_DAYS.other;
  const result = new Date(fromDate);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
