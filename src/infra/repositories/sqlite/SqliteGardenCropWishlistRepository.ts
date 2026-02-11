import { getDatabase } from "@/core/db/sqlite";
import type { GardenCropWishlistItemView, PlantSource } from "@/domain/entities/Plant";
import type {
  AddGardenCropItemInput,
  GardenCropWishlistRepository,
  UpdateGardenCropItemInput,
} from "@/domain/repositories/GardenCropWishlistRepository";
import { makeId } from "@/utils/id";

type CropEntryRow = {
  entry_id: string;
  garden_id: string;
  plant_catalog_id: string;
  entry_status: "wanted" | "already_growing";
  entry_bed_id: string | null;
  entry_bed_name: string | null;
  entry_is_perennial: number;
  entry_variety_name: string | null;
  entry_support_needed: number;
  notes: string | null;
  entry_created_at: string;
  entry_updated_at: string;
  plant_source: PlantSource;
  plant_external_id: string | null;
  plant_common_name: string;
  plant_scientific_name: string | null;
  plant_family_name: string | null;
  plant_image_url: string | null;
  plant_meta_json: string | null;
  plant_created_at: string;
  plant_updated_at: string;
};

export class SqliteGardenCropWishlistRepository implements GardenCropWishlistRepository {
  async listByGarden(gardenId: string): Promise<GardenCropWishlistItemView[]> {
    const rows = await getDatabase().getAllAsync<CropEntryRow>(
      `SELECT
         e.id AS entry_id,
         e.garden_id AS garden_id,
         e.plant_catalog_id AS plant_catalog_id,
         e.status AS entry_status,
         e.bed_id AS entry_bed_id,
         b.name AS entry_bed_name,
         e.is_perennial AS entry_is_perennial,
         e.variety_name AS entry_variety_name,
         e.support_needed AS entry_support_needed,
         e.notes AS notes,
         e.created_at AS entry_created_at,
         e.updated_at AS entry_updated_at,
         p.source AS plant_source,
         p.external_id AS plant_external_id,
         p.common_name AS plant_common_name,
         p.scientific_name AS plant_scientific_name,
         p.family_name AS plant_family_name,
         p.image_url AS plant_image_url,
         p.meta_json AS plant_meta_json,
         p.created_at AS plant_created_at,
         p.updated_at AS plant_updated_at
       FROM garden_crop_entries e
       INNER JOIN plant_catalog_cache p ON p.id = e.plant_catalog_id
       LEFT JOIN beds b ON b.id = e.bed_id
       WHERE e.garden_id = ?
       ORDER BY e.created_at DESC, p.common_name COLLATE NOCASE ASC`,
      [gardenId]
    );

    return rows.map((row) => ({
      id: row.entry_id,
      gardenId: row.garden_id,
      plantCatalogId: row.plant_catalog_id,
      status: row.entry_status,
      isPerennial: row.entry_is_perennial === 1,
      supportNeeded: row.entry_support_needed === 1,
      ...(row.entry_variety_name ? { varietyName: row.entry_variety_name } : {}),
      ...(row.entry_bed_id ? { bedId: row.entry_bed_id } : {}),
      ...(row.entry_bed_name ? { bedName: row.entry_bed_name } : {}),
      ...(row.notes ? { notes: row.notes } : {}),
      createdAt: row.entry_created_at,
      updatedAt: row.entry_updated_at,
      plant: {
        id: row.plant_catalog_id,
        source: row.plant_source,
        commonName: row.plant_common_name,
        ...(row.plant_external_id ? { externalId: row.plant_external_id } : {}),
        ...(row.plant_scientific_name ? { scientificName: row.plant_scientific_name } : {}),
        ...(row.plant_family_name ? { familyName: row.plant_family_name } : {}),
        ...(row.plant_image_url ? { imageUrl: row.plant_image_url } : {}),
        ...(row.plant_meta_json ? { metaJson: row.plant_meta_json } : {}),
        createdAt: row.plant_created_at,
        updatedAt: row.plant_updated_at,
      },
    }));
  }

  async add(input: AddGardenCropItemInput): Promise<void> {
    const now = new Date().toISOString();
    const varietyName = input.varietyName?.trim() || null;
    await getDatabase().runAsync(
      `INSERT INTO garden_crop_entries (
         id, garden_id, plant_catalog_id, status, bed_id, is_perennial, variety_name, support_needed, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        makeId("crop"),
        input.gardenId,
        input.plantCatalogId,
        input.status,
        input.bedId ?? null,
        input.isPerennial ? 1 : 0,
        varietyName,
        input.supportNeeded ? 1 : 0,
        now,
        now,
      ]
    );
  }

  async update(input: UpdateGardenCropItemInput): Promise<void> {
    const varietyName = input.varietyName?.trim() || null;
    await getDatabase().runAsync(
      `UPDATE garden_crop_entries
       SET status = ?, bed_id = ?, is_perennial = ?, variety_name = ?, support_needed = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.status,
        input.status === "already_growing" ? (input.bedId ?? null) : null,
        input.status === "already_growing" && input.isPerennial ? 1 : 0,
        varietyName,
        input.supportNeeded ? 1 : 0,
        new Date().toISOString(),
        input.id,
      ]
    );
  }

  async remove(id: string): Promise<void> {
    await getDatabase().runAsync("DELETE FROM garden_crop_entries WHERE id = ?", [id]);
  }
}
