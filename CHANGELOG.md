# Changelog

## 2026-11-20

### Added
- **Ingredient swaps** (`src/substitutions.ts`). For each missing ingredient, an in-stock substitute is suggested (olive oil for butter, lime for lemon, shallots for onion, and others). Recipe cards show `Butter → Olive oil` with a how-to tooltip; recipes whose every gap is covered show **Ready with swaps** and rank first in Almost There.
- Swaps are restriction-safe: dietary tags are re-derived with the swap applied (via `deriveDietaryTags`), free-text avoid terms are checked, and one inventory item covers at most one gap.
- The weekly meal planner counts swapped ingredients as already owned when minimizing shopping.
- `RecipeMatch` gains `swaps` and `missingAfterSwaps`.
- Test suite: 19 tests on Node's built-in runner (`npm test`), including `matchRecipes()` against an in-memory Postgres stand-in.
- GitHub Actions CI: type check and tests on every push.

### Changed
- Package and docs renamed from the `nodejs-hello-world` template to `kitchen-sense`.

## 2026-08-10
- Hackathon release for The Zerops Challenge (48-hour solo build).
