import { Link, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function GardenDetailScreen() {
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;

  return (
    <View style={styles.page}>
      <View style={styles.container}>
        <Text style={styles.title}>Garden Workspace</Text>
        <Text style={styles.subtitle}>Start with setup/calibration, then map beds with rough real-world area.</Text>
        {gardenId ? (
          <>
            <Link href={`/gardens/${gardenId}/setup`} style={styles.primaryLink}>Start Setup (Scale)</Link>
            <Link href={`/gardens/${gardenId}/map`} style={styles.link}>Open Garden Mapper</Link>
            <Link href={`/gardens/${gardenId}/beds`} style={styles.link}>View Beds List</Link>
          </>
        ) : (
          <Text style={styles.errorText}>Missing garden id</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F0F6EE" },
  container: { flex: 1, padding: 16, backgroundColor: "#F0F6EE" },
  title: { fontSize: 26, fontWeight: "800", marginBottom: 6, color: "#1D3D2A" },
  subtitle: { color: "#4A6553", marginBottom: 14 },
  primaryLink: {
    color: "#FFFFFF",
    fontWeight: "700",
    backgroundColor: "#2F6F4F",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 10,
  },
  link: { color: "#2F6F4F", fontWeight: "700", marginBottom: 6 },
  errorText: { color: "#A0382B", fontWeight: "700" },
});
