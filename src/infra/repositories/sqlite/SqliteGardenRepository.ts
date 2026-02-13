import { getDatabase } from "@/core/db/sqlite";
import type { Garden, GardenScaleCalibration } from "@/domain/entities/Garden";
import type { GardenRepository } from "@/domain/repositories/GardenRepository";
import { makeId } from "@/utils/id";

type GardenRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  location_label: string | null;
  photo_uri: string | null;
  image_source_type: "photo" | "satellite" | null;
  scale_calibration_json: string | null;
  created_at: string;
  updated_at: string;
};

type BedCloneRow = {
  id: string;
  name: string;
  polygon_json: string;
  sun_exposure: string;
  drainage: string;
  contains_perennials: number;
  perennial_plants_csv: string | null;
  is_raised_bed: number;
  has_irrigation: number;
  soil_notes: string | null;
  created_at: string;
  updated_at: string;
};

type FeatureCloneRow = {
  id: string;
  type: string;
  name: string;
  polygon_json: string;
  created_at: string;
  updated_at: string;
};

type EntryCloneRow = {
  id: string;
  plant_catalog_id: string;
  status: "wanted" | "already_growing";
  started_indoors_at: string | null;
  bed_id: string | null;
  is_perennial: number;
  variety_name: string | null;
  support_needed: number;
  quantity: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type PlantingCloneRow = {
  id: string;
  entry_id: string;
  bed_id: string | null;
  planted_at: string;
  ended_at: string | null;
  end_state: "harvested" | "done" | "dead" | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type TaskCloneRow = {
  id: string;
  entry_id: string | null;
  bed_id: string | null;
  task_type: "start_indoors" | "direct_sow" | "plant_out" | "harvest_window" | "water_alert" | "manual";
  title: string;
  detail: string | null;
  due_date: string;
  priority: number;
  status: "open" | "done" | "dismissed";
  source: "auto" | "manual";
  rule_key: string;
  seen_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SettingsRow = {
  value_json: string;
};

export class SqliteGardenRepository implements GardenRepository {
  async list(): Promise<Garden[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<GardenRow>("SELECT * FROM gardens ORDER BY created_at DESC");
    return rows.map((row) => this.toEntity(row));
  }

  async getById(id: string): Promise<Garden | null> {
    const db = getDatabase();
    const row = await db.getFirstAsync<GardenRow>("SELECT * FROM gardens WHERE id = ?", [id]);
    return row ? this.toEntity(row) : null;
  }

  async create(garden: Garden): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `INSERT INTO gardens (
        id, name, latitude, longitude, location_label, photo_uri, image_source_type, scale_calibration_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        garden.id,
        garden.name,
        garden.latitude,
        garden.longitude,
        garden.locationLabel ?? null,
        garden.photoUri ?? null,
        garden.imageSourceType ?? null,
        garden.scaleCalibration ? JSON.stringify(garden.scaleCalibration) : null,
        garden.createdAt,
        garden.updatedAt,
      ]
    );
  }

  async clone(sourceGardenId: string, options?: { name?: string }): Promise<Garden> {
    const db = getDatabase();
    const source = await db.getFirstAsync<GardenRow>("SELECT * FROM gardens WHERE id = ? LIMIT 1", [sourceGardenId]);
    if (!source) throw new Error("Garden not found");

    const requestedName = options?.name?.trim();
    const cloneName = await this.resolveCloneName(source.name, requestedName);
    const now = new Date().toISOString();
    const clonedGardenId = makeId("garden");
    const bedIdMap = new Map<string, string>();
    const entryIdMap = new Map<string, string>();

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO gardens (
           id, name, latitude, longitude, location_label, photo_uri, image_source_type, scale_calibration_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          clonedGardenId,
          cloneName,
          source.latitude,
          source.longitude,
          source.location_label,
          source.photo_uri,
          source.image_source_type,
          source.scale_calibration_json,
          now,
          now,
        ]
      );

      const sourceBeds = await db.getAllAsync<BedCloneRow>(
        `SELECT
           id, name, polygon_json, sun_exposure, drainage, contains_perennials, perennial_plants_csv,
           is_raised_bed, has_irrigation, soil_notes, created_at, updated_at
         FROM beds
         WHERE garden_id = ?`,
        [sourceGardenId]
      );
      for (const bed of sourceBeds) {
        const nextBedId = makeId("bed");
        bedIdMap.set(bed.id, nextBedId);
        await db.runAsync(
          `INSERT INTO beds (
             id, garden_id, name, polygon_json, sun_exposure, drainage,
             contains_perennials, perennial_plants_csv, is_raised_bed, has_irrigation,
             soil_notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nextBedId,
            clonedGardenId,
            bed.name,
            bed.polygon_json,
            bed.sun_exposure,
            bed.drainage,
            bed.contains_perennials,
            bed.perennial_plants_csv,
            bed.is_raised_bed,
            bed.has_irrigation,
            bed.soil_notes,
            bed.created_at,
            bed.updated_at,
          ]
        );
      }

      const sourceFeatures = await db.getAllAsync<FeatureCloneRow>(
        "SELECT id, type, name, polygon_json, created_at, updated_at FROM garden_features WHERE garden_id = ?",
        [sourceGardenId]
      );
      for (const feature of sourceFeatures) {
        await db.runAsync(
          `INSERT INTO garden_features (id, garden_id, type, name, polygon_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [makeId("feature"), clonedGardenId, feature.type, feature.name, feature.polygon_json, feature.created_at, feature.updated_at]
        );
      }

      const sourceEntries = await db.getAllAsync<EntryCloneRow>(
        `SELECT
           id, plant_catalog_id, status, started_indoors_at, bed_id, is_perennial, variety_name, support_needed, quantity, notes, created_at, updated_at
         FROM garden_crop_entries
         WHERE garden_id = ?`,
        [sourceGardenId]
      );
      for (const entry of sourceEntries) {
        const nextEntryId = makeId("crop");
        entryIdMap.set(entry.id, nextEntryId);
        await db.runAsync(
          `INSERT INTO garden_crop_entries (
             id, garden_id, plant_catalog_id, status, started_indoors_at, bed_id, is_perennial, variety_name, support_needed, quantity, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nextEntryId,
            clonedGardenId,
            entry.plant_catalog_id,
            entry.status,
            entry.started_indoors_at,
            entry.bed_id ? bedIdMap.get(entry.bed_id) ?? null : null,
            entry.is_perennial,
            entry.variety_name,
            entry.support_needed,
            entry.quantity,
            entry.notes,
            entry.created_at,
            entry.updated_at,
          ]
        );
      }

      const sourcePlantings = await db.getAllAsync<PlantingCloneRow>(
        `SELECT
           id, entry_id, bed_id, planted_at, ended_at, end_state, notes, created_at, updated_at
         FROM garden_crop_plantings
         WHERE garden_id = ?`,
        [sourceGardenId]
      );
      for (const planting of sourcePlantings) {
        const nextEntryId = entryIdMap.get(planting.entry_id);
        if (!nextEntryId) continue;
        await db.runAsync(
          `INSERT INTO garden_crop_plantings (
             id, entry_id, garden_id, bed_id, planted_at, ended_at, end_state, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            makeId("planting"),
            nextEntryId,
            clonedGardenId,
            planting.bed_id ? bedIdMap.get(planting.bed_id) ?? null : null,
            planting.planted_at,
            planting.ended_at,
            planting.end_state,
            planting.notes,
            planting.created_at,
            planting.updated_at,
          ]
        );
      }

      const sourceTasks = await db.getAllAsync<TaskCloneRow>(
        `SELECT
           id, entry_id, bed_id, task_type, title, detail, due_date, priority, status, source, rule_key,
           seen_at, completed_at, created_at, updated_at
         FROM garden_tasks
         WHERE garden_id = ?`,
        [sourceGardenId]
      );
      for (const task of sourceTasks) {
        const nextTaskId = makeId("task");
        const nextEntryId = task.entry_id ? entryIdMap.get(task.entry_id) ?? null : null;
        const nextBedId = task.bed_id ? bedIdMap.get(task.bed_id) ?? null : null;
        await db.runAsync(
          `INSERT INTO garden_tasks (
             id, garden_id, entry_id, bed_id, task_type, title, detail, due_date,
             priority, status, source, rule_key, seen_at, completed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nextTaskId,
            clonedGardenId,
            nextEntryId,
            nextBedId,
            task.task_type,
            task.title,
            task.detail,
            task.due_date,
            task.priority,
            task.status,
            task.source,
            `${task.rule_key}:clone:${clonedGardenId}`,
            task.seen_at,
            task.completed_at,
            task.created_at,
            task.updated_at,
          ]
        );
      }

      const progressRow = await db.getFirstAsync<SettingsRow>(
        "SELECT value_json FROM app_settings WHERE key = ? LIMIT 1",
        ["garden_progress_v1"]
      );
      if (progressRow?.value_json) {
        try {
          const parsed = JSON.parse(progressRow.value_json) as Record<string, unknown>;
          const sourceFlags = parsed[sourceGardenId];
          if (sourceFlags && typeof sourceFlags === "object" && !Array.isArray(sourceFlags)) {
            const next = { ...parsed, [clonedGardenId]: sourceFlags };
            await db.runAsync(
              `INSERT INTO app_settings (key, value_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
              ["garden_progress_v1", JSON.stringify(next), now]
            );
          }
        } catch {
          // ignore malformed saved progress payload
        }
      }
    });

    return {
      id: clonedGardenId,
      name: cloneName,
      latitude: source.latitude,
      longitude: source.longitude,
      ...(source.location_label ? { locationLabel: source.location_label } : {}),
      ...(source.photo_uri ? { photoUri: source.photo_uri } : {}),
      ...(source.image_source_type ? { imageSourceType: source.image_source_type } : {}),
      ...(source.scale_calibration_json
        ? { scaleCalibration: JSON.parse(source.scale_calibration_json) as GardenScaleCalibration }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
  }

  async delete(id: string): Promise<void> {
    await getDatabase().runAsync("DELETE FROM gardens WHERE id = ?", [id]);
  }

  async updatePhoto(id: string, photoUri: string, sourceType: "photo" | "satellite" = "photo"): Promise<void> {
    await getDatabase().runAsync(
      "UPDATE gardens SET photo_uri = ?, image_source_type = ?, updated_at = ? WHERE id = ?",
      [photoUri, sourceType, new Date().toISOString(), id]
    );
  }

  async clearPhoto(id: string): Promise<void> {
    await getDatabase().runAsync(
      "UPDATE gardens SET photo_uri = NULL, image_source_type = NULL, updated_at = ? WHERE id = ?",
      [new Date().toISOString(), id]
    );
  }

  async updateScaleCalibration(id: string, calibration: GardenScaleCalibration): Promise<void> {
    await getDatabase().runAsync(
      "UPDATE gardens SET scale_calibration_json = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(calibration), new Date().toISOString(), id]
    );
  }

  async updateLocation(
    id: string,
    latitude: number,
    longitude: number,
    locationLabel?: string
  ): Promise<void> {
    await getDatabase().runAsync(
      "UPDATE gardens SET latitude = ?, longitude = ?, location_label = ?, updated_at = ? WHERE id = ?",
      [latitude, longitude, locationLabel ?? null, new Date().toISOString(), id]
    );
  }

  private toEntity(row: GardenRow): Garden {
    const garden: Garden = {
      id: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.location_label) garden.locationLabel = row.location_label;
    if (row.photo_uri) garden.photoUri = row.photo_uri;
    if (row.image_source_type) garden.imageSourceType = row.image_source_type;
    if (row.scale_calibration_json) {
      garden.scaleCalibration = JSON.parse(row.scale_calibration_json) as GardenScaleCalibration;
    }

    return garden;
  }

  private async resolveCloneName(sourceName: string, requestedName?: string): Promise<string> {
    const db = getDatabase();
    const base = requestedName?.trim() || `${sourceName} (Copy)`;
    const cleanBase = base.trim() || "Garden (Copy)";
    let attempt = cleanBase;
    let index = 2;
    while (true) {
      const existing = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM gardens WHERE lower(name) = lower(?) LIMIT 1",
        [attempt]
      );
      if (!existing) return attempt;
      attempt = `${cleanBase} ${index}`;
      index += 1;
    }
  }
}
