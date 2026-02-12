import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useGardensQuery } from "@/features/gardens/hooks/useGardensQuery";
import { useGardenSummariesQuery } from "@/features/gardens/hooks/useGardenSummariesQuery";
import { fetchCurrentWeather, fetchDailyForecast } from "@/features/weather/services/openMeteo";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { useTheme } from "@/ui/theme/ThemeProvider";

export default function DashboardScreen() {
  const { theme } = useTheme();
  const gardensQuery = useGardensQuery();
  const gardens = gardensQuery.data ?? [];
  const summariesQuery = useGardenSummariesQuery(gardens);
  const summaries = summariesQuery.data ?? {};
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);

  const selectedGarden = gardens.find((garden) => garden.id === selectedGardenId) ?? gardens[0] ?? null;
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

  const totalBeds = gardens.reduce((sum, garden) => sum + (summaries[garden.id]?.bedCount ?? 0), 0);
  const mappedGardens = gardens.reduce((sum, garden) => {
    const bedCount = summaries[garden.id]?.bedCount ?? 0;
    const featureCount = summaries[garden.id]?.featureCount ?? 0;
    return sum + (bedCount + featureCount > 0 ? 1 : 0);
  }, 0);
  const totalAreaSqM = gardens.reduce((sum, garden) => sum + (garden.scaleCalibration?.boundaryAreaSqM ?? 0), 0);

  return (
    <ScrollView style={[styles.page, { backgroundColor: theme.appBackground }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>GardenMe</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>Plan smarter with one quick view of progress and next steps.</Text>

      <View style={styles.metricsRow}>
        <MetricCard label="Gardens" value={gardens.length.toString()} />
        <MetricCard label="Mapped" value={mappedGardens.toString()} />
      </View>
      <View style={styles.metricsRow}>
        <MetricCard label="Beds" value={totalBeds.toString()} />
        <MetricCard label="Total Area" value={totalAreaSqM > 0 ? `${totalAreaSqM.toFixed(1)} sqm` : "-"} />
      </View>

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Quick Actions</Text>
        <Link
          href="/gardens/new"
          style={[styles.primaryLink, { backgroundColor: theme.primaryActionBackground, color: theme.primaryActionText }]}
        >
          + New Garden
        </Link>
        <Link
          href="/(tabs)/gardens"
          style={[styles.secondaryLink, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}
        >
          Open Gardens
        </Link>
        <Link
          href="/(tabs)/plan"
          style={[styles.secondaryLink, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}
        >
          Open Plan
        </Link>
      </View>

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
                {formatShortDate(day.date)}: {Math.round(day.tempMinC)}-{Math.round(day.tempMaxC)}C, {Math.round(day.precipMm)}mm rain (
                {Math.round(day.precipProbPct)}%)
              </Text>
            ))}
          </>
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Current Garden</Text>
        {!selectedGarden && <Text style={[styles.helper, { color: theme.textMuted }]}>No gardens yet. Create one to get started.</Text>}
        {selectedGarden && (
          <>
            <Text style={[styles.gardenName, { color: theme.textPrimary }]}>{selectedGarden.name}</Text>
            <Text style={[styles.helper, { color: theme.textMuted }]}> 
              {selectedGarden.locationLabel ?? `${selectedGarden.latitude.toFixed(4)}, ${selectedGarden.longitude.toFixed(4)}`}
            </Text>
            <Text style={[styles.helper, { color: theme.textMuted }]}> 
              Area {selectedGarden.scaleCalibration?.boundaryAreaSqM ? `${selectedGarden.scaleCalibration.boundaryAreaSqM.toFixed(1)} sqm` : "not set"}
              {" | "}Beds {summaries[selectedGarden.id]?.bedCount ?? 0}
              {" | "}Features {summaries[selectedGarden.id]?.featureCount ?? 0}
            </Text>
            <View style={styles.inlineActions}>
              <Link
                href={`/gardens/${selectedGarden.id}/setup`}
                style={[styles.secondaryLinkSmall, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}
              >
                Setup
              </Link>
              <Link
                href={`/gardens/${selectedGarden.id}/map`}
                style={[styles.secondaryLinkSmall, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}
              >
                Mapper
              </Link>
              <Pressable onPress={() => setSelectedGardenId(selectedGarden.id)}>
                <Text style={[styles.selectText, { color: theme.primaryActionBackground }]}>Set as current</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function MetricCard(props: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.metricCard, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}>
      <Text style={[styles.metricLabel, { color: theme.textMuted }]}>{props.label}</Text>
      <Text style={[styles.metricValue, { color: theme.textPrimary }]}>{props.value}</Text>
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
  metricsRow: { flexDirection: "row", gap: 10 },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  metricLabel: { fontWeight: "700", fontSize: 12 },
  metricValue: { fontWeight: "800", fontSize: 20 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  cardTitle: { fontWeight: "800" },
  primaryLink: {
    fontWeight: "800",
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryLink: {
    fontWeight: "700",
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  gardenName: { fontSize: 20, fontWeight: "800" },
  helper: {},
  weatherNow: { fontSize: 16, fontWeight: "700" },
  inlineActions: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  secondaryLinkSmall: {
    fontWeight: "700",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
  },
  selectText: { fontWeight: "700" },
});

