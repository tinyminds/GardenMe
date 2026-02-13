import { Link } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { SqliteGardenTaskRepository } from "@/infra/repositories/sqlite/SqliteGardenTaskRepository";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/ui/theme/ThemeProvider";

const taskRepository = new SqliteGardenTaskRepository();

export function PersistentNav() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);

  const unseenCountQuery = useQuery({
    queryKey: ["tasks-unseen-count", selectedGardenId],
    enabled: Boolean(selectedGardenId),
    queryFn: async () => {
      if (!selectedGardenId) return 0;
      return taskRepository.countOpenUnseenByGarden(selectedGardenId);
    },
  });
  const unseenCount = unseenCountQuery.data ?? 0;

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingBottom: Math.max(insets.bottom, 10),
          borderTopColor: theme.borderColor,
          backgroundColor: theme.surfaceBackground,
        },
      ]}
    >
      <View style={styles.row}>
        <Link href="/(tabs)" style={styles.link}><Text style={[styles.text, { color: theme.textPrimary }]}>Home</Text></Link>
        <Link href="/(tabs)/plan" style={styles.link}><Text style={[styles.text, { color: theme.textPrimary }]}>Workspace</Text></Link>
        <Link href="/(tabs)/tasks" style={styles.link}>
          <View style={styles.taskLink}>
            <Text style={[styles.text, { color: theme.textPrimary }]}>Tasks</Text>
            {unseenCount > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.primaryActionBackground }]}>
                <Text style={[styles.badgeText, { color: theme.primaryActionText }]}>{unseenCount}</Text>
              </View>
            ) : null}
          </View>
        </Link>
        <Link href="/(tabs)/settings" style={styles.link}><Text style={[styles.text, { color: theme.textPrimary }]}>Settings</Text></Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  link: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  taskLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  badge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10, fontWeight: "800" },
  text: {
    fontWeight: "700",
    fontSize: 12,
  },
});
