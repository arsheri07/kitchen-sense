// Single source of truth for inventory categories — internal value +
// display label. Shared by the manual-add validator, the vision prompt's
// classification guidance/validation, and the expiry-estimate lookup.
// (The frontend is a plain static file with no build step, so it keeps
// its own copy of this same list in sync by hand.)
export interface CategoryDef {
  value: string;
  label: string;
}

export const CATEGORIES: CategoryDef[] = [
  { value: 'produce', label: 'Produce' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'protein', label: 'Protein' },
  { value: 'pantry', label: 'Pantry/Canned' },
  { value: 'condiment', label: 'Condiments' },
  { value: 'beverage', label: 'Beverages' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'other', label: 'Other' },
];

export const VALID_CATEGORY_VALUES = new Set(CATEGORIES.map((c) => c.value));
