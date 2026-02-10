import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>GardenMe</Text>
      <Text style={styles.subtitle}>Start here: create a garden, set scale, then map zones.</Text>
      <Link href="/(tabs)/gardens" style={styles.primaryLink}>Start Setup</Link>
      <Link href="/(tabs)/gardens" style={styles.link}>Open Gardens</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: "center", gap: 8 },
  title: { fontSize: 32, fontWeight: "700", color: "#224F37" },
  subtitle: { fontSize: 16, color: "#4A5B50" },
  primaryLink: {
    fontSize: 16,
    color: "#fff",
    fontWeight: "700",
    backgroundColor: "#2F6F4F",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    overflow: "hidden",
  },
  link: { fontSize: 16, color: "#2F6F4F", fontWeight: "600" },
});
