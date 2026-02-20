import { getDatabase } from "@/core/db/sqlite";
import type { Garden, GardenScaleCalibration } from "@/domain/entities/Garden";
import type { GardenRepository } from "@/domain/repositories/GardenRepository";
import { makeId } from "@/utils/id";
import * as FileSystem from "expo-file-system";

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

type PlantCatalogBackupRow = {
  id: string;
  source: "growstuff" | "manual";
  external_id: string | null;
  common_name: string;
  scientific_name: string | null;
  family_name: string | null;
  image_url: string | null;
  meta_json: string | null;
  created_at: string;
  updated_at: string;
};

type GardenProgressFlags = {
  mapperDone?: boolean;
  growDone?: boolean;
};

type GardenBedPlannerFlags = {
  spareSpaceByBedId?: Record<string, boolean>;
  rejectedSuggestionIdsByBed?: Record<string, string[]>;
};

type BedPhotoLogEntry = {
  id: string;
  bedId: string;
  uri: string;
  backgroundPreviewUri?: string;
  source: "camera" | "gallery";
  createdAt: string;
  notes?: string;
  isBedBackground?: boolean;
};

type GardenBackupMediaFile = {
  id: string;
  kind: "garden_photo" | "bed_photo";
  base64: string;
  mimeType: string;
  fileExtension: string;
  bedPhotoId?: string;
};

export type GardenBackupBundle = {
  format: "gardenme-garden-backup-v1";
  exportedAt: string;
  garden: Omit<Garden, "id">;
  beds: BedCloneRow[];
  features: FeatureCloneRow[];
  plants: PlantCatalogBackupRow[];
  entries: EntryCloneRow[];
  plantings: PlantingCloneRow[];
  tasks: TaskCloneRow[];
  settings?: {
    gardenProgress?: GardenProgressFlags;
    bedPlanner?: GardenBedPlannerFlags;
    bedPhotoLog?: BedPhotoLogEntry[];
  };
  media?: {
    files: GardenBackupMediaFile[];
  };
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

  async exportBackupBundle(gardenId: string): Promise<GardenBackupBundle> {
    const db = getDatabase();
    const source = await db.getFirstAsync<GardenRow>("SELECT * FROM gardens WHERE id = ? LIMIT 1", [gardenId]);
    if (!source) throw new Error("Garden not found");

    const beds = await db.getAllAsync<BedCloneRow>(
      `SELECT
         id, name, polygon_json, sun_exposure, drainage, contains_perennials, perennial_plants_csv,
         is_raised_bed, has_irrigation, soil_notes, created_at, updated_at
       FROM beds
       WHERE garden_id = ?`,
      [gardenId]
    );
    const features = await db.getAllAsync<FeatureCloneRow>(
      "SELECT id, type, name, polygon_json, created_at, updated_at FROM garden_features WHERE garden_id = ?",
      [gardenId]
    );
    const entries = await db.getAllAsync<EntryCloneRow>(
      `SELECT
         id, plant_catalog_id, status, started_indoors_at, bed_id, is_perennial, variety_name, support_needed, quantity, notes, created_at, updated_at
       FROM garden_crop_entries
       WHERE garden_id = ?`,
      [gardenId]
    );
    const plantings = await db.getAllAsync<PlantingCloneRow>(
      `SELECT
         id, entry_id, bed_id, planted_at, ended_at, end_state, notes, created_at, updated_at
       FROM garden_crop_plantings
       WHERE garden_id = ?`,
      [gardenId]
    );
    const tasks = await db.getAllAsync<TaskCloneRow>(
      `SELECT
         id, entry_id, bed_id, task_type, title, detail, due_date, priority, status, source, rule_key,
         seen_at, completed_at, created_at, updated_at
       FROM garden_tasks
       WHERE garden_id = ?`,
      [gardenId]
    );

    const plantCatalogIds = Array.from(new Set(entries.map((entry) => entry.plant_catalog_id)));
    const plants: PlantCatalogBackupRow[] = [];
    for (const id of plantCatalogIds) {
      const row = await db.getFirstAsync<PlantCatalogBackupRow>(
        `SELECT
           id, source, external_id, common_name, scientific_name, family_name, image_url, meta_json, created_at, updated_at
         FROM plant_catalog_cache
         WHERE id = ?`,
        [id]
      );
      if (row) plants.push(row);
    }

    const progressRow = await db.getFirstAsync<SettingsRow>(
      "SELECT value_json FROM app_settings WHERE key = ? LIMIT 1",
      ["garden_progress_v1"]
    );
    const bedPlannerRow = await db.getFirstAsync<SettingsRow>(
      "SELECT value_json FROM app_settings WHERE key = ? LIMIT 1",
      ["garden_bed_planner_v1"]
    );
    const bedPhotoRow = await db.getFirstAsync<SettingsRow>(
      "SELECT value_json FROM app_settings WHERE key = ? LIMIT 1",
      ["bed_photo_log_v1"]
    );

    let gardenProgress: GardenProgressFlags | undefined;
    let bedPlanner: GardenBedPlannerFlags | undefined;
    let bedPhotoLog: BedPhotoLogEntry[] | undefined;
    try {
      if (progressRow?.value_json) {
        const parsed = JSON.parse(progressRow.value_json) as Record<string, GardenProgressFlags>;
        gardenProgress = parsed[gardenId];
      }
    } catch {}
    try {
      if (bedPlannerRow?.value_json) {
        const parsed = JSON.parse(bedPlannerRow.value_json) as Record<string, GardenBedPlannerFlags>;
        bedPlanner = parsed[gardenId];
      }
    } catch {}
    try {
      if (bedPhotoRow?.value_json) {
        const parsed = JSON.parse(bedPhotoRow.value_json) as Record<string, BedPhotoLogEntry[]>;
        bedPhotoLog = parsed[gardenId];
      }
    } catch {}
    const mediaFiles = await this.buildBackupMediaFiles(source.photo_uri, bedPhotoLog);

    return {
      format: "gardenme-garden-backup-v1",
      exportedAt: new Date().toISOString(),
      garden: {
        name: source.name,
        latitude: source.latitude,
        longitude: source.longitude,
        ...(source.location_label ? { locationLabel: source.location_label } : {}),
        ...(source.photo_uri ? { photoUri: source.photo_uri } : {}),
        ...(source.image_source_type ? { imageSourceType: source.image_source_type } : {}),
        ...(source.scale_calibration_json
          ? { scaleCalibration: JSON.parse(source.scale_calibration_json) as GardenScaleCalibration }
          : {}),
        createdAt: source.created_at,
        updatedAt: source.updated_at,
      },
      beds,
      features,
      plants,
      entries,
      plantings,
      tasks,
      settings: {
        ...(gardenProgress ? { gardenProgress } : {}),
        ...(bedPlanner ? { bedPlanner } : {}),
        ...(bedPhotoLog ? { bedPhotoLog } : {}),
      },
      ...(mediaFiles.length > 0 ? { media: { files: mediaFiles } } : {}),
    };
  }

  async importBackupBundle(bundle: GardenBackupBundle, options?: { name?: string }): Promise<Garden> {
    if (!bundle || bundle.format !== "gardenme-garden-backup-v1") {
      throw new Error("Unsupported backup format");
    }
    const db = getDatabase();
    const requestedName = options?.name?.trim();
    const sourceName = bundle.garden?.name?.trim() || "Imported Garden";
    const importName = await this.resolveCloneName(sourceName, requestedName);
    const now = new Date().toISOString();
    const importedGardenId = makeId("garden");
    const bedIdMap = new Map<string, string>();
    const entryIdMap = new Map<string, string>();
    const plantIdMap = new Map<string, string>();
    const importedMedia = await this.restoreBackupMedia(bundle, importedGardenId);

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO gardens (
           id, name, latitude, longitude, location_label, photo_uri, image_source_type, scale_calibration_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          importedGardenId,
          importName,
          bundle.garden.latitude,
          bundle.garden.longitude,
          bundle.garden.locationLabel ?? null,
          importedMedia.gardenPhotoUri ?? bundle.garden.photoUri ?? null,
          bundle.garden.imageSourceType ?? null,
          bundle.garden.scaleCalibration ? JSON.stringify(bundle.garden.scaleCalibration) : null,
          now,
          now,
        ]
      );

      for (const plant of bundle.plants ?? []) {
        const existingByExternal =
          plant.external_id && plant.source
            ? await db.getFirstAsync<{ id: string }>(
                "SELECT id FROM plant_catalog_cache WHERE source = ? AND external_id = ? LIMIT 1",
                [plant.source, plant.external_id]
              )
            : null;
        const existingByManualName =
          !plant.external_id
            ? await db.getFirstAsync<{ id: string }>(
                "SELECT id FROM plant_catalog_cache WHERE source = ? AND external_id IS NULL AND lower(common_name) = lower(?) LIMIT 1",
                [plant.source, plant.common_name]
              )
            : null;
        const targetId = existingByExternal?.id ?? existingByManualName?.id ?? makeId("plant");
        plantIdMap.set(plant.id, targetId);
        if (existingByExternal?.id || existingByManualName?.id) {
          await db.runAsync(
            `UPDATE plant_catalog_cache
             SET common_name = ?, scientific_name = ?, family_name = ?, image_url = ?, meta_json = ?, updated_at = ?
             WHERE id = ?`,
            [
              plant.common_name,
              plant.scientific_name,
              plant.family_name,
              plant.image_url,
              plant.meta_json,
              now,
              targetId,
            ]
          );
        } else {
          await db.runAsync(
            `INSERT INTO plant_catalog_cache (
               id, source, external_id, common_name, scientific_name, family_name, image_url, meta_json, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              targetId,
              plant.source,
              plant.external_id,
              plant.common_name,
              plant.scientific_name,
              plant.family_name,
              plant.image_url,
              plant.meta_json,
              now,
              now,
            ]
          );
        }
      }

      for (const bed of bundle.beds ?? []) {
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
            importedGardenId,
            bed.name,
            bed.polygon_json,
            bed.sun_exposure,
            bed.drainage,
            bed.contains_perennials,
            bed.perennial_plants_csv,
            bed.is_raised_bed,
            bed.has_irrigation,
            bed.soil_notes,
            now,
            now,
          ]
        );
      }

      for (const feature of bundle.features ?? []) {
        await db.runAsync(
          `INSERT INTO garden_features (id, garden_id, type, name, polygon_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [makeId("feature"), importedGardenId, feature.type, feature.name, feature.polygon_json, now, now]
        );
      }

      for (const entry of bundle.entries ?? []) {
        const nextEntryId = makeId("crop");
        entryIdMap.set(entry.id, nextEntryId);
        const mappedPlantId = plantIdMap.get(entry.plant_catalog_id);
        if (!mappedPlantId) continue;
        await db.runAsync(
          `INSERT INTO garden_crop_entries (
             id, garden_id, plant_catalog_id, status, started_indoors_at, bed_id, is_perennial, variety_name, support_needed, quantity, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nextEntryId,
            importedGardenId,
            mappedPlantId,
            entry.status,
            entry.started_indoors_at,
            entry.bed_id ? bedIdMap.get(entry.bed_id) ?? null : null,
            entry.is_perennial,
            entry.variety_name,
            entry.support_needed,
            entry.quantity,
            entry.notes,
            now,
            now,
          ]
        );
      }

      for (const planting of bundle.plantings ?? []) {
        const nextEntryId = entryIdMap.get(planting.entry_id);
        if (!nextEntryId) continue;
        await db.runAsync(
          `INSERT INTO garden_crop_plantings (
             id, entry_id, garden_id, bed_id, planted_at, ended_at, end_state, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            makeId("planting"),
            nextEntryId,
            importedGardenId,
            planting.bed_id ? bedIdMap.get(planting.bed_id) ?? null : null,
            planting.planted_at,
            planting.ended_at,
            planting.end_state,
            planting.notes,
            now,
            now,
          ]
        );
      }

      for (const task of bundle.tasks ?? []) {
        await db.runAsync(
          `INSERT INTO garden_tasks (
             id, garden_id, entry_id, bed_id, task_type, title, detail, due_date,
             priority, status, source, rule_key, seen_at, completed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            makeId("task"),
            importedGardenId,
            task.entry_id ? entryIdMap.get(task.entry_id) ?? null : null,
            task.bed_id ? bedIdMap.get(task.bed_id) ?? null : null,
            task.task_type,
            task.title,
            task.detail,
            task.due_date,
            task.priority,
            task.status,
            task.source,
            `${task.rule_key}:import:${importedGardenId}`,
            task.seen_at,
            task.completed_at,
            now,
            now,
          ]
        );
      }

      const progressRow = await db.getFirstAsync<SettingsRow>(
        "SELECT value_json FROM app_settings WHERE key = ? LIMIT 1",
        ["garden_progress_v1"]
      );
      const progressParsed = progressRow?.value_json ? (JSON.parse(progressRow.value_json) as Record<string, unknown>) : {};
      if (bundle.settings?.gardenProgress) {
        const next = { ...progressParsed, [importedGardenId]: bundle.settings.gardenProgress };
        await db.runAsync(
          `INSERT INTO app_settings (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
          ["garden_progress_v1", JSON.stringify(next), now]
        );
      }

      const bedPlannerRow = await db.getFirstAsync<SettingsRow>(
        "SELECT value_json FROM app_settings WHERE key = ? LIMIT 1",
        ["garden_bed_planner_v1"]
      );
      const bedPlannerParsed = bedPlannerRow?.value_json ? (JSON.parse(bedPlannerRow.value_json) as Record<string, unknown>) : {};
      if (bundle.settings?.bedPlanner) {
        const next = { ...bedPlannerParsed, [importedGardenId]: bundle.settings.bedPlanner };
        await db.runAsync(
          `INSERT INTO app_settings (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
          ["garden_bed_planner_v1", JSON.stringify(next), now]
        );
      }

      const bedPhotoRow = await db.getFirstAsync<SettingsRow>(
        "SELECT value_json FROM app_settings WHERE key = ? LIMIT 1",
        ["bed_photo_log_v1"]
      );
      const bedPhotoParsed = bedPhotoRow?.value_json ? (JSON.parse(bedPhotoRow.value_json) as Record<string, unknown>) : {};
      if (bundle.settings?.bedPhotoLog) {
        const remappedPhotos = bundle.settings.bedPhotoLog.map((row) => {
          const { backgroundPreviewUri: _ignoredBackgroundPreviewUri, ...rest } = row;
          return {
            ...rest,
            id: makeId("bed-photo"),
            bedId: bedIdMap.get(row.bedId) ?? row.bedId,
            uri: importedMedia.bedPhotoUriByPhotoId[row.id] ?? row.uri,
          };
        });
        const next = { ...bedPhotoParsed, [importedGardenId]: remappedPhotos };
        await db.runAsync(
          `INSERT INTO app_settings (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
          ["bed_photo_log_v1", JSON.stringify(next), now]
        );
      }
    });

    return {
      id: importedGardenId,
      name: importName,
      latitude: bundle.garden.latitude,
      longitude: bundle.garden.longitude,
      ...(bundle.garden.locationLabel ? { locationLabel: bundle.garden.locationLabel } : {}),
      ...(importedMedia.gardenPhotoUri ?? bundle.garden.photoUri
        ? { photoUri: importedMedia.gardenPhotoUri ?? bundle.garden.photoUri! }
        : {}),
      ...(bundle.garden.imageSourceType ? { imageSourceType: bundle.garden.imageSourceType } : {}),
      ...(bundle.garden.scaleCalibration ? { scaleCalibration: bundle.garden.scaleCalibration } : {}),
      createdAt: now,
      updatedAt: now,
    };
  }

  async delete(id: string): Promise<void> {
    await getDatabase().runAsync("DELETE FROM gardens WHERE id = ?", [id]);
  }

  async updatePhoto(id: string, photoUri: string, sourceType: "photo" | "satellite" = "photo"): Promise<void> {
    const db = getDatabase();
    const existing = await db.getFirstAsync<{ photo_uri: string | null }>(
      "SELECT photo_uri FROM gardens WHERE id = ? LIMIT 1",
      [id]
    );
    const persistedPhotoUri = await this.persistGardenPhotoUri(id, photoUri);
    await db.runAsync(
      "UPDATE gardens SET photo_uri = ?, image_source_type = ?, updated_at = ? WHERE id = ?",
      [persistedPhotoUri, sourceType, new Date().toISOString(), id]
    );
    if (
      existing?.photo_uri &&
      existing.photo_uri !== persistedPhotoUri &&
      this.isManagedGardenMediaUri(existing.photo_uri)
    ) {
      this.safeDeleteFile(existing.photo_uri);
    }
  }

  async clearPhoto(id: string): Promise<void> {
    const db = getDatabase();
    const existing = await db.getFirstAsync<{ photo_uri: string | null }>(
      "SELECT photo_uri FROM gardens WHERE id = ? LIMIT 1",
      [id]
    );
    await db.runAsync(
      "UPDATE gardens SET photo_uri = NULL, image_source_type = NULL, updated_at = ? WHERE id = ?",
      [new Date().toISOString(), id]
    );
    if (existing?.photo_uri && this.isManagedGardenMediaUri(existing.photo_uri)) {
      this.safeDeleteFile(existing.photo_uri);
    }
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

  private async buildBackupMediaFiles(
    gardenPhotoUri: string | null,
    bedPhotoLog: BedPhotoLogEntry[] | undefined
  ): Promise<GardenBackupMediaFile[]> {
    const files: GardenBackupMediaFile[] = [];

    const appendMedia = async (payload: {
      id: string;
      kind: "garden_photo" | "bed_photo";
      uri: string;
      bedPhotoId?: string;
    }) => {
      const base64 = await this.readFileAsBase64(payload.uri);
      if (!base64) return;
      const fileExtension = this.inferFileExtensionFromUri(payload.uri);
      files.push({
        id: payload.id,
        kind: payload.kind,
        base64,
        fileExtension,
        mimeType: this.mimeTypeFromExtension(fileExtension),
        ...(payload.bedPhotoId ? { bedPhotoId: payload.bedPhotoId } : {}),
      });
    };

    if (gardenPhotoUri) {
      await appendMedia({
        id: "garden-photo",
        kind: "garden_photo",
        uri: gardenPhotoUri,
      });
    }

    const bedPhotos = bedPhotoLog ?? [];
    for (const row of bedPhotos) {
      if (!row?.uri) continue;
      await appendMedia({
        id: `bed-photo-${row.id}`,
        kind: "bed_photo",
        uri: row.uri,
        bedPhotoId: row.id,
      });
    }

    return files;
  }

  private async restoreBackupMedia(
    bundle: GardenBackupBundle,
    importedGardenId: string
  ): Promise<{ gardenPhotoUri: string | null; bedPhotoUriByPhotoId: Record<string, string> }> {
    const result: { gardenPhotoUri: string | null; bedPhotoUriByPhotoId: Record<string, string> } = {
      gardenPhotoUri: null,
      bedPhotoUriByPhotoId: {},
    };
    const mediaFiles = bundle.media?.files ?? [];
    if (mediaFiles.length === 0) {
      return result;
    }

    const mediaDirectory = new FileSystem.Directory(FileSystem.Paths.document, "garden-media", importedGardenId);
    mediaDirectory.create({ idempotent: true, intermediates: true });

    for (const media of mediaFiles) {
      if (!media?.base64) continue;
      const extension = this.normalizeFileExtension(media.fileExtension);
      const cleanBase64 = this.stripBase64DataPrefix(media.base64);
      try {
        if (media.kind === "garden_photo") {
          const target = new FileSystem.File(mediaDirectory, `garden-base.${extension}`);
          target.create({ intermediates: true, overwrite: true });
          target.write(cleanBase64, { encoding: "base64" });
          result.gardenPhotoUri = target.uri;
          continue;
        }
        if (media.kind === "bed_photo" && media.bedPhotoId) {
          const target = new FileSystem.File(
            mediaDirectory,
            `bed-photo-${this.sanitizeIdSegment(media.bedPhotoId)}.${extension}`
          );
          target.create({ intermediates: true, overwrite: true });
          target.write(cleanBase64, { encoding: "base64" });
          result.bedPhotoUriByPhotoId[media.bedPhotoId] = target.uri;
        }
      } catch {
        // Ignore media import failures and keep URI fallback paths.
      }
    }

    return result;
  }

  private async readFileAsBase64(uri: string): Promise<string | null> {
    try {
      const file = new FileSystem.File(uri);
      if (!file.exists) return null;
      const base64 = await file.base64();
      return base64 || null;
    } catch {
      return null;
    }
  }

  private inferFileExtensionFromUri(uri: string): string {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".png")) return "png";
    if (lower.endsWith(".webp")) return "webp";
    if (lower.endsWith(".heic")) return "heic";
    if (lower.endsWith(".heif")) return "heif";
    return "jpg";
  }

  private normalizeFileExtension(extension?: string): string {
    const clean = (extension ?? "").trim().toLowerCase().replace(/^\./, "");
    if (clean === "png" || clean === "webp" || clean === "heic" || clean === "heif" || clean === "jpg" || clean === "jpeg") {
      return clean === "jpeg" ? "jpg" : clean;
    }
    return "jpg";
  }

  private mimeTypeFromExtension(extension: string): string {
    const normalized = this.normalizeFileExtension(extension);
    if (normalized === "png") return "image/png";
    if (normalized === "webp") return "image/webp";
    if (normalized === "heic") return "image/heic";
    if (normalized === "heif") return "image/heif";
    return "image/jpeg";
  }

  private stripBase64DataPrefix(value: string): string {
    const marker = "base64,";
    const index = value.indexOf(marker);
    if (index === -1) return value;
    return value.slice(index + marker.length);
  }

  private sanitizeIdSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private async persistGardenPhotoUri(gardenId: string, sourceUri: string): Promise<string> {
    const extension = this.inferFileExtensionFromUri(sourceUri);
    const mediaDirectory = new FileSystem.Directory(FileSystem.Paths.document, "garden-media", "garden-photos", gardenId);
    mediaDirectory.create({ idempotent: true, intermediates: true });
    const target = new FileSystem.File(
      mediaDirectory,
      `garden-base-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`
    );

    try {
      const source = new FileSystem.File(sourceUri);
      source.copy(target);
      return target.uri;
    } catch {
      try {
        const source = new FileSystem.File(sourceUri);
        const base64 = await source.base64();
        target.create({ intermediates: true, overwrite: true });
        target.write(base64, { encoding: "base64" });
        return target.uri;
      } catch {
        return sourceUri;
      }
    }
  }

  private isManagedGardenMediaUri(uri: string): boolean {
    const lower = uri.toLowerCase();
    return lower.includes("/garden-media/");
  }

  private safeDeleteFile(uri: string): void {
    try {
      const file = new FileSystem.File(uri);
      if (file.exists) {
        file.delete();
      }
    } catch {
      // Ignore cleanup failures.
    }
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
