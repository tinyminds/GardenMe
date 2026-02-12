import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";

export default function SettingsTabScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Settings</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          Manage app preferences and appearance.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/styleguide")}
          style={[styles.linkRow, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}
        >
          <Text style={[styles.linkTitle, { color: theme.textPrimary }]}>Styleguide</Text>
          <Text style={[styles.linkChevron, { color: theme.textMuted }]}>›</Text>
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
