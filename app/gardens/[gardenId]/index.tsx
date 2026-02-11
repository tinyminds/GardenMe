import { Link, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";

const gardenRepository = new SqliteGardenRepository();
const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();

type StepStatus = "done" | "in_progress" | "start" | "blocked";

export default function GardenDetailScreen() {
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;

  const gardenQuery = useQuery({
    queryKey: ["garden", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing garden id");
      return gardenRepository.getById(gardenId);
    },
  });

  const bedsQuery = useQuery({
    queryKey: ["beds", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) return [];
      return bedRepository.listByGarden(gardenId);
    },
  });

  const featuresQuery = useQuery({
    queryKey: ["garden-features", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) return [];
      return featureRepository.listByGarden(gardenId);
    },
  });

  const garden = gardenQuery.data;
  const bedCount = bedsQuery.data?.length ?? 0;
  const featureCount = featuresQuery.data?.length ?? 0;
  const hasSetup = Boolean(garden?.scaleCalibration);
  const hasMappedContent = bedCount + featureCount > 0;

  const steps = gardenId
    ? [
        {
          href: `/gardens/${gardenId}/setup`,
          title: "Setup and Scale",
          helper: hasSetup
            ? `Area ${garden?.scaleCalibration?.boundaryAreaSqM?.toFixed(1) ?? "?"} sqm`
            : "Set boundary and calibration",
          status: hasSetup ? ("done" as StepStatus) : ("start" as StepStatus),
        },
        {
          href: `/gardens/${gardenId}/map`,
          title: "Garden Mapper",
          helper: hasMappedContent ? `${bedCount} beds · ${featureCount} features` : "Add beds and features",
          status: hasMappedContent ? ("in_progress" as StepStatus) : hasSetup ? ("start" as StepStatus) : ("blocked" as StepStatus),
        },
        {
          href: `/gardens/${gardenId}/beds`,
          title: "Beds List",
          helper: bedCount > 0 ? `${bedCount} beds ready to review` : "No beds yet",
          status: bedCount > 0 ? ("in_progress" as StepStatus) : hasMappedContent ? ("start" as StepStatus) : ("blocked" as StepStatus),
        },
      ]
    : [];

  return (
    <View style={styles.page}>
      <View style={styles.container}>
        <Text style={styles.title}>Garden Workspace</Text>
        <Text style={styles.subtitle}>Move through setup, mapping, and review without losing context.</Text>

        {gardenId ? (
          <>
            {garden && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryName}>{garden.name}</Text>
                <Text style={styles.summaryMeta}>
                  {garden.locationLabel ?? `${garden.latitude.toFixed(5)}, ${garden.longitude.toFixed(5)}`}
                </Text>
                <Text style={styles.summaryMeta}>
                  Area {garden.scaleCalibration?.boundaryAreaSqM ? `${garden.scaleCalibration.boundaryAreaSqM.toFixed(1)} sqm` : "not set"}
                  {" · "}Beds {bedCount}
                  {" · "}Features {featureCount}
                </Text>
              </View>
            )}

            {steps.map((step) => (
              <Link key={step.href} href={step.href} style={styles.stepLink}>
                <View style={styles.stepRow}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text
                    style={[
                      styles.stepStatus,
                      step.status === "done" && styles.stepStatusDone,
                      step.status === "in_progress" && styles.stepStatusProgress,
                      step.status === "blocked" && styles.stepStatusBlocked,
                    ]}
                  >
                    {step.status === "done"
                      ? "✓ Done"
                      : step.status === "in_progress"
                        ? "In progress"
                        : step.status === "blocked"
                          ? "Not ready"
                          : "Start"}
                  </Text>
                </View>
                <Text style={styles.stepHelper}>{step.helper}</Text>
              </Link>
            ))}
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
  container: { flex: 1, padding: 16, backgroundColor: "#F0F6EE", gap: 10 },
  title: { fontSize: 26, fontWeight: "800", marginBottom: 6, color: "#1D3D2A" },
  subtitle: { color: "#4A6553", marginBottom: 4 },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D8E5D5",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  summaryName: { color: "#1E402C", fontSize: 18, fontWeight: "800" },
  summaryMeta: { color: "#4E6857" },
  stepLink: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D8E5D5",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    overflow: "hidden",
    gap: 6,
  },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  stepTitle: { color: "#23412E", fontWeight: "800", fontSize: 16, flex: 1, paddingRight: 6 },
  stepHelper: { color: "#4E6857", fontWeight: "600", marginTop: 2 },
  stepStatus: {
    backgroundColor: "#E4EFE3",
    color: "#2F6F4F",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: "hidden",
    fontWeight: "700",
    fontSize: 12,
    textAlign: "center",
    alignSelf: "flex-start",
    minWidth: 84,
  },
  stepStatusDone: { backgroundColor: "#D3E9DA", color: "#1E5A37" },
  stepStatusProgress: { backgroundColor: "#E0ECDD", color: "#325746" },
  stepStatusBlocked: { backgroundColor: "#ECECEC", color: "#5E6761" },
  errorText: { color: "#A0382B", fontWeight: "700" },
});
