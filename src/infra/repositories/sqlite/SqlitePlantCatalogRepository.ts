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

    const rows = await getDatabase().getAllAsync<PlantCatalogRow>(
      `SELECT *
       FROM plant_catalog_cache
       WHERE LOWER(common_name) LIKE ?
          OR LOWER(COALESCE(scientific_name, '')) LIKE ?
       ORDER BY updated_at DESC
       LIMIT ?`,
      [`%${normalized}%`, `%${normalized}%`, limit]
    );

    return rows.map(toPlantCatalogEntity);
  }

  async getBySourceExternalId(source: PlantSource, externalId: string): Promise<PlantCatalogEntry | null> {
    const row = await getDatabase().getFirstAsync<PlantCatalogRow>(
      "SELECT * FROM plant_catalog_cache WHERE source = ? AND external_id = ?",
      [source, externalId]
    );
    return row ? toPlantCatalogEntity(row) : null;
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
