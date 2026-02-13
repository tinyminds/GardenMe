import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useGardensQuery } from "@/features/gardens/hooks/useGardensQuery";
import { fetchCurrentWeather, fetchDailyForecast } from "@/features/weather/services/openMeteo";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { SqliteGardenTaskRepository } from "@/infra/repositories/sqlite/SqliteGardenTaskRepository";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { ChoiceChip } from "@/ui/components/ChoiceChip";
import { buildGardenCalendarItems, getCurrentMonthItems } from "@/features/calendar/services/calendarPlanner";
import { getCalendarTypeMeta, getCalendarVisualKind } from "@/features/calendar/services/calendarPresentation";
import { BedPlanPreview } from "@/features/garden-mapping/components/BedPlanPreview";

const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();
const growRepository = new SqliteGardenCropWishlistRepository();
const taskRepository = new SqliteGardenTaskRepository();

export default function DashboardScreen() {
  const { theme } = useTheme();
  const gardensQuery = useGardensQuery();
  const gardens = gardensQuery.data ?? [];
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);

  const selectedGarden = gardens.find((garden) => garden.id === selectedGardenId) ?? gardens[0] ?? null;
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

  const plantingsQuery = useQuery({
    queryKey: ["garden-plantings", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return [];
      return growRepository.listPlantingsByGarden(activeGardenId);
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["dashboard-task-summary", activeGardenId],
    enabled: Boolean(activeGardenId),
    queryFn: async () => {
      if (!activeGardenId) return { open: 0, unseen: 0 };
      const [allTasks, unseen] = await Promise.all([
        taskRepository.listByGarden(activeGardenId),
        taskRepository.countOpenUnseenByGarden(activeGardenId),
      ]);
      return {
        open: allTasks.filter((task) => task.status === "open").length,
        unseen,
      };
    },
  });

  const canLoadWeather = Boolean(
    selectedGarden && (Math.abs(selectedGarden.latitude) > 0.000001 || Math.abs(selectedGarden.longitude) > 0.000001)
  );

  const weatherQuery = useQuery({
    queryKey: ["dashboard-weather", selectedGarden?.id, selectedGarden?.latitude, selectedGarden?.longitude],
    enabled: canLoadWeather,
    queryFn: async () => {
      if (!selectedGarden) return null;
      const [current, forecast] = await Promise.all([
        fetchCurrentWeather(selectedGarden.latitude, selectedGarden.longitude),
        fetchDailyForecast(selectedGarden.latitude, selectedGarden.longitude, 3),
      ]);
      return { current, forecast };
    },
    staleTime: 15 * 60 * 1000,
  });

  const bedCount = (bedsQuery.data ?? []).length;
  const featureCount = (featuresQuery.data ?? []).length;
  const growList = growQuery.data ?? [];
  const growCount = growList.length;
  const placedCount = growList.filter((entry) => Boolean(entry.bedId)).length;
  const plannedCount = growList.filter((entry) => entry.status === "wanted").length;
  const growingCount = growList.filter((entry) => entry.status === "already_growing").length;
  const hasSetup = Boolean(selectedGarden?.scaleCalibration);
  const hasDesign = bedCount + featureCount > 0;
  const isBedPlannerReady = bedCount > 0 && growCount > 0;
  const isBedPlannerDone = isBedPlannerReady && placedCount === growCount;
  const monthItems = useMemo(() => {
    if (!activeGardenId) return [];
    const all = buildGardenCalendarItems({
      gardenId: activeGardenId,
      now: new Date(),
      year: new Date().getFullYear(),
      wishlist: growList,
      activePlantings: plantingsQuery.data ?? [],
      forecast: (weatherQuery.data?.forecast ?? []).map((day) => ({
        date: day.date,
        tempMinC: day.tempMinC,
        tempMaxC: day.tempMaxC,
        precipMm: day.precipMm,
        precipProbPct: day.precipProbPct,
      })),
      existingTasks: [],
    });
    return getCurrentMonthItems(all, new Date());
  }, [activeGardenId, growList, plantingsQuery.data, weatherQuery.data?.forecast]);
  const monthTypeCounts = useMemo(() => {
    const counts = new Map<string, { meta: ReturnType<typeof getCalendarTypeMeta>; count: number }>();
    for (const item of monthItems) {
      const kind = getCalendarVisualKind(item);
      const current = counts.get(kind);
      if (current) {
        current.count += 1;
      } else {
        counts.set(kind, { meta: getCalendarTypeMeta(item), count: 1 });
      }
    }
    const order = ["frost", "drought", "start_indoors", "direct_sow", "plant_out", "harvest", "seasonal_now", "task"];
    return order
      .map((kind) => (counts.has(kind) ? { kind, ...counts.get(kind)! } : null))
      .filter((row): row is { kind: string; meta: ReturnType<typeof getCalendarTypeMeta>; count: number } => Boolean(row));
  }, [monthItems]);
  const bedPreviewInfoById = useMemo(() => {
    const map: Record<string, { bedName: string; lines: string[] }> = {};
    for (const bed of bedsQuery.data ?? []) {
      const bedEntries = growList.filter((entry) => entry.bedId === bed.id);
      const growing = bedEntries.filter((entry) => entry.status === "already_growing").map((entry) => entry.plant.commonName);
      const planned = bedEntries.filter((entry) => entry.status === "wanted").map((entry) => entry.plant.commonName);
      map[bed.id] = {
        bedName: bed.name,
        lines: [
          growing.length > 0 ? `Growing: ${growing.join(", ")}` : "Growing: none",
          planned.length > 0 ? `Planned: ${planned.join(", ")}` : "Planned: none",
        ],
      };
    }
    return map;
  }, [bedsQuery.data, growList]);

  return (
    <ScrollView style={[styles.page, { backgroundColor: theme.appBackground }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Home</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>Focus on your current garden, then jump straight into the next step.</Text>

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Current Garden</Text>
        {!selectedGarden ? (
          <>
            <Text style={[styles.helper, { color: theme.textMuted }]}>No gardens yet. Create your first garden to start planning.</Text>
            <Link
              href="/gardens/new"
              style={[styles.primaryLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}
            >
              + New Garden
            </Link>
          </>
        ) : (
          <>
            <Text style={[styles.gardenName, { color: theme.textPrimary }]}>{selectedGarden.name}</Text>
            <Text style={[styles.helper, { color: theme.textMuted }]}>
              {selectedGarden.locationLabel ?? `${selectedGarden.latitude.toFixed(4)}, ${selectedGarden.longitude.toFixed(4)}`}
            </Text>
            <Text style={[styles.helper, { color: theme.textMuted }]}>
              Area {selectedGarden.scaleCalibration?.boundaryAreaSqM ? `${selectedGarden.scaleCalibration.boundaryAreaSqM.toFixed(1)} sqm` : "not set"}
            </Text>
            <View style={styles.metricsRow}>
              <MetricChip label={`Beds ${bedCount}`} />
              <MetricChip label={`Features ${featureCount}`} />
              <MetricChip label={`Grow list ${growCount}`} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {gardens.map((garden) => {
                const selected = garden.id === selectedGarden.id;
                return (
                  <ChoiceChip
                    key={garden.id}
                    label={garden.name}
                    selected={selected}
                    onPress={() => setSelectedGardenId(garden.id)}
                  />
                );
              })}
            </ScrollView>
            <Link
              href="/(tabs)/gardens"
              style={[styles.secondaryLink, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}
            >
              Manage Gardens
            </Link>
          </>
        )}
      </View>

      {selectedGarden ? (
        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Quick Actions</Text>
          <View style={styles.actionGrid}>
            <Link href={`/gardens/${selectedGarden.id}/setup`} style={[styles.actionLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}>
              {hasSetup ? "Garden Setup - Edit" : "Garden Setup - Start"}
            </Link>
            <Link href={`/gardens/${selectedGarden.id}/map`} style={[styles.actionLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}>
              {hasDesign ? "Garden Design - Continue" : "Garden Design - Start"}
            </Link>
            <Link href={`/gardens/${selectedGarden.id}/grow`} style={[styles.actionLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}>
              {growCount > 0 ? "Grow List - Continue" : "Grow List - Start"}
            </Link>
            <Link href={`/gardens/${selectedGarden.id}/beds`} style={[styles.actionLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}>
              {isBedPlannerDone ? "Bed Planner - Review" : isBedPlannerReady ? "Bed Planner - Continue" : "Bed Planner - Start"}
            </Link>
          </View>
          <Text style={[styles.helper, { color: theme.textMuted }]}>
            Planned {plannedCount} · Growing now {growingCount} · Positioned {placedCount}/{growCount}
          </Text>
        </View>
      ) : null}

      {selectedGarden ? (
        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Tasks Snapshot</Text>
          <View style={styles.metricsRow}>
            <MetricChip label={`Open ${tasksQuery.data?.open ?? 0}`} />
            <MetricChip label={`Unseen ${tasksQuery.data?.unseen ?? 0}`} />
          </View>
          <Link
            href="/(tabs)/tasks"
            style={[styles.secondaryLink, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}
          >
            Open Tasks
          </Link>
        </View>
      ) : null}

      {selectedGarden ? (
        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>This Month</Text>
          {monthTypeCounts.length === 0 ? (
            <Text style={[styles.helper, { color: theme.textMuted }]}>No scheduled items this month yet.</Text>
          ) : (
            <View style={styles.metricsRow}>
              {monthTypeCounts.map((group) => (
                <View
                  key={group.kind}
                  style={[styles.monthIndicator, { backgroundColor: group.meta.background, borderColor: group.meta.border }]}
                >
                  <Text style={[styles.monthIndicatorText, { color: group.meta.text }]}>
                    {group.meta.label}: {group.count}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <Link
            href="/(tabs)/calendar"
            style={[styles.secondaryLink, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}
          >
            Open Calendar
          </Link>
        </View>
      ) : null}

      {selectedGarden && bedCount > 0 ? (
        <BedPlanPreview
          beds={bedsQuery.data ?? []}
          {...(selectedGarden.scaleCalibration?.boundaryPolygon
            ? { boundaryPolygon: selectedGarden.scaleCalibration.boundaryPolygon }
            : {})}
          {...(selectedGarden.scaleCalibration?.baseWidth && selectedGarden.scaleCalibration?.baseHeight
            ? { previewRatio: selectedGarden.scaleCalibration.baseHeight / selectedGarden.scaleCalibration.baseWidth }
            : {})}
          infoByBedId={bedPreviewInfoById}
          title="Bed Layout"
          subtitle="Quick view of your planned and planted beds."
        />
      ) : null}

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Garden Weather</Text>
        {!selectedGarden ? <Text style={[styles.helper, { color: theme.textMuted }]}>Choose a garden to see weather.</Text> : null}
        {selectedGarden && !canLoadWeather ? (
          <Text style={[styles.helper, { color: theme.textMuted }]}>Set this garden location to load local weather.</Text>
        ) : null}
        {canLoadWeather && weatherQuery.isLoading ? (
          <Text style={[styles.helper, { color: theme.textMuted }]}>Loading weather...</Text>
        ) : null}
        {canLoadWeather && !weatherQuery.isLoading && weatherQuery.data?.current ? (
          <>
            <Text style={[styles.weatherNow, { color: theme.textPrimary }]}>
              Now {Math.round(weatherQuery.data.current.temperatureC)}C, {describeWeatherCode(weatherQuery.data.current.weatherCode)}
            </Text>
            <Text style={[styles.helper, { color: theme.textMuted }]}>Wind {Math.round(weatherQuery.data.current.windSpeedKmh)} km/h</Text>
            {weatherQuery.data.forecast.slice(0, 3).map((day) => (
              <Text key={day.date} style={[styles.helper, { color: theme.textMuted }]}>
                {formatShortDate(day.date)}: {Math.round(day.tempMinC)}-{Math.round(day.tempMaxC)}C, {Math.round(day.precipMm)}mm rain ({Math.round(day.precipProbPct)}%)
              </Text>
            ))}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

function MetricChip(props: { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.metricChip, { backgroundColor: theme.secondaryActionBackground }]}>
      <Text style={[styles.metricChipText, { color: theme.secondaryActionText }]}>{props.label}</Text>
    </View>
  );
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

function describeWeatherCode(code: number): string {
  if (code === 0) return "clear";
  if (code >= 1 && code <= 3) return "partly cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 95) return "storm";
  return "mixed conditions";
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  title: { fontSize: 30, fontWeight: "800" },
  subtitle: { fontSize: 15 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  cardTitle: { fontWeight: "800" },
  helper: {},
  gardenName: { fontSize: 20, fontWeight: "800" },
  metricsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  monthIndicator: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  monthIndicatorText: { fontSize: 12, fontWeight: "800" },
  metricChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metricChipText: { fontSize: 12, fontWeight: "700" },
  chipRow: { gap: 8 },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionLink: {
    minWidth: "48%",
    flexGrow: 1,
    textAlign: "center",
    fontWeight: "800",
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryLink: {
    fontWeight: "800",
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlign: "center",
  },
  secondaryLink: {
    fontWeight: "700",
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 9,
    textAlign: "center",
  },
  weatherNow: { fontSize: 16, fontWeight: "700" },
});
