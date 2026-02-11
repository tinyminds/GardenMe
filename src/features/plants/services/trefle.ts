export interface TreflePlantHit {
  externalId: string;
  commonName: string;
  scientificName?: string;
  familyName?: string;
  imageUrl?: string;
  rawJson: string;
}

type TrefleSearchResponse = {
  data?: Array<{
    id?: number;
    common_name?: string | null;
    scientific_name?: string | null;
    family_common_name?: string | null;
    image_url?: string | null;
  }>;
};

const DEFAULT_TREFLE_BASE_URL = "https://trefle.io/api/v1";

export async function searchTreflePlants(query: string): Promise<TreflePlantHit[]> {
  const token = process.env.EXPO_PUBLIC_TREFLE_API_TOKEN;
  if (!token) return [];

  const trimmed = query.trim();
  if (!trimmed) return [];

  const baseUrl = process.env.EXPO_PUBLIC_TREFLE_BASE_URL ?? DEFAULT_TREFLE_BASE_URL;
  const url = `${baseUrl}/plants/search?token=${encodeURIComponent(token)}&q=${encodeURIComponent(trimmed)}`;

  const response = await fetch(url);
  if (!response.ok) return [];

  const payload = (await response.json()) as TrefleSearchResponse;
  const rows = payload.data ?? [];

  return rows
    .map((row): TreflePlantHit | null => {
      const id = row.id;
      const commonName = row.common_name?.trim();
      const scientificName = row.scientific_name?.trim();
      if (!id || (!commonName && !scientificName)) return null;

      return {
        externalId: String(id),
        commonName: commonName || scientificName || "Unknown plant",
        ...(scientificName ? { scientificName } : {}),
        ...(row.family_common_name?.trim() ? { familyName: row.family_common_name.trim() } : {}),
        ...(row.image_url?.trim() ? { imageUrl: row.image_url.trim() } : {}),
        rawJson: JSON.stringify(row),
      };
    })
    .filter((item): item is TreflePlantHit => item !== null);
}
