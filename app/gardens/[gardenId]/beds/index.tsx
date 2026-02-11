import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { queryClient } from "@/state/queryClient";
import type { Bed } from "@/domain/entities/Bed";

const bedRepository = new SqliteBedRepository();
const wishlistRepository = new SqliteGardenCropWishlistRepository();

type BedDraft = {
  containsPerennials: boolean;
  perennialPlantNames: string[];
};

export default function BedsListScreen() {
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;
  const [bedDrafts, setBedDrafts] = useState<Record<string, BedDraft>>({});

  const bedsQuery = useQuery({
    queryKey: ["beds", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing gardenId");
      return bedRepository.listByGarden(gardenId);
    },
  });

  const wishlistQuery = useQuery({
    queryKey: ["garden-grow-list", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) return [];
      return wishlistRepository.listByGarden(gardenId);
    },
  });

  const perennialOptions = useMemo(
    () =>
      Array.from(
        new Set((wishlistQuery.data ?? []).map((item) => item.plant.commonName.trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [wishlistQuery.data]
  );

  useEffect(() => {
    const next: Record<string, BedDraft> = {};
    for (const bed of bedsQuery.data ?? []) {
      next[bed.id] = {
        containsPerennials: bed.containsPerennials,
        perennialPlantNames: parsePerennialPlants(bed.perennialPlantsCsv),
      };
    }
    setBedDrafts((prev) => (areBedDraftsEqual(prev, next) ? prev : next));
  }, [bedsQuery.data]);

  const saveBedMutation = useMutation({
    mutationFn: async (bedId: string) => {
      const existing = (bedsQuery.data ?? []).find((bed) => bed.id === bedId);
      const draft = bedDrafts[bedId];
      if (!existing || !draft) return;

      const perennialCsv = serializePerennialPlants(draft.perennialPlantNames);
      const payload: Bed = {
        id: existing.id,
        gardenId: existing.gardenId,
        name: existing.name,
        polygon: existing.polygon,
        sunExposure: existing.sunExposure,
        drainage: existing.drainage,
        containsPerennials: draft.containsPerennials,
        isRaisedBed: existing.isRaisedBed,
        hasIrrigation: existing.hasIrrigation,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        ...(existing.soilNotes ? { soilNotes: existing.soilNotes } : {}),
        ...(draft.containsPerennials && perennialCsv ? { perennialPlantsCsv: perennialCsv } : {}),
      };
      await bedRepository.update(payload);

      const allEntries = wishlistQuery.data ?? [];
      const selectedPerennials = new Set(
        (draft.containsPerennials ? draft.perennialPlantNames : []).map(normalizePlantName)
      );
      const entriesInBed = allEntries.filter(
        (item) => item.status === "already_growing" && item.bedId === bedId
      );

      for (const entry of entriesInBed) {
        const isPerennial = selectedPerennials.has(normalizePlantName(entry.plant.commonName));
        await wishlistRepository.update({
          id: entry.id,
          status: "already_growing",
          bedId,
          isPerennial,
          ...(entry.varietyName ? { varietyName: entry.varietyName } : {}),
          ...(entry.supportNeeded ? { supportNeeded: true } : { supportNeeded: false }),
        });
      }

      for (const perennialName of selectedPerennials) {
        const alreadyPresent = entriesInBed.some(
          (entry) => normalizePlantName(entry.plant.commonName) === perennialName
        );
        if (alreadyPresent) continue;
        const source = allEntries.find(
          (entry) => normalizePlantName(entry.plant.commonName) === perennialName
        );
        if (!source) continue;
        await wishlistRepository.add({
          gardenId: existing.gardenId,
          plantCatalogId: source.plantCatalogId,
          status: "already_growing",
          bedId,
          isPerennial: true,
          ...(source.varietyName ? { varietyName: source.varietyName } : {}),
          ...(source.supportNeeded ? { supportNeeded: true } : { supportNeeded: false }),
        });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
    },
  });

  return (
    <View style={styles.page}>
      <View style={styles.container}>
        <Text style={styles.title}>Beds</Text>
        <Text style={styles.subtitle}>Set perennial beds here. Perennial beds are excluded from seasonal suggestions.</Text>
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
                <Text style={styles.meta}>{item.sunExposure} - {item.drainage}</Text>
                <Text style={styles.meta}>Points: {item.polygon.length}</Text>

                <View style={styles.controls}>
                  <Text style={styles.label}>Contains Perennials</Text>
                  <View style={styles.chips}>
                    {["yes", "no"].map((option) => {
                      const selected = (bedDrafts[item.id]?.containsPerennials ?? false) === (option === "yes");
                      return (
                        <Pressable
                          key={`${item.id}-${option}`}
                          style={[styles.chip, selected && styles.chipActive]}
                          onPress={() =>
                            setBedDrafts((prev) => ({
                              ...prev,
                              [item.id]: {
                                containsPerennials: option === "yes",
                                perennialPlantNames: option === "yes" ? (prev[item.id]?.perennialPlantNames ?? []) : [],
                              },
                            }))
                          }
                        >
                          <Text style={styles.chipText}>{option}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {(bedDrafts[item.id]?.containsPerennials ?? false) && (
                  <View style={styles.controls}>
                    <Text style={styles.label}>Perennial Plants</Text>
                    {perennialOptions.length === 0 ? (
                      <Text style={styles.empty}>No Grow List plants yet. Add plants in Grow List first.</Text>
                    ) : (
                      <View style={styles.chips}>
                        {perennialOptions.map((plantName) => {
                          const selected = bedDrafts[item.id]?.perennialPlantNames.includes(plantName) ?? false;
                          return (
                            <Pressable
                              key={`${item.id}-${plantName}`}
                              style={[styles.chip, selected && styles.chipActive]}
                              onPress={() =>
                                setBedDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: {
                                    containsPerennials: true,
                                    perennialPlantNames: togglePlantName(prev[item.id]?.perennialPlantNames ?? [], plantName),
                                  },
                                }))
                              }
                            >
                              <Text style={styles.chipText}>{plantName}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}

                <Pressable
                  style={styles.saveButton}
                  onPress={() => saveBedMutation.mutate(item.id)}
                  disabled={saveBedMutation.isPending}
                >
                  <Text style={styles.saveButtonText}>Save Perennial Settings</Text>
                </Pressable>
              </View>
            )}
          />
        )}
      </View>
    </View>
  );
}

function parsePerennialPlants(csv: string | undefined): string[] {
  if (!csv) return [];
  return Array.from(
    new Set(
      csv
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function serializePerennialPlants(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join(", ");
}

function togglePlantName(values: string[], plantName: string): string[] {
  return values.includes(plantName)
    ? values.filter((value) => value !== plantName)
    : [...values, plantName];
}

function normalizePlantName(value: string): string {
  return value.trim().toLowerCase();
}

function areBedDraftsEqual(a: Record<string, BedDraft>, b: Record<string, BedDraft>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const left = a[key];
    const right = b[key];
    if (!left || !right) return false;
    if (left.containsPerennials !== right.containsPerennials) return false;
    if (serializePerennialPlants(left.perennialPlantNames) !== serializePerennialPlants(right.perennialPlantNames)) {
      return false;
    }
  }
  return true;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F6FAF5" },
  container: { flex: 1, padding: 16, gap: 10, backgroundColor: "#F6FAF5" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  subtitle: { color: "#4F6658", marginTop: -8, marginBottom: 4 },
  row: { padding: 12, backgroundColor: "#E9F3E8", borderRadius: 10, marginBottom: 8 },
  name: { fontSize: 16, fontWeight: "700" },
  meta: { color: "#4D6256" },
  empty: { color: "#54645A" },
  controls: { marginTop: 8, gap: 6 },
  label: { color: "#244130", fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#D9E7D8",
  },
  chipActive: { backgroundColor: "#9BC8A4" },
  chipText: { color: "#264433", textTransform: "capitalize" },
  saveButton: {
    marginTop: 10,
    backgroundColor: "#275C3F",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  saveButtonText: { color: "#FFFFFF", fontWeight: "700" },
});
