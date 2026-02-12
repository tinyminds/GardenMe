type TrefleSearchItem = {
  id?: number;
  common_name?: string | null;
  scientific_name?: string | null;
  family?: string | null;
  image_url?: string | null;
  slug?: string | null;
};

type TrefleSearchResponse = {
  data?: TrefleSearchItem[];
};

type TreflePlantDetailResponse = {
  data?: {
    id?: number;
    slug?: string | null;
    common_name?: string | null;
    scientific_name?: string | null;
    family?: string | null;
    image_url?: string | null;
    growth?: {
      days_to_harvest?: number | null;
      sowing?: string | null;
      growth_months?: string[] | string | null;
      fruit_months?: string[] | string | null;
    } | null;
    main_species?: {
      growth?: {
        days_to_harvest?: number | null;
        sowing?: string | null;
        growth_months?: string[] | string | null;
        fruit_months?: string[] | string | null;
      } | null;
    } | null;
  };
};

export type TreflePlantProfile = {
  trefleId: number;
  commonName?: string;
  scientificName?: string;
  familyName?: string;
  imageUrl?: string;
  slug?: string;
  daysToHarvest?: number;
  sowing?: string;
  growthMonths: number[];
  fruitMonths: number[];
};

const TREFLE_BASE_URL = "https://trefle.io/api/v1";

export async function fetchBestTreflePlantProfile(params: {
  commonName: string;
  scientificName?: string;
}): Promise<TreflePlantProfile | null> {
  const token = process.env.EXPO_PUBLIC_TREFLE_API_TOKEN?.trim();
  if (!token) return null;

  const queries = Array.from(
    new Set([params.commonName.trim(), params.scientificName?.trim() ?? ""].filter(Boolean))
  );
  if (queries.length === 0) return null;

  let best: TrefleSearchItem | null = null;
  let bestScore = -Infinity;

  for (const query of queries) {
    const searchResults = await searchTreflePlants(query, token);
    for (const result of searchResults) {
      const score = scoreSearchMatch(params.commonName, params.scientificName, result);
      if (score > bestScore) {
        best = result;
        bestScore = score;
      }
    }
    if (bestScore >= 120) break;
  }

  if (!best?.id) return null;
  const detail = await fetchTreflePlantDetail(best.id, token);
  if (!detail?.data) return null;

  const growth = detail.data.main_species?.growth ?? detail.data.growth ?? null;
  const growthMonths = parseTrefleMonths(growth?.growth_months);
  const fruitMonths = parseTrefleMonths(growth?.fruit_months);
  const days = toPositiveInt(growth?.days_to_harvest);
  const sowing = growth?.sowing?.trim();

  return {
    trefleId: best.id,
    ...(detail.data.common_name?.trim() ? { commonName: detail.data.common_name.trim() } : {}),
    ...(detail.data.scientific_name?.trim() ? { scientificName: detail.data.scientific_name.trim() } : {}),
    ...(detail.data.family?.trim() ? { familyName: detail.data.family.trim() } : {}),
    ...(detail.data.image_url?.trim() ? { imageUrl: detail.data.image_url.trim() } : {}),
    ...(detail.data.slug?.trim() ? { slug: detail.data.slug.trim() } : {}),
    ...(typeof days === "number" ? { daysToHarvest: days } : {}),
    ...(sowing ? { sowing } : {}),
    growthMonths,
    fruitMonths,
  };
}

async function searchTreflePlants(query: string, token: string): Promise<TrefleSearchItem[]> {
  const url = `${TREFLE_BASE_URL}/plants/search?token=${encodeURIComponent(token)}&q=${encodeURIComponent(query)}&page=1`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const payload = (await response.json()) as TrefleSearchResponse;
  return payload.data ?? [];
}

async function fetchTreflePlantDetail(id: number, token: string): Promise<TreflePlantDetailResponse | null> {
  const url = `${TREFLE_BASE_URL}/plants/${encodeURIComponent(String(id))}?token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return (await response.json()) as TreflePlantDetailResponse;
}

function scoreSearchMatch(commonName: string, scientificName: string | undefined, item: TrefleSearchItem): number {
  const queryCommon = normalize(commonName);
  const queryScientific = normalize(scientificName ?? "");
  const itemCommon = normalize(item.common_name ?? "");
  const itemScientific = normalize(item.scientific_name ?? "");

  let score = 0;
  if (queryCommon && itemCommon === queryCommon) score += 120;
  if (queryScientific && itemScientific === queryScientific) score += 110;
  if (queryCommon && itemCommon.startsWith(queryCommon)) score += 75;
  if (queryCommon && itemCommon.includes(queryCommon)) score += 35;
  if (queryScientific && itemScientific.includes(queryScientific)) score += 35;
  if (queryCommon && itemScientific.includes(queryCommon)) score += 10;
  return score;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTrefleMonths(value: string[] | string | null | undefined): number[] {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : value.split("|");
  const monthKeys = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const parsed = parts
    .map((part) => part.trim().toLowerCase().slice(0, 3))
    .map((part) => {
      const idx = monthKeys.findIndex((key) => key === part);
      return idx >= 0 ? idx + 1 : null;
    })
    .filter((month): month is number => typeof month === "number");
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

