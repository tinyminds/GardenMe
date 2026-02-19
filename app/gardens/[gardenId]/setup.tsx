import * as Location from "expo-location";
import area from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Polygon, Text as SvgText } from "react-native-svg";
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
  const [mapReadyAlerted, setMapReadyAlerted] = useState(false);
  const [mapLayoutAlerted, setMapLayoutAlerted] = useState(false);
  const [mapTilesLoaded, setMapTilesLoaded] = useState(false);
  const mapTilesTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Canvas preview for measurements mode
  const [measurementCanvas, setMeasurementCanvas] = useState({ width: BASE_CANVAS_WIDTH, height: BASE_CANVAS_HEIGHT });
  const [measurementZoom, setMeasurementZoom] = useState(0.8); // Start zoomed out to show padding

  const gardenQuery = useQuery({
    queryKey: ["garden", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing garden id");
      return gardenRepository.getById(gardenId);
    },
  });

  const showDebugAlert = (title: string, details: Record<string, unknown> | string) => {
    const message = typeof details === "string" ? details : JSON.stringify(details, null, 2);
    console.log(`[MapDiag] ${title}`, details);
    Alert.alert(`MapDiag: ${title}`, message.length > 3800 ? `${message.slice(0, 3800)}...` : message);
  };

  const clearMapTilesTimeout = () => {
    if (mapTilesTimeoutRef.current) {
      clearTimeout(mapTilesTimeoutRef.current);
      mapTilesTimeoutRef.current = null;
    }
  };

  const runMapDiagnostics = async () => {
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      const foregroundPermission = await Location.getForegroundPermissionsAsync();
      const backgroundPermission = await Location.getBackgroundPermissionsAsync();
      showDebugAlert("Device + Permission Snapshot", {
        platform: Platform.OS,
        servicesEnabled,
        foregroundStatus: foregroundPermission.status,
        foregroundGranted: foregroundPermission.granted,
        foregroundCanAskAgain: foregroundPermission.canAskAgain,
        backgroundStatus: backgroundPermission.status,
        mapCenterLatitude: mapCenter.latitude,
        mapCenterLongitude: mapCenter.longitude,
        savedGardenLatitude: gardenQuery.data?.latitude ?? null,
        savedGardenLongitude: gardenQuery.data?.longitude ?? null,
        mapBoundaryPoints: mapBoundary.length,
        mapType,
      });
    } catch (error) {
      showDebugAlert("Diagnostics failed", error instanceof Error ? error.message : "Unknown diagnostics error");
    }
  };

  useEffect(() => {
    // Geographic boundary display is disabled when design begins
    // Setup becomes locked after beds/features are created
  }, []);

  // Load saved measurements into input fields
  useEffect(() => {
    if (gardenQuery.data?.scaleCalibration) {
      const { manualLengthM, manualWidthM } = gardenQuery.data.scaleCalibration;
      if (typeof manualLengthM === 'number' && manualLengthM > 0) {
        setManualLengthM(manualLengthM.toString());
      }
      if (typeof manualWidthM === 'number' && manualWidthM > 0) {
        setManualWidthM(manualWidthM.toString());
      }
    }
  }, [gardenQuery.data?.scaleCalibration]);

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
        showDebugAlert("Hydrate center", "Requesting current device location for initial map center.");
        const nextCenter = await getCurrentUserLocation();
        setMapCenter(nextCenter);
        await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude);
        await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
        showDebugAlert("Hydrate center success", {
          latitude: nextCenter.latitude,
          longitude: nextCenter.longitude,
        });
      } catch (error) {
        showDebugAlert("Hydrate center failed", error instanceof Error ? error.message : "Unknown location error");
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

  useEffect(
    () => () => {
      clearMapTilesTimeout();
    },
    []
  );

  const moveToCurrentLocation = async () => {
    if (!gardenId) return;
    setLocatingUser(true);
    try {
      showDebugAlert("My Location tapped", "Requesting foreground location permission and current position.");
      const nextCenter = await getCurrentUserLocation();
      setMapCenter(nextCenter);
      await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude);
      await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
      showDebugAlert("My Location success", {
        latitude: nextCenter.latitude,
        longitude: nextCenter.longitude,
      });
    } catch (error) {
      showDebugAlert("My Location failed", error instanceof Error ? error.message : "Unknown location error");
      Alert.alert("Location unavailable", `Could not access your location: ${error instanceof Error ? error.message : 'Unknown error'}. You can still search for an address manually.`);
    } finally {
      setLocatingUser(false);
    }
  };

  const searchMapLocation = async () => {
    if (!gardenId) return;
    const query = mapSearch.trim();
    if (!query) {
      Alert.alert(
        "Enter search location", 
        "Type an address, postcode, or place name to find your garden location on the map.",
        [{ text: "OK", style: "default" }]
      );
      return;
    }

    setSearchingMap(true);
    try {
      showDebugAlert("Search started", { query });
      const results = await Location.geocodeAsync(query);
      const first = results[0];
      if (!first) {
        showDebugAlert("Search returned no results", { query, resultsCount: results.length });
        Alert.alert("Location not found", "No results found. Try a more specific address or different search terms.");
        return;
      }
      const nextCenter = { latitude: first.latitude, longitude: first.longitude };
      setMapCenter(nextCenter);
      await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude, query);
      await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
      showDebugAlert("Search success", {
        query,
        resultsCount: results.length,
        latitude: nextCenter.latitude,
        longitude: nextCenter.longitude,
      });
    } catch (error) {
      showDebugAlert("Search failed", error instanceof Error ? error.message : "Unknown search error");
      Alert.alert("Search error", `Location search failed: ${error instanceof Error ? error.message : 'Unknown error'}. Try a different search term.`);
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
      Alert.alert("Need more points", "Add at least 3 points around your garden boundary before finishing.");
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
      Alert.alert("Device not supported", "Map boundary mode requires a mobile device with camera access. Please use the Measurement mode instead.");
      return;
    }

    if (mapBoundary.length < 3) {
      Alert.alert("Draw boundary first", "Tap around your garden on the satellite map to create a boundary with at least 3 points.");
      return;
    }

    const finalBoundaryGeo = isMapClosed ? mapBoundary : [...mapBoundary];
    if (!isMapClosed) {
      setIsMapClosed(true);
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
          showDebugAlert("Map snapshot captured", {
            uri: snapshot.uri,
            width: snapshot.width,
            height: snapshot.height,
            boundaryPoints: snapshot.boundary.length,
          });
        }
      } catch {
        showDebugAlert("Map snapshot failed", "Snapshot capture threw an error. Continuing without image.");
        // keep save flow successful
      }
    }

    const normalizedArea = polygonArea(boundaryForCalibration);
    if (!Number.isFinite(normalizedArea) || normalizedArea <= 0) {
      Alert.alert("Boundary error", "Could not process this boundary shape. Try redrawing with fewer complex curves.");
      return;
    }

    // Calculate initial area estimate from map polygon (will be refined when boundary is edited)
    const boundaryAreaSqM = polygonAreaSqMeters(finalBoundaryGeo);
    if (!Number.isFinite(boundaryAreaSqM) || boundaryAreaSqM <= 0) {
      Alert.alert("Area calculation failed", "Could not calculate garden area from this boundary. Please try redrawing.");
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
      // Remove geographic polygon - setup will be locked after design begins
      boundaryAreaSqM,
      showBaseImage: true,
      showGridOverlay: false,
      showBedMeasurements: false,
      orientationDegrees: 0,
    };

    await gardenRepository.updateScaleCalibration(gardenId, calibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    showDebugAlert("Map setup saved", {
      boundaryAreaSqM,
      boundaryPoints: boundaryForCalibration.length,
      metersPerPixel,
      baseWidth: baseWidthForCalibration,
      baseHeight: baseHeightForCalibration,
      snapshotSaved,
    });
    Alert.alert(
      "Map boundary saved",
      `Garden area: ${boundaryAreaSqM.toFixed(1)} sqm.${snapshotSaved ? " Satellite image captured." : ""} You can edit the boundary on the design page until you add beds or features.`
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
      Alert.alert("Invalid measurements", "Please enter valid positive numbers for both length and width in meters.");
      return;
    }

    // Work backward from desired measurements to get correct boundary
    // We want exact length×width measurements with padding around
    
    // Determine scale first - how many pixels per meter?
    // Use a reasonable scale that fits the garden with padding
    const padding = 0.15;
    const availableWidth = (1 - 2 * padding) * BASE_CANVAS_WIDTH;  // pixels available for garden
    const availableHeight = (1 - 2 * padding) * BASE_CANVAS_HEIGHT; // pixels available for garden
    
    // Scale to fit the larger dimension
    const scaleX = availableWidth / length;   // pixels per meter based on length
    const scaleY = availableHeight / width;   // pixels per meter based on width
    const pixelsPerMeter = Math.min(scaleX, scaleY); // use smaller to ensure both fit
    const metersPerPixel = 1 / pixelsPerMeter;
    
    // Calculate exact garden size in pixels
    const gardenWidthPixels = length * pixelsPerMeter;
    const gardenHeightPixels = width * pixelsPerMeter;
    
    // Convert to normalized coordinates
    const gardenWidthNorm = gardenWidthPixels / BASE_CANVAS_WIDTH;
    const gardenHeightNorm = gardenHeightPixels / BASE_CANVAS_HEIGHT;
    
    // Center the garden
    const startX = 0.5 - gardenWidthNorm / 2;
    const startY = 0.5 - gardenHeightNorm / 2;
    
    const boundaryPolygon = [
      { x: startX, y: startY },
      { x: startX + gardenWidthNorm, y: startY },
      { x: startX + gardenWidthNorm, y: startY + gardenHeightNorm },
      { x: startX, y: startY + gardenHeightNorm },
    ];
    
    const boundaryAreaSqM = length * width;

    const calibration: GardenScaleCalibration = {
      method: "reference_line",
      metersPerPixel,
      baseWidth: BASE_CANVAS_WIDTH,
      baseHeight: BASE_CANVAS_HEIGHT,
      boundaryPolygon,
      boundaryAreaSqM,
      manualLengthM: length,
      manualWidthM: width,
      showBaseImage: false,
      showGridOverlay: false,
      showBedMeasurements: false,
      orientationDegrees: 0,
    };

    await gardenRepository.updateScaleCalibration(gardenId, calibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    Alert.alert("Measurements saved", `Garden layout: ${length}m × ${width}m created. You can edit dimensions until you add beds or features. Note: No location or satellite image has been saved.`);
  };

  const mapAreaSqM = useMemo(() => polygonAreaSqMeters(mapBoundary), [mapBoundary]);

  const onMeasurementCanvasLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMeasurementCanvas({ width, height });
  };

  const measurementBoundary = useMemo(() => {
    const length = Number(manualLengthM);
    const width = Number(manualWidthM);
    
    if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) {
      // Default square if no valid measurements
      return [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ];
    }
    
    // Create rectangle with EXACT proportions of length×width
    // Length = horizontal, Width = vertical
    const aspectRatio = width / length;
    const maxDim = 0.8; // Use 80% of available space
    const padding = 0.1;
    
    let rectWidth, rectHeight;
    
    if (aspectRatio > 1) {
      // Taller than wide: fit to height, scale width
      rectHeight = maxDim;
      rectWidth = maxDim / aspectRatio;
    } else {
      // Wider than tall: fit to width, scale height  
      rectWidth = maxDim;
      rectHeight = maxDim * aspectRatio;
    }
    
    // Center the rectangle
    const startX = 0.5 - rectWidth / 2;
    const startY = 0.5 - rectHeight / 2;
    
    return [
      { x: startX, y: startY },
      { x: startX + rectWidth, y: startY },
      { x: startX + rectWidth, y: startY + rectHeight },
      { x: startX, y: startY + rectHeight },
    ];
  }, [manualLengthM, manualWidthM]);

  const measurementLabels = useMemo(() => {
    const length = Number(manualLengthM);
    const width = Number(manualWidthM);
    if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) return [];
    if (measurementBoundary.length < 4) return [];
    
    const topLeft = measurementBoundary[0];
    const topRight = measurementBoundary[1];
    const bottomRight = measurementBoundary[2];
    const bottomLeft = measurementBoundary[3];
    if (!topLeft || !topRight || !bottomRight || !bottomLeft) return [];
    
    return [
      {
        x: measurementCanvas.width * (topLeft.x + topRight.x) / 2,
        y: measurementCanvas.height * (topLeft.y - 0.04),
        text: `${length}m`,
      },
      {
        x: measurementCanvas.width * (topRight.x + 0.04),
        y: measurementCanvas.height * (topRight.y + bottomRight.y) / 2,
        text: `${width}m`,
      },
      {
        x: measurementCanvas.width * (bottomLeft.x + bottomRight.x) / 2,
        y: measurementCanvas.height * (bottomRight.y + 0.06),
        text: `${length}m`,
      },
      {
        x: measurementCanvas.width * (bottomLeft.x - 0.04),
        y: measurementCanvas.height * (topLeft.y + bottomLeft.y) / 2,
        text: `${width}m`,
      },
    ];
  }, [manualLengthM, manualWidthM, measurementCanvas, measurementBoundary]);

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
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>Choose how to set up your garden layout. Map mode captures satellite imagery and location, while measurements create a basic rectangular layout.</Text>

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
                <Text style={[styles.cardText, { color: theme.textMuted }]}>Tap around your garden edge, then save. Zoom in close and fill the screen with your garden - this will be your design layout. Boundary can be edited later, but only until you add beds or features.</Text>

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
                  <Pressable
                    style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                    onPress={() => void runMapDiagnostics()}
                  >
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Run Diagnostics</Text>
                  </Pressable>
                  <Pressable style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={undoMapBoundaryPoint}>
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Undo</Text>
                  </Pressable>
                  <Pressable style={[styles.toolButton, { backgroundColor: theme.dangerActionBackground, borderColor: theme.borderColor }]} onPress={deleteSelectedMapPoint}>
                    <Text style={[styles.toolButtonText, { color: theme.dangerActionText }]}>Delete Point</Text>
                  </Pressable>
                  <Pressable style={[styles.toolButton, { backgroundColor: theme.dangerActionBackground, borderColor: theme.borderColor }]} onPress={resetMapBoundary}>
                    <Text style={[styles.toolButtonText, { color: theme.dangerActionText }]}>Reset</Text>
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
                  onMapReady={() => {
                    if (mapReadyAlerted) return;
                    setMapReadyAlerted(true);
                    clearMapTilesTimeout();
                    mapTilesTimeoutRef.current = setTimeout(() => {
                      if (!mapTilesLoaded) {
                        showDebugAlert("Tiles not loaded after map ready", {
                          hint: "Likely Google Maps key auth/restriction/billing issue.",
                          checks: [
                            "Correct key value in build env",
                            "Package name com.tinyminds.gardenme",
                            "Play app signing SHA-1",
                            "Maps SDK for Android enabled",
                            "Billing active",
                          ],
                        });
                      }
                    }, 12000);
                    showDebugAlert("MapView ready", {
                      mapType,
                      centerLatitude: mapCenter.latitude,
                      centerLongitude: mapCenter.longitude,
                      boundaryPoints: mapBoundary.length,
                    });
                  }}
                  onMapTilesLoaded={() => {
                    setMapTilesLoaded(true);
                    clearMapTilesTimeout();
                    showDebugAlert("Map tiles loaded", "Google map tiles successfully loaded on device.");
                  }}
                  onMapLayout={(size) => {
                    if (mapLayoutAlerted) return;
                    setMapLayoutAlerted(true);
                    showDebugAlert("MapView layout", {
                      width: size.width,
                      height: size.height,
                    });
                  }}
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
                <Text style={[styles.cardText, { color: theme.textMuted }]}>Enter your garden dimensions for a basic rectangular layout. No satellite image or location will be saved. Once you add features or beds, you cannot return to add location data.</Text>

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

                <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />

                {/* Canvas Preview */}
                <Text style={[styles.cardText, { color: theme.textMuted }]}>Preview</Text>
                <View style={styles.zoomRow}>
                  <Pressable
                    style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                    onPress={() => setMeasurementZoom(Math.max(0.5, measurementZoom - 0.1))}
                  >
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Zoom Out</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                    onPress={() => setMeasurementZoom(Math.min(2, measurementZoom + 0.1))}
                  >
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Zoom In</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                    onPress={() => setMeasurementZoom(0.8)}
                  >
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Reset</Text>
                  </Pressable>
                </View>

                <View
                  style={[
                    styles.measurementCanvas,
                    { backgroundColor: theme.appBackground, borderColor: theme.borderColor }
                  ]}
                  onLayout={onMeasurementCanvasLayout}
                >
                  <Svg
                    width="100%"
                    height="100%"
                    viewBox={`${measurementCanvas.width * (1 - measurementZoom) / 2} ${measurementCanvas.height * (1 - measurementZoom) / 2} ${measurementCanvas.width * measurementZoom} ${measurementCanvas.height * measurementZoom}`}
                  >
                    <Polygon
                      points={measurementBoundary.map(p => `${p.x * measurementCanvas.width},${p.y * measurementCanvas.height}`).join(' ')}
                      fill={theme.mapBoundaryFill}
                      stroke={theme.mapBoundaryStroke}
                      strokeWidth={3}
                    />
                    {measurementLabels.map((label, index) => (
                      <SvgText
                        key={`measure-${index}`}
                        x={label.x}
                        y={label.y}
                        textAnchor="middle"
                        alignmentBaseline="middle"
                        fontSize={14}
                        fontWeight="700"
                        fill={theme.textPrimary}
                      >
                        {label.text}
                      </SvgText>
                    ))}
                  </Svg>
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

async function getCurrentUserLocation(): Promise<LatLngPoint> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    throw new Error("Location services are turned off on this device.");
  }

  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    if (!permission.canAskAgain) {
      throw new Error("Location permission is blocked. Open system settings and allow location for GardenMe.");
    }
    throw new Error("Location permission was denied.");
  }

  const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: current.coords.latitude, longitude: current.coords.longitude };
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
  measurementCanvas: {
    height: 200,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
});

