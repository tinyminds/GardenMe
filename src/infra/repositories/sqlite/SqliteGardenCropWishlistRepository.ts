import { getDatabase } from "@/core/db/sqlite";
import type {
  GardenCropPlantingHistoryItem,
  GardenCropWishlistItemView,
  PlantingEndState,
  PlantSource,
} from "@/domain/entities/Plant";
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
  entry_quantity: number;
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

type PlantingRow = {
  planting_id: string;
  entry_id: string;
  garden_id: string;
  planting_bed_id: string | null;
  planting_bed_name: string | null;
  planted_at: string;
  ended_at: string | null;
  end_state: PlantingEndState | null;
  planting_created_at: string;
  planting_updated_at: string;
  entry_variety_name: string | null;
  plant_catalog_id: string;
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
         e.quantity AS entry_quantity,
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
      quantity: row.entry_quantity,
      ...(row.entry_variety_name ? { varietyName: row.entry_variety_name } : {}),
      ...(row.entry_bed_id ? { bedId: row.entry_bed_id } : {}),
      ...(row.entry_bed_name ? { bedName: row.entry_bed_name } : {}),
      ...(row.notes ? { notes: row.notes } : {}),
      createdAt: row.entry_created_at,
      updatedAt: row.entry_updated_at,
      plant: toPlantCatalogEntry(row),
    }));
  }

  async listPlantingsByGarden(gardenId: string): Promise<GardenCropPlantingHistoryItem[]> {
    const rows = await getDatabase().getAllAsync<PlantingRow>(
      `SELECT
         gp.id AS planting_id,
         gp.entry_id AS entry_id,
         gp.garden_id AS garden_id,
         gp.bed_id AS planting_bed_id,
         b.name AS planting_bed_name,
         gp.planted_at AS planted_at,
         gp.ended_at AS ended_at,
         gp.end_state AS end_state,
         gp.created_at AS planting_created_at,
         gp.updated_at AS planting_updated_at,
         e.variety_name AS entry_variety_name,
         p.id AS plant_catalog_id,
         p.source AS plant_source,
         p.external_id AS plant_external_id,
         p.common_name AS plant_common_name,
         p.scientific_name AS plant_scientific_name,
         p.family_name AS plant_family_name,
         p.image_url AS plant_image_url,
         p.meta_json AS plant_meta_json,
         p.created_at AS plant_created_at,
         p.updated_at AS plant_updated_at
       FROM garden_crop_plantings gp
       INNER JOIN garden_crop_entries e ON e.id = gp.entry_id
       INNER JOIN plant_catalog_cache p ON p.id = e.plant_catalog_id
       LEFT JOIN beds b ON b.id = gp.bed_id
       WHERE gp.garden_id = ?
       ORDER BY gp.planted_at DESC, p.common_name COLLATE NOCASE ASC`,
      [gardenId]
    );

    return rows.map((row) => ({
      id: row.planting_id,
      entryId: row.entry_id,
      gardenId: row.garden_id,
      ...(row.planting_bed_id ? { bedId: row.planting_bed_id } : {}),
      ...(row.planting_bed_name ? { bedName: row.planting_bed_name } : {}),
      plantedAt: row.planted_at,
      ...(row.ended_at ? { endedAt: row.ended_at } : {}),
      ...(row.end_state ? { endState: row.end_state } : {}),
      createdAt: row.planting_created_at,
      updatedAt: row.planting_updated_at,
      ...(row.entry_variety_name ? { varietyName: row.entry_variety_name } : {}),
      plant: toPlantCatalogEntry(row),
    }));
  }

  async add(input: AddGardenCropItemInput): Promise<void> {
    const now = new Date().toISOString();
    const varietyName = input.varietyName?.trim() || null;
    const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
    await getDatabase().runAsync(
      `INSERT INTO garden_crop_entries (
         id, garden_id, plant_catalog_id, status, bed_id, is_perennial, variety_name, support_needed, quantity, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        makeId("crop"),
        input.gardenId,
        input.plantCatalogId,
        input.status,
        input.bedId ?? null,
        input.isPerennial ? 1 : 0,
        varietyName,
        input.supportNeeded ? 1 : 0,
        quantity,
        now,
        now,
      ]
    );
  }

  async update(input: UpdateGardenCropItemInput): Promise<void> {
    const varietyName = input.varietyName?.trim() || null;
    const quantity = input.quantity === undefined ? null : Math.max(1, Math.floor(input.quantity));
    await getDatabase().runAsync(
      `UPDATE garden_crop_entries
       SET status = ?, bed_id = ?, is_perennial = ?, variety_name = ?, support_needed = ?, quantity = COALESCE(?, quantity), updated_at = ?
       WHERE id = ?`,
      [
        input.status,
        input.bedId ?? null,
        input.status === "already_growing" && input.isPerennial ? 1 : 0,
        varietyName,
        input.supportNeeded ? 1 : 0,
        quantity,
        new Date().toISOString(),
        input.id,
      ]
    );
  }

  async markPlanted(input: { entryId: string; bedId: string; plantedAt?: string }): Promise<void> {
    const now = input.plantedAt ?? new Date().toISOString();
    const db = getDatabase();
    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM garden_crop_plantings WHERE entry_id = ? AND ended_at IS NULL LIMIT 1",
        [input.entryId]
      );

      if (existing?.id) {
        await db.runAsync(
          "UPDATE garden_crop_plantings SET bed_id = ?, updated_at = ? WHERE id = ?",
          [input.bedId, now, existing.id]
        );
      } else {
        const entry = await db.getFirstAsync<{ garden_id: string }>(
          "SELECT garden_id FROM garden_crop_entries WHERE id = ? LIMIT 1",
          [input.entryId]
        );
        if (!entry) throw new Error("Crop entry not found");

        await db.runAsync(
          `INSERT INTO garden_crop_plantings (
             id, entry_id, garden_id, bed_id, planted_at, ended_at, end_state, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
          [makeId("planting"), input.entryId, entry.garden_id, input.bedId, now, now, now]
        );
      }

      await db.runAsync(
        "UPDATE garden_crop_entries SET status = 'already_growing', bed_id = ?, updated_at = ? WHERE id = ?",
        [input.bedId, now, input.entryId]
      );
    });
  }

  async finishPlanting(input: { entryId: string; endState: PlantingEndState; endedAt?: string }): Promise<void> {
    const now = input.endedAt ?? new Date().toISOString();
    const db = getDatabase();
    await db.withTransactionAsync(async () => {
      const active = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM garden_crop_plantings WHERE entry_id = ? AND ended_at IS NULL ORDER BY planted_at DESC LIMIT 1",
        [input.entryId]
      );

      if (active?.id) {
        await db.runAsync(
          "UPDATE garden_crop_plantings SET ended_at = ?, end_state = ?, updated_at = ? WHERE id = ?",
          [now, input.endState, now, active.id]
        );
      } else {
        const entry = await db.getFirstAsync<{ garden_id: string; bed_id: string | null; updated_at: string }>(
          "SELECT garden_id, bed_id, updated_at FROM garden_crop_entries WHERE id = ? LIMIT 1",
          [input.entryId]
        );
        if (!entry) throw new Error("Crop entry not found");
        const plantedAt = entry.updated_at || now;
        await db.runAsync(
          `INSERT INTO garden_crop_plantings (
             id, entry_id, garden_id, bed_id, planted_at, ended_at, end_state, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          [makeId("planting"), input.entryId, entry.garden_id, entry.bed_id, plantedAt, now, input.endState, now, now]
        );
      }

      await db.runAsync(
        "UPDATE garden_crop_entries SET status = 'wanted', bed_id = NULL, updated_at = ? WHERE id = ?",
        [now, input.entryId]
      );
    });
  }

  async remove(id: string): Promise<void> {
    await getDatabase().runAsync("DELETE FROM garden_crop_entries WHERE id = ?", [id]);
  }
}

function toPlantCatalogEntry(
  row: Pick<
    CropEntryRow | PlantingRow,
    | "plant_catalog_id"
    | "plant_source"
    | "plant_external_id"
    | "plant_common_name"
    | "plant_scientific_name"
    | "plant_family_name"
    | "plant_image_url"
    | "plant_meta_json"
    | "plant_created_at"
    | "plant_updated_at"
  >
) {
  return {
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
  };
}
