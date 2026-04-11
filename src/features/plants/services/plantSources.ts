import type { PlantCatalogEntry } from "@/domain/entities/Plant";
import type { PlantCatalogRepository } from "@/domain/repositories/PlantCatalogRepository";
import { searchGrowstuffPlants } from "@/features/plants/services/growstuff";

type GbifMatch = {
  usageKey?: number;
  acceptedUsageKey?: number;
  scientificName?: string;
  canonicalName?: string;
  vernacularName?: string;
  family?: string;
  confidence?: number;
  matchType?: string;
  synonym?: boolean;
  [key: string]: unknown;
};

type WikidataSearchHit = {
  id?: string;
  label?: string;
  description?: string;
  concepturi?: string;
  [key: string]: unknown;
};

type WikidataSearchResponse = {
  search?: WikidataSearchHit[];
};

type WikidataEntityResponse = {
  entities?: Record<
    string,
    {
      aliases?: Record<string, Array<{ value?: string }>>;
      claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>;
      labels?: Record<string, { value?: string }>;
      descriptions?: Record<string, { value?: string }>;
    }
  >;
};

export async function searchExternalPlantCatalogEntries(
  query: string,
  repository: PlantCatalogRepository,
  limit = 12
): Promise<PlantCatalogEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const variants = buildSearchVariants(trimmed);

  const deduped = new Map<string, PlantCatalogEntry>();
  const addEntry = (entry: PlantCatalogEntry | null) => {
    if (!entry) return;
    const key = buildEntryKey(entry);
    if (deduped.has(key)) return;
    deduped.set(key, entry);
  };

  const gbifHit = await fetchGbifMatch(variants);
  if (gbifHit) {
    const gbifAliases = collectGbifAliases(gbifHit);
    addEntry(
      await repository.upsert({
        source: "gbif",
        externalId: String(gbifHit.usageKey ?? gbifHit.acceptedUsageKey ?? trimmed),
        commonName: gbifHit.vernacularName?.trim() || gbifHit.canonicalName?.trim() || gbifHit.scientificName?.trim() || trimmed,
        ...(gbifHit.scientificName?.trim() ? { scientificName: gbifHit.scientificName.trim() } : {}),
        ...(gbifHit.family?.trim() ? { familyName: gbifHit.family.trim() } : {}),
        metaJson: JSON.stringify({
          gbif: gbifHit,
          gardenme: {
            searchTerms: gbifAliases,
          },
        }),
      })
    );
  }

  const wikidataHits = await searchWikidataCandidates(variants);
  for (const hit of wikidataHits.slice(0, limit)) {
    addEntry(
      await repository.upsert({
        source: "wikidata",
        externalId: hit.id,
        commonName: hit.label?.trim() || trimmed,
        ...(hit.scientificName?.trim() ? { scientificName: hit.scientificName.trim() } : {}),
        metaJson: JSON.stringify({
          wikidata: hit,
          gardenme: {
            searchTerms: collectWikidataSearchTerms(hit),
          },
        }),
      })
    );
  }

  const growstuffHits = await searchGrowstuffCandidates(variants.slice(0, 3), repository, limit);
  growstuffHits.forEach(addEntry);

  return Array.from(deduped.values()).sort((a, b) => scoreCandidate(trimmed, a) - scoreCandidate(trimmed, b));
}

async function searchGrowstuffCandidates(
  queries: string[],
  repository: PlantCatalogRepository,
  limit: number
): Promise<PlantCatalogEntry[]> {
  try {
    const deduped = new Map<string, PlantCatalogEntry>();
    for (const query of queries) {
      const hits = await searchGrowstuffPlants(query, 1, Math.max(4, limit));
      const entries = await Promise.all(
        hits.map(async (hit) => {
          const existing = await repository.getBySourceExternalId("growstuff", hit.externalId);
          return repository.upsert({
            source: "growstuff",
            externalId: hit.externalId,
            commonName: hit.commonName,
            ...(hit.scientificName ? { scientificName: hit.scientificName } : {}),
            ...(hit.imageUrl ? { imageUrl: hit.imageUrl } : {}),
            metaJson: existing?.metaJson ?? hit.rawJson,
          });
        })
      );
      for (const entry of entries) {
        const key = buildEntryKey(entry);
        if (!deduped.has(key)) deduped.set(key, entry);
      }
    }
    return Array.from(deduped.values());
  } catch {
    return [];
  }
}

async function fetchGbifMatch(queries: string[]): Promise<GbifMatch | null> {
  for (const query of queries) {
    const response = await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(query)}`);
    if (!response.ok) continue;
    const payload = (await response.json()) as GbifMatch;
    if (!payload.usageKey && !payload.scientificName && !payload.canonicalName) continue;
    return payload;
  }
  return null;
}

async function searchWikidataCandidates(
  queries: string[]
): Promise<Array<{ id: string; label: string; description?: string; scientificName?: string; aliases?: string[] }>> {
  const deduped = new Map<string, { id: string; label: string; description?: string; scientificName?: string }>();
  for (const query of queries.slice(0, 3)) {
    const response = await fetch(
      "https://www.wikidata.org/w/api.php?action=wbsearchentities" +
        `&search=${encodeURIComponent(query)}` +
        "&language=en&uselang=en&type=item&limit=6&format=json&origin=*"
    );
    if (!response.ok) continue;
    const payload = (await response.json()) as WikidataSearchResponse;
    const hits = payload.search ?? [];
    for (const hit of hits) {
      if (!hit.id || deduped.has(hit.id)) continue;
      const entity = await fetchWikidataEntity(hit.id);
      const scientificName = extractScientificName(entity);
      const aliases = extractWikidataAliases(entity);
      deduped.set(hit.id, {
        id: hit.id,
        label: hit.label?.trim() || query,
        ...(hit.description?.trim() ? { description: hit.description.trim() } : {}),
        ...(scientificName ? { scientificName } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
      });
    }
  }
  return Array.from(deduped.values());
}

async function fetchWikidataEntity(id: string): Promise<NonNullable<WikidataEntityResponse["entities"]>[string] | null> {
  const response = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(id)}.json`);
  if (!response.ok) return null;
  const payload = (await response.json()) as WikidataEntityResponse;
  return payload.entities?.[id] ?? null;
}

function extractScientificName(entity: NonNullable<WikidataEntityResponse["entities"]>[string] | null): string | undefined {
  const value = entity?.claims?.P225?.[0]?.mainsnak?.datavalue?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildEntryKey(entry: PlantCatalogEntry): string {
  return entry.externalId ? `${entry.source}:${entry.externalId}` : `${entry.source}:${normalizeText(entry.commonName)}:${normalizeText(entry.scientificName ?? "")}`;
}

function scoreCandidate(query: string, entry: PlantCatalogEntry): number {
  const normalizedQuery = normalizeText(query);
  const common = normalizeText(entry.commonName);
  const scientific = normalizeText(entry.scientificName ?? "");
  const aliases = extractSearchTermsFromMeta(entry).map(normalizeText);
  if (!normalizedQuery) return 3;
  const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordMatch = new RegExp(`\\b${escapedQuery}\\b`);
  const prefixMatch =
    common.startsWith(normalizedQuery) ||
    scientific.startsWith(normalizedQuery) ||
    aliases.some((alias) => alias.startsWith(normalizedQuery));
  if (prefixMatch) return 0;

  const wordMatchFound =
    wordMatch.test(common) ||
    wordMatch.test(scientific) ||
    aliases.some((alias) => wordMatch.test(alias));
  if (wordMatchFound) return 1;

  const substringMatch =
    common.includes(normalizedQuery) ||
    scientific.includes(normalizedQuery) ||
    aliases.some((alias) => alias.includes(normalizedQuery));
  if (substringMatch) return 2;

  return 3;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildSearchVariants(query: string): string[] {
  const variants = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizeText(value);
    if (normalized) variants.add(normalized);
  };

  add(query);
  for (const alias of expandUkAliases(query)) add(alias);
  add(query.replace(/[()[\],.:;'"'"'`]/g, " "));
  add(query.replace(/[^a-z0-9\s-]/g, " "));
  add(query.replace(/-/g, " "));
  add(stripTrailingPlural(query));
  add(stripTrailingPlural(query.replace(/[()[\],.:;'"'"'`]/g, " ")));

  return Array.from(variants);
}

function stripTrailingPlural(value: string): string {
  const trimmed = value.trim();
  const parts = trimmed.split(/\s+/g);
  if (parts.length === 0) return trimmed;
  const last = parts[parts.length - 1] ?? "";
  if (last.length > 3 && last.endsWith("es")) {
    parts[parts.length - 1] = last.slice(0, -2);
    return parts.join(" ");
  }
  if (last.length > 2 && last.endsWith("s")) {
    parts[parts.length - 1] = last.slice(0, -1);
    return parts.join(" ");
  }
  return trimmed;
}

function collectGbifAliases(match: GbifMatch): string[] {
  const aliases = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) aliases.add(trimmed);
    }
  };
  add(match.vernacularName);
  add(match.canonicalName);
  add(match.scientificName);
  return Array.from(aliases);
}

function collectWikidataSearchTerms(hit: { label?: string; description?: string; scientificName?: string; aliases?: string[] }): string[] {
  const aliases = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) aliases.add(trimmed);
    }
  };
  add(hit.label);
  add(hit.description);
  add(hit.scientificName);
  if (Array.isArray(hit.aliases)) {
    for (const alias of hit.aliases) add(alias);
  }
  return Array.from(aliases);
}

function extractWikidataAliases(
  entity: NonNullable<WikidataEntityResponse["entities"]>[string] | null
): string[] {
  if (!entity?.aliases) return [];
  const aliases = new Set<string>();
  for (const list of Object.values(entity.aliases)) {
    for (const alias of list ?? []) {
      if (typeof alias?.value === "string") {
        const trimmed = alias.value.trim();
        if (trimmed) aliases.add(trimmed);
      }
    }
  }
  return Array.from(aliases);
}

function expandUkAliases(query: string): string[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const aliases = UK_ALIAS_MAP[normalized];
  return aliases ?? [];
}

function expandAutocompleteFamilyTerms(query: string): string[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const terms = new Set<string>();
  for (const [prefix, values] of Object.entries(AUTOCOMPLETE_FAMILY_MAP)) {
    if (!normalized.startsWith(prefix)) continue;
    for (const value of values) terms.add(value);
  }
  return Array.from(terms);
}

function extractSearchTermsFromMeta(entry: PlantCatalogEntry): string[] {
  if (!entry.metaJson) return [];
  try {
    const parsed = JSON.parse(entry.metaJson) as {
      gardenme?: { searchTerms?: unknown };
      gbif?: { vernacularName?: unknown; canonicalName?: unknown; scientificName?: unknown };
      wikidata?: { label?: unknown; description?: unknown; scientificName?: unknown; aliases?: unknown };
      aliases?: unknown;
      common_names?: unknown;
      commonNames?: unknown;
      vernacular_names?: unknown;
      vernacularNames?: unknown;
      description?: unknown;
    };
    const terms = new Set<string>();
    const push = (value: unknown) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) terms.add(trimmed);
      } else if (Array.isArray(value)) {
        for (const item of value) push(item);
      } else if (value && typeof value === "object") {
        for (const nested of Object.values(value as Record<string, unknown>)) push(nested);
      }
    };
    push(parsed.gardenme?.searchTerms);
    push(parsed.gbif?.vernacularName);
    push(parsed.gbif?.canonicalName);
    push(parsed.gbif?.scientificName);
    push(parsed.wikidata?.label);
    push(parsed.wikidata?.description);
    push(parsed.wikidata?.scientificName);
    push(parsed.wikidata?.aliases);
    push(parsed.aliases);
    push(parsed.common_names);
    push(parsed.commonNames);
    push(parsed.vernacular_names);
    push(parsed.vernacularNames);
    push(parsed.description);
    return Array.from(terms);
  } catch {
    return [];
  }
}

const UK_ALIAS_MAP: Record<string, string[]> = {
  aubergine: ["eggplant"],
  eggplant: ["aubergine"],
  courgette: ["zucchini"],
  zucchini: ["courgette"],
  rocket: ["arugula"],
  arugula: ["rocket"],
  coriander: ["cilantro"],
  cilantro: ["coriander"],
  "spring onion": ["scallion", "green onion"],
  scallion: ["spring onion", "green onion"],
  "green onion": ["spring onion", "scallion"],
  beetroot: ["beet"],
  beet: ["beetroot"],
  swede: ["rutabaga"],
  rutabaga: ["swede"],
  sweetcorn: ["corn"],
  corn: ["sweetcorn"],
  "french bean": ["green bean"],
  "green bean": ["french bean"],
  "pak choi": ["bok choy"],
  "bok choy": ["pak choi"],
};

const AUTOCOMPLETE_FAMILY_MAP: Record<string, string[]> = {
  cour: ["courgette", "zucchini", "summer squash", "marrow", "pattypan squash", "tromboncino", "crookneck squash"],
  bean: ["bean", "French bean", "runner bean", "broad bean", "haricot bean"],
  pea: ["pea", "garden pea", "mangetout", "sugar snap pea"],
  tom: ["tomato", "cherry tomato", "plum tomato", "beefsteak tomato"],
  onion: ["onion", "spring onion", "salad onion", "red onion"],
  lett: ["lettuce", "leaf lettuce", "cos lettuce", "romaine lettuce"],
  cabb: ["cabbage", "kale", "brassica", "broccoli"],
  spin: ["spinach", "baby leaf spinach", "perpetual spinach"],
  beet: ["beetroot", "beet"],
  carro: ["carrot"],
};
