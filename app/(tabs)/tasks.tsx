import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadAppPreferences } from "@/core/settings/appPreferences";
import type { GardenTask } from "@/domain/entities/GardenTask";
import { BedPlanPreview } from "@/features/garden-mapping/components/BedPlanPreview";
import { getCalendarTypeMeta } from "@/features/calendar/services/calendarPresentation";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteGardenTaskRepository } from "@/infra/repositories/sqlite/SqliteGardenTaskRepository";
import { notifyForOpenTasks } from "@/features/tasks/services/notifications";
import { buildAutoTaskInputs, buildWeatherTaskInputs } from "@/features/tasks/services/taskGeneration";
import { fetchDailyForecast } from "@/features/weather/services/openMeteo";
import { queryClient } from "@/state/queryClient";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { AppButton } from "@/ui/components/AppButton";

const gardenRepository = new SqliteGardenRepository();
const bedRepository = new SqliteBedRepository();
const wishlistRepository = new SqliteGardenCropWishlistRepository();
const taskRepository = new SqliteGardenTaskRepository();

export default function TasksTabScreen() {
  const { theme } = useTheme();
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);
  const [bedPicker, setBedPicker] = useState<{ task: GardenTask; bedId: string | null } | null>(null);

  const gardensQuery = useQuery({
    queryKey: ["gardens"],
    queryFn: async () => gardenRepository.list(),
  });

  const activeGardenId = useMemo(() => {
    if (selectedGardenId) return selectedGardenId;
    return gardensQuery.data?.[0]?.id ?? null;
  }, [gardensQuery.data, selectedGardenId]);

  useEffect(() => {
    if (!selectedGardenId && activeGardenId) setSelectedGardenId(activeGardenId);
  }, [activeGardenId, selectedGardenId, setSelectedGardenId]);

  const preferencesQuery = useQuery({
    queryKey: ["app-preferences"],
    queryFn: loadAppPreferences,
  });

  const tasksQuery = useQuery({
    queryKey: ["garden-tasks", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return taskRepository.listByGarden(activeGardenId);
    },
  });
  const growQuery = useQuery({
    queryKey: ["garden-grow-list", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return wishlistRepository.listByGarden(activeGardenId);
    },
  });
  const bedsQuery = useQuery({
    queryKey: ["beds", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return bedRepository.listByGarden(activeGardenId);
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (gardenId: string) => {
      const [garden, wishlist, activePlantings] = await Promise.all([
        gardenRepository.getById(gardenId),
        wishlistRepository.listByGarden(gardenId),
        wishlistRepository.listPlantingsByGarden(gardenId),
      ]);
      const activeEntries = wishlist.filter((entry) => entry.status === "already_growing");
      const forecast =
        garden && (Math.abs(garden.latitude) > 0.000001 || Math.abs(garden.longitude) > 0.000001)
          ? await fetchDailyForecast(garden.latitude, garden.longitude, 7)
          : [];
      const tasks = buildAutoTaskInputs({
        gardenId,
        now: new Date(),
        wishlist,
        activePlantings: activePlantings.filter((row) => !row.endedAt),
      });
      const weatherTasks = buildWeatherTaskInputs({
        gardenId,
        now: new Date(),
        forecast,
        activeEntries,
      });
      for (const task of tasks) {
        await taskRepository.upsertAutoTask(task);
      }
      for (const task of weatherTasks) {
        await taskRepository.upsertAutoTask(task);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-tasks", activeGardenId] });
      await queryClient.invalidateQueries({ queryKey: ["tasks-unseen-count", activeGardenId] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (payload: { task: GardenTask; status: "done" | "dismissed"; selectedBedId?: string }) => {
      const { task, status, selectedBedId } = payload;
      if (status === "done" && activeGardenId && task.entryId) {
        const wishlist = await wishlistRepository.listByGarden(activeGardenId);
        const entry = wishlist.find((item) => item.id === task.entryId);
        if (entry) {
          if (task.taskType === "start_indoors") {
            await wishlistRepository.update({
              id: entry.id,
              status: entry.status,
              startedIndoorsAt: entry.startedIndoorsAt ?? new Date().toISOString(),
              ...(entry.bedId ? { bedId: entry.bedId } : {}),
              ...(entry.varietyName ? { varietyName: entry.varietyName } : { varietyName: "" }),
              supportNeeded: entry.supportNeeded,
              quantity: Math.max(1, entry.quantity ?? 1),
            });
          } else if (task.taskType === "direct_sow" || task.taskType === "plant_out") {
            const bedIdToUse = entry.bedId ?? selectedBedId;
            if (bedIdToUse) {
              await wishlistRepository.markPlanted({ entryId: entry.id, bedId: bedIdToUse });
            }
          }
        }
      }
      await taskRepository.setStatus(task.id, status);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-tasks", activeGardenId] });
      await queryClient.invalidateQueries({ queryKey: ["tasks-unseen-count", activeGardenId] });
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", activeGardenId] });
      await queryClient.invalidateQueries({ queryKey: ["garden-plantings", activeGardenId] });
      await queryClient.invalidateQueries({ queryKey: ["beds", activeGardenId] });
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: async (gardenId: string) => {
      await taskRepository.clearHistoryByGarden(gardenId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-tasks", activeGardenId] });
      await queryClient.invalidateQueries({ queryKey: ["tasks-unseen-count", activeGardenId] });
    },
  });

  useEffect(() => {
    if (!activeGardenId) return;
    generateMutation.mutate(activeGardenId);
    void taskRepository.markSeenByGarden(activeGardenId).then(async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks-unseen-count", activeGardenId] });
    });
  }, [activeGardenId]);

  const tasks = tasksQuery.data ?? [];
  const growList = growQuery.data ?? [];
  const beds = bedsQuery.data ?? [];
  const bedNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const bed of beds) map.set(bed.id, bed.name);
    return map;
  }, [beds]);
  const openTasks = tasks.filter((task) => task.status === "open");
  const doneTasks = tasks.filter((task) => task.status !== "open");
  const openTaskSections = useMemo(() => groupOpenTasks(openTasks), [openTasks]);
  const currentGarden = (gardensQuery.data ?? []).find((garden) => garden.id === activeGardenId) ?? null;

  useEffect(() => {
    if (!currentGarden) return;
    if (!preferencesQuery.data?.notificationsEnabled) return;
    if (openTasks.length === 0) return;
    void notifyForOpenTasks({
      gardenId: currentGarden.id,
      gardenName: currentGarden.name,
      openTasks,
    });
  }, [currentGarden, openTasks, preferencesQuery.data?.notificationsEnabled]);

  const handleDonePress = async (task: GardenTask) => {
    if (!activeGardenId) {
      statusMutation.mutate({ task, status: "done" });
      return;
    }
    if (task.taskType !== "plant_out" && task.taskType !== "direct_sow") {
      statusMutation.mutate({ task, status: "done" });
      return;
    }
    if (!task.entryId) {
      statusMutation.mutate({ task, status: "done" });
      return;
    }
    const wishlist = await wishlistRepository.listByGarden(activeGardenId);
    const entry = wishlist.find((item) => item.id === task.entryId);
    if (!entry) {
      statusMutation.mutate({ task, status: "done" });
      return;
    }
    if (entry.bedId) {
      statusMutation.mutate({ task, status: "done" });
      return;
    }
    const beds = bedsQuery.data ?? [];
    if (beds.length === 0) {
      Alert.alert("Pick a bed first", "This crop needs a bed before it can be marked planted.");
      return;
    }
    setBedPicker({ task, bedId: beds[0]?.id ?? null });
  };
  const bedPreviewInfoById = useMemo(() => {
    const map: Record<string, { bedName: string; lines: string[] }> = {};
    for (const bed of bedsQuery.data ?? []) {
      const bedEntries = growList.filter((entry) => entry.bedId === bed.id);
      const growing = bedEntries.filter((entry) => entry.status === "already_growing").map((entry) => entry.plant.commonName);
      const planned = bedEntries.filter((entry) => entry.status === "wanted").map((entry) => entry.plant.commonName);
      map[bed.id] = {
        bedName: bed.name,
        lines: [
          growing.length > 0 ? `Growing: ${growing.join(", ")}` : "Growing: none",
          planned.length > 0 ? `Planned: ${planned.join(", ")}` : "Planned: none",
        ],
      };
    }
    return map;
  }, [bedsQuery.data, growList]);
  const bedPlantDotsById = useMemo(() => {
    const map: Record<string, { plantedCount: number; perennialCount: number; plannedCount: number }> = {};
    for (const bed of bedsQuery.data ?? []) {
      const plantedEntries = growList.filter((entry) => entry.bedId === bed.id && entry.status === "already_growing");
      const plannedEntries = growList.filter((entry) => entry.bedId === bed.id && entry.status === "wanted");
      map[bed.id] = {
        plantedCount: plantedEntries.length,
        perennialCount: plantedEntries.filter((entry) => entry.isPerennial).length,
        plannedCount: plannedEntries.length,
      };
    }
    return map;
  }, [bedsQuery.data, growList]);

  return (
    <ScrollView style={[styles.page, { backgroundColor: theme.appBackground }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Tasks</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        {currentGarden ? `Active garden: ${currentGarden.name}` : "Choose a garden to see task alerts."}
      </Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>Notifications: {preferencesQuery.data?.notificationsEnabled ? "on" : "off"} (manage in Settings)</Text>

      {gardensQuery.isLoading && <Text style={[styles.empty, { color: theme.textMuted }]}>Loading gardens...</Text>}
      {activeGardenId && (
        <AppButton
          label={generateMutation.isPending ? "Refreshing tasks..." : "Refresh tasks"}
          variant="secondary"
          size="sm"
          style={styles.button}
          onPress={() => generateMutation.mutate(activeGardenId)}
        />
      )}

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Due now</Text>
        {bedPicker ? (
          <View style={[styles.bedPickerBox, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}>
            <Text style={[styles.taskTitle, { color: theme.textPrimary }]}>Choose bed for {formatTaskTitle(bedPicker.task.title)}</Text>
            <View style={styles.actions}>
              {(bedsQuery.data ?? []).map((bed) => {
                const selected = bedPicker.bedId === bed.id;
                return (
                  <Pressable
                    key={bed.id}
                    style={[
                      styles.bedPickerChip,
                      {
                        borderColor: selected ? theme.primaryActionBackground : theme.borderColor,
                        backgroundColor: selected ? theme.primaryActionBackground : theme.surfaceBackground,
                      },
                    ]}
                    onPress={() => setBedPicker((prev) => (prev ? { ...prev, bedId: bed.id } : prev))}
                  >
                    <Text style={{ color: selected ? theme.primaryActionText : theme.textPrimary, fontWeight: "700", fontSize: 12 }}>{bed.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.actions}>
              <AppButton
                label="Cancel"
                variant="secondary"
                size="sm"
                style={styles.actionButton}
                onPress={() => setBedPicker(null)}
              />
              <AppButton
                label="Plant here"
                variant="primary"
                size="sm"
                style={styles.actionButton}
                onPress={() => {
                  if (!bedPicker.bedId) return;
                  statusMutation.mutate({ task: bedPicker.task, status: "done", selectedBedId: bedPicker.bedId });
                  setBedPicker(null);
                }}
                disabled={!bedPicker.bedId || statusMutation.isPending}
              />
            </View>
          </View>
        ) : null}
        {openTasks.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textMuted }]}>No open tasks right now.</Text>
        ) : (
          openTaskSections.map((section) => {
            const sectionMeta = getCalendarTypeMeta({
              type: section.taskType as any,
              title: "",
              detail: "",
            });
            return (
              <View key={section.key} style={[styles.taskSectionCard, { borderColor: sectionMeta.border }]}>
                <View style={[styles.taskSectionAccent, { backgroundColor: sectionMeta.background }]} />
                <View style={styles.taskSectionBody}>
                  <View style={styles.sectionHeader}>
                    <TaskTypePill taskType={section.taskType} />
                    <View style={styles.sectionHeaderMain}>
                      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>{section.label}</Text>
                      <Text style={[styles.sectionCount, { color: theme.textMuted }]}>{section.tasks.length} tasks</Text>
                    </View>
                  </View>
                  <View style={styles.sectionList}>
                    {section.tasks.map((task) => (
                      <View key={task.id} style={[styles.taskRow, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}>
                        <View style={styles.taskMain}>
                          <Text style={[styles.taskTitle, { color: theme.textPrimary }]}>{formatTaskTitle(task.title)}</Text>
                          <View style={styles.taskMetaRow}>
                            <Text style={[styles.taskMeta, { color: theme.textMuted }]}>Due {formatDate(task.dueDate)}</Text>
                            {task.bedId ? (
                              <Text style={[styles.taskMeta, { color: theme.textMuted }]}>Bed {bedNameById.get(task.bedId) ?? "selected"}</Text>
                            ) : (
                              <Text style={[styles.taskMeta, { color: theme.textMuted }]}>No bed assigned</Text>
                            )}
                          </View>
                          {task.detail ? <Text style={[styles.taskMeta, { color: theme.textMuted }]}>{task.detail}</Text> : null}
                        </View>
                        <View style={styles.actions}>
                          <AppButton
                            label={getOpenTaskActionLabel(task)}
                            variant="primary"
                            size="sm"
                            style={styles.actionButton}
                            onPress={() => {
                              void handleDonePress(task);
                            }}
                          />
                          <AppButton
                            label="Dismiss"
                            variant="danger"
                            size="sm"
                            style={styles.actionButton}
                            onPress={() => statusMutation.mutate({ task, status: "dismissed" })}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      {activeGardenId && (bedsQuery.data ?? []).length > 0 && (
        <BedPlanPreview
          beds={bedsQuery.data ?? []}
          scaleCalibration={currentGarden?.scaleCalibration ?? null}
          {...(Number.isFinite(currentGarden?.scaleCalibration?.boundaryAreaSqM)
            ? { boundaryAreaSqM: currentGarden?.scaleCalibration?.boundaryAreaSqM }
            : {})}
          {...(currentGarden?.scaleCalibration?.boundaryPolygon
            ? { boundaryPolygon: currentGarden.scaleCalibration.boundaryPolygon }
            : {})}
          {...(currentGarden?.scaleCalibration?.baseWidth && currentGarden?.scaleCalibration?.baseHeight
            ? { previewRatio: currentGarden.scaleCalibration.baseHeight / currentGarden.scaleCalibration.baseWidth }
            : {})}
          infoByBedId={bedPreviewInfoById}
          bedPlantDotsById={bedPlantDotsById}
          title="Bed Layout"
          subtitle="Use this to match bed names when completing planting tasks."
        />
      )}

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <View style={styles.historyHeader}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>History</Text>
          {activeGardenId && doneTasks.length > 0 && (
            <AppButton
              label={clearHistoryMutation.isPending ? "Clearing..." : "Clear history"}
              variant="danger"
              size="sm"
              style={styles.actionButton}
              onPress={() =>
                Alert.alert("Clear task history", `Delete ${doneTasks.length} completed/dismissed tasks?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Clear", style: "destructive", onPress: () => clearHistoryMutation.mutate(activeGardenId) },
                ])
              }
              disabled={clearHistoryMutation.isPending}
            />
          )}
        </View>
        {doneTasks.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textMuted }]}>Nothing completed/dismissed yet.</Text>
        ) : (
          doneTasks.slice(0, 24).map((task) => (
            <View key={task.id} style={[styles.taskRow, { borderColor: theme.borderColor }]}>
              <View style={styles.taskMain}>
                <Text style={[styles.taskTitle, { color: theme.textPrimary }]}>{formatTaskTitle(task.title)}</Text>
                <Text style={[styles.taskMeta, { color: theme.textMuted }]}> 
                  {task.status === "done" ? "Completed" : "Dismissed"} | Due {formatDate(task.dueDate)}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function formatTaskTitle(title: string): string {
  return title
    .replace(/^(Start indoors|Direct sow|Plant out|Harvest window|Check harvest readiness|Garden watering alert|Garden frost alert):\s*/i, "")
    .replace(/^(Weather alert:|Task:|Planted:|Started indoors:)\s*/i, "")
    .trim();
}

function getOpenTaskActionLabel(task: GardenTask): string {
  if (task.taskType === "direct_sow" || task.taskType === "plant_out") {
    return task.bedId ? "Plant" : "Choose bed";
  }
  return "Done";
}

type TaskSection = {
  key: string;
  taskType: GardenTask["taskType"];
  label: string;
  tasks: GardenTask[];
};

function groupOpenTasks(tasks: GardenTask[]): TaskSection[] {
  const deduped = collapseDuplicateOpenTasks(tasks);
  const orderedTypes: Array<GardenTask["taskType"]> = [
    "start_indoors",
    "direct_sow",
    "plant_out",
    "harvest_window",
    "water_alert",
    "manual",
  ];
  const labelByType: Record<GardenTask["taskType"], string> = {
    start_indoors: "Start indoors",
    direct_sow: "Direct sow",
    plant_out: "Plant out",
    harvest_window: "Harvest",
    water_alert: "Weather",
    manual: "Other tasks",
  };
  const grouped = new Map<GardenTask["taskType"], GardenTask[]>();
  for (const task of deduped) {
    const list = grouped.get(task.taskType) ?? [];
    list.push(task);
    grouped.set(task.taskType, list);
  }
  return orderedTypes
    .filter((taskType) => (grouped.get(taskType) ?? []).length > 0)
    .map((taskType) => {
      const list = grouped.get(taskType) ?? [];
      list.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.priority - a.priority || a.title.localeCompare(b.title));
      return {
        key: taskType,
        taskType,
        label: labelByType[taskType],
        tasks: list,
      };
    });
}

function collapseDuplicateOpenTasks(tasks: GardenTask[]): GardenTask[] {
  const byKey = new Map<string, GardenTask>();
  for (const task of tasks) {
    const key = task.entryId
      ? `${task.taskType}:${task.entryId}:${task.dueDate}`
      : task.ruleKey || `${task.taskType}:${task.dueDate}:${formatTaskTitle(task.title).toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, task);
      continue;
    }
    const next = choosePreferredTask(existing, task);
    byKey.set(key, next);
  }
  return Array.from(byKey.values());
}

function choosePreferredTask(a: GardenTask, b: GardenTask): GardenTask {
  const score = (task: GardenTask): number => {
    let value = 0;
    if (task.bedId) value += 20;
    if (task.detail) value += 5;
    value += Math.min(task.priority, 20);
    value += task.updatedAt ? 1 : 0;
    return value;
  };
  return score(b) > score(a) ? b : a;
}

function TaskTypePill(props: { taskType: string }) {
  const meta = getCalendarTypeMeta({
    type: props.taskType as any,
    title: "",
    detail: ""
  });
  
  return (
    <View style={[styles.taskTypePill, { backgroundColor: meta.background, borderColor: meta.border }]}>
      <Text style={[styles.taskTypePillText, { color: meta.text }]}>{meta.label}</Text>
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 14, gap: 10, paddingBottom: 110 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  cardTitle: { fontWeight: "800" },
  empty: { fontSize: 12 },
  button: { alignSelf: "flex-start" },
  taskRow: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  taskMain: { gap: 2 },
  taskTitle: { fontWeight: "700", fontSize: 14 },
  taskMeta: { fontSize: 12 },
  taskMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  taskTypePill: { borderWidth: 1, borderRadius: 999, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4 },
  taskTypePillText: { fontWeight: "700", fontSize: 10 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  taskSection: { gap: 8 },
  taskSectionCard: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  taskSectionAccent: { height: 4 },
  taskSectionBody: { gap: 8, padding: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sectionHeaderMain: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 14, fontWeight: "800" },
  sectionCount: { fontSize: 12, fontWeight: "700" },
  sectionList: { gap: 8 },
  bedPickerBox: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  bedPickerChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  actionButton: {},
});
