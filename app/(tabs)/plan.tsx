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
import { SegmentedChoice } from "@/ui/components/SegmentedChoice";

const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();
const growRepository = new SqliteGardenCropWishlistRepository();

type StepState = "not_ready" | "start" | "in_progress" | "done";

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
  const activeGardenId = selectedGarden?.id ?? null;

  const bedsQuery = useQuery({
    queryKey: ["beds", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return bedRepository.listByGarden(activeGardenId);
    },
  });

  const featuresQuery = useQuery({
    queryKey: ["garden-features", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return featureRepository.listByGarden(activeGardenId);
    },
  });

  const growQuery = useQuery({
    queryKey: ["garden-grow-list", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return growRepository.listByGarden(activeGardenId);
    },
  });

  const bedCount = (bedsQuery.data ?? []).length;
  const featureCount = (featuresQuery.data ?? []).length;
  const growList = growQuery.data ?? [];
  const growCount = growList.length;
  const plannedCount = growList.filter((entry) => entry.status === "wanted").length;
  const growingCount = growList.filter((entry) => entry.status === "already_growing").length;
  const placedCount = growList.filter((entry) => Boolean(entry.bedId)).length;
  const hasSetup = Boolean(selectedGarden?.scaleCalibration);
  const hasDesign = bedCount + featureCount > 0;

  const setupState: StepState = hasSetup ? "done" : "start";
  const designState: StepState = !hasSetup ? "not_ready" : hasDesign ? "done" : "start";
  const growState: StepState = !hasSetup ? "not_ready" : growCount > 0 ? "in_progress" : "start";
  const bedsReady = bedCount > 0 && growCount > 0;
  const bedsDone = bedsReady && placedCount === growCount;
  const bedsState: StepState = !bedsReady ? "not_ready" : bedsDone ? "done" : "in_progress";

  return (
    <ScrollView style={[styles.page, { backgroundColor: theme.appBackground }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Workspace</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>Build and plant in order. Each step shows what is next.</Text>

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Active Garden</Text>
        <SegmentedChoice
          options={gardens.map((garden) => ({ id: garden.id, label: garden.name }))}
          selectedId={activeGardenId}
          onSelect={setSelectedGardenId}
        />
      </View>

      {!selectedGarden ? (
        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.state, { color: theme.textMuted }]}>No gardens yet.</Text>
          <Link href="/gardens/new" style={[styles.primaryLink, { backgroundColor: theme.primaryActionBackground, borderColor: theme.primaryActionBackground, color: theme.primaryActionText }]}>
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
            <Text style={[styles.metric, { color: theme.textMuted }]}>Beds {bedCount} | Features {featureCount}</Text>
            <Text style={[styles.metric, { color: theme.textMuted }]}>Grow list {growCount} | Planned {plannedCount} | Growing {growingCount}</Text>
          </View>

          <StepCard
            title="1. Garden Setup"
            helper={hasSetup ? "Boundary and scale saved." : "Set location, boundary, and scale."}
            href={`/gardens/${selectedGarden.id}/setup`}
            state={setupState}
          />
          <StepCard
            title="2. Garden Design"
            helper={hasDesign ? `${bedCount} beds and ${featureCount} features mapped.` : "Map your beds and garden features."}
            href={`/gardens/${selectedGarden.id}/map`}
            state={designState}
          />
          <StepCard
            title="3. Grow List"
            helper={growCount > 0 ? `${growCount} plants added.` : "Add the plants you want to grow."}
            href={`/gardens/${selectedGarden.id}/grow`}
            state={growState}
          />
          <StepCard
            title="4. Bed Planner"
            helper={
              bedsReady
                ? bedsDone
                  ? `${placedCount}/${growCount} plants positioned in beds.`
                  : `${placedCount}/${growCount} plants positioned in beds.`
                : "Add beds and grow list plants first."
            }
            href={`/gardens/${selectedGarden.id}/beds`}
            state={bedsState}
          />
        </>
      )}
    </ScrollView>
  );
}

function StepCard(props: { title: string; helper: string; href: string; state: StepState }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
      <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{props.title}</Text>
      <Text style={[styles.metric, { color: theme.textMuted }]}>{props.helper}</Text>
      <Link
        href={props.href}
        style={[
          styles.primaryLink,
          {
            backgroundColor: props.state === "not_ready" ? theme.disabledActionBackground : theme.primaryActionBackground,
            borderColor: props.state === "not_ready" ? theme.disabledActionBackground : theme.primaryActionBackground,
            color: props.state === "not_ready" ? theme.disabledActionText : theme.primaryActionText,
          },
        ]}
      >
        {getStepStatus(props.state)}
      </Link>
    </View>
  );
}

function getStepStatus(state: StepState): string {
  if (state === "done") return "Review";
  if (state === "in_progress") return "Continue";
  if (state === "not_ready") return "Not ready";
  return "Start";
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
  metric: { fontWeight: "600" },
  state: {},
  primaryLink: {
    fontWeight: "800",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
    textAlign: "center",
  },
});
