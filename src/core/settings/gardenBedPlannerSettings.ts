import { getDatabase } from "@/core/db/sqlite";

const GARDEN_BED_PLANNER_KEY = "garden_bed_planner_v1";

type SettingsRow = {
  value_json: string;
};

type GardenBedPlannerFlags = {
  spareSpaceByBedId?: Record<string, boolean>;
  rejectedSuggestionIdsByBed?: Record<string, string[]>;
};

export type GardenBedPlannerSettings = Record<string, GardenBedPlannerFlags>;

export async function loadGardenBedPlannerSettings(): Promise<GardenBedPlannerSettings> {
  const row = await getDatabase().getFirstAsync<SettingsRow>(
    "SELECT value_json FROM app_settings WHERE key = ?",
    [GARDEN_BED_PLANNER_KEY]
  );
  if (!row?.value_json) return {};
  try {
    const parsed = JSON.parse(row.value_json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as GardenBedPlannerSettings;
  } catch {
    return {};
  }
}

export async function saveGardenBedPlannerSettings(value: GardenBedPlannerSettings): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [GARDEN_BED_PLANNER_KEY, JSON.stringify(value), new Date().toISOString()]
  );
}
