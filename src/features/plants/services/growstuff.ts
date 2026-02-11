export interface GrowstuffPlantHit {
  externalId: string;
  commonName: string;
  scientificName?: string;
  familyName?: string;
  imageUrl?: string;
  rawJson: string;
}

type GrowstuffQueryItem = {
  id?: string | number;
  name?: string | null;
  slug?: string | null;
  scientific_name?: string | null;
  scientific_names?: Array<string | null> | null;
  alternate_names?: Array<string | null> | null;
  description?: string | null;
  thumbnail_url?: string | null;
};

type GrowstuffSearchResponse = {
  query?: GrowstuffQueryItem[];
};

export type GrowstuffCropDetails = {
  id?: string | number;
  slug?: string | null;
  name?: string | null;
  description?: string | null;
  scientific_name?: string | null;
  scientific_names?: Array<string | null> | null;
  perennial?: boolean | null;
  median_lifespan?: number | null;
  median_days_to_first_harvest?: number | null;
  median_days_to_last_harvest?: number | null;
  row_spacing?: number | null;
  spread?: number | null;
  height?: number | null;
  sun_requirements?: string | null;
  sowing_method?: string | null;
  growing_degree_days?: number | null;
  thumbnail_url?: string | null;
  [key: string]: unknown;
};

const DEFAULT_GROWSTUFF_BASE_URL = "https://www.growstuff.org";
const GROWSTUFF_QUERY_SYNONYMS: Record<string, string[]> = {
  cilantro: ["coriander"],
  coriander: ["cilantro"],
  courgette: ["zucchini"],
  zucchini: ["courgette"],
  aubergine: ["eggplant"],
  eggplant: ["aubergine"],
  rocket: ["arugula"],
  arugula: ["rocket"],
  scallion: ["green onion"],
  spring_onion: ["green onion"],
};

export async function searchGrowstuffPlants(query: string, page = 1, limit = 24): Promise<GrowstuffPlantHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const canonicalQuery = trimmed.toLowerCase();
  const expandedTerms = expandSearchTerms(canonicalQuery);

  const baseUrl = getGrowstuffBaseUrl();
  const batches = await Promise.all(expandedTerms.map((term) => fetchGrowstuffSearchRows(baseUrl, term, page, limit)));
  const rows = batches.flat();

  const matchesByExternalId = new Map<string, GrowstuffPlantHit>();
  for (const row of rows) {
    const mapped = toGrowstuffPlantHit(row);
    if (!mapped) continue;

    const commonLower = mapped.commonName.toLowerCase();
    const scientificLower = (mapped.scientificName ?? "").toLowerCase();
    const alternatesLower = (row.alternate_names ?? [])
      .map((value) => value?.trim().toLowerCase() ?? "")
      .filter(Boolean);
    const slugLower = row.slug?.trim().toLowerCase() ?? "";
    const relevant = expandedTerms.some(
      (term) =>
        commonLower.includes(term) ||
        scientificLower.includes(term) ||
        alternatesLower.some((name) => name.includes(term)) ||
        slugLower.includes(term)
    );
    if (!relevant) continue;
    if (!matchesByExternalId.has(mapped.externalId)) {
      matchesByExternalId.set(mapped.externalId, mapped);
    }
  }

  const exactHits = await Promise.all(expandedTerms.map((term) => fetchGrowstuffCropByQuery(baseUrl, term)));
  for (const exact of exactHits) {
    if (!exact) continue;
    if (!matchesByExternalId.has(exact.externalId)) {
      matchesByExternalId.set(exact.externalId, exact);
    }
  }

  return Array.from(matchesByExternalId.values());
}

function expandSearchTerms(canonicalQuery: string): string[] {
  const underscored = canonicalQuery.replace(/\s+/g, " ").trim().replace(/ /g, "_");
  const keys = Array.from(new Set([canonicalQuery, underscored]));
  const synonymTerms = keys.flatMap((key) => GROWSTUFF_QUERY_SYNONYMS[key] ?? []);
  return Array.from(
    new Set(
      [canonicalQuery, ...synonymTerms]
        .map((value) => value.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean)
    )
  );
}

export async function fetchGrowstuffCropDetails(externalIdOrSlug: string): Promise<GrowstuffCropDetails | null> {
  const trimmed = externalIdOrSlug.trim();
  if (!trimmed) return null;

  const baseUrl = getGrowstuffBaseUrl();
  const url = `${baseUrl}/crops/${encodeURIComponent(trimmed)}.json`;
  const response = await fetch(url);
  if (!response.ok) return null;

  return (await response.json()) as GrowstuffCropDetails;
}

function getGrowstuffBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_GROWSTUFF_BASE_URL?.trim();
  if (!configured) return DEFAULT_GROWSTUFF_BASE_URL;
  return configured.replace(/\/+$/, "");
}

function toGrowstuffPlantHit(row: GrowstuffQueryItem): GrowstuffPlantHit | null {
  const id = row.id;
  const commonName = row.name?.trim();
  const scientificName =
    row.scientific_name?.trim() ??
    row.scientific_names?.find((value): value is string => Boolean(value?.trim()))?.trim();
  if (!id || (!commonName && !scientificName)) return null;

  const displayName = commonName || scientificName || "Unknown plant";
  return {
    externalId: String(id),
    commonName: displayName,
    ...(scientificName ? { scientificName } : {}),
    ...(row.thumbnail_url?.trim() ? { imageUrl: row.thumbnail_url.trim() } : {}),
    rawJson: JSON.stringify(row),
  };
}

async function fetchGrowstuffCropByQuery(baseUrl: string, rawQuery: string): Promise<GrowstuffPlantHit | null> {
  const slug = rawQuery
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;

  const candidates = Array.from(new Set([slug, slug.replace(/-+/g, "-")]));
  for (const candidate of candidates) {
    const response = await fetch(`${baseUrl}/crops/${encodeURIComponent(candidate)}.json`);
    if (!response.ok) continue;
    const crop = (await response.json()) as GrowstuffQueryItem;
    const mapped = toGrowstuffPlantHit(crop);
    if (mapped) return mapped;
  }

  return null;
}

async function fetchGrowstuffSearchRows(
  baseUrl: string,
  query: string,
  page: number,
  limit: number
): Promise<GrowstuffQueryItem[]> {
  const modernUrl =
    `${baseUrl}/crops/search.json?term=${encodeURIComponent(query)}` +
    `&page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}`;
  const modernRows = await fetchRowsFromEndpoint(modernUrl);
  if (modernRows.length > 0) return modernRows;

  // Legacy fallback endpoint, in case self-hosted instances still use it.
  const legacyUrl =
    `${baseUrl}/crops.json?term=${encodeURIComponent(query)}` +
    `&page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}`;
  return fetchRowsFromEndpoint(legacyUrl);
}

async function fetchRowsFromEndpoint(url: string): Promise<GrowstuffQueryItem[]> {
  const response = await fetch(url);
  if (!response.ok) return [];

  const payload = (await response.json()) as GrowstuffSearchResponse | GrowstuffQueryItem[];
  if (Array.isArray(payload)) return payload;
  return payload.query ?? [];
}
