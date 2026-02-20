import * as Location from "expo-location";
import area from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
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
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Line, Polygon, Text as SvgText } from "react-native-svg";
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
const PLAN_BOUNDARY_PADDING = 0.01;
const PLAN_BOUNDARY_MIN_SIZE = 0.04;
const DEFAULT_MAP_CENTER: LatLngPoint = { latitude: 37.7749, longitude: -122.4194 };

type SetupMode = "map" | "measure" | "plan";
type NativeMapType = "standard" | "satellite" | "hybrid";
type PlanHandle = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";
type PlanImageDraft = { uri: string; width: number; height: number };
type RectBounds = { left: number; top: number; right: number; bottom: number };

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
  const [setupHydratedGardenId, setSetupHydratedGardenId] = useState<string | null>(null);
  
  // Canvas preview for measurements mode
  const [measurementCanvas, setMeasurementCanvas] = useState({ width: BASE_CANVAS_WIDTH, height: BASE_CANVAS_HEIGHT });
  const [measurementZoom, setMeasurementZoom] = useState(0.8); // Start zoomed out to show padding
  const [planImage, setPlanImage] = useState<PlanImageDraft | null>(null);
  const [planBoundaryBounds, setPlanBoundaryBounds] = useState<RectBounds>({
    left: 0.2,
    top: 0.2,
    right: 0.8,
    bottom: 0.8,
  });
  const [planStep, setPlanStep] = useState<"draw" | "measure">("draw");
  const [planReferenceMetersInput, setPlanReferenceMetersInput] = useState("");
  const [planCanvas, setPlanCanvas] = useState({ width: BASE_CANVAS_WIDTH, height: BASE_CANVAS_HEIGHT });
  const planDragStartRef = useRef<RectBounds | null>(null);
  const planBoundaryBoundsRef = useRef(planBoundaryBounds);
  const planCanvasRef = useRef(planCanvas);

  const gardenQuery = useQuery({
    queryKey: ["garden", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing garden id");
      return gardenRepository.getById(gardenId);
    },
  });

  useEffect(() => {
    // Geographic boundary display is disabled when design begins
    // Setup becomes locked after beds/features are created
  }, []);

  useEffect(() => {
    setSetupHydratedGardenId(null);
    setLocationHydrated(false);
  }, [gardenId]);

  // Hydrate setup form from saved garden data when returning to this screen.
  useEffect(() => {
    if (!gardenId || !gardenQuery.isSuccess || setupHydratedGardenId === gardenId) return;
    const garden = gardenQuery.data;
    const calibration = garden?.scaleCalibration;

    if (calibration?.method === "map_polygon") {
      setSetupMode("map");
      const geoBoundary = calibration.boundaryGeoPolygon ?? [];
      if (geoBoundary.length >= 3) {
        setMapBoundary(geoBoundary.map((point) => ({ latitude: point.latitude, longitude: point.longitude })));
        setIsMapClosed(true);
      }
    }

    const isUploadedPlanMode =
      calibration?.method === "reference_line" &&
      garden?.imageSourceType === "photo" &&
      Boolean(garden.photoUri) &&
      calibration?.showBaseImage !== false &&
      (calibration?.boundaryPolygon?.length ?? 0) >= 3;

    if (isUploadedPlanMode && garden.photoUri && calibration) {
      setSetupMode("plan");
      setPlanImage({
        uri: garden.photoUri,
        width: Math.max(1, Math.round(calibration.baseWidth || BASE_CANVAS_WIDTH)),
        height: Math.max(1, Math.round(calibration.baseHeight || BASE_CANVAS_HEIGHT)),
      });
      const boundary = calibration.boundaryPolygon ?? [];
      if (boundary.length >= 3) {
        const xs = boundary.map((point) => point.x);
        const ys = boundary.map((point) => point.y);
        const rawLeft = Math.min(...xs);
        const rawRight = Math.max(...xs);
        const rawTop = Math.min(...ys);
        const rawBottom = Math.max(...ys);
        const left = clamp(rawLeft, PLAN_BOUNDARY_PADDING, 1 - PLAN_BOUNDARY_PADDING - PLAN_BOUNDARY_MIN_SIZE);
        const top = clamp(rawTop, PLAN_BOUNDARY_PADDING, 1 - PLAN_BOUNDARY_PADDING - PLAN_BOUNDARY_MIN_SIZE);
        const right = clamp(rawRight, left + PLAN_BOUNDARY_MIN_SIZE, 1 - PLAN_BOUNDARY_PADDING);
        const bottom = clamp(rawBottom, top + PLAN_BOUNDARY_MIN_SIZE, 1 - PLAN_BOUNDARY_PADDING);
        setPlanBoundaryBounds({ left, top, right, bottom });
      }
      if (typeof calibration.referenceMeters === "number" && calibration.referenceMeters > 0) {
        setPlanReferenceMetersInput(calibration.referenceMeters.toString());
      }
      setPlanStep("draw");
    }

    if (calibration?.method === "reference_line" && !isUploadedPlanMode) {
      setSetupMode("measure");
      if (typeof calibration.manualLengthM === "number" && calibration.manualLengthM > 0) {
        setManualLengthM(calibration.manualLengthM.toString());
      }
      if (typeof calibration.manualWidthM === "number" && calibration.manualWidthM > 0) {
        setManualWidthM(calibration.manualWidthM.toString());
      }
    }

    setSetupHydratedGardenId(gardenId);
  }, [gardenId, gardenQuery.data, gardenQuery.isSuccess, setupHydratedGardenId]);

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
        const nextCenter = await getCurrentUserLocation();
        setMapCenter(nextCenter);
        await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude);
        await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
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
      const nextCenter = await getCurrentUserLocation();
      setMapCenter(nextCenter);
      await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude);
      await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    } catch (error) {
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
      const results = await Location.geocodeAsync(query);
      const first = results[0];
      if (!first) {
        Alert.alert("Location not found", "No results found. Try a more specific address or different search terms.");
        return;
      }
      const nextCenter = { latitude: first.latitude, longitude: first.longitude };
      setMapCenter(nextCenter);
      await gardenRepository.updateLocation(gardenId, nextCenter.latitude, nextCenter.longitude, query);
      await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    } catch (error) {
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
        }
      } catch {
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

  const planBoundary = useMemo(() => {
    return [
      { x: planBoundaryBounds.left, y: planBoundaryBounds.top },
      { x: planBoundaryBounds.right, y: planBoundaryBounds.top },
      { x: planBoundaryBounds.right, y: planBoundaryBounds.bottom },
      { x: planBoundaryBounds.left, y: planBoundaryBounds.bottom },
    ];
  }, [planBoundaryBounds]);

  const planReferenceEdgePixels = useMemo(() => {
    const baseWidth = planImage?.width ?? BASE_CANVAS_WIDTH;
    const dx = planBoundaryBounds.right - planBoundaryBounds.left;
    return Math.max(1e-6, dx * baseWidth);
  }, [planBoundaryBounds.left, planBoundaryBounds.right, planImage?.width]);

  useEffect(() => {
    planBoundaryBoundsRef.current = planBoundaryBounds;
  }, [planBoundaryBounds]);

  useEffect(() => {
    planCanvasRef.current = planCanvas;
  }, [planCanvas]);

  const planAreaPreviewSqM = useMemo(() => {
    const referenceMeters = Number(planReferenceMetersInput);
    if (!Number.isFinite(referenceMeters) || referenceMeters <= 0) return null;
    const baseWidth = planImage?.width ?? BASE_CANVAS_WIDTH;
    const baseHeight = planImage?.height ?? BASE_CANVAS_HEIGHT;
    const metersPerPixel = referenceMeters / planReferenceEdgePixels;
    const normalizedArea = polygonArea(planBoundary);
    const areaSqM = normalizedArea * baseWidth * baseHeight * metersPerPixel * metersPerPixel;
    if (!Number.isFinite(areaSqM) || areaSqM <= 0) return null;
    return areaSqM;
  }, [planBoundary, planImage?.height, planImage?.width, planReferenceEdgePixels, planReferenceMetersInput]);

  const onPlanCanvasLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    setPlanCanvas((prev) => (prev.width === safeWidth && prev.height === safeHeight ? prev : { width: safeWidth, height: safeHeight }));
  };

  const pickPlanImage = async (source: "camera" | "library") => {
    const permissionResult = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert("Permission needed", source === "camera" ? "Camera permission is required." : "Photo library permission is required.");
      return;
    }

    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          quality: 0.9,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: false,
          allowsEditing: true,
          quality: 0.9,
        });

    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.uri) return;

    const imageWidth = Math.max(1, Math.round(asset.width ?? BASE_CANVAS_WIDTH));
    const imageHeight = Math.max(1, Math.round(asset.height ?? BASE_CANVAS_HEIGHT));

    setPlanImage({ uri: asset.uri, width: imageWidth, height: imageHeight });
    setPlanBoundaryBounds({
      left: 0.2,
      top: 0.2,
      right: 0.8,
      bottom: 0.8,
    });
    setPlanReferenceMetersInput("");
    setPlanStep("draw");
  };

  const updatePlanBoundaryForHandle = (
    startBounds: RectBounds,
    handle: PlanHandle,
    deltaXNorm: number,
    deltaYNorm: number
  ) => {
    let { left, right, top, bottom } = startBounds;
    switch (handle) {
      case "topLeft":
        left = clamp(left + deltaXNorm, PLAN_BOUNDARY_PADDING, right - PLAN_BOUNDARY_MIN_SIZE);
        top = clamp(top + deltaYNorm, PLAN_BOUNDARY_PADDING, bottom - PLAN_BOUNDARY_MIN_SIZE);
        break;
      case "topRight":
        right = clamp(right + deltaXNorm, left + PLAN_BOUNDARY_MIN_SIZE, 1 - PLAN_BOUNDARY_PADDING);
        top = clamp(top + deltaYNorm, PLAN_BOUNDARY_PADDING, bottom - PLAN_BOUNDARY_MIN_SIZE);
        break;
      case "bottomRight":
        right = clamp(right + deltaXNorm, left + PLAN_BOUNDARY_MIN_SIZE, 1 - PLAN_BOUNDARY_PADDING);
        bottom = clamp(bottom + deltaYNorm, top + PLAN_BOUNDARY_MIN_SIZE, 1 - PLAN_BOUNDARY_PADDING);
        break;
      case "bottomLeft":
        left = clamp(left + deltaXNorm, PLAN_BOUNDARY_PADDING, right - PLAN_BOUNDARY_MIN_SIZE);
        bottom = clamp(bottom + deltaYNorm, top + PLAN_BOUNDARY_MIN_SIZE, 1 - PLAN_BOUNDARY_PADDING);
        break;
    }
    return { left, right, top, bottom };
  };

  const movePlanBoundary = (startBounds: RectBounds, deltaXNorm: number, deltaYNorm: number): RectBounds => {
    const width = startBounds.right - startBounds.left;
    const height = startBounds.bottom - startBounds.top;
    const left = clamp(startBounds.left + deltaXNorm, PLAN_BOUNDARY_PADDING, 1 - PLAN_BOUNDARY_PADDING - width);
    const top = clamp(startBounds.top + deltaYNorm, PLAN_BOUNDARY_PADDING, 1 - PLAN_BOUNDARY_PADDING - height);
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
    };
  };

  const topLeftPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          planDragStartRef.current = planBoundaryBoundsRef.current;
        },
        onPanResponderMove: (_event, gestureState) => {
          const canvas = planCanvasRef.current;
          if (canvas.width <= 0 || canvas.height <= 0) return;
          const startBounds = planDragStartRef.current ?? planBoundaryBoundsRef.current;
          const next = updatePlanBoundaryForHandle(
            startBounds,
            "topLeft",
            gestureState.dx / canvas.width,
            gestureState.dy / canvas.height
          );
          setPlanBoundaryBounds(next);
        },
        onPanResponderRelease: () => {
          planDragStartRef.current = null;
        },
      }),
    []
  );

  const topRightPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          planDragStartRef.current = planBoundaryBoundsRef.current;
        },
        onPanResponderMove: (_event, gestureState) => {
          const canvas = planCanvasRef.current;
          if (canvas.width <= 0 || canvas.height <= 0) return;
          const startBounds = planDragStartRef.current ?? planBoundaryBoundsRef.current;
          const next = updatePlanBoundaryForHandle(
            startBounds,
            "topRight",
            gestureState.dx / canvas.width,
            gestureState.dy / canvas.height
          );
          setPlanBoundaryBounds(next);
        },
        onPanResponderRelease: () => {
          planDragStartRef.current = null;
        },
      }),
    []
  );

  const bottomRightPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          planDragStartRef.current = planBoundaryBoundsRef.current;
        },
        onPanResponderMove: (_event, gestureState) => {
          const canvas = planCanvasRef.current;
          if (canvas.width <= 0 || canvas.height <= 0) return;
          const startBounds = planDragStartRef.current ?? planBoundaryBoundsRef.current;
          const next = updatePlanBoundaryForHandle(
            startBounds,
            "bottomRight",
            gestureState.dx / canvas.width,
            gestureState.dy / canvas.height
          );
          setPlanBoundaryBounds(next);
        },
        onPanResponderRelease: () => {
          planDragStartRef.current = null;
        },
      }),
    []
  );

  const bottomLeftPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          planDragStartRef.current = planBoundaryBoundsRef.current;
        },
        onPanResponderMove: (_event, gestureState) => {
          const canvas = planCanvasRef.current;
          if (canvas.width <= 0 || canvas.height <= 0) return;
          const startBounds = planDragStartRef.current ?? planBoundaryBoundsRef.current;
          const next = updatePlanBoundaryForHandle(
            startBounds,
            "bottomLeft",
            gestureState.dx / canvas.width,
            gestureState.dy / canvas.height
          );
          setPlanBoundaryBounds(next);
        },
        onPanResponderRelease: () => {
          planDragStartRef.current = null;
        },
      }),
    []
  );

  const planMovePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          planDragStartRef.current = planBoundaryBoundsRef.current;
        },
        onPanResponderMove: (_event, gestureState) => {
          const canvas = planCanvasRef.current;
          if (canvas.width <= 0 || canvas.height <= 0) return;
          const startBounds = planDragStartRef.current ?? planBoundaryBoundsRef.current;
          const next = movePlanBoundary(
            startBounds,
            gestureState.dx / canvas.width,
            gestureState.dy / canvas.height
          );
          setPlanBoundaryBounds(next);
        },
        onPanResponderRelease: () => {
          planDragStartRef.current = null;
        },
      }),
    []
  );

  const saveUploadedPlanSetup = async () => {
    if (!gardenId) return;
    if (!planImage?.uri) {
      Alert.alert("Upload a plan", "Choose a plan image first.");
      return;
    }

    const referenceMeters = Number(planReferenceMetersInput);
    if (!Number.isFinite(referenceMeters) || referenceMeters <= 0) {
      Alert.alert("Missing measurement", "Enter a valid meter value for the highlighted top edge.");
      return;
    }

    const baseWidth = planImage.width;
    const baseHeight = planImage.height;
    const metersPerPixel = referenceMeters / planReferenceEdgePixels;
    const normalizedArea = polygonArea(planBoundary);
    const boundaryAreaSqM = normalizedArea * baseWidth * baseHeight * metersPerPixel * metersPerPixel;

    if (!Number.isFinite(boundaryAreaSqM) || boundaryAreaSqM <= 0) {
      Alert.alert("Invalid boundary", "Could not calculate a valid area. Adjust the boundary and try again.");
      return;
    }
    const topLeft = planBoundary[0];
    const topRight = planBoundary[1];
    if (!topLeft || !topRight) {
      Alert.alert("Invalid boundary", "Boundary points are incomplete. Adjust and try again.");
      return;
    }

    const calibration: GardenScaleCalibration = {
      method: "reference_line",
      p1: topLeft,
      p2: topRight,
      referenceMeters,
      metersPerPixel,
      baseWidth,
      baseHeight,
      boundaryPolygon: planBoundary,
      boundaryAreaSqM,
      showBaseImage: true,
      showGridOverlay: false,
      showBedMeasurements: false,
      orientationDegrees: 0,
    };

    await gardenRepository.updatePhoto(gardenId, planImage.uri, "photo");
    await gardenRepository.updateScaleCalibration(gardenId, calibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    Alert.alert(
      "Plan saved",
      `Boundary saved from uploaded plan. Area: ${boundaryAreaSqM.toFixed(1)} sqm. You can toggle the plan image on/off in Garden Design.`
    );
  };

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
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>Choose how to set up your garden layout. Map captures satellite imagery, Measurement creates a basic rectangle, and Upload Plan lets you calibrate from your own drawing.</Text>

            <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Mode</Text>
              <SegmentedChoice
                options={[
                  { id: "map", label: "Map" },
                  { id: "measure", label: "Measurement" },
                  { id: "plan", label: "Upload Plan" },
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
                />

                <Text style={[styles.infoText, { color: theme.infoText }]}>Boundary points: {mapBoundary.length}{isMapClosed ? " (closed)" : ""}</Text>
                <Text style={[styles.infoText, { color: theme.infoText }]}>Garden area: {mapAreaSqM > 0 ? `${mapAreaSqM.toFixed(1)} sqm` : "-"}</Text>

                <Pressable style={[styles.button, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor }]} onPress={saveMapSetup}>
                  <Text style={[styles.buttonText, { color: theme.primaryActionText }]}>Save Map Boundary</Text>
                </Pressable>
              </View>
            ) : setupMode === "measure" ? (
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
            ) : (
              <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Upload Plan</Text>
                <Text style={[styles.cardText, { color: theme.textMuted }]}>
                  Upload or photograph your plan, drag the rectangle around your garden border, then enter one measured edge to calibrate scale and area.
                </Text>

                <View style={styles.zoomRow}>
                  <Pressable
                    style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                    onPress={() => void pickPlanImage("library")}
                  >
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Upload Plan</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                    onPress={() => void pickPlanImage("camera")}
                  >
                    <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Take Photo</Text>
                  </Pressable>
                </View>

                {planImage ? (
                  <>
                    <View
                      style={[
                        styles.planCanvas,
                        {
                          borderColor: theme.borderColor,
                          backgroundColor: theme.appBackground,
                          aspectRatio: Math.max(0.3, (planImage.width || BASE_CANVAS_WIDTH) / Math.max(1, planImage.height || BASE_CANVAS_HEIGHT)),
                        },
                      ]}
                      onLayout={onPlanCanvasLayout}
                    >
                      <Image source={{ uri: planImage.uri }} style={StyleSheet.absoluteFillObject} resizeMode="contain" />
                      <Svg width={planCanvas.width} height={planCanvas.height} style={StyleSheet.absoluteFillObject}>
                        <Polygon
                          points={planBoundary.map((p) => `${p.x * planCanvas.width},${p.y * planCanvas.height}`).join(" ")}
                          fill={withAlpha(theme.mapBoundaryFill, 0.35)}
                          stroke={theme.mapBoundaryStroke}
                          strokeWidth={3}
                        />
                        {planStep === "measure" && (
                          <Line
                            x1={planBoundaryBounds.left * planCanvas.width}
                            y1={planBoundaryBounds.top * planCanvas.height}
                            x2={planBoundaryBounds.right * planCanvas.width}
                            y2={planBoundaryBounds.top * planCanvas.height}
                            stroke={theme.primaryActionBackground}
                            strokeWidth={5}
                          />
                        )}
                      </Svg>
                      <View
                        style={[
                          styles.planDragArea,
                          {
                            left: planBoundaryBounds.left * planCanvas.width,
                            top: planBoundaryBounds.top * planCanvas.height,
                            width: Math.max(1, (planBoundaryBounds.right - planBoundaryBounds.left) * planCanvas.width),
                            height: Math.max(1, (planBoundaryBounds.bottom - planBoundaryBounds.top) * planCanvas.height),
                            borderColor: withAlpha(theme.primaryActionBackground, 0.6),
                          },
                        ]}
                        {...planMovePanResponder.panHandlers}
                      />
                      <View
                        style={[
                          styles.planHandle,
                          {
                            left: planBoundaryBounds.left * planCanvas.width - 14,
                            top: planBoundaryBounds.top * planCanvas.height - 14,
                            backgroundColor: theme.primaryActionBackground,
                          },
                        ]}
                        {...topLeftPanResponder.panHandlers}
                      />
                      <View
                        style={[
                          styles.planHandle,
                          {
                            left: planBoundaryBounds.right * planCanvas.width - 14,
                            top: planBoundaryBounds.top * planCanvas.height - 14,
                            backgroundColor: theme.primaryActionBackground,
                          },
                        ]}
                        {...topRightPanResponder.panHandlers}
                      />
                      <View
                        style={[
                          styles.planHandle,
                          {
                            left: planBoundaryBounds.right * planCanvas.width - 14,
                            top: planBoundaryBounds.bottom * planCanvas.height - 14,
                            backgroundColor: theme.primaryActionBackground,
                          },
                        ]}
                        {...bottomRightPanResponder.panHandlers}
                      />
                      <View
                        style={[
                          styles.planHandle,
                          {
                            left: planBoundaryBounds.left * planCanvas.width - 14,
                            top: planBoundaryBounds.bottom * planCanvas.height - 14,
                            backgroundColor: theme.primaryActionBackground,
                          },
                        ]}
                        {...bottomLeftPanResponder.panHandlers}
                      />
                    </View>

                    {planStep === "draw" ? (
                      <Pressable
                        style={[styles.button, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor }]}
                        onPress={() => setPlanStep("measure")}
                      >
                        <Text style={[styles.buttonText, { color: theme.primaryActionText }]}>Confirm Boundary</Text>
                      </Pressable>
                    ) : (
                      <>
                        <Text style={[styles.infoText, { color: theme.infoText }]}>
                          Enter the real length of the highlighted top edge (meters).
                        </Text>
                        <TextInput
                          value={planReferenceMetersInput}
                          onChangeText={setPlanReferenceMetersInput}
                          keyboardType="decimal-pad"
                          style={[styles.input, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                          placeholder="Top edge length (m)"
                          placeholderTextColor={theme.textMuted}
                        />
                        <Text style={[styles.infoText, { color: theme.infoText }]}>
                          Garden area: {planAreaPreviewSqM ? `${planAreaPreviewSqM.toFixed(1)} sqm` : "-"}
                        </Text>
                        <View style={styles.zoomRow}>
                          <Pressable
                            style={[styles.toolButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                            onPress={() => setPlanStep("draw")}
                          >
                            <Text style={[styles.toolButtonText, { color: theme.secondaryActionText }]}>Adjust Boundary</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.button, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor }]}
                            onPress={() => void saveUploadedPlanSetup()}
                          >
                            <Text style={[styles.buttonText, { color: theme.primaryActionText }]}>Save Uploaded Plan</Text>
                          </Pressable>
                        </View>
                      </>
                    )}
                  </>
                ) : (
                  <Text style={[styles.cardText, { color: theme.textMuted }]}>
                    No plan image selected yet.
                  </Text>
                )}
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

function withAlpha(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const hex = color.trim().replace(/^#/, "");
  const alphaHex = Math.round(clamped * 255).toString(16).padStart(2, "0").toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}${alphaHex}`;
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(0, 6).toUpperCase()}${alphaHex}`;
  return color;
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
  planCanvas: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  planHandle: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    zIndex: 3,
  },
  planDragArea: {
    position: "absolute",
    borderWidth: 1,
    borderStyle: "dashed",
    backgroundColor: "#00000001",
    zIndex: 2,
  },
});

