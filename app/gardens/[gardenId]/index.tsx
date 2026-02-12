import { Link, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { useTheme } from "@/ui/theme/ThemeProvider";

const gardenRepository = new SqliteGardenRepository();
const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();
const wishlistRepository = new SqliteGardenCropWishlistRepository();

type StepStatus = "done" | "in_progress" | "start" | "blocked";

export default function GardenDetailScreen() {
  const { theme } = useTheme();
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

  const wishlistQuery = useQuery({
    queryKey: ["garden-grow-list", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) return [];
      return wishlistRepository.listByGarden(gardenId);
    },
  });

  const garden = gardenQuery.data;
  const bedCount = bedsQuery.data?.length ?? 0;
  const featureCount = featuresQuery.data?.length ?? 0;
  const wishlistCount = wishlistQuery.data?.length ?? 0;
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
          helper: hasMappedContent ? `${bedCount} beds | ${featureCount} features` : "Add beds and features",
          status: hasMappedContent ? ("in_progress" as StepStatus) : hasSetup ? ("start" as StepStatus) : ("blocked" as StepStatus),
        },
        {
          href: `/gardens/${gardenId}/beds`,
          title: "Beds List",
          helper: bedCount > 0 ? `${bedCount} beds ready to review` : "No beds yet",
          status: bedCount > 0 ? ("in_progress" as StepStatus) : hasMappedContent ? ("start" as StepStatus) : ("blocked" as StepStatus),
        },
        {
          href: `/gardens/${gardenId}/grow`,
          title: "Grow List",
          helper: wishlistCount > 0 ? `${wishlistCount} plants shortlisted` : "Choose crops to grow this season",
          status: wishlistCount > 0 ? ("in_progress" as StepStatus) : hasSetup ? ("start" as StepStatus) : ("blocked" as StepStatus),
        },
      ]
    : [];

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <View style={[styles.container, { backgroundColor: theme.appBackground }]}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Garden Workspace</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>Move through setup, mapping, and review without losing context.</Text>

        {gardenId ? (
          <>
            {garden && (
              <View style={[styles.summaryCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
                <Text style={[styles.summaryName, { color: theme.textPrimary }]}>{garden.name}</Text>
                <Text style={[styles.summaryMeta, { color: theme.textMuted }]}>
                  {garden.locationLabel ?? `${garden.latitude.toFixed(5)}, ${garden.longitude.toFixed(5)}`}
                </Text>
                <Text style={[styles.summaryMeta, { color: theme.textMuted }]}>
                  Area {garden.scaleCalibration?.boundaryAreaSqM ? `${garden.scaleCalibration.boundaryAreaSqM.toFixed(1)} sqm` : "not set"}
                  {" | "}Beds {bedCount}
                  {" | "}Features {featureCount}
                  {" | "}Grow list {wishlistCount}
                </Text>
              </View>
            )}

            {steps.map((step) => (
              <Link
                key={step.href}
                href={step.href}
                style={[styles.stepLink, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}
              >
                <View style={styles.stepRow}>
                  <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>{step.title}</Text>
                  <Text
                    style={[
                      styles.stepStatus,
                      {
                        backgroundColor:
                          step.status === "done"
                            ? theme.secondaryActionBackground
                            : step.status === "in_progress"
                              ? theme.secondaryActionBackground
                              : step.status === "blocked"
                                ? theme.disabledActionBackground
                                : theme.secondaryActionBackground,
                        color:
                          step.status === "blocked" ? theme.disabledActionText : theme.secondaryActionText,
                      },
                    ]}
                  >
                    {step.status === "done"
                      ? "\u2713 Done"
                      : step.status === "in_progress"
                        ? "In progress"
                        : step.status === "blocked"
                          ? "Not ready"
                          : "Start"}
                  </Text>
                </View>
                <Text style={[styles.stepHelper, { color: theme.textMuted }]}>{step.helper}</Text>
              </Link>
            ))}
          </>
        ) : (
          <Text style={[styles.errorText, { color: theme.textMuted }]}>Missing garden id</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 10 },
  title: { fontSize: 26, fontWeight: "800", marginBottom: 6 },
  subtitle: { marginBottom: 4 },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  summaryName: { fontSize: 18, fontWeight: "800" },
  summaryMeta: {},
  stepLink: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    overflow: "hidden",
    gap: 6,
  },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  stepTitle: { fontWeight: "800", fontSize: 16, flex: 1, paddingRight: 6 },
  stepHelper: { fontWeight: "600", marginTop: 2 },
  stepStatus: {
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
  errorText: { fontWeight: "700" },
});

