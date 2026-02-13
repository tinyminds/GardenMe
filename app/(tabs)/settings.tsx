import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { loadAppPreferences, saveAppPreferences } from "@/core/settings/appPreferences";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { queryClient } from "@/state/queryClient";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { SelectionRow } from "@/ui/components/SelectionRow";

const gardenRepository = new SqliteGardenRepository();

export default function SettingsTabScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);

  const gardensQuery = useQuery({
    queryKey: ["gardens"],
    queryFn: async () => gardenRepository.list(),
  });

  const preferencesQuery = useQuery({
    queryKey: ["app-preferences"],
    queryFn: loadAppPreferences,
  });

  const preferencesMutation = useMutation({
    mutationFn: saveAppPreferences,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-preferences"] });
    },
  });

  const activeGardenId = selectedGardenId ?? preferencesQuery.data?.activeGardenId ?? null;

  const setActiveGarden = (gardenId: string | null) => {
    setSelectedGardenId(gardenId);
    const existing = preferencesQuery.data ?? { activeGardenId: null, notificationsEnabled: false };
    preferencesMutation.mutate({ ...existing, activeGardenId: gardenId });
  };

  const toggleNotifications = () => {
    const existing = preferencesQuery.data ?? { activeGardenId: activeGardenId ?? null, notificationsEnabled: false };
    preferencesMutation.mutate({
      ...existing,
      activeGardenId: activeGardenId ?? null,
      notificationsEnabled: !existing.notificationsEnabled,
    });
  };

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Settings</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>Manage app preferences and appearance.</Text>

        <View style={[styles.group, { borderColor: theme.borderColor }]}>
          <Text style={[styles.groupTitle, { color: theme.textPrimary }]}>Active garden for alerts</Text>
          <Text style={[styles.groupMeta, { color: theme.textMuted }]}>
            Only this garden generates task alerts and task badge counts.
          </Text>
          {(gardensQuery.data ?? []).map((garden) => {
            const selected = garden.id === activeGardenId;
            return (
              <SelectionRow
                key={garden.id}
                label={garden.name}
                selected={selected}
                onPress={() => setActiveGarden(garden.id)}
              />
            );
          })}
        </View>

        <View style={[styles.group, { borderColor: theme.borderColor }]}>
          <Text style={[styles.groupTitle, { color: theme.textPrimary }]}>Notifications</Text>
          <SelectionRow
            label={preferencesQuery.data?.notificationsEnabled ? "Enabled" : "Disabled"}
            selected={Boolean(preferencesQuery.data?.notificationsEnabled)}
            onPress={toggleNotifications}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/styleguide")}
          style={[styles.linkRow, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}
        >
          <Text style={[styles.linkTitle, { color: theme.textPrimary }]}>Theme Editor</Text>
          <Text style={[styles.linkChevron, { color: theme.textMuted }]}>{">"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  title: { fontSize: 24, fontWeight: "800" },
  subtitle: { fontSize: 13 },
  group: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  groupTitle: { fontWeight: "800", fontSize: 14 },
  groupMeta: { fontSize: 12 },
  linkRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  linkTitle: { fontWeight: "700", fontSize: 15 },
  linkChevron: { fontWeight: "800", fontSize: 18, lineHeight: 18 },
});
