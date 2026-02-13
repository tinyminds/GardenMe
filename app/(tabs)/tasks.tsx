import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadAppPreferences } from "@/core/settings/appPreferences";
import type { GardenTask } from "@/domain/entities/GardenTask";
import { BedPlanPreview } from "@/features/garden-mapping/components/BedPlanPreview";
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
              ...(entry.status === "already_growing" && entry.bedId ? { bedId: entry.bedId } : {}),
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
  const openTasks = tasks.filter((task) => task.status === "open");
  const doneTasks = tasks.filter((task) => task.status !== "open");
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
            <Text style={[styles.taskTitle, { color: theme.textPrimary }]}>Choose bed: {bedPicker.task.title}</Text>
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
                label="Done + Plant"
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
          openTasks.map((task) => (
            <View key={task.id} style={[styles.taskRow, { borderColor: theme.borderColor }]}>
              <View style={styles.taskMain}>
                <Text style={[styles.taskTitle, { color: theme.textPrimary }]}>{task.title}</Text>
                <Text style={[styles.taskMeta, { color: theme.textMuted }]}>Due {formatDate(task.dueDate)} | {formatTaskType(task.taskType)}</Text>
                {task.detail ? <Text style={[styles.taskMeta, { color: theme.textMuted }]}>{task.detail}</Text> : null}
              </View>
              <View style={styles.actions}>
                <AppButton
                  label="Done"
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
          ))
        )}
      </View>

      {activeGardenId && (bedsQuery.data ?? []).length > 0 && (
        <BedPlanPreview
          beds={bedsQuery.data ?? []}
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
                <Text style={[styles.taskTitle, { color: theme.textPrimary }]}>{task.title}</Text>
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

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTaskType(value: string): string {
  return value.replace(/_/g, " ");
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
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  bedPickerBox: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  bedPickerChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  actionButton: {},
});
