import { getDatabase } from "@/core/db/sqlite";
import type { PlantCatalogEntry, PlantSource } from "@/domain/entities/Plant";
import type {
  PlantCatalogRepository,
  PlantCatalogUpsertInput,
} from "@/domain/repositories/PlantCatalogRepository";
import { makeId } from "@/utils/id";

type PlantCatalogRow = {
  id: string;
  source: PlantSource;
  external_id: string | null;
  common_name: string;
  scientific_name: string | null;
  family_name: string | null;
  image_url: string | null;
  meta_json: string | null;
  created_at: string;
  updated_at: string;
};

export class SqlitePlantCatalogRepository implements PlantCatalogRepository {
  async searchByName(query: string, limit = 12): Promise<PlantCatalogEntry[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const variants = buildSearchVariants(normalized);
    const rowsById = new Map<string, PlantCatalogRow>();
    for (const variant of variants) {
      const rows = await getDatabase().getAllAsync<PlantCatalogRow>(
        `SELECT *
         FROM plant_catalog_cache
         WHERE LOWER(common_name) LIKE ?
            OR LOWER(COALESCE(scientific_name, '')) LIKE ?
            OR LOWER(COALESCE(meta_json, '')) LIKE ?
         ORDER BY updated_at DESC
         LIMIT ?`,
        [`%${variant}%`, `%${variant}%`, `%${variant}%`, limit * 2]
      );
      for (const row of rows) {
        if (!rowsById.has(row.id)) rowsById.set(row.id, row);
      }
    }

    return Array.from(rowsById.values())
      .sort((a, b) => scoreSearchCandidate(normalized, a) - scoreSearchCandidate(normalized, b))
      .slice(0, limit)
      .map(toPlantCatalogEntity);
  }

  async getBySourceExternalId(source: PlantSource, externalId: string): Promise<PlantCatalogEntry | null> {
    const row = await getDatabase().getFirstAsync<PlantCatalogRow>(
      "SELECT * FROM plant_catalog_cache WHERE source = ? AND external_id = ?",
      [source, externalId]
    );
    return row ? toPlantCatalogEntity(row) : null;
  }

  async listAll(): Promise<PlantCatalogEntry[]> {
    const rows = await getDatabase().getAllAsync<PlantCatalogRow>(
      "SELECT * FROM plant_catalog_cache ORDER BY updated_at DESC, common_name COLLATE NOCASE ASC"
    );
    return rows.map(toPlantCatalogEntity);
  }

  async upsert(input: PlantCatalogUpsertInput): Promise<PlantCatalogEntry> {
    const now = new Date().toISOString();
    const normalizedName = input.commonName.trim();
    if (!normalizedName) {
      throw new Error("Plant name is required.");
    }

    if (input.externalId) {
      const existing = await this.getBySourceExternalId(input.source, input.externalId);
      if (existing) {
        const fallbackByName = await getDatabase().getFirstAsync<PlantCatalogRow>(
          `SELECT *
           FROM plant_catalog_cache
           WHERE source = ?
             AND external_id IS NULL
             AND LOWER(common_name) = LOWER(?)
             AND id <> ?
           ORDER BY updated_at DESC
           LIMIT 1`,
          [input.source, normalizedName, existing.id]
        );

        if (fallbackByName) {
          const db = getDatabase();
          await db.withTransactionAsync(async () => {
            await db.runAsync(
              "UPDATE garden_crop_entries SET plant_catalog_id = ? WHERE plant_catalog_id = ?",
              [existing.id, fallbackByName.id]
            );
            await db.runAsync(
              "UPDATE garden_crop_wishlist SET plant_catalog_id = ? WHERE plant_catalog_id = ?",
              [existing.id, fallbackByName.id]
            ).catch(() => undefined);

            const entryRef = await db.getFirstAsync<{ count: number }>(
              "SELECT COUNT(*) AS count FROM garden_crop_entries WHERE plant_catalog_id = ?",
              [fallbackByName.id]
            );
            const wishlistRef = await db
              .getFirstAsync<{ count: number }>(
                "SELECT COUNT(*) AS count FROM garden_crop_wishlist WHERE plant_catalog_id = ?",
                [fallbackByName.id]
              )
              .catch(() => ({ count: 0 }));
            const remainingRefs = (entryRef?.count ?? 0) + (wishlistRef?.count ?? 0);
            if (remainingRefs === 0) {
              await db.runAsync("DELETE FROM plant_catalog_cache WHERE id = ?", [fallbackByName.id]);
            }
          });
        }

        await getDatabase().runAsync(
          `UPDATE plant_catalog_cache
           SET common_name = ?, scientific_name = ?, family_name = ?, image_url = ?, meta_json = ?, updated_at = ?
           WHERE id = ?`,
          [
            normalizedName,
            input.scientificName ?? null,
            input.familyName ?? null,
            input.imageUrl ?? null,
            input.metaJson ?? null,
            now,
            existing.id,
          ]
        );
        return {
          ...existing,
          source: input.source,
          commonName: normalizedName,
          updatedAt: now,
          ...(input.externalId ? { externalId: input.externalId } : {}),
          ...(input.scientificName ? { scientificName: input.scientificName } : {}),
          ...(input.familyName ? { familyName: input.familyName } : {}),
          ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
          ...(input.metaJson ? { metaJson: input.metaJson } : {}),
        };
      }

      // Repair older growstuff rows that were cached without external_id.
      const fallbackByName = await getDatabase().getFirstAsync<PlantCatalogRow>(
        `SELECT *
         FROM plant_catalog_cache
         WHERE source = ?
           AND external_id IS NULL
           AND LOWER(common_name) = LOWER(?)
         ORDER BY updated_at DESC
         LIMIT 1`,
        [input.source, normalizedName]
      );
      if (fallbackByName) {
        await getDatabase().runAsync(
          `UPDATE plant_catalog_cache
           SET external_id = ?, common_name = ?, scientific_name = ?, family_name = ?, image_url = ?, meta_json = ?, updated_at = ?
           WHERE id = ?`,
          [
            input.externalId,
            normalizedName,
            input.scientificName ?? null,
            input.familyName ?? null,
            input.imageUrl ?? null,
            input.metaJson ?? null,
            now,
            fallbackByName.id,
          ]
        );
        return {
          id: fallbackByName.id,
          source: input.source,
          commonName: normalizedName,
          externalId: input.externalId,
          ...(input.scientificName ? { scientificName: input.scientificName } : {}),
          ...(input.familyName ? { familyName: input.familyName } : {}),
          ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
          ...(input.metaJson ? { metaJson: input.metaJson } : {}),
          createdAt: fallbackByName.created_at,
          updatedAt: now,
        };
      }
    }

    const id = makeId("plant");
    await getDatabase().runAsync(
      `INSERT INTO plant_catalog_cache (
         id, source, external_id, common_name, scientific_name, family_name, image_url, meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.source,
        input.externalId ?? null,
        normalizedName,
        input.scientificName ?? null,
        input.familyName ?? null,
        input.imageUrl ?? null,
        input.metaJson ?? null,
        now,
        now,
      ]
    );

    return {
      id,
      source: input.source,
      commonName: normalizedName,
      ...(input.externalId ? { externalId: input.externalId } : {}),
      ...(input.scientificName ? { scientificName: input.scientificName } : {}),
      ...(input.familyName ? { familyName: input.familyName } : {}),
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
      ...(input.metaJson ? { metaJson: input.metaJson } : {}),
      createdAt: now,
      updatedAt: now,
    };
  }

  async clearAll(): Promise<void> {
    await getDatabase().runAsync("DELETE FROM plant_catalog_cache");
  }
}

function toPlantCatalogEntity(row: PlantCatalogRow): PlantCatalogEntry {
  const item: PlantCatalogEntry = {
    id: row.id,
    source: row.source,
    commonName: row.common_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.external_id) item.externalId = row.external_id;
  if (row.scientific_name) item.scientificName = row.scientific_name;
  if (row.family_name) item.familyName = row.family_name;
  if (row.image_url) item.imageUrl = row.image_url;
  if (row.meta_json) item.metaJson = row.meta_json;
  return item;
}

function buildSearchVariants(query: string): string[] {
  const variants = new Set<string>();
  const add = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (normalized) variants.add(normalized);
  };

  add(query);
  for (const alias of expandUkAliases(query)) add(alias);
  for (const familyTerm of expandAutocompleteFamilyTerms(query)) add(familyTerm);
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

function scoreSearchCandidate(query: string, entry: PlantCatalogRow): number {
  const normalizedQuery = query.trim().toLowerCase();
  const common = entry.common_name.trim().toLowerCase();
  const scientific = (entry.scientific_name ?? "").trim().toLowerCase();
  const aliases = extractSearchTermsFromMeta(entry).map((value) => value.trim().toLowerCase());
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

function expandUkAliases(query: string): string[] {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return [];
  return UK_ALIAS_MAP[normalized] ?? [];
}

function expandAutocompleteFamilyTerms(query: string): string[] {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return [];
  const terms = new Set<string>();
  for (const [prefix, values] of Object.entries(AUTOCOMPLETE_FAMILY_MAP)) {
    if (!normalized.startsWith(prefix)) continue;
    for (const value of values) terms.add(value);
  }
  return Array.from(terms);
}

function extractSearchTermsFromMeta(entry: PlantCatalogRow): string[] {
  if (!entry.meta_json) return [];
  try {
    const parsed = JSON.parse(entry.meta_json) as {
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
