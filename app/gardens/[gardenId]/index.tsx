import { Link, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadGardenProgressSettings, saveGardenProgressSettings } from "@/core/settings/gardenProgressSettings";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { queryClient } from "@/state/queryClient";
import { useTheme } from "@/ui/theme/ThemeProvider";

const gardenRepository = new SqliteGardenRepository();
const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();
const wishlistRepository = new SqliteGardenCropWishlistRepository();

type StepStatus = "done" | "in_progress" | "start" | "blocked";

type StepKey = "setup" | "mapper" | "beds" | "grow";

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

  const progressQuery = useQuery({
    queryKey: ["garden-progress-settings"],
    queryFn: loadGardenProgressSettings,
  });

  const progressMutation = useMutation({
    mutationFn: saveGardenProgressSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-progress-settings"] });
    },
  });

  const garden = gardenQuery.data;
  const bedCount = bedsQuery.data?.length ?? 0;
  const featureCount = featuresQuery.data?.length ?? 0;
  const wishlist = wishlistQuery.data ?? [];
  const wishlistCount = wishlist.length;
  const placedWishlistCount = wishlist.filter((item) => Boolean(item.bedId)).length;
  const hasSetup = Boolean(garden?.scaleCalibration);
  const hasMappedContent = bedCount + featureCount > 0;

  const manualFlags = (gardenId ? progressQuery.data?.[gardenId] : undefined) ?? {};
  const mapperAutoDone = hasSetup && bedCount > 0;
  const growAutoDone = wishlistCount > 0;
  const mapperDone = typeof manualFlags.mapperDone === "boolean" ? manualFlags.mapperDone : mapperAutoDone;
  const growDone = typeof manualFlags.growDone === "boolean" ? manualFlags.growDone : growAutoDone;
  const bedsDone = bedCount > 0 && wishlistCount > 0 && placedWishlistCount === wishlistCount;

  const setManualStepDone = (step: "mapperDone" | "growDone", done: boolean) => {
    if (!gardenId) return;
    const all = progressQuery.data ?? {};
    const next = {
      ...all,
      [gardenId]: {
        ...(all[gardenId] ?? {}),
        [step]: done,
      },
    };
    progressMutation.mutate(next);
  };

  const steps: Array<{ href: string; key: StepKey; title: string; helper: string; status: StepStatus }> = gardenId
      ? [
        {
          href: `/gardens/${gardenId}/setup`,
          key: "setup",
          title: "Setup and Scale",
          helper: hasSetup
            ? `Area ${garden?.scaleCalibration?.boundaryAreaSqM?.toFixed(1) ?? "?"} sqm`
            : "Set boundary and calibration",
          status: hasSetup ? "done" : "start",
        },
        {
          href: `/gardens/${gardenId}/map`,
          key: "mapper",
          title: "Garden Mapper",
          helper: hasMappedContent ? `${bedCount} beds | ${featureCount} features` : "Add beds and features",
          status: mapperDone ? "done" : hasMappedContent ? "in_progress" : hasSetup ? "start" : "blocked",
        },
        {
          href: `/gardens/${gardenId}/grow`,
          key: "grow",
          title: "Grow List",
          helper: wishlistCount > 0 ? `${wishlistCount} plants shortlisted` : "Choose crops to grow this season",
          status: growDone ? "done" : hasSetup ? "start" : "blocked",
        },
        {
          href: `/gardens/${gardenId}/beds`,
          key: "beds",
          title: "Bed Planner",
          helper:
            bedCount > 0
              ? wishlistCount > 0
                ? `${placedWishlistCount}/${wishlistCount} crops placed in beds`
                : `${bedCount} beds ready to review`
              : "No beds yet",
          status: bedsDone ? "done" : bedCount > 0 ? "in_progress" : hasMappedContent ? "start" : "blocked",
        },
      ]
    : [];

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <ScrollView
        style={[styles.container, { backgroundColor: theme.appBackground }]}
        contentContainerStyle={styles.contentContainer}
      >
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

            {steps.map((step) => {
              const isManualStep = step.key === "mapper" || step.key === "grow";
              const effectiveDone = step.key === "mapper" ? mapperDone : step.key === "grow" ? growDone : false;
              return (
                <Link
                  key={step.href}
                  href={step.href}
                  style={[styles.stepLink, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}
                >
                  <View style={styles.stepRow}>
                    <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>{step.title}</Text>
                    <View style={styles.stepRight}>
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
                      {isManualStep && (
                        <Pressable
                          style={[styles.stepActionButton, { borderColor: theme.primaryActionBackground, backgroundColor: theme.primaryActionBackground }]}
                          onPress={() =>
                            setManualStepDone(
                              step.key === "mapper" ? "mapperDone" : "growDone",
                              !effectiveDone
                            )
                          }
                        >
                          <Text style={[styles.stepActionText, { color: theme.primaryActionText }]}>
                            {effectiveDone ? "Clear tick" : "Mark done"}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                  <Text style={[styles.stepHelper, { color: theme.textMuted }]}>{step.helper}</Text>
                </Link>
              );
            })}
          </>
        ) : (
          <Text style={[styles.errorText, { color: theme.textMuted }]}>Missing garden id</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  container: { flex: 1 },
  contentContainer: { padding: 16, gap: 10, paddingBottom: 120 },
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
  stepRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  stepRight: { alignItems: "flex-end", gap: 6 },
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
  stepActionButton: {
    borderWidth: 1,
    borderRadius: 8,
    minWidth: 84,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stepActionText: { fontWeight: "700", fontSize: 12 },
  errorText: { fontWeight: "700" },
});
