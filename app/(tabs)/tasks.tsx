import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadAppPreferences } from "@/core/settings/appPreferences";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteGardenTaskRepository } from "@/infra/repositories/sqlite/SqliteGardenTaskRepository";
import { buildAutoTaskInputs, buildWeatherTaskInputs } from "@/features/tasks/services/taskGeneration";
import { fetchDailyForecast } from "@/features/weather/services/openMeteo";
import { queryClient } from "@/state/queryClient";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { useTheme } from "@/ui/theme/ThemeProvider";

const gardenRepository = new SqliteGardenRepository();
const wishlistRepository = new SqliteGardenCropWishlistRepository();
const taskRepository = new SqliteGardenTaskRepository();

export default function TasksTabScreen() {
  const { theme } = useTheme();
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);

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
    mutationFn: async (payload: { id: string; status: "done" | "dismissed" }) => {
      await taskRepository.setStatus(payload.id, payload.status);
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
  const openTasks = tasks.filter((task) => task.status === "open");
  const doneTasks = tasks.filter((task) => task.status !== "open");
  const currentGarden = (gardensQuery.data ?? []).find((garden) => garden.id === activeGardenId) ?? null;

  return (
    <ScrollView style={[styles.page, { backgroundColor: theme.appBackground }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Tasks</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        {currentGarden ? `Active garden: ${currentGarden.name}` : "Choose a garden to see task alerts."}
      </Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        Notifications: {preferencesQuery.data?.notificationsEnabled ? "on" : "off"} (manage in Settings)
      </Text>

      {gardensQuery.isLoading && <Text style={[styles.empty, { color: theme.textMuted }]}>Loading gardens...</Text>}
      {activeGardenId && (
        <Pressable
          style={[styles.button, { backgroundColor: theme.secondaryActionBackground }]}
          onPress={() => generateMutation.mutate(activeGardenId)}
        >
          <Text style={[styles.buttonText, { color: theme.secondaryActionText }]}>
            {generateMutation.isPending ? "Refreshing tasks..." : "Refresh tasks"}
          </Text>
        </Pressable>
      )}

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Due now</Text>
        {openTasks.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textMuted }]}>No open tasks right now.</Text>
        ) : (
          openTasks.map((task) => (
            <View key={task.id} style={[styles.taskRow, { borderColor: theme.borderColor }]}>
              <View style={styles.taskMain}>
                <Text style={[styles.taskTitle, { color: theme.textPrimary }]}>{task.title}</Text>
                <Text style={[styles.taskMeta, { color: theme.textMuted }]}>
                  Due {formatDate(task.dueDate)} · {formatTaskType(task.taskType)}
                </Text>
                {task.detail ? <Text style={[styles.taskMeta, { color: theme.textMuted }]}>{task.detail}</Text> : null}
              </View>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.actionButton, { backgroundColor: theme.primaryActionBackground }]}
                  onPress={() => statusMutation.mutate({ id: task.id, status: "done" })}
                >
                  <Text style={[styles.actionText, { color: theme.primaryActionText }]}>Done</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionButton, { backgroundColor: theme.dangerActionBackground }]}
                  onPress={() => statusMutation.mutate({ id: task.id, status: "dismissed" })}
                >
                  <Text style={[styles.actionText, { color: theme.dangerActionText }]}>Dismiss</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>History</Text>
        {doneTasks.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textMuted }]}>Nothing completed/dismissed yet.</Text>
        ) : (
          doneTasks.slice(0, 24).map((task) => (
            <View key={task.id} style={[styles.taskRow, { borderColor: theme.borderColor }]}>
              <View style={styles.taskMain}>
                <Text style={[styles.taskTitle, { color: theme.textPrimary }]}>{task.title}</Text>
                <Text style={[styles.taskMeta, { color: theme.textMuted }]}>
                  {task.status === "done" ? "Completed" : "Dismissed"} · Due {formatDate(task.dueDate)}
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
  button: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" },
  buttonText: { fontWeight: "700", fontSize: 12 },
  taskRow: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  taskMain: { gap: 2 },
  taskTitle: { fontWeight: "700", fontSize: 14 },
  taskMeta: { fontSize: 12 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  actionText: { fontSize: 12, fontWeight: "700" },
});
