import { getDatabase } from "@/core/db/sqlite";

const APP_PREFERENCES_KEY = "app_preferences_v1";

type SettingsRow = {
  value_json: string;
};

export type AppPreferences = {
  activeGardenId: string | null;
  notificationsEnabled: boolean;
  showBedPhotos: boolean;
  showBedNames: boolean;
  showBedSizes: boolean;
};

const DEFAULT_PREFERENCES: AppPreferences = {
  activeGardenId: null,
  notificationsEnabled: false,
  showBedPhotos: true,
  showBedNames: true,
  showBedSizes: true,
};

export async function loadAppPreferences(): Promise<AppPreferences> {
  const row = await getDatabase().getFirstAsync<SettingsRow>(
    "SELECT value_json FROM app_settings WHERE key = ?",
    [APP_PREFERENCES_KEY]
  );
  if (!row?.value_json) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(row.value_json) as Partial<AppPreferences>;
    return {
      activeGardenId: typeof parsed.activeGardenId === "string" ? parsed.activeGardenId : null,
      notificationsEnabled: Boolean(parsed.notificationsEnabled),
      showBedPhotos: parsed.showBedPhotos !== false,
      showBedNames: parsed.showBedNames !== false,
      showBedSizes: parsed.showBedSizes !== false,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function saveAppPreferences(next: AppPreferences): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [APP_PREFERENCES_KEY, JSON.stringify(next), new Date().toISOString()]
  );
}
