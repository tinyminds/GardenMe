import { Link } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useGardensQuery } from "@/features/gardens/hooks/useGardensQuery";
import { useGardenSummariesQuery } from "@/features/gardens/hooks/useGardenSummariesQuery";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { queryClient } from "@/state/queryClient";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";

const repository = new SqliteGardenRepository();

export default function GardensTabScreen() {
  const { data, isLoading, isError } = useGardensQuery();
  const gardens = data ?? [];
  const summariesQuery = useGardenSummariesQuery(gardens);
  const summaries = summariesQuery.data ?? {};
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repository.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
    },
  });

  const confirmDelete = (id: string, name: string) => {
    Alert.alert("Delete garden", `Delete "${name}" and all beds/features?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  if (isLoading) return <Text style={styles.state}>Loading gardens...</Text>;
  if (isError) return <Text style={styles.state}>Could not load gardens.</Text>;

  return (
    <View style={styles.container}>
      <Link href="/gardens/new" style={styles.addLink}>+ New Garden</Link>
      <FlatList
        data={gardens}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.state}>No gardens yet.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, selectedGardenId === item.id && styles.cardActive]}>
            <Link href={`/gardens/${item.id}`} asChild>
              <Pressable
                style={styles.cardMain}
                onPress={() => {
                  setSelectedGardenId(item.id);
                }}
              >
                <Text style={styles.name}>{item.name}</Text>
                {item.locationLabel && <Text style={styles.locationText}>{item.locationLabel}</Text>}
                <Text style={styles.coordsText}>
                  Coordinates: {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaChip}>
                    Area {item.scaleCalibration?.boundaryAreaSqM ? `${item.scaleCalibration.boundaryAreaSqM.toFixed(1)} sqm` : "not set"}
                  </Text>
                  <Text style={styles.metaChip}>Beds {summaries[item.id]?.bedCount ?? 0}</Text>
                  <Text style={styles.metaChip}>Features {summaries[item.id]?.featureCount ?? 0}</Text>
                </View>
                <Text style={styles.statusText}>
                  {item.scaleCalibration
                    ? (summaries[item.id]?.bedCount ?? 0) > 0 || (summaries[item.id]?.featureCount ?? 0) > 0
                      ? "Mapped and in progress"
                      : "Setup done, ready to map"
                    : "Needs setup"}
                </Text>
              </Pressable>
            </Link>
            <Pressable style={styles.deleteButton} onPress={() => confirmDelete(item.id, item.name)}>
              <Text style={styles.deleteButtonText}>×</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#F4F8F3" },
  addLink: { color: "#2F6F4F", marginBottom: 12, fontWeight: "700" },
  card: {
    position: "relative",
    backgroundColor: "#EAF3E8",
    borderRadius: 12,
    marginBottom: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#D7E6D6",
  },
  cardActive: { borderColor: "#2F6F4F", borderWidth: 2 },
  cardMain: { padding: 14, paddingRight: 54, gap: 7 },
  name: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  locationText: { color: "#38503F", fontWeight: "600" },
  coordsText: { color: "#617A6A", fontSize: 12, marginTop: -1 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 8, marginTop: 3 },
  metaChip: {
    backgroundColor: "#DCE9DA",
    color: "#284534",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "700",
    alignSelf: "flex-start",
  },
  statusText: { color: "#365648", fontWeight: "700", marginTop: 2 },
  deleteButton: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "#FBE3DE",
    borderWidth: 1,
    borderColor: "#DFA69A",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonText: { color: "#A13422", fontWeight: "800", fontSize: 16, lineHeight: 18 },
  state: { padding: 20 },
});
