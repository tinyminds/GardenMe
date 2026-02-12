import { getDatabase } from "@/core/db/sqlite";

const GARDEN_PROGRESS_KEY = "garden_progress_v1";

type SettingsRow = {
  value_json: string;
};

type GardenProgressFlags = {
  mapperDone?: boolean;
  growDone?: boolean;
};

export type GardenProgressSettings = Record<string, GardenProgressFlags>;

export async function loadGardenProgressSettings(): Promise<GardenProgressSettings> {
  const row = await getDatabase().getFirstAsync<SettingsRow>(
    "SELECT value_json FROM app_settings WHERE key = ?",
    [GARDEN_PROGRESS_KEY]
  );
  if (!row?.value_json) return {};
  try {
    const parsed = JSON.parse(row.value_json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as GardenProgressSettings;
  } catch {
    return {};
  }
}

export async function saveGardenProgressSettings(value: GardenProgressSettings): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [GARDEN_PROGRESS_KEY, JSON.stringify(value), new Date().toISOString()]
  );
}

