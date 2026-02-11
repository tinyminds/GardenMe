import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useGardensQuery } from "@/features/gardens/hooks/useGardensQuery";
import { useGardenSummariesQuery } from "@/features/gardens/hooks/useGardenSummariesQuery";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";

export default function DashboardScreen() {
  const gardensQuery = useGardensQuery();
  const gardens = gardensQuery.data ?? [];
  const summariesQuery = useGardenSummariesQuery(gardens);
  const summaries = summariesQuery.data ?? {};
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);

  const selectedGarden = gardens.find((garden) => garden.id === selectedGardenId) ?? gardens[0] ?? null;

  const totalBeds = gardens.reduce((sum, garden) => sum + (summaries[garden.id]?.bedCount ?? 0), 0);
  const mappedGardens = gardens.reduce((sum, garden) => {
    const bedCount = summaries[garden.id]?.bedCount ?? 0;
    const featureCount = summaries[garden.id]?.featureCount ?? 0;
    return sum + (bedCount + featureCount > 0 ? 1 : 0);
  }, 0);
  const totalAreaSqM = gardens.reduce((sum, garden) => sum + (garden.scaleCalibration?.boundaryAreaSqM ?? 0), 0);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>GardenMe</Text>
      <Text style={styles.subtitle}>Plan smarter with one quick view of progress and next steps.</Text>

      <View style={styles.metricsRow}>
        <MetricCard label="Gardens" value={gardens.length.toString()} />
        <MetricCard label="Mapped" value={mappedGardens.toString()} />
      </View>
      <View style={styles.metricsRow}>
        <MetricCard label="Beds" value={totalBeds.toString()} />
        <MetricCard label="Total Area" value={totalAreaSqM > 0 ? `${totalAreaSqM.toFixed(1)} sqm` : "-"} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quick Actions</Text>
        <Link href="/gardens/new" style={styles.primaryLink}>+ New Garden</Link>
        <Link href="/(tabs)/gardens" style={styles.secondaryLink}>Open Gardens</Link>
        <Link href="/(tabs)/planner" style={styles.secondaryLink}>Open Planner</Link>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Current Garden</Text>
        {!selectedGarden && <Text style={styles.helper}>No gardens yet. Create one to get started.</Text>}
        {selectedGarden && (
          <>
            <Text style={styles.gardenName}>{selectedGarden.name}</Text>
            <Text style={styles.helper}>
              {selectedGarden.locationLabel ?? `${selectedGarden.latitude.toFixed(4)}, ${selectedGarden.longitude.toFixed(4)}`}
            </Text>
            <Text style={styles.helper}>
              Area {selectedGarden.scaleCalibration?.boundaryAreaSqM ? `${selectedGarden.scaleCalibration.boundaryAreaSqM.toFixed(1)} sqm` : "not set"}
              {" · "}Beds {summaries[selectedGarden.id]?.bedCount ?? 0}
              {" · "}Features {summaries[selectedGarden.id]?.featureCount ?? 0}
            </Text>
            <View style={styles.inlineActions}>
              <Link href={`/gardens/${selectedGarden.id}/setup`} style={styles.secondaryLinkSmall}>Setup</Link>
              <Link href={`/gardens/${selectedGarden.id}/map`} style={styles.secondaryLinkSmall}>Mapper</Link>
              <Pressable onPress={() => setSelectedGardenId(selectedGarden.id)}>
                <Text style={styles.selectText}>Set as current</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function MetricCard(props: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{props.label}</Text>
      <Text style={styles.metricValue}>{props.value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F4F8F3" },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  title: { fontSize: 30, fontWeight: "800", color: "#224F37" },
  subtitle: { fontSize: 15, color: "#4A5B50" },
  metricsRow: { flexDirection: "row", gap: 10 },
  metricCard: {
    flex: 1,
    backgroundColor: "#EAF3E8",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D7E6D6",
    padding: 12,
    gap: 4,
  },
  metricLabel: { color: "#406150", fontWeight: "700", fontSize: 12 },
  metricValue: { color: "#193727", fontWeight: "800", fontSize: 20 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D7E6D6",
    padding: 12,
    gap: 8,
  },
  cardTitle: { color: "#264635", fontWeight: "800" },
  primaryLink: {
    color: "#FFFFFF",
    fontWeight: "800",
    backgroundColor: "#2F6F4F",
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryLink: {
    color: "#24563D",
    fontWeight: "700",
    backgroundColor: "#E4EFE3",
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  gardenName: { fontSize: 20, fontWeight: "800", color: "#1B3D2B" },
  helper: { color: "#4E6857" },
  inlineActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  secondaryLinkSmall: {
    color: "#24563D",
    fontWeight: "700",
    backgroundColor: "#E4EFE3",
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  selectText: { color: "#2F6F4F", fontWeight: "700" },
});
