import * as Location from "expo-location";
import area from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { queryClient } from "@/state/queryClient";
import { polygonArea } from "@/features/garden-mapping/utils/geometry";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { SegmentedChoice } from "@/ui/components/SegmentedChoice";
import MapBoundaryEditor, {
  type LatLngPoint,
  type MapSnapshotResult,
} from "@/features/garden-mapping/components/MapBoundaryEditor";
import type { GardenScaleCalibration } from "@/domain/entities/Garden";

const BASE_CANVAS_WIDTH = 1000;
const BASE_CANVAS_HEIGHT = 700;
const DEFAULT_MAP_CENTER: LatLngPoint = { latitude: 37.7749, longitude: -122.4194 };

type SetupMode = "map" | "measure";
type NativeMapType = "standard" | "satellite" | "hybrid";

const gardenRepository = new SqliteGardenRepository();

export default function GardenSetupScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;

  const [setupMode, setSetupMode] = useState<SetupMode>("map");
  const [manualLengthM, setManualLengthM] = useState("20");
  const [manualWidthM, setManualWidthM] = useState("10");

  const [mapBoundary, setMapBoundary] = useState<LatLngPoint[]>([]);
  const [mapType, setMapType] = useState<NativeMapType>("hybrid");
  const [isMapClosed, setIsMapClosed] = useState(false);
  const [selectedMapPointIndex, setSelectedMapPointIndex] = useState<number | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLngPoint>(DEFAULT_MAP_CENTER);
  const [mapSearch, setMapSearch] = useState("");
  const [searchingMap, setSearchingMap] = useState(false);
  const [locatingUser, setLocatingUser] = useState(false);
  const [captureMapSnapshot, setCaptureMapSnapshot] = useState<(() => Promise<MapSnapshotResult>) | null>(null);
  const [locationHydrated, setLocationHydrated] = useState(false);

  const gardenQuery = useQuery({
    queryKey: ["garden", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing garden id");
      return gardenRepository.getById(gardenId);
    },
  });

  useEffect(() => {
    const existingGeoBoundary = gardenQuery.data?.scaleCalibration?.boundaryGeoPolygon;
    if (!existingGeoBoundary || existingGeoBoundary.length < 3) return;
    if (mapBoundary.length > 0) return;
    setMapBoundary(existingGeoBoundary);
    setIsMapClosed(true);
  }, [gardenQuery.data?.scaleCalibration?.boundaryGeoPolygon, mapBoundary.length]);

  useEffect(() => {
    const hydrateCenter = async () => {
      if (locationHydrated) return;

      const savedLat = gardenQuery.data?.latitude;
      const savedLng = gardenQuery.data?.longitude;
      if (typeof savedLat === "number" && typeof savedLng === "number" && hasValidCoordinates(savedLat, savedLng)) {
        setMapCenter({ latitude: savedLat, longitude: savedLng });
        setLocationHydrated(true);
        return;
      }

      if (gardenQuery.isLoading || !gardenId) return;

      setLocatingUser(true);
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.granted) {
          const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const nextCenter = {
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
          };
          setMapCenter(nextCenter);
          await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude);
          await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
        }
      } catch {
        // Keep default center if lookup fails.
      } finally {
        setLocatingUser(false);
        setLocationHydrated(true);
      }
    };

    void hydrateCenter();
  }, [
    gardenId,
    gardenQuery.data?.latitude,
    gardenQuery.data?.longitude,
    gardenQuery.isLoading,
    locationHydrated,
  ]);

  const moveToCurrentLocation = async () => {
    if (!gardenId) return;
    setLocatingUser(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission needed", "Allow location access to center map on your position.");
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const nextCenter = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setMapCenter(nextCenter);
      await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude);
      await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    } catch (error) {
      Alert.alert("Location unavailable", error instanceof Error ? error.message : "Could not fetch your location.");
    } finally {
      setLocatingUser(false);
    }
  };

  const searchMapLocation = async () => {
    if (!gardenId) return;
    const query = mapSearch.trim();
    if (!query) {
      Alert.alert(
        "Search needed", 
        "Enter an address, postcode, or place name.",
        [{ text: "OK", style: "default" }]
      );
      return;
    }

    setSearchingMap(true);
    try {
      const results = await Location.geocodeAsync(query);
      const first = results[0];
      if (!first) {
        Alert.alert("No results", "Try a more specific address.");
        return;
      }
      const nextCenter = { latitude: first.latitude, longitude: first.longitude };
      setMapCenter(nextCenter);
      await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude, query);
      await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    } catch (error) {
      Alert.alert("Search failed", error instanceof Error ? error.message : "Could not search this location.");
    } finally {
      setSearchingMap(false);
    }
  };

  const onMapPress = (point: LatLngPoint) => {
    if (isMapClosed) {
      setMapBoundary([point]);
      setIsMapClosed(false);
      setSelectedMapPointIndex(null);
      return;
    }
    setMapBoundary((prev) => [...prev, point]);
  };

  const finishMapBoundary = () => {
    if (mapBoundary.length < 3) {
      Alert.alert("Need 3 points", "Add at least 3 points before finishing the map boundary.");
      return;
    }
    setIsMapClosed(true);
  };

  const resetMapBoundary = () => {
    setMapBoundary([]);
    setIsMapClosed(false);
    setSelectedMapPointIndex(null);
  };

  const undoMapBoundaryPoint = () => {
    setMapBoundary((prev) => prev.slice(0, -1));
    setSelectedMapPointIndex(null);
    if (mapBoundary.length <= 3) {
      setIsMapClosed(false);
    }
  };

  const deleteSelectedMapPoint = () => {
    if (selectedMapPointIndex === null) return;
    setMapBoundary((prev) => prev.filter((_p, idx) => idx !== selectedMapPointIndex));
    setSelectedMapPointIndex(null);
    setIsMapClosed(false);
  };

  const saveMapSetup = async () => {
    if (!gardenId) return;
    if (Platform.OS === "web") {
      Alert.alert("Native only", "Map boundary mode currently works on iOS/Android only.");
      return;
    }

    if (mapBoundary.length < 3) {
      Alert.alert("Draw boundary", "Tap around your garden on the map with at least 3 points.");
      return;
    }

    const finalBoundaryGeo = isMapClosed ? mapBoundary : [...mapBoundary];
    if (!isMapClosed) {
      setIsMapClosed(true);
    }

    const boundaryAreaSqM = polygonAreaSqMeters(finalBoundaryGeo);
    if (!Number.isFinite(boundaryAreaSqM) || boundaryAreaSqM <= 0) {
      Alert.alert("Area invalid", "Could not calculate area from this boundary. Try redrawing.");
      return;
    }

    let snapshotSaved = false;
    let boundaryForCalibration = normalizeLatLngBoundary(finalBoundaryGeo);
    let baseWidthForCalibration = BASE_CANVAS_WIDTH;
    let baseHeightForCalibration = BASE_CANVAS_HEIGHT;

    if (captureMapSnapshot) {
      try {
        const snapshot = await captureMapSnapshot();
        if (snapshot.uri) {
          if (snapshot.boundary.length >= 3) {
            boundaryForCalibration = snapshot.boundary;
          }
          baseWidthForCalibration = snapshot.width;
          baseHeightForCalibration = snapshot.height;
          await gardenRepository.updatePhoto(gardenId, snapshot.uri, "satellite");
          snapshotSaved = true;
        }
      } catch {
        // keep save flow successful
      }
    }

    const normalizedArea = polygonArea(boundaryForCalibration);
    if (!Number.isFinite(normalizedArea) || normalizedArea <= 0) {
      Alert.alert("Boundary invalid", "Could not normalize this boundary. Try redrawing.");
      return;
    }

    const metersPerPixel = Math.sqrt(
      boundaryAreaSqM / (normalizedArea * baseWidthForCalibration * baseHeightForCalibration)
    );

    const calibration: GardenScaleCalibration = {
      method: "map_polygon",
      metersPerPixel,
      baseWidth: baseWidthForCalibration,
      baseHeight: baseHeightForCalibration,
      latitude: mapCenter.latitude,
      boundaryPolygon: boundaryForCalibration,
      boundaryGeoPolygon: finalBoundaryGeo,
      boundaryAreaSqM,
      showBaseImage: true,
      showGridOverlay: false,
      showBedMeasurements: false,
      orientationDegrees: 0,
    };

    await gardenRepository.updateScaleCalibration(gardenId, calibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    Alert.alert(
      "Map saved",
      `Garden area: ${boundaryAreaSqM.toFixed(1)} sqm.${snapshotSaved ? " Design image captured." : ""}`
    );
  };

  const manualAreaSqM = useMemo(() => {
    const length = Number(manualLengthM);
    const width = Number(manualWidthM);
    if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) return null;
    return length * width;
  }, [manualLengthM, manualWidthM]);

  const saveManualSetup = async () => {
    if (!gardenId) return;

    const length = Number(manualLengthM);
    const width = Number(manualWidthM);
    if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) {
      Alert.alert("Invalid dimensions", "Enter valid length and width in meters.");
      return;
    }

    const boundaryPolygon = [
      { x: 0.08, y: 0.08 },
      { x: 0.92, y: 0.08 },
      { x: 0.92, y: 0.92 },
      { x: 0.08, y: 0.92 },
    ];
    const imageAreaPixels = BASE_CANVAS_WIDTH * BASE_CANVAS_HEIGHT;
    const boundaryNormalizedArea = polygonArea(boundaryPolygon);
    const metersPerPixel = Math.sqrt((length * width) / (imageAreaPixels * boundaryNormalizedArea));

    const calibration: GardenScaleCalibration = {
      method: "reference_line",
      metersPerPixel,
      baseWidth: BASE_CANVAS_WIDTH,
      baseHeight: BASE_CANVAS_HEIGHT,
      boundaryPolygon,
      boundaryAreaSqM: length * width,
      manualLengthM: length,
      manualWidthM: width,
      showBaseImage: false,
      showGridOverlay: false,
      showBedMeasurements: false,
      orientationDegrees: 0,
    };

    await gardenRepository.updateScaleCalibration(gardenId, calibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    Alert.alert("Measurements saved", `Garden area: ${(length * width).toFixed(1)} sqm.`);
  };

  const mapAreaSqM = useMemo(() => polygonAreaSqMeters(mapBoundary), [mapBoundary]);

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.appBackground }]} edges={["left", "right"]}>
        <KeyboardAvoidingView
          style={styles.keyboardWrap}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Text style={[styles.title, { color: theme.textPrimary }]}>Garden Setup</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>Set your garden boundary on map, or enter measurements in meters.</Text>

            <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Mode</Text>
              <SegmentedChoice
                options={[
                  { id: "map", label: "Map" },
                  { id: "measure", label: "Measurement" },
                ]}
                selectedId={setupMode}
                onSelect={(id) => setSetupMode(id as SetupMode)}
              />
            </View>

            <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />

            {setupMode === "map" ? (
              <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Map Boundary</Text>
                <Text style={[styles.cardText, { color: theme.textMuted }]}>Tap points around the outer garden edge, then save.</Text>

                <SegmentedChoice
                  options={[
                    { id: "standard", label: "Standard" },
                    { id: "satellite", label: "Satellite" },
                    { id: "hybrid", label: "Satellite + Labels" },
                  ]}
                  selectedId={mapType}
                  onSelect={(id) => setMapType(id as NativeMapType)}
                />

                <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />

                <View style={styles.searchRow}>
                  <TextInput
                    value={mapSearch}
                    onChangeText={setMapSearch}
                    style={[styles.input, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                    placeholder="Search address or place"
                    placeholderTextColor={theme.textMuted}
                    returnKeyType="search"
                    onSubmitEditing={() => {
                      void searchMapLocation();
                    }}
                  />
                  <Pressable style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={() => void searchMapLocation()} disabled={searchingMap}>
                    {searchingMap ? <ActivityIndicator color={theme.secondaryActionText} size="small" /> : <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Search</Text>}
                  </Pressable>
                  <Pressable style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={() => void moveToCurrentLocation()} disabled={locatingUser}>
                    {locatingUser ? <ActivityIndicator color={theme.secondaryActionText} size="small" /> : <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>My Location</Text>}
                  </Pressable>
                </View>

                <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />

                <View style={styles.zoomRow}>
                  <Pressable style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={undoMapBoundaryPoint}>
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Undo</Text>
                  </Pressable>
                  <Pressable style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={deleteSelectedMapPoint}>
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Delete Point</Text>
                  </Pressable>
                  <Pressable style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={resetMapBoundary}>
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Reset</Text>
                  </Pressable>
                  <Pressable style={[styles.toolButton, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor }]} onPress={finishMapBoundary}>
                    <Text style={[styles.toolButtonText, { color: theme.primaryActionText }]}>Finish Shape</Text>
                  </Pressable>
                </View>

                <MapBoundaryEditor
                  center={mapCenter}
                  points={mapBoundary}
                  mapType={mapType}
                  selectedPointIndex={selectedMapPointIndex}
                  onMapPress={onMapPress}
                  onSelectPoint={setSelectedMapPointIndex}
                  onDragPoint={(index, point) => {
                    setMapBoundary((prev) => prev.map((p, i) => (i === index ? point : p)));
                  }}
                  onRequestSnapshot={(capture) => setCaptureMapSnapshot(() => capture)}
                />

                <Text style={[styles.infoText, { color: theme.infoText }]}>Boundary points: {mapBoundary.length}{isMapClosed ? " (closed)" : ""}</Text>
                <Text style={[styles.infoText, { color: theme.infoText }]}>Garden area: {mapAreaSqM > 0 ? `${mapAreaSqM.toFixed(1)} sqm` : "-"}</Text>

                <Pressable style={[styles.button, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor }]} onPress={saveMapSetup}>
                  <Text style={[styles.buttonText, { color: theme.primaryActionText }]}>Save Map Boundary</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Manual Measurements (meters)</Text>
                <Text style={[styles.cardText, { color: theme.textMuted }]}>Enter your approximate garden dimensions.</Text>

                <View style={styles.inputRow}>
                  <TextInput
                    value={manualLengthM}
                    onChangeText={setManualLengthM}
                    keyboardType="decimal-pad"
                    style={[styles.input, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                    placeholder="Length (m)"
                    placeholderTextColor={theme.textMuted}
                  />
                  <TextInput
                    value={manualWidthM}
                    onChangeText={setManualWidthM}
                    keyboardType="decimal-pad"
                    style={[styles.input, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                    placeholder="Width (m)"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>

                <Text style={[styles.infoText, { color: theme.infoText }]}>Garden area: {manualAreaSqM ? `${manualAreaSqM.toFixed(1)} sqm` : "-"}</Text>

                <Pressable style={[styles.button, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor }]} onPress={saveManualSetup}>
                  <Text style={[styles.buttonText, { color: theme.primaryActionText }]}>Save Measurements</Text>
                </Pressable>
              </View>
            )}

            {gardenId && (
              <Link
                href={`/gardens/${gardenId}/map`}
                style={[styles.mapperLink, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor, color: theme.primaryActionText }]}
              >
                Continue to Garden Design
              </Link>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function polygonAreaSqMeters(points: LatLngPoint[]): number {
  if (points.length < 3) return 0;
  const ring: [number, number][] = points.map((p) => [p.longitude, p.latitude]);
  const first = ring[0];
  if (!first) return 0;
  ring.push([first[0], first[1]]);
  const feature = turfPolygon([ring]);
  return area(feature);
}

function normalizeLatLngBoundary(points: LatLngPoint[]): { x: number; y: number }[] {
  const latitudes = points.map((p) => p.latitude);
  const longitudes = points.map((p) => p.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latSpan = Math.max(maxLat - minLat, 1e-9);
  const lngSpan = Math.max(maxLng - minLng, 1e-9);

  return points.map((p) => ({
    x: clamp((p.longitude - minLng) / lngSpan, 0, 1),
    y: clamp((maxLat - p.latitude) / latSpan, 0, 1),
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasValidCoordinates(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return Math.abs(latitude) > 0.000001 || Math.abs(longitude) > 0.000001;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  keyboardWrap: { flex: 1 },
  content: { padding: 14, gap: 10, paddingBottom: 120 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { marginBottom: 2 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  cardTitle: { fontWeight: "800" },
  cardText: {},
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  button: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  buttonText: { fontWeight: "700" },
  separator: { height: 1, marginVertical: 8 },
  modeChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  modeChipActive: {},
  modeChipText: { fontWeight: "700" },
  modeChipTextActive: {},
  zoomRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  toolButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  toolButtonText: { fontWeight: "700", fontSize: 12 },
  inputRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  infoText: { fontWeight: "600" },
  mapperLink: {
    fontWeight: "800",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    overflow: "hidden",
    textAlign: "center",
  },
});

