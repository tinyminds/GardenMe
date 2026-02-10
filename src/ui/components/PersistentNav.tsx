import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function PersistentNav() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.row}>
        <Link href="/(tabs)" style={styles.link}><Text style={styles.text}>Home</Text></Link>
        <Link href="/(tabs)/gardens" style={styles.link}><Text style={styles.text}>Gardens</Text></Link>
        <Link href="/(tabs)/planner" style={styles.link}><Text style={styles.text}>Planner</Text></Link>
        <Link href="/(tabs)/tasks" style={styles.link}><Text style={styles.text}>Tasks</Text></Link>
        <Link href="/(tabs)/settings" style={styles.link}><Text style={styles.text}>Settings</Text></Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: "#D7E2D5",
    backgroundColor: "#FFFFFF",
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
    color: "#2A4B39",
    fontWeight: "700",
    fontSize: 12,
  },
});
