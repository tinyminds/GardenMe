import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";

const repository = new SqliteBedRepository();

export default function BedsListScreen() {
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;

  const bedsQuery = useQuery({
    queryKey: ["beds", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing gardenId");
      return repository.listByGarden(gardenId);
    },
  });

  return (
    <View style={styles.page}>
      <View style={styles.container}>
        <Text style={styles.title}>Beds</Text>
        {bedsQuery.isLoading && <Text style={styles.empty}>Loading beds...</Text>}
        {bedsQuery.isError && <Text style={styles.empty}>Could not load beds.</Text>}
        {!bedsQuery.isLoading && !bedsQuery.isError && (
          <FlatList
            data={bedsQuery.data ?? []}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={<Text style={styles.empty}>No beds yet. Add beds in Garden Mapper.</Text>}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>{item.sunExposure} · {item.drainage}</Text>
                <Text style={styles.meta}>Points: {item.polygon.length}</Text>
              </View>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F6FAF5" },
  container: { flex: 1, padding: 16, backgroundColor: "#F6FAF5" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  row: { padding: 12, backgroundColor: "#E9F3E8", borderRadius: 10, marginBottom: 8 },
  name: { fontSize: 16, fontWeight: "700" },
  meta: { color: "#4D6256" },
  empty: { color: "#54645A" },
});
