import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/ui/theme/ThemeProvider";

export function PersistentNav() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

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
        <Link href="/(tabs)/gardens" style={styles.link}><Text style={[styles.text, { color: theme.textPrimary }]}>Gardens</Text></Link>
        <Link href="/(tabs)/plan" style={styles.link}><Text style={[styles.text, { color: theme.textPrimary }]}>Plan</Text></Link>
        <Link href="/(tabs)/tasks" style={styles.link}><Text style={[styles.text, { color: theme.textPrimary }]}>Tasks</Text></Link>
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
  text: {
    fontWeight: "700",
    fontSize: 12,
  },
});
