import { Link } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useGardensQuery } from "@/features/gardens/hooks/useGardensQuery";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { useTheme } from "@/ui/theme/ThemeProvider";

const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();
const growRepository = new SqliteGardenCropWishlistRepository();

export default function PlanTabScreen() {
  const { theme } = useTheme();
  const gardensQuery = useGardensQuery();
  const gardens = gardensQuery.data ?? [];
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);

  useEffect(() => {
    if (selectedGardenId && gardens.some((g) => g.id === selectedGardenId)) return;
    setSelectedGardenId(gardens[0]?.id ?? null);
  }, [gardens, selectedGardenId, setSelectedGardenId]);

  const selectedGarden = gardens.find((g) => g.id === selectedGardenId) ?? null;

  const bedsQuery = useQuery({
    queryKey: ["beds", selectedGardenId],
    enabled: Boolean(selectedGardenId),
    queryFn: async () => {
      if (!selectedGardenId) return [];
      return bedRepository.listByGarden(selectedGardenId);
    },
  });

  const featuresQuery = useQuery({
    queryKey: ["garden-features", selectedGardenId],
    enabled: Boolean(selectedGardenId),
    queryFn: async () => {
      if (!selectedGardenId) return [];
      return featureRepository.listByGarden(selectedGardenId);
    },
  });

  const growQuery = useQuery({
    queryKey: ["garden-grow-list", selectedGardenId],
    enabled: Boolean(selectedGardenId),
    queryFn: async () => {
      if (!selectedGardenId) return [];
      return growRepository.listByGarden(selectedGardenId);
    },
  });

  const bedCount = (bedsQuery.data ?? []).length;
  const featureCount = (featuresQuery.data ?? []).length;
  const wantedCount = (growQuery.data ?? []).filter((entry) => entry.status === "wanted").length;
  const growingCount = (growQuery.data ?? []).filter((entry) => entry.status === "already_growing").length;
  const perennialBedCount = (bedsQuery.data ?? []).filter((bed) => bed.containsPerennials).length;

  return (
    <ScrollView style={[styles.page, { backgroundColor: theme.appBackground }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Plan</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>One place for setup, mapping, beds, and growing plan.</Text>

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Garden</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {gardens.map((garden) => {
            const selected = garden.id === selectedGardenId;
            return (
              <Text
                key={garden.id}
                onPress={() => setSelectedGardenId(garden.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? theme.primaryActionBackground : theme.secondaryActionBackground,
                    color: selected ? theme.primaryActionText : theme.secondaryActionText,
                  },
                ]}
              >
                {garden.name}
              </Text>
            );
          })}
        </ScrollView>
      </View>

      {!selectedGarden ? (
        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.state, { color: theme.textMuted }]}>No gardens yet.</Text>
          <Link
            href="/gardens/new"
            style={[styles.primaryLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}
          >
            Create Garden
          </Link>
        </View>
      ) : (
        <>
          <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{selectedGarden.name}</Text>
            <Text style={[styles.metric, { color: theme.textMuted }]}>
              Area {selectedGarden.scaleCalibration?.boundaryAreaSqM ? `${selectedGarden.scaleCalibration.boundaryAreaSqM.toFixed(1)} sqm` : "not set"}
            </Text>
            <Text style={[styles.metric, { color: theme.textMuted }]}>Beds {bedCount} · Features {featureCount}</Text>
            <Text style={[styles.metric, { color: theme.textMuted }]}>Wanted {wantedCount} · Growing {growingCount}</Text>
            <Text style={[styles.metric, { color: theme.textMuted }]}>Perennial beds {perennialBedCount}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Build</Text>
            <Link
              href={`/gardens/${selectedGarden.id}/setup`}
              style={[styles.primaryLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}
            >
              Setup & Scale
            </Link>
            <Link
              href={`/gardens/${selectedGarden.id}/map`}
              style={[styles.primaryLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}
            >
              Garden Mapper
            </Link>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Planting</Text>
            <Link
              href={`/gardens/${selectedGarden.id}/grow`}
              style={[styles.primaryLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}
            >
              Grow List
            </Link>
            <Link
              href={`/gardens/${selectedGarden.id}/beds`}
              style={[styles.primaryLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}
            >
              Bed Planner
            </Link>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 14, gap: 10, paddingBottom: 120 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: {},
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  cardTitle: { fontWeight: "800" },
  chipRow: { gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: "hidden",
    fontWeight: "700",
  },
  metric: { fontWeight: "600" },
  state: {},
  primaryLink: {
    fontWeight: "800",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
    textAlign: "center",
  },
});

