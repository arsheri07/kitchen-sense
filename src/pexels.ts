const PEXELS_SEARCH_URL = 'https://api.pexels.com/v1/search';

// Looks up a representative photo for a dish by name. Best-effort — a
// missing key, a rate limit, or no result just means no photo, never a
// failure that blocks the recipe detail response.
export async function fetchDishPhoto(dishName: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.error('PEXELS_API_KEY is not set — skipping recipe photo fetch');
    return null;
  }

  try {
    const url = `${PEXELS_SEARCH_URL}?query=${encodeURIComponent(`${dishName} food dish`)}&per_page=1&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });

    if (!res.ok) {
      console.error(`Pexels API error ${res.status} for "${dishName}"`);
      return null;
    }

    const data = (await res.json()) as { photos?: { src?: { large?: string; medium?: string } }[] };
    const photo = data.photos?.[0];
    return photo?.src?.large ?? photo?.src?.medium ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Pexels fetch failed for "${dishName}":`, message);
    return null;
  }
}
