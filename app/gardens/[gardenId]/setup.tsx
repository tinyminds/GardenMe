import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Location from "expo-location";
import area from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Polygon } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { queryClient } from "@/state/queryClient";
import { polygonArea } from "@/features/garden-mapping/utils/geometry";
import MapBoundaryEditor, { type LatLngPoint } from "@/features/garden-mapping/components/MapBoundaryEditor";
import { PersistentNav } from "@/ui/components/PersistentNav";
import type { GardenScaleCalibration } from "@/domain/entities/Garden";

const BASE_CANVAS_WIDTH = 1000;
const BASE_CANVAS_HEIGHT = 700;
const AUTO_CLOSE_PX = 24;
const DEFAULT_MAP_CENTER: LatLngPoint = { latitude: 37.7749, longitude: -122.4194 };

type SetupMode = "map" | "draw" | "manual";
type CanvasMode = "draw" | "pan";
type NativeMapType = "standard" | "satellite" | "hybrid";

const gardenRepository = new SqliteGardenRepository();

export default function GardenSetupScreen() {
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;

  const [setupMode, setSetupMode] = useState<SetupMode>("map");
  const [boundary, setBoundary] = useState<{ x: number; y: number }[]>([]);
  const [isClosed, setIsClosed] = useState(false);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("draw");
  const [latitude, setLatitude] = useState(DEFAULT_MAP_CENTER.latitude.toFixed(4));
  const [zoomLevel, setZoomLevel] = useState("20");
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
  const [captureMapSnapshot, setCaptureMapSnapshot] = useState<(() => Promise<string>) | null>(null);
  const [locationHydrated, setLocationHydrated] = useState(false);
  const [viewport, setViewport] = useState({ width: 320, height: 220 });
  const [canvas, setCanvas] = useState({ width: BASE_CANVAS_WIDTH, height: BASE_CANVAS_HEIGHT });
  const zoomedWidth = Math.max(1, Math.round(viewport.width * zoom));
  const zoomedHeight = Math.max(1, Math.round(viewport.height * zoom));

  useEffect(() => {
    if (zoom > 1.01 && canvasMode !== "pan") {
      setCanvasMode("pan");
      return;
    }
    if (zoom <= 1.01 && canvasMode !== "draw") {
      setCanvasMode("draw");
    }
  }, [zoom, canvasMode]);

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
        const nextCenter = { latitude: savedLat, longitude: savedLng };
        setMapCenter(nextCenter);
        setLatitude(savedLat.toFixed(4));
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
          setLatitude(current.coords.latitude.toFixed(4));
          await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude);
          await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
        }
      } catch {
        // Keep default center if permission or lookup fails.
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
      setLatitude(current.coords.latitude.toFixed(4));
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
      Alert.alert("Search needed", "Enter an address, postcode, or place name.");
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
      setLatitude(first.latitude.toFixed(4));
      await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude, query);
      await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    } catch (error) {
      Alert.alert("Search failed", error instanceof Error ? error.message : "Could not search this location.");
    } finally {
      setSearchingMap(false);
    }
  };

  const mpp = useMemo(() => {
    const lat = Number(latitude);
    const zoom = Number(zoomLevel);
    if (!Number.isFinite(lat) || !Number.isFinite(zoom)) return null;
    return metersPerPixelAtLatitudeZoom(lat, zoom);
  }, [latitude, zoomLevel]);

  const normalizedBoundaryArea = polygonArea(boundary);
  const boundaryAreaSqM = mpp
    ? normalizedAreaToSqM(normalizedBoundaryArea, mpp, BASE_CANVAS_WIDTH, BASE_CANVAS_HEIGHT)
    : null;

  const manualAreaSqM = useMemo(() => {
    const length = Number(manualLengthM);
    const width = Number(manualWidthM);
    if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) return null;
    return length * width;
  }, [manualLengthM, manualWidthM]);

  const mapAreaSqM = useMemo(() => {
    return polygonAreaSqMeters(mapBoundary);
  }, [mapBoundary]);

  const onCanvasLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvas({ width, height });
  };

  const onViewportLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    const safeWidth = Math.max(1, Math.floor(width));
    const heightFromRatio = Math.floor((safeWidth * BASE_CANVAS_HEIGHT) / BASE_CANVAS_WIDTH);
    setViewport({ width: safeWidth, height: Math.max(180, heightFromRatio) });
  };

  const onCanvasTap = (event: GestureResponderEvent) => {
    const tap = getNormalizedTapPoint(event, canvas);
    if (!tap) {
      return;
    }

    if (isClosed) {
      setBoundary([tap]);
      setIsClosed(false);
      setSelectedPointIndex(null);
      return;
    }

    if (boundary.length >= 3) {
      const first = boundary[0];
      if (first) {
        const distancePx = Math.hypot((tap.x - first.x) * canvas.width, (tap.y - first.y) * canvas.height);
        if (distancePx <= AUTO_CLOSE_PX) {
          setIsClosed(true);
          return;
        }
      }
    }

    setBoundary((prev) => [...prev, tap]);
  };

  const undoBoundaryPoint = () => {
    setBoundary((prev) => prev.slice(0, -1));
    setSelectedPointIndex(null);
    if (boundary.length <= 3) {
      setIsClosed(false);
    }
  };

  const deleteSelectedBoundaryPoint = () => {
    if (selectedPointIndex === null) return;
    setBoundary((prev) => prev.filter((_p, idx) => idx !== selectedPointIndex));
    setSelectedPointIndex(null);
    setIsClosed(false);
  };

  const resetBoundary = () => {
    setBoundary([]);
    setIsClosed(false);
    setSelectedPointIndex(null);
  };

  const finishBoundary = () => {
    if (boundary.length < 3) {
      Alert.alert("Need 3 points", "Add at least 3 points before finishing the boundary.");
      return;
    }
    setIsClosed(true);
  };

  const reverseBoundaryOrder = () => {
    setBoundary((prev) => [...prev].reverse());
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

  const pickPhoto = async () => {
    if (!gardenId) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo access to select your base image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    await gardenRepository.updatePhoto(gardenId, asset.uri, "satellite");
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
  };

  const saveManualSetup = async () => {
    if (!gardenId) return;

    const length = Number(manualLengthM);
    const width = Number(manualWidthM);
    if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) {
      Alert.alert("Invalid dimensions", "Enter valid garden length and width in meters.");
      return;
    }

    const imageAreaPixels = BASE_CANVAS_WIDTH * BASE_CANVAS_HEIGHT;
    const metersPerPixel = Math.sqrt((length * width) / imageAreaPixels);

    const calibration: GardenScaleCalibration = {
      method: "reference_line",
      metersPerPixel,
      baseWidth: BASE_CANVAS_WIDTH,
      baseHeight: BASE_CANVAS_HEIGHT,
      boundaryPolygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      boundaryAreaSqM: length * width,
      manualLengthM: length,
      manualWidthM: width,
    };

    await gardenRepository.updateScaleCalibration(gardenId, calibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    Alert.alert("Manual setup saved", `Garden area set to ${Math.round(length * width)} sqm.`);
  };

  const saveDrawSetup = async () => {
    if (!gardenId) return;

    if (boundary.length < 3) {
      Alert.alert("Draw boundary", "Tap around the outer garden boundary with at least 3 points.");
      return;
    }

    const wasOpen = !isClosed;
    if (wasOpen) {
      setIsClosed(true);
    }

    const lat = Number(latitude);
    const zoom = Number(zoomLevel);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      Alert.alert("Latitude invalid", "Enter latitude between -90 and 90.");
      return;
    }
    if (!Number.isFinite(zoom) || zoom < 14 || zoom > 22) {
      Alert.alert("Zoom invalid", "Enter map zoom between 14 and 22.");
      return;
    }

    if (!mpp) {
      Alert.alert("Scale invalid", "Could not calculate map scale from latitude/zoom.");
      return;
    }

    const originalUri = gardenQuery.data?.photoUri;
    let finalBoundary = boundary;
    const finalAreaSqM = boundaryAreaSqM ?? undefined;

    if (originalUri) {
      const cropResult = await cropImageToBoundary(originalUri, boundary);
      await gardenRepository.updatePhoto(gardenId, cropResult.uri, "satellite");
      finalBoundary = cropResult.remappedBoundary;
    }

    const calibration: GardenScaleCalibration = {
      method: "map_zoom",
      metersPerPixel: mpp,
      baseWidth: BASE_CANVAS_WIDTH,
      baseHeight: BASE_CANVAS_HEIGHT,
      latitude: lat,
      zoomLevel: zoom,
      boundaryPolygon: finalBoundary,
    };

    if (finalAreaSqM !== undefined) {
      calibration.boundaryAreaSqM = finalAreaSqM;
    }

    await gardenRepository.updateScaleCalibration(gardenId, calibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    Alert.alert(
      "Setup saved",
      `${finalAreaSqM ? `Garden area ~ ${finalAreaSqM.toFixed(1)} sqm.` : "Scale saved."}${
        wasOpen ? " Boundary auto-finished on save." : ""
      }${originalUri ? " Boundary region is now your mapping image." : ""}`
    );
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

    const normalizedBoundary = normalizeLatLngBoundary(finalBoundaryGeo);
    const normalizedArea = polygonArea(normalizedBoundary);
    if (!Number.isFinite(normalizedArea) || normalizedArea <= 0) {
      Alert.alert("Boundary invalid", "Could not normalize this boundary. Try redrawing.");
      return;
    }

    const metersPerPixel = Math.sqrt(
      boundaryAreaSqM / (normalizedArea * BASE_CANVAS_WIDTH * BASE_CANVAS_HEIGHT)
    );

    let snapshotSaved = false;
    if (captureMapSnapshot) {
      try {
        const snapshotUri = await captureMapSnapshot();
        if (snapshotUri) {
          await gardenRepository.updatePhoto(gardenId, snapshotUri, "satellite");
          snapshotSaved = true;
        }
      } catch {
        // Keep save flow successful even if snapshot capture fails.
      }
    }

    const calibration: GardenScaleCalibration = {
      method: "map_polygon",
      metersPerPixel,
      baseWidth: BASE_CANVAS_WIDTH,
      baseHeight: BASE_CANVAS_HEIGHT,
      latitude: mapCenter.latitude,
      boundaryPolygon: normalizedBoundary,
      boundaryGeoPolygon: finalBoundaryGeo,
      boundaryAreaSqM,
    };

    await gardenRepository.updateScaleCalibration(gardenId, calibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    Alert.alert(
      "Map setup saved",
      `Garden area set to ${boundaryAreaSqM.toFixed(1)} sqm.${snapshotSaved ? " Map image captured for planner." : ""}`
    );
  };

  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardWrap}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            scrollEnabled={setupMode !== "draw" || canvasMode === "draw"}
          >
            <Text style={styles.title}>Garden Setup</Text>
            <Text style={styles.subtitle}>Choose map boundary (accurate), image boundary, or manual dimensions.</Text>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>1. Base Image</Text>
              <Text style={styles.cardText}>Use a satellite screenshot or property image. You can replace it later.</Text>
              <View style={styles.row}>
                <Pressable style={styles.button} onPress={pickPhoto}>
                  <Text style={styles.buttonText}>Pick Image</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.secondaryButton]}
                  onPress={() =>
                    Alert.alert(
                      "Map Provider",
                      "Map boundary mode uses your native map view. For production tile control, plug in a provider key later."
                    )
                  }
                >
                  <Text style={[styles.buttonText, styles.secondaryButtonText]}>Map Provider Info</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>2. Setup Method</Text>
              <View style={styles.row}>
                <Pressable
                  style={[styles.modeChip, setupMode === "map" && styles.modeChipActive]}
                  onPress={() => setSetupMode("map")}
                >
                  <Text style={[styles.modeChipText, setupMode === "map" && styles.modeChipTextActive]}>Map Boundary</Text>
                </Pressable>
                <Pressable
                  style={[styles.modeChip, setupMode === "draw" && styles.modeChipActive]}
                  onPress={() => setSetupMode("draw")}
                >
                  <Text style={[styles.modeChipText, setupMode === "draw" && styles.modeChipTextActive]}>Image Boundary</Text>
                </Pressable>
                <Pressable
                  style={[styles.modeChip, setupMode === "manual" && styles.modeChipActive]}
                  onPress={() => setSetupMode("manual")}
                >
                  <Text style={[styles.modeChipText, setupMode === "manual" && styles.modeChipTextActive]}>Manual L x W</Text>
                </Pressable>
              </View>
            </View>

            {setupMode === "map" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>3. Draw Garden Boundary On Map</Text>
                  <Text style={styles.cardText}>Tap to add points, drag markers to edit. This gives accurate size in sqm.</Text>
                  <View style={styles.row}>
                    <Pressable
                      style={[styles.modeChip, mapType === "standard" && styles.modeChipActive]}
                      onPress={() => setMapType("standard")}
                    >
                      <Text style={[styles.modeChipText, mapType === "standard" && styles.modeChipTextActive]}>Standard</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.modeChip, mapType === "satellite" && styles.modeChipActive]}
                      onPress={() => setMapType("satellite")}
                    >
                      <Text style={[styles.modeChipText, mapType === "satellite" && styles.modeChipTextActive]}>Satellite</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.modeChip, mapType === "hybrid" && styles.modeChipActive]}
                      onPress={() => setMapType("hybrid")}
                    >
                      <Text style={[styles.modeChipText, mapType === "hybrid" && styles.modeChipTextActive]}>Satellite + Labels</Text>
                    </Pressable>
                  </View>
                  <View style={styles.searchRow}>
                    <TextInput
                      value={mapSearch}
                      onChangeText={setMapSearch}
                      style={styles.input}
                      placeholder="Search address or place"
                      returnKeyType="search"
                      onSubmitEditing={() => {
                        void searchMapLocation();
                      }}
                    />
                    <Pressable style={styles.toolButton} onPress={() => void searchMapLocation()} disabled={searchingMap}>
                      {searchingMap ? (
                        <ActivityIndicator color="#2D4B3C" size="small" />
                      ) : (
                        <Text style={styles.toolButtonText}>Search</Text>
                      )}
                    </Pressable>
                    <Pressable style={styles.toolButton} onPress={() => void moveToCurrentLocation()} disabled={locatingUser}>
                      {locatingUser ? (
                        <ActivityIndicator color="#2D4B3C" size="small" />
                      ) : (
                        <Text style={styles.toolButtonText}>My Location</Text>
                      )}
                    </Pressable>
                  </View>
                  <View style={styles.zoomRow}>
                    <Pressable style={styles.toolButton} onPress={undoMapBoundaryPoint}>
                      <Text style={styles.toolButtonText}>Undo</Text>
                    </Pressable>
                    <Pressable style={styles.toolButton} onPress={deleteSelectedMapPoint}>
                      <Text style={styles.toolButtonText}>Delete Point</Text>
                    </Pressable>
                    <Pressable style={styles.toolButton} onPress={finishMapBoundary}>
                      <Text style={styles.toolButtonText}>Finish Shape</Text>
                    </Pressable>
                    <Pressable style={styles.toolButton} onPress={resetMapBoundary}>
                      <Text style={styles.toolButtonText}>Reset</Text>
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
                  <Text style={styles.infoText}>
                    Boundary points: {mapBoundary.length}
                    {isMapClosed ? " (closed)" : ""}
                  </Text>
                  <Text style={styles.infoText}>Estimated garden area: {mapAreaSqM > 0 ? `${mapAreaSqM.toFixed(1)} sqm` : "-"}</Text>
                  <Pressable style={styles.button} onPress={saveMapSetup}>
                    <Text style={styles.buttonText}>Save Map Boundary</Text>
                  </Pressable>
                </View>
              </>
            ) : setupMode === "draw" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>3. Draw Whole Garden Boundary</Text>
                  <Text style={styles.cardText}>Tap around the garden edge. Use Finish to complete or tap near the first point.</Text>
                  <View style={styles.zoomRow}>
                    <Pressable style={styles.zoomButton} onPress={() => setZoom((z) => clamp(z - 0.25, 1, 10))}>
                      <Text style={styles.zoomButtonText}>-</Text>
                    </Pressable>
                    <Text style={styles.zoomText}>{Math.round(zoom * 100)}%</Text>
                    <Pressable style={styles.zoomButton} onPress={() => setZoom((z) => clamp(z + 0.25, 1, 10))}>
                      <Text style={styles.zoomButtonText}>+</Text>
                    </Pressable>
                    <Pressable style={styles.toolButton} onPress={undoBoundaryPoint}>
                      <Text style={styles.toolButtonText}>Undo</Text>
                    </Pressable>
                    <Pressable style={styles.toolButton} onPress={deleteSelectedBoundaryPoint}>
                      <Text style={styles.toolButtonText}>Delete Point</Text>
                    </Pressable>
                    <Pressable style={styles.toolButton} onPress={finishBoundary}>
                      <Text style={styles.toolButtonText}>Finish Shape</Text>
                    </Pressable>
                    <Pressable style={styles.toolButton} onPress={reverseBoundaryOrder}>
                      <Text style={styles.toolButtonText}>Reverse</Text>
                    </Pressable>
                    <Pressable style={styles.toolButton} onPress={resetBoundary}>
                      <Text style={styles.toolButtonText}>Reset</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.toolButton, canvasMode === "pan" && styles.toolButtonActive]}
                      onPress={() => setCanvasMode((mode) => (mode === "draw" ? "pan" : "draw"))}
                    >
                      <Text style={[styles.toolButtonText, canvasMode === "pan" && styles.toolButtonTextActive]}>
                        {canvasMode === "draw" ? "Pan Canvas" : "Draw Points"}
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={styles.infoText}>
                    Mode: {canvasMode === "draw" ? "Draw/edit boundary points and scroll page." : "Pan/zoom canvas without adding points."}
                  </Text>

                  <View style={styles.canvasViewport} onLayout={onViewportLayout}>
                    <ScrollView
                      horizontal
                      bounces={false}
                      style={styles.canvasOuterScroll}
                      nestedScrollEnabled
                      scrollEnabled={canvasMode === "pan" && zoom > 1.01}
                    >
                      <ScrollView
                        bounces={false}
                        nestedScrollEnabled
                        scrollEnabled={canvasMode === "pan" && zoom > 1.01}
                      >
                      <View
                        style={[styles.canvasWrap, { width: zoomedWidth, height: zoomedHeight }]}
                        onLayout={onCanvasLayout}
                      >
                        {gardenQuery.data?.photoUri ? (
                          <Image source={{ uri: gardenQuery.data.photoUri }} style={styles.canvasImage} resizeMode="contain" />
                        ) : (
                          <View style={[styles.canvasImage, styles.placeholder]}>
                            <Text style={styles.placeholderText}>Pick image first</Text>
                          </View>
                        )}

                        <Pressable style={StyleSheet.absoluteFill} onPress={onCanvasTap} disabled={canvasMode === "pan"}>
                          <Svg width="100%" height="100%">
                            {boundary.length >= 2 && (
                              <Polygon
                                points={toSvgPoints(boundary, canvas)}
                                fill={isClosed ? "rgba(53,130,82,0.3)" : "rgba(0,0,0,0.05)"}
                                stroke="#2F6F4F"
                                strokeWidth={3}
                                {...(!isClosed ? { strokeDasharray: [10, 5] } : {})}
                              />
                            )}
                            {boundary.filter(isFinitePoint).map((p, idx) => (
                              <Circle
                                key={idx.toString()}
                                cx={p.x * canvas.width}
                                cy={p.y * canvas.height}
                                r={selectedPointIndex === idx ? 8 : 6}
                                fill={selectedPointIndex === idx ? "#E85D2A" : "#FFFFFF"}
                                stroke="#1F3D2A"
                                strokeWidth={2}
                              />
                            ))}
                          </Svg>
                          {canvasMode === "draw" &&
                            boundary.filter(isFinitePoint).map((point, index) => (
                            <VertexHandle
                              key={`boundary-handle-${index.toString()}`}
                              point={point}
                              width={canvas.width}
                              height={canvas.height}
                              onSelect={() => setSelectedPointIndex(index)}
                              onDrag={(nextPoint) => {
                                setBoundary((prev) => prev.map((p, i) => (i === index ? nextPoint : p)));
                              }}
                            />
                            ))}
                        </Pressable>
                      </View>
                      </ScrollView>
                    </ScrollView>
                  </View>

                  <Text style={styles.infoText}>On save, the selected boundary is cropped and used as the planner image.</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>4. Image Scale Inputs</Text>
                  <Text style={styles.cardText}>For image tracing, enter map center latitude and zoom used to capture the image.</Text>

                  <View style={styles.inputRow}>
                    <TextInput value={latitude} onChangeText={setLatitude} keyboardType="decimal-pad" style={styles.input} placeholder="Latitude" />
                    <TextInput value={zoomLevel} onChangeText={setZoomLevel} keyboardType="decimal-pad" style={styles.input} placeholder="Zoom" />
                  </View>

                  <Text style={styles.infoText}>Meters/pixel: {mpp ? mpp.toFixed(4) : "-"}</Text>
                  <Text style={styles.infoText}>Boundary points: {boundary.length}{isClosed ? " (closed)" : ""}</Text>
                  <Text style={styles.infoText}>Estimated garden area: {boundaryAreaSqM ? `${boundaryAreaSqM.toFixed(1)} sqm` : "-"}</Text>

                  <Pressable style={styles.button} onPress={saveDrawSetup}>
                    <Text style={styles.buttonText}>Save Boundary + Scale</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>3. Manual Garden Size</Text>
                <Text style={styles.cardText}>If you know approximate dimensions, enter them directly.</Text>

                <View style={styles.inputRow}>
                  <TextInput
                    value={manualLengthM}
                    onChangeText={setManualLengthM}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    placeholder="Length (m)"
                  />
                  <TextInput
                    value={manualWidthM}
                    onChangeText={setManualWidthM}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    placeholder="Width (m)"
                  />
                </View>

                <Text style={styles.infoText}>Estimated garden area: {manualAreaSqM ? `${manualAreaSqM.toFixed(1)} sqm` : "-"}</Text>
                <Pressable style={styles.button} onPress={saveManualSetup}>
                  <Text style={styles.buttonText}>Save Manual Setup</Text>
                </Pressable>
              </View>
            )}

            {gardenId && <Link href={`/gardens/${gardenId}/map`} style={styles.mapperLink}>Continue to Garden Mapper</Link>}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <PersistentNav />
    </View>
  );
}

function VertexHandle(props: {
  point: { x: number; y: number };
  width: number;
  height: number;
  onSelect: () => void;
  onDrag: (point: { x: number; y: number }) => void;
}) {
  const panResponder = useMemo(() => {
    let startPoint = props.point;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startPoint = props.point;
        props.onSelect();
      },
      onPanResponderMove: (_event, gestureState) => {
        if (props.width <= 0 || props.height <= 0) return;
        props.onDrag({
          x: clamp(startPoint.x + gestureState.dx / props.width, 0, 1),
          y: clamp(startPoint.y + gestureState.dy / props.height, 0, 1),
        });
      },
    });
  }, [props]);

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.handle,
        {
          left: props.point.x * props.width - 14,
          top: props.point.y * props.height - 14,
        },
      ]}
    />
  );
}

async function cropImageToBoundary(
  uri: string,
  boundary: { x: number; y: number }[]
): Promise<{ uri: string; remappedBoundary: { x: number; y: number }[] }> {
  if (boundary.length < 3) return { uri, remappedBoundary: boundary };

  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);

  const minX = clamp(Math.min(...xs), 0, 1);
  const maxX = clamp(Math.max(...xs), 0, 1);
  const minY = clamp(Math.min(...ys), 0, 1);
  const maxY = clamp(Math.max(...ys), 0, 1);

  const imageSize = await getImageSize(uri);

  const originX = Math.floor(minX * imageSize.width);
  const originY = Math.floor(minY * imageSize.height);
  const width = Math.max(1, Math.floor((maxX - minX) * imageSize.width));
  const height = Math.max(1, Math.floor((maxY - minY) * imageSize.height));

  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop: { originX, originY, width, height } }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );

  const remappedBoundary = boundary.map((p) => ({
    x: clamp((p.x - minX) / Math.max(maxX - minX, 1e-6), 0, 1),
    y: clamp((p.y - minY) / Math.max(maxY - minY, 1e-6), 0, 1),
  }));

  return { uri: result.uri, remappedBoundary };
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error)
    );
  });
}

function metersPerPixelAtLatitudeZoom(latitude: number, zoom: number): number {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
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

function normalizedAreaToSqM(
  normalizedArea: number,
  metersPerPixel: number,
  baseWidth: number,
  baseHeight: number
): number {
  return normalizedArea * baseWidth * baseHeight * metersPerPixel * metersPerPixel;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasValidCoordinates(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return Math.abs(latitude) > 0.000001 || Math.abs(longitude) > 0.000001;
}

function getNormalizedTapPoint(
  event: GestureResponderEvent,
  canvas: { width: number; height: number }
): { x: number; y: number } | null {
  if (canvas.width <= 0 || canvas.height <= 0) return null;

  const native = event.nativeEvent as GestureResponderEvent["nativeEvent"] & {
    offsetX?: number;
    offsetY?: number;
  };
  const rawX = Number.isFinite(native.locationX) ? native.locationX : native.offsetX;
  const rawY = Number.isFinite(native.locationY) ? native.locationY : native.offsetY;
  const x = rawX ?? Number.NaN;
  const y = rawY ?? Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    x: clamp(x / canvas.width, 0, 1),
    y: clamp(y / canvas.height, 0, 1),
  };
}

function isFinitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function toSvgPoints(points: { x: number; y: number }[], canvas: { width: number; height: number }): string {
  return points
    .filter(isFinitePoint)
    .map((p) => `${p.x * canvas.width},${p.y * canvas.height}`)
    .join(" ");
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#EFF6EC" },
  safeArea: { flex: 1, backgroundColor: "#EFF6EC" },
  keyboardWrap: { flex: 1 },
  content: { padding: 14, gap: 10, paddingBottom: 120 },
  title: { fontSize: 28, fontWeight: "800", color: "#1B3D2A" },
  subtitle: { color: "#4E6759", marginBottom: 2 },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E5D5",
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  cardTitle: { fontWeight: "800", color: "#2A4738" },
  cardText: { color: "#587063" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  button: { backgroundColor: "#2F6F4F", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
  secondaryButton: { backgroundColor: "#E3ECE0" },
  secondaryButtonText: { color: "#2E4B3C" },
  modeChip: { backgroundColor: "#DFEADF", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  modeChipActive: { backgroundColor: "#2F6F4F" },
  modeChipText: { color: "#2F4A3A", fontWeight: "700" },
  modeChipTextActive: { color: "#FFFFFF" },
  zoomRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  zoomButton: { backgroundColor: "#DFEADF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  zoomButtonText: { fontSize: 18, fontWeight: "700", color: "#23412E" },
  zoomText: { minWidth: 52, textAlign: "center", fontWeight: "700", color: "#375947" },
  toolButton: { backgroundColor: "#E9F1E6", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  toolButtonText: { color: "#2D4B3C", fontWeight: "700", fontSize: 12 },
  toolButtonActive: { backgroundColor: "#245A3E" },
  toolButtonTextActive: { color: "#FFFFFF" },
  canvasOuterScroll: { maxHeight: 320 },
  canvasViewport: { borderRadius: 12, overflow: "hidden", maxHeight: 320 },
  canvasWrap: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#C8D7C4",
    backgroundColor: "#E7EFE5",
  },
  canvasImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  placeholder: { justifyContent: "center", alignItems: "center" },
  placeholderText: { color: "#5C7465" },
  inputRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#C1D2BE",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
  },
  infoText: { color: "#587063", fontWeight: "600" },
  mapperLink: {
    color: "#FFFFFF",
    fontWeight: "800",
    backgroundColor: "#245A3E",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    overflow: "hidden",
    textAlign: "center",
  },
  handle: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(232,93,42,0.35)",
    borderWidth: 2,
    borderColor: "#E85D2A",
  },
});

