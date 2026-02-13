import Constants from "expo-constants";
import { Platform } from "react-native";
import { getDatabase } from "@/core/db/sqlite";
import type { GardenTask } from "@/domain/entities/GardenTask";

const TASK_NOTIFICATIONS_KEY = "task_notifications_v1";

type SettingsRow = { value_json: string };
type NotifiedMap = Record<string, string>;

export async function ensureTaskNotificationPermission(): Promise<boolean> {
  const notifications = await loadNotificationsModule();
  if (!notifications) return false;
  const permissions = await notifications.getPermissionsAsync();
  if (permissions.granted || permissions.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  const requested = await notifications.requestPermissionsAsync();
  return Boolean(requested.granted || requested.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL);
}

export async function notifyForOpenTasks(params: {
  gardenId: string;
  gardenName: string;
  openTasks: GardenTask[];
}): Promise<number> {
  const notifications = await loadNotificationsModule();
  if (!notifications) return 0;
  if (params.openTasks.length === 0) return 0;

  const allowed = await ensureTaskNotificationPermission();
  if (!allowed) return 0;

  const nowMs = Date.now();
  const dueSoonTasks = params.openTasks.filter((task) => {
    const dueMs = new Date(task.dueDate).getTime();
    if (!Number.isFinite(dueMs)) return false;
    return dueMs <= nowMs + 24 * 60 * 60 * 1000;
  });
  if (dueSoonTasks.length === 0) return 0;

  const known = await loadNotifiedMap();
  let count = 0;

  const urgentWeatherTasks = dueSoonTasks.filter((task) => isUrgentWeatherTask(task));
  for (const task of urgentWeatherTasks) {
    const key = buildTaskNotifyKey(params.gardenId, task.id);
    const fingerprint = `${task.status}|${task.dueDate}|${task.updatedAt}`;
    if (known[key] === fingerprint) continue;

    await notifications.scheduleNotificationAsync({
      content: {
        title: `Garden task: ${params.gardenName}`,
        body: task.title,
        data: { gardenId: params.gardenId, taskId: task.id, type: task.taskType },
      },
      trigger: null,
    });

    known[key] = fingerprint;
    count += 1;
  }

  const summaryCandidates = dueSoonTasks.filter((task) => !isUrgentWeatherTask(task));
  if (summaryCandidates.length > 0) {
    const summaryKey = buildDailySummaryKey(params.gardenId, new Date());
    if (!known[summaryKey]) {
      const preview = summaryCandidates
        .slice(0, 2)
        .map((task) => task.title.trim())
        .filter(Boolean)
        .join(" | ");
      await notifications.scheduleNotificationAsync({
        content: {
          title: `Garden tasks: ${params.gardenName}`,
          body:
            summaryCandidates.length === 1
              ? `1 task due soon${preview ? `: ${preview}` : ""}`
              : `${summaryCandidates.length} tasks due soon${preview ? `: ${preview}` : ""}`,
          data: { gardenId: params.gardenId, type: "task_summary", count: summaryCandidates.length },
        },
        trigger: null,
      });
      known[summaryKey] = new Date().toISOString();
      count += 1;
    }
  }

  if (count > 0) {
    await saveNotifiedMap(known);
  }
  return count;
}

function buildTaskNotifyKey(gardenId: string, taskId: string): string {
  return `${gardenId}:${taskId}`;
}

function buildDailySummaryKey(gardenId: string, now: Date): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `summary:${gardenId}:${y}-${m}-${d}`;
}

function isUrgentWeatherTask(task: GardenTask): boolean {
  if (task.taskType !== "water_alert" && task.taskType !== "manual") return false;
  return task.ruleKey.startsWith("weather:");
}

async function loadNotifiedMap(): Promise<NotifiedMap> {
  const row = await getDatabase().getFirstAsync<SettingsRow>(
    "SELECT value_json FROM app_settings WHERE key = ? LIMIT 1",
    [TASK_NOTIFICATIONS_KEY]
  );
  if (!row?.value_json) return {};
  try {
    const parsed = JSON.parse(row.value_json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as NotifiedMap;
  } catch {
    return {};
  }
}

async function saveNotifiedMap(map: NotifiedMap): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [TASK_NOTIFICATIONS_KEY, JSON.stringify(map), new Date().toISOString()]
  );
}

async function loadNotificationsModule(): Promise<typeof import("expo-notifications") | null> {
  if (Platform.OS === "web") return null;
  if (Constants.appOwnership === "expo") return null;
  try {
    return await import("expo-notifications");
  } catch {
    return null;
  }
}
