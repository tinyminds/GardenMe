import { Link } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useGardensQuery } from "@/features/gardens/hooks/useGardensQuery";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { queryClient } from "@/state/queryClient";

const repository = new SqliteGardenRepository();

export default function GardensTabScreen() {
  const { data, isLoading, isError } = useGardensQuery();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repository.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
    },
  });

  const confirmDelete = (id: string, name: string) => {
    Alert.alert("Delete garden", `Delete \"${name}\" and all beds/features?`, [
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
        data={data ?? []}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.state}>No gardens yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Link href={`/gardens/${item.id}`} asChild>
              <Pressable style={styles.cardMain}>
                <Text style={styles.name}>{item.name}</Text>
                <Text>{item.locationLabel ?? `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`}</Text>
              </Pressable>
            </Link>
            <Pressable style={styles.deleteButton} onPress={() => confirmDelete(item.id, item.name)}>
              <Text style={styles.deleteButtonText}>Delete</Text>
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
  card: { backgroundColor: "#EAF3E8", borderRadius: 12, marginBottom: 10, overflow: "hidden" },
  cardMain: { padding: 14 },
  name: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  deleteButton: { borderTopWidth: 1, borderTopColor: "#D7E6D6", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#FBE7E2" },
  deleteButtonText: { color: "#8A2D1C", fontWeight: "700" },
  state: { padding: 20 },
});
