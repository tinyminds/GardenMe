import { getDatabase } from "@/core/db/sqlite";

const BED_PHOTO_LOG_KEY = "bed_photo_log_v1";

type SettingsRow = {
  value_json: string;
};

export type BedPhotoLogEntry = {
  id: string;
  bedId: string;
  uri: string;
  source: "camera" | "gallery";
  createdAt: string;
  notes?: string;
  isBedBackground?: boolean;
};

export type BedPhotoLogSettings = Record<string, BedPhotoLogEntry[]>;

export async function loadBedPhotoLogSettings(): Promise<BedPhotoLogSettings> {
  const row = await getDatabase().getFirstAsync<SettingsRow>(
    "SELECT value_json FROM app_settings WHERE key = ?",
    [BED_PHOTO_LOG_KEY]
  );
  if (!row?.value_json) return {};
  try {
    const parsed = JSON.parse(row.value_json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as BedPhotoLogSettings;
  } catch {
    return {};
  }
}

export async function saveBedPhotoLogSettings(value: BedPhotoLogSettings): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [BED_PHOTO_LOG_KEY, JSON.stringify(value), new Date().toISOString()]
  );
}
