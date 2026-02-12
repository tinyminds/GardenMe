import { getDatabase } from "@/core/db/sqlite";

const THEME_SETTINGS_KEY = "ui_theme_v1";

type SettingsRow = {
  value_json: string;
};

export async function loadThemeSettingsJson(): Promise<string | null> {
  const row = await getDatabase().getFirstAsync<SettingsRow>(
    "SELECT value_json FROM app_settings WHERE key = ?",
    [THEME_SETTINGS_KEY]
  );
  return row?.value_json ?? null;
}

export async function saveThemeSettingsJson(valueJson: string): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [THEME_SETTINGS_KEY, valueJson, new Date().toISOString()]
  );
}
