import { Link, useLocalSearchParams } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type GestureResponderEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Line, Path, Polygon, Text as SvgText } from "react-native-svg";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/state/queryClient";
import { makeId } from "@/utils/id";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { SegmentedChoice } from "@/ui/components/SegmentedChoice";
import { AppButton } from "@/ui/components/AppButton";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { Drainage, SunExposure, type Point2D } from "@/domain/entities/Bed";
import { GardenFeatureType } from "@/domain/entities/GardenFeature";
import { clipLineToPolygon, isPointInsidePolygon, polygonArea } from "@/features/garden-mapping/utils/geometry";
import type { GardenScaleCalibration } from "@/domain/entities/Garden";

const gardenRepository = new SqliteGardenRepository();
const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();

const featureTypes: GardenFeatureType[] = [
  GardenFeatureType.BED,
  GardenFeatureType.LAWN,
  GardenFeatureType.TREE,
  GardenFeatureType.SHRUB,
  GardenFeatureType.HEDGE,
  GardenFeatureType.PATH,
  GardenFeatureType.WALL,
  GardenFeatureType.FENCE,
  GardenFeatureType.TRELLIS,
  GardenFeatureType.PATIO,
  GardenFeatureType.DECK,
];

type ZonePreview = {
  id: string;
  name: string;
  type: GardenFeatureType;
  polygon: Point2D[];
  source: "bed" | "feature";
  sunExposure?: SunExposure;
  drainage?: Drainage;
  containsPerennials?: boolean;
  perennialPlantsCsv?: string;
  isRaisedBed?: boolean;
  hasIrrigation?: boolean;
};
type CanvasMode = "draw" | "pan" | "boundary";
type ShapeDraftMode = "points" | "rectangle" | "ellipse" | "line";
type PresetShapeDraft = {
  kind: "rectangle" | "ellipse" | "line";
  center: Point2D;
  width: number;
  height: number;
  angleDeg?: number;
  variant?: "tree" | "shrub";
  forceCircle?: boolean;
};
const BASE_CANVAS_WIDTH = 1000;
const BASE_CANVAS_HEIGHT = 700;
const AUTO_CLOSE_PX = 24;

export default function GardenMapEditorScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;

  const [activeType, setActiveType] = useState<GardenFeatureType>(GardenFeatureType.BED);
  const [name, setName] = useState("Bed 1");
  const [sunExposure, setSunExposure] = useState<SunExposure>(SunExposure.FULL_SUN);
  const [drainage, setDrainage] = useState<Drainage>(Drainage.GOOD);
  const [containsPerennials, setContainsPerennials] = useState(false);
  const [isRaisedBed, setIsRaisedBed] = useState(false);
  const [hasIrrigation, setHasIrrigation] = useState(false);
  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [isEditingCanvas, setIsEditingCanvas] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("draw");
  const [shapeDraftMode, setShapeDraftMode] = useState<ShapeDraftMode>("rectangle");
  const [presetShape, setPresetShape] = useState<PresetShapeDraft | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [viewRotationDeg, setViewRotationDeg] = useState(0);
  const [showImageLayer, setShowImageLayer] = useState(true);
  const [showGridLayer, setShowGridLayer] = useState(false);
  const [showBedMeasurementsLayer, setShowBedMeasurementsLayer] = useState(false);
  const [rectLengthMInput, setRectLengthMInput] = useState("");
  const [rectWidthMInput, setRectWidthMInput] = useState("");
  const [isEditingRectLength, setIsEditingRectLength] = useState(false);
  const [isEditingRectWidth, setIsEditingRectWidth] = useState(false);
  const [viewport, setViewport] = useState({ width: 320, height: 220 });
  const [canvas, setCanvas] = useState({ width: BASE_CANVAS_WIDTH, height: BASE_CANVAS_HEIGHT });
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [isExportRenderMode, setIsExportRenderMode] = useState(false);
  const [deleteZoneDraft, setDeleteZoneDraft] = useState<ZonePreview | null>(null);
  const gestureStartRef = useRef<{ distance: number; angle: number; zoom: number; rotation: number } | null>(null);
  const exportCanvasRef = useRef<View | null>(null);
  const rectLengthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rectWidthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [didNormalizeLegacyCalibration, setDidNormalizeLegacyCalibration] = useState(false);
  
  // Boundary editing state
  const [isEditingBoundary, setIsEditingBoundary] = useState(false);
  const [selectedBoundaryPoint, setSelectedBoundaryPoint] = useState<number | null>(null);
  const [editingBoundary, setEditingBoundary] = useState<Point2D[] | null>(null);

  const gardenQuery = useQuery({
    queryKey: ["garden", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("gardenId missing");
      return gardenRepository.getById(gardenId);
    },
  });

  const bedsQuery = useQuery({
    queryKey: ["beds", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("gardenId missing");
      return bedRepository.listByGarden(gardenId);
    },
  });

  const featuresQuery = useQuery({
    queryKey: ["garden-features", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("gardenId missing");
      return featureRepository.listByGarden(gardenId);
    },
  });

  const existingZones = useMemo<ZonePreview[]>(() => {
    const beds = (bedsQuery.data ?? []).map((bed) => ({
      id: bed.id,
      name: bed.name,
      type: GardenFeatureType.BED,
      polygon: bed.polygon,
      source: "bed" as const,
      sunExposure: bed.sunExposure,
      drainage: bed.drainage,
      containsPerennials: bed.containsPerennials,
      isRaisedBed: bed.isRaisedBed,
      hasIrrigation: bed.hasIrrigation,
      ...(bed.perennialPlantsCsv ? { perennialPlantsCsv: bed.perennialPlantsCsv } : {}),
    }));

    const features = (featuresQuery.data ?? []).map((feature) => ({
      id: feature.id,
      name: feature.name,
      type: feature.type,
      polygon: feature.polygon,
      source: "feature" as const,
    }));

    return [...features, ...beds];
  }, [bedsQuery.data, featuresQuery.data]);

  const calibration = gardenQuery.data?.scaleCalibration;
  // Use editing boundary if available, otherwise use the original boundary
  const currentBoundary = editingBoundary || getBoundaryOrDefault(calibration?.boundaryPolygon);
  const gardenBoundary = currentBoundary;
  const boundaryXs = gardenBoundary.map((p) => p.x);
  const boundaryYs = gardenBoundary.map((p) => p.y);
  const boundaryMinX = boundaryXs.length > 0 ? Math.min(...boundaryXs) : 0;
  const boundaryMaxX = boundaryXs.length > 0 ? Math.max(...boundaryXs) : 1;
  const boundaryMinY = boundaryYs.length > 0 ? Math.min(...boundaryYs) : 0;
  const boundaryMaxY = boundaryYs.length > 0 ? Math.max(...boundaryYs) : 1;
  const gridStepX = calibration ? 1 / Math.max(calibration.metersPerPixel * calibration.baseWidth, 1e-6) : 0;
  const gridStepY = calibration ? 1 / Math.max(calibration.metersPerPixel * calibration.baseHeight, 1e-6) : 0;
  const shapeOptions = getShapeOptionsForType(activeType);
  const defaultShapeMode = shapeOptions[0]?.mode ?? "rectangle";
  const typeColors: Record<GardenFeatureType, { fill: string; stroke: string }> = useMemo(
    () => ({
      bed: { fill: theme.mapBedFill, stroke: theme.mapBedStroke },
      lawn: { fill: theme.mapLawnFill, stroke: theme.mapLawnStroke },
      tree: { fill: theme.mapTreeFill, stroke: theme.mapTreeStroke },
      shrub: { fill: theme.mapShrubFill, stroke: theme.mapShrubStroke },
      hedge: { fill: theme.mapHedgeFill, stroke: theme.mapHedgeStroke },
      path: { fill: theme.mapPathFill, stroke: theme.mapPathStroke },
      wall: { fill: theme.mapWallFill, stroke: theme.mapWallStroke },
      fence: { fill: theme.mapFenceFill, stroke: theme.mapFenceStroke },
      trellis: { fill: theme.mapTrellisFill, stroke: theme.mapTrellisStroke },
      patio: { fill: theme.mapPatioFill, stroke: theme.mapPatioStroke },
      deck: { fill: theme.mapDeckFill, stroke: theme.mapDeckStroke },
    }),
    [theme]
  );

  useEffect(() => {
    if (editingZoneId) return;
    setName(nextZoneName(activeType, existingZones));
  }, [activeType, existingZones, editingZoneId]);

  useEffect(() => {
    if (editingZoneId) return;
    if (activeType !== GardenFeatureType.BED) return;
    setContainsPerennials(false);
    setIsRaisedBed(false);
    setHasIrrigation(false);
  }, [activeType, editingZoneId]);

  useEffect(() => {
    if (!shapeOptions.some((option) => option.mode === shapeDraftMode)) {
      setShapeDraftMode(defaultShapeMode);
      setPresetShape(null);
    }
  }, [defaultShapeMode, shapeDraftMode, shapeOptions]);

  useEffect(() => {
    if (shapeDraftMode === "points") {
      setPresetShape(null);
    }
  }, [shapeDraftMode]);

  useEffect(() => {
    if (!gardenQuery.isFetched) return;
    setShowImageLayer(calibration?.showBaseImage ?? true);
    setShowGridLayer(calibration?.showGridOverlay ?? false);
    setShowBedMeasurementsLayer(calibration?.showBedMeasurements ?? false);
  }, [
    gardenId,
    gardenQuery.isFetched,
    calibration?.showBaseImage,
    calibration?.showGridOverlay,
    calibration?.showBedMeasurements,
  ]);

  const zoomedWidth = Math.max(1, Math.round(viewport.width * zoom));
  const zoomedHeight = Math.max(1, Math.round(viewport.height * zoom));

  useEffect(() => {
    setCanvas((prev) => {
      if (prev.width === zoomedWidth && prev.height === zoomedHeight) {
        return prev;
      }
      return { width: zoomedWidth, height: zoomedHeight };
    });
  }, [zoomedHeight, zoomedWidth]);

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

  const addPoint = (point: Point2D) => {
    if (isClosed || canvas.width <= 0 || canvas.height <= 0) return;
    setDraftPoints((prev) => [...prev, point]);
  };

  const closePolygon = () => {
    if (draftPoints.length < 3) {
      Alert.alert("Need 3 points", "Add at least 3 points before finishing the shape.");
      return;
    }
    setIsClosed(true);
  };

  const resetDraft = () => {
    setDraftPoints([]);
    setSelectedPointIndex(null);
    setIsClosed(false);
    setEditingZoneId(null);
    setPresetShape(null);
  };

  const undoPoint = () => {
    setDraftPoints((prev) => {
      const next = prev.slice(0, -1);
      if (next.length < 3) {
        setIsClosed(false);
      }
      return next;
    });
    setSelectedPointIndex(null);
  };

  const deleteSelectedPoint = () => {
    if (selectedPointIndex === null) return;
    setDraftPoints((prev) => prev.filter((_point, index) => index !== selectedPointIndex));
    setSelectedPointIndex(null);
    setIsClosed(false);
  };

  const startEditZone = (zone: ZonePreview) => {
    setIsEditingCanvas(true);
    setCanvasMode("draw");
    const inferredPreset = inferPresetShapeFromZone(zone);
    if (inferredPreset) {
      setShapeDraftMode(inferredPreset.kind === "line" ? "line" : inferredPreset.kind);
      setPresetShape(inferredPreset);
      setDraftPoints(pointsFromPresetShape(inferredPreset));
    } else {
      setShapeDraftMode("points");
      setPresetShape(null);
      setDraftPoints(zone.polygon.map((p) => ({ ...p })));
    }
    setEditingZoneId(zone.id);
    setActiveType(zone.type);
    setName(zone.name);
    setIsClosed(true);
    setSelectedPointIndex(null);

    if (zone.source === "bed") {
      setSunExposure(zone.sunExposure ?? SunExposure.FULL_SUN);
      setDrainage(zone.drainage ?? Drainage.GOOD);
      setContainsPerennials(zone.containsPerennials ?? false);
      setIsRaisedBed(zone.isRaisedBed ?? false);
      setHasIrrigation(zone.hasIrrigation ?? false);
    } else {
      setContainsPerennials(false);
      setIsRaisedBed(false);
      setHasIrrigation(false);
    }
  };

  // Boundary editing functions
  const startBoundaryEdit = () => {
    if (calibration?.boundaryPolygon) {
      setEditingBoundary([...calibration.boundaryPolygon]);
    }
    setIsEditingCanvas(true);
    setIsEditingBoundary(true);
    setSelectedBoundaryPoint(null);
    setCanvasMode("boundary");
  };

  const startEditBoundary = () => {
    startBoundaryEdit();
  };

  const cancelBoundaryEdit = () => {
    setEditingBoundary(null);
    setIsEditingBoundary(false);
    setSelectedBoundaryPoint(null);
    setCanvasMode("draw");
  };

  const saveBoundary = async () => {
    if (!gardenId || !calibration || !editingBoundary) {
      Alert.alert("Error", "No garden, calibration, or boundary data found.");
      return;
    }

    if (editingBoundary.length < 3) {
      Alert.alert("Invalid boundary", "A boundary must have at least 3 points.");
      return;
    }

    try {
      // Calculate the area using the edited boundary
      const boundaryAreaSqM = polygonArea(editingBoundary) * (calibration.baseWidth * calibration.baseHeight) * Math.pow(calibration.metersPerPixel, 2);
      const { boundaryGeoPolygon: _ignoredBoundaryGeoPolygon, ...calibrationWithoutGeoBoundary } = calibration;
      
      // Update the calibration with the modified boundary
      const updatedCalibration: GardenScaleCalibration = {
        ...calibrationWithoutGeoBoundary,
        boundaryPolygon: editingBoundary,
        boundaryAreaSqM,
      };

      // Update local query cache immediately for instant UI updates
      queryClient.setQueryData(["garden", gardenId], (old: any) => ({
        ...old,
        scaleCalibration: updatedCalibration,
      }));

      // Persist to database
      await gardenRepository.updateScaleCalibration(gardenId, updatedCalibration);
      
      // Force complete cache refresh for all garden-related queries
      queryClient.removeQueries({ queryKey: ["garden", gardenId] });
      queryClient.removeQueries({ queryKey: ["gardens"] });
      queryClient.removeQueries({ queryKey: ["garden-features", gardenId] });  
      queryClient.removeQueries({ queryKey: ["garden-areas", gardenId] });
      
      // Refetch fresh data
      await queryClient.refetchQueries({ queryKey: ["garden", gardenId] });
      
      setEditingBoundary(null);
      setIsEditingBoundary(false);
      setSelectedBoundaryPoint(null);
      setCanvasMode("draw");
      
      Alert.alert("Boundary updated", "Garden boundary has been successfully updated. Navigate to other pages to see changes.");
    } catch (error) {
      console.error("Error saving boundary:", error);
      Alert.alert("Error", "Failed to save boundary. Please try again.");
    }
  };

  const snapPoint = (point: Point2D): Point2D => {
    if (!snapToGrid || !calibration || gridStepX <= 0 || gridStepY <= 0) {
      return point;
    }
    return {
      x: snapValueToGrid(point.x, boundaryMinX, gridStepX),
      y: snapValueToGrid(point.y, boundaryMinY, gridStepY),
    };
  };

  const applyPresetShape = (candidate: PresetShapeDraft): boolean => {
    const points = pointsFromPresetShape(candidate);
    if (!Array.isArray(points) || points.length < 3 || points.some((point) => !isFinitePoint(point))) {
      return false;
    }
    try {
      if (!Array.isArray(gardenBoundary) || gardenBoundary.length < 3) return false;
      if (points.some((point) => !isPointInsidePolygon(point, gardenBoundary))) {
        return false;
      }
    } catch {
      return false;
    }

    const shouldUpdatePreset = !presetShape || !arePresetShapesEquivalent(presetShape, candidate);
    const shouldUpdatePoints = !arePointArraysEquivalent(draftPoints, points);
    const shouldResetSelection = selectedPointIndex !== null;
    const shouldClose = !isClosed;

    if (shouldUpdatePreset) {
      setPresetShape(candidate);
    }
    if (shouldUpdatePoints) {
      setDraftPoints(points);
    }
    if (shouldResetSelection) {
      setSelectedPointIndex(null);
    }
    if (shouldClose) {
      setIsClosed(true);
    }
    return true;
  };

  const createDefaultPresetShape = (
    kind: "rectangle" | "ellipse" | "line",
    center: Point2D,
    forceCircle: boolean
  ): PresetShapeDraft => {
    const defaultWidth = clamp(Math.max(gridStepX * 4, 0.12), 0.08, 0.9);
    const defaultHeight =
      kind === "line" ? clamp(Math.max(gridStepY * 0.75, 0.02), 0.015, 0.08) : clamp(Math.max(gridStepY * 4, 0.12), 0.08, 0.9);
    const variant = activeType === GardenFeatureType.TREE ? "tree" : activeType === GardenFeatureType.SHRUB ? "shrub" : null;
    return {
      kind,
      center,
      width: forceCircle ? Math.max(defaultWidth, defaultHeight) : defaultWidth,
      height: forceCircle ? Math.max(defaultWidth, defaultHeight) : defaultHeight,
      angleDeg: 0,
      ...(variant ? { variant } : {}),
      forceCircle,
    };
  };

  const onCanvasPress = (event: GestureResponderEvent) => {
    const tapPointRaw = getNormalizedTapPoint(event, canvas);
    if (!tapPointRaw) return;
    
    // Handle boundary editing mode
    if (canvasMode === "boundary" && currentBoundary) {
      const tapPoint = snapPoint(tapPointRaw);
      if (!tapPoint) return;
      
      // Check if we tapped near a boundary point to select it
      const boundaryPoints = currentBoundary;
      const threshold = 15 / Math.min(canvas.width, canvas.height); // 15px threshold
      
      for (let i = 0; i < boundaryPoints.length; i++) {
        const point = boundaryPoints[i];
        if (!point) continue;
        const distance = Math.hypot(tapPoint.x - point.x, tapPoint.y - point.y);
        if (distance <= threshold) {
          setSelectedBoundaryPoint(selectedBoundaryPoint === i ? null : i);
          return;
        }
      }
      
      setSelectedBoundaryPoint(null);
      return;
    }

    if (!isEditingCanvas || canvasMode !== "draw") return;
    const tapPoint = snapPoint(tapPointRaw);
    if (!tapPoint) return;
    if (!isPointInsidePolygon(tapPoint, gardenBoundary)) {
      return;
    }

    if (shapeDraftMode !== "points") {
      const kind: PresetShapeDraft["kind"] =
        shapeDraftMode === "rectangle" ? "rectangle" : shapeDraftMode === "line" ? "line" : "ellipse";
      const forceCircle = activeType === GardenFeatureType.TREE || activeType === GardenFeatureType.SHRUB;
      if (!presetShape || presetShape.kind !== kind) {
        const seeded = createDefaultPresetShape(kind, tapPoint, forceCircle);
        void applyPresetShape(seeded);
        return;
      }
      void applyPresetShape({
        ...presetShape,
        center: tapPoint,
      });
      return;
    }

    const hasOpenDraft = draftPoints.length > 0 && !isClosed;

    if (hasOpenDraft) {
      if (draftPoints.length >= 3) {
        const first = draftPoints[0];
        if (first) {
          const distancePx = Math.hypot((tapPoint.x - first.x) * canvas.width, (tapPoint.y - first.y) * canvas.height);
          if (distancePx <= AUTO_CLOSE_PX) {
            setIsClosed(true);
            return;
          }
        }
      }

      addPoint(tapPoint);
      return;
    }

    const tappedZone = [...existingZones]
      .reverse()
      .find((zone) => zone.polygon.length >= 3 && isPointInsidePolygon(tapPoint, zone.polygon));

    if (tappedZone) {
      startEditZone(tappedZone);
      return;
    }

    if (isClosed && editingZoneId) {
      Alert.alert("Editing mode", "Use Cancel Edit first if you want to start a new area.");
      return;
    }

    if (isClosed && !editingZoneId) {
      resetDraft();
    }

    addPoint(tapPoint);
  };

  const movePresetShape = (nextCenter: Point2D) => {
    if (!presetShape) return;
    const snappedCenter = snapPoint(nextCenter);
    void applyPresetShape({
      ...presetShape,
      center: snappedCenter,
    });
  };

  const resizePresetShapeFromHandle = (handlePoint: Point2D) => {
    if (!presetShape) return;
    const snappedHandle = snapPoint(handlePoint);
    const dx = snappedHandle.x - presetShape.center.x;
    const dy = snappedHandle.y - presetShape.center.y;
    const halfW = Math.max(Math.abs(dx), 0.02);
    const halfH = Math.max(Math.abs(dy), 0.02);
    const forceCircle = Boolean(presetShape.forceCircle);
    const size = forceCircle ? Math.max(halfW, halfH) * 2 : 0;
    if (presetShape.kind === "line") {
      const halfLength = Math.max(Math.hypot(dx, dy), 0.03);
      const nextShape: PresetShapeDraft = {
        ...presetShape,
        width: clamp(halfLength * 2, 0.08, 1.8),
        height: clamp(presetShape.height, 0.012, 0.08),
        angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      };
      void applyPresetShape(nextShape);
      return;
    }
    const nextShape: PresetShapeDraft = {
      ...presetShape,
      width: forceCircle ? size : clamp(halfW * 2, 0.04, 1.6),
      height: forceCircle ? size : clamp(halfH * 2, 0.04, 1.6),
    };
    void applyPresetShape(nextShape);
  };

  const handleUndo = () => {
    if (draftPoints.length === 0) return;
    undoPoint();
  };

  const exportPlannerImage = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not available on web", "Image export currently works on iOS and Android.");
      return;
    }
    if (!exportCanvasRef.current) {
      Alert.alert("Export unavailable", "Canvas was not ready. Try again in a moment.");
      return;
    }

    const prevZoom = zoom;
    const prevRotation = viewRotationDeg;
    try {
      setIsExportingImage(true);
      setIsExportRenderMode(true);
      setZoom(1);
      setViewRotationDeg(0);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const aspectRatio = BASE_CANVAS_HEIGHT / BASE_CANVAS_WIDTH;
      const exportWidth = 5600;
      const exportHeight = Math.max(1200, Math.round(exportWidth * aspectRatio));
      const uri = await captureRef(exportCanvasRef.current, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        width: exportWidth,
        height: exportHeight,
      });
      const sharingAvailable = await Sharing.isAvailableAsync();
      if (!sharingAvailable) {
        Alert.alert("Sharing unavailable", "This device does not support file sharing.");
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: "Export Garden Map",
        UTI: "public.png",
      });
    } catch (error) {
      Alert.alert("Export failed", error instanceof Error ? error.message : "Could not export image.");
    } finally {
      setZoom(prevZoom);
      setViewRotationDeg(prevRotation);
      setIsExportRenderMode(false);
      setIsExportingImage(false);
    }
  };

  const gestureResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) => isEditingCanvas && canvasMode === "pan" && event.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponder: (event) => isEditingCanvas && canvasMode === "pan" && event.nativeEvent.touches.length >= 2,
        onPanResponderGrant: (event) => {
          const metrics = getGestureMetrics(event.nativeEvent.touches);
          if (!metrics) {
            gestureStartRef.current = null;
            return;
          }
          gestureStartRef.current = {
            distance: metrics.distance,
            angle: metrics.angle,
            zoom,
            rotation: viewRotationDeg,
          };
        },
        onPanResponderMove: (event) => {
          const start = gestureStartRef.current;
          if (!start) return;
          const metrics = getGestureMetrics(event.nativeEvent.touches);
          if (!metrics) return;

          const zoomFactor = metrics.distance / Math.max(start.distance, 1);
          const nextZoom = clamp(start.zoom * zoomFactor, 0.2, 15);
          const angleDelta = metrics.angle - start.angle;

          setZoom(nextZoom);
          setViewRotationDeg(normalizeDegrees(start.rotation + angleDelta));
        },
      }),
    [canvasMode, isEditingCanvas, viewRotationDeg, zoom]
  );

  const deleteZone = async (zone: ZonePreview) => {
    if (!gardenId) return;

    try {
      if (zone.source === "bed") {
        await bedRepository.delete(zone.id, gardenId);
        await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
      } else {
        await featureRepository.delete(zone.id, gardenId);
        await queryClient.invalidateQueries({ queryKey: ["garden-features", gardenId] });
      }

      if (editingZoneId === zone.id) {
        resetDraft();
      }

      Alert.alert("Deleted", `${zone.name} removed.`);
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : "Unknown delete error");
    }
  };

  const confirmDeleteZone = (zone: ZonePreview) => {
    setDeleteZoneDraft(zone);
  };

  const saveZone = async () => {
    if (!gardenId) return;

    if (draftPoints.length < 3) {
      Alert.alert("Need more points", "Add at least 3 points to save an area.");
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Give this area a short name.");
      return;
    }

    const normalized = normalizeName(trimmedName);
    const duplicate = existingZones.some(
      (zone) => normalizeName(zone.name) === normalized && zone.id !== editingZoneId
    );
    if (duplicate) {
      Alert.alert("Name already used", "Use a unique name for each area in this garden.");
      return;
    }

    try {
      const now = new Date().toISOString();
      const savedAsClosed = !isClosed;
      if (savedAsClosed) {
        setIsClosed(true);
      }

      if (activeType === GardenFeatureType.BED) {
        const existingBed = editingZoneId
          ? (bedsQuery.data ?? []).find((bed) => bed.id === editingZoneId)
          : null;
        const bedPayloadBase = {
          gardenId,
          name: trimmedName,
          polygon: draftPoints,
          sunExposure,
          drainage,
          containsPerennials,
          isRaisedBed,
          hasIrrigation,
          createdAt: now,
          updatedAt: now,
          ...(existingBed?.perennialPlantsCsv ? { perennialPlantsCsv: existingBed.perennialPlantsCsv } : {}),
        };
        if (editingZoneId) {
          await bedRepository.update({
            ...bedPayloadBase,
            id: editingZoneId,
          });
        } else {
          await bedRepository.create({
            ...bedPayloadBase,
            id: makeId("bed"),
          });
        }
        await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
      } else {
        if (editingZoneId) {
          await featureRepository.update({
            id: editingZoneId,
            gardenId,
            type: activeType,
            name: trimmedName,
            polygon: draftPoints,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          await featureRepository.create({
            id: makeId("feature"),
            gardenId,
            type: activeType,
            name: trimmedName,
            polygon: draftPoints,
            createdAt: now,
            updatedAt: now,
          });
        }
        await queryClient.invalidateQueries({ queryKey: ["garden-features", gardenId] });
      }

      const wasEditing = Boolean(editingZoneId);
      resetDraft();
      Alert.alert("Saved", wasEditing ? `${trimmedName} updated.` : `${trimmedName} saved${savedAsClosed ? " (auto-closed)." : "."}`);
    } catch (error) {
      Alert.alert("Save failed", error instanceof Error ? error.message : "Unknown save error");
    }
  };

  const area = polygonArea(draftPoints);
  const showBaseImage = showImageLayer;
  const annotationScale = isExportRenderMode ? 0.68 : 1;
  const gridVerticalLines = showGridLayer
    ? buildGridSeries(boundaryMinX, boundaryMaxX, gridStepX).map((x) => x * canvas.width)
    : [];
  const gridHorizontalLines = showGridLayer
    ? buildGridSeries(boundaryMinY, boundaryMaxY, gridStepY).map((y) => y * canvas.height)
    : [];
  const boundaryMeasurements = getBoundaryMeasurementLabels(gardenBoundary, canvas.width, canvas.height, calibration);
  const areaSqM = calibration
    ? normalizedAreaToSqM(area, calibration.metersPerPixel, calibration.baseWidth, calibration.baseHeight)
    : null;
  const saveDisabled = draftPoints.length < 3 || !name.trim();
  const canApplyShape = Boolean(presetShape);
  const canCloseShape = !presetShape && draftPoints.length >= 3 && !isClosed;
  const canUndo = draftPoints.length > 0;
  const canDeletePoint = selectedPointIndex !== null;
  const canCancelEdit = Boolean(editingZoneId);
  const shapeActionLabel = presetShape ? "Apply Shape" : "Close Shape";
  const zonesToRender = editingZoneId ? existingZones.filter((zone) => zone.id !== editingZoneId) : existingZones;
  const canPrecisionEditBed = activeType === GardenFeatureType.BED && Boolean(calibration) && isClosed && draftPoints.length >= 3;
  const draftBedMeasurementLabels = canPrecisionEditBed
    ? getBedMeasurementLabels(draftPoints, canvas.width, canvas.height, calibration)
    : [];
  const draftBedEdgeLengths = canPrecisionEditBed
    ? getPolygonEdgeLengthsMeters(draftPoints, calibration)
    : [];
  const isDraftBedRectangle = canPrecisionEditBed && draftPoints.length === 4 && isRectangleLikePolygon(draftPoints);

  useEffect(() => {
    if (!isDraftBedRectangle) return;
    const length = draftBedEdgeLengths[0];
    const width = draftBedEdgeLengths[1];
    if (!isEditingRectLength && length !== undefined && Number.isFinite(length) && length > 0) {
      setRectLengthMInput(length >= 10 ? `${length.toFixed(1)}` : `${length.toFixed(2)}`);
    }
    if (!isEditingRectWidth && width !== undefined && Number.isFinite(width) && width > 0) {
      setRectWidthMInput(width >= 10 ? `${width.toFixed(1)}` : `${width.toFixed(2)}`);
    }
  }, [draftBedEdgeLengths, isDraftBedRectangle, isEditingRectLength, isEditingRectWidth]);

  useEffect(
    () => () => {
      if (rectLengthTimerRef.current) clearTimeout(rectLengthTimerRef.current);
      if (rectWidthTimerRef.current) clearTimeout(rectWidthTimerRef.current);
    },
    []
  );

  const persistCanvasViewSettings = async (
    nextShowImage: boolean,
    nextShowGrid: boolean,
    nextShowBedMeasurements: boolean
  ) => {
    if (!gardenId || !calibration) return;
    const nextCalibration: typeof calibration = {
      ...calibration,
      showBaseImage: nextShowImage,
      showGridOverlay: nextShowGrid,
      showBedMeasurements: nextShowBedMeasurements,
    };
    await gardenRepository.updateScaleCalibration(gardenId, nextCalibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    await queryClient.invalidateQueries({ queryKey: ["gardens"] });
  };

  const applyRectangleDimension = (edgeIndex: 0 | 1, valueRaw: string) => {
    if (!canPrecisionEditBed || !calibration || !isDraftBedRectangle) return;
    const nextLength = Number(valueRaw);
    if (!Number.isFinite(nextLength) || nextLength <= 0) {
      Alert.alert("Invalid length", "Enter a positive size in meters.");
      return;
    }
    const currentLength = draftBedEdgeLengths[0];
    const currentWidth = draftBedEdgeLengths[1];
    if (currentLength === undefined || currentWidth === undefined) return;
    const nextPoints = setRectangleDimensionsMeters(
      draftPoints,
      calibration,
      edgeIndex === 0 ? nextLength : currentLength,
      edgeIndex === 1 ? nextLength : currentWidth
    );
    if (!nextPoints) {
      Alert.alert("Cannot apply", "Could not set that size.");
      return;
    }
    if (nextPoints.some((point) => !isPointInsidePolygon(point, gardenBoundary))) {
      Alert.alert("Outside boundary", "That size would push the bed outside the garden boundary.");
      return;
    }
    setDraftPoints(nextPoints);
    const nextPreset = rectanglePresetFromPolygon(nextPoints);
    if (nextPreset) {
      setShapeDraftMode("rectangle");
      setPresetShape(nextPreset);
    }
  };

  const handleRectLengthChange = (value: string) => {
    setRectLengthMInput(value);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (rectLengthTimerRef.current) clearTimeout(rectLengthTimerRef.current);
    rectLengthTimerRef.current = setTimeout(() => applyRectangleDimension(0, value), 350);
  };

  const handleRectWidthChange = (value: string) => {
    setRectWidthMInput(value);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (rectWidthTimerRef.current) clearTimeout(rectWidthTimerRef.current);
    rectWidthTimerRef.current = setTimeout(() => applyRectangleDimension(1, value), 350);
  };

  useEffect(() => {
    if (!gardenId || !calibration || didNormalizeLegacyCalibration) return;
    const needsNormalize = (calibration.orientationDegrees ?? 0) !== 0;
    if (!needsNormalize) {
      setDidNormalizeLegacyCalibration(true);
      return;
    }

    const nextCalibration: typeof calibration = {
      ...calibration,
      orientationDegrees: 0,
    };

    void gardenRepository
      .updateScaleCalibration(gardenId, nextCalibration)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
        setDidNormalizeLegacyCalibration(true);
      })
      .catch(() => {
        setDidNormalizeLegacyCalibration(true);
      });
  }, [calibration, didNormalizeLegacyCalibration, gardenId]);

  const guidanceText = (() => {
    if (editingZoneId) return "Editing mode: drag points, update details, then tap Update.";
    if (draftPoints.length === 0) return "Pan/zoom to frame the map, switch to Draw, then tap to start an area.";
    if (!isClosed) return "Keep adding points. Tap near the first point or tap Close Shape.";
    return "Shape ready. Add details and tap Save.";
  })();

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.appBackground }]} edges={["left", "right"]}>
        <ScrollView contentContainerStyle={styles.scrollContent} scrollEnabled={!isEditingCanvas || canvasMode === "draw" || canvasMode === "boundary"}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Garden Design</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>Map beds and spaces quickly with tap-to-draw and tap-to-edit.</Text>
        </View>

        <View style={[styles.guidanceCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.guidanceText, { color: theme.infoText }]}>{guidanceText}</Text>
          {!calibration && gardenId && (
            (bedsQuery.data && bedsQuery.data.length > 0) || (featuresQuery.data && featuresQuery.data.length > 0) ? (
              <View>
                <Text style={[styles.setupLinkText, { color: theme.disabledActionText }]}>
                  Garden Setup completed - no longer editable
                </Text>
                <Text style={[styles.infoText, { color: theme.infoText, fontSize: 12, fontStyle: "italic" }]}>
                  Setup locked after design begins
                </Text>
              </View>
            ) : (
              <Link href={`/gardens/${gardenId}/setup`} style={[styles.setupLinkText, { color: theme.primaryActionBackground }]}>
                Set scale in Garden Setup to enable sqm estimates
              </Link>
            )
          )}
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>1. Select Area Type</Text>
          {isEditingBoundary && (
            <Text style={[styles.infoText, { color: theme.textMuted, marginBottom: 8 }]}>
              Finish editing the boundary before creating new areas.
            </Text>
          )}
          <SegmentedChoice
            options={featureTypes.map((type) => ({ id: type, label: type }))}
            selectedId={activeType}
            onSelect={(type) => {
              if (editingZoneId) {
                Alert.alert("Finish editing first", "Tap Cancel Edit before switching area type.");
                return;
              }
              if (isEditingBoundary) {
                Alert.alert("Finish editing boundary", "Complete boundary editing before creating new areas.");
                return;
              }
              setActiveType(type as GardenFeatureType);
              const nextOptions = getShapeOptionsForType(type as GardenFeatureType);
              setShapeDraftMode(nextOptions[0]?.mode ?? "points");
              setPresetShape(null);
              setName(nextZoneName(type as GardenFeatureType, existingZones));
            }}
          />
          <View style={styles.shapeChoiceContainer}>
            <Text style={[styles.shapeChoiceLabel, { color: theme.textMuted }]}>Shape:</Text>
            <SegmentedChoice
              options={shapeOptions.map((option) => ({ id: option.mode, label: option.label }))}
              selectedId={shapeDraftMode}
              onSelect={(mode) => setShapeDraftMode(mode as ShapeDraftMode)}
            />
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>2. Design Canvas</Text>
            <View style={styles.zoomRow}>
              <Pressable style={[styles.zoomButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => setZoom((z) => clamp(z - 0.25, 0.2, 15))}>
                <Text style={[styles.zoomButtonText, { color: theme.secondaryActionText }]}>-</Text>
              </Pressable>
              <Text style={[styles.zoomText, { color: theme.textPrimary }]}>{Math.round(zoom * 100)}%</Text>
              <Pressable style={[styles.zoomButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => setZoom((z) => clamp(z + 0.25, 0.2, 15))}>
                <Text style={[styles.zoomButtonText, { color: theme.secondaryActionText }]}>+</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.toolbarRow}>
            <SimpleToggle 
              label="Image" 
              value={showImageLayer} 
              disabled={!gardenQuery.data?.photoUri}
              onToggle={(next) => {
                setShowImageLayer(next);
                void persistCanvasViewSettings(next, showGridLayer, showBedMeasurementsLayer);
              }} 
            />
            <SimpleToggle label="Grid" value={showGridLayer} disabled={!calibration} onToggle={(next) => {
              setShowGridLayer(next);
              void persistCanvasViewSettings(showImageLayer, next, showBedMeasurementsLayer);
            }} />
            <SimpleToggle label="Bed Sizes" value={showBedMeasurementsLayer} disabled={!calibration} onToggle={(next) => {
              setShowBedMeasurementsLayer(next);
              void persistCanvasViewSettings(showImageLayer, showGridLayer, next);
            }} />
          </View>
          <View style={styles.toolbarRow}>
            <SegmentedChoice
              options={[
                { id: "draw", label: "Draw" },
                { id: "pan", label: "Pan" },
                ...(calibration?.boundaryPolygon ? [{ id: "boundary", label: "Edit Boundary" }] : [])
              ]}
              selectedId={canvasMode}
              onSelect={(mode) => {
                if (mode === "boundary") {
                  startBoundaryEdit();
                } else {
                  if (isEditingBoundary) cancelBoundaryEdit();
                  setCanvasMode(mode as CanvasMode);
                  if (mode === "pan") {
                    setSelectedPointIndex(null);
                  }
                }
              }}
            />
          </View>
          <Text style={[styles.infoText, { color: theme.infoText }]}>
            Mode: {canvasMode === "draw" ? "Draw/edit points." : canvasMode === "boundary" ? "Edit boundary points." : "Pan/zoom/twist canvas."}
          </Text>
          <Text style={[styles.infoText, { color: theme.infoText }]}>View rotation: {viewRotationDeg.toFixed(1)}deg</Text>

          <View style={styles.canvasViewport} onLayout={onViewportLayout}>
            <ScrollView
              horizontal
              bounces={false}
              style={styles.canvasOuterScroll}
              nestedScrollEnabled
              scrollEnabled={(canvasMode === "pan" || canvasMode === "boundary") && zoom > 1.01}
            >
              <ScrollView
                bounces={false}
                nestedScrollEnabled
                scrollEnabled={(canvasMode === "pan" || canvasMode === "boundary") && zoom > 1.01}
              >
                <View
                  ref={exportCanvasRef}
                  style={[
                    styles.canvasContainer,
                    { width: zoomedWidth, height: zoomedHeight, transform: [{ rotate: `${viewRotationDeg}deg` }] },
                  ]}
                  onLayout={onCanvasLayout}
                  {...((canvasMode === "pan" || canvasMode === "boundary") ? gestureResponder.panHandlers : {})}
                >
                {showBaseImage && gardenQuery.data?.photoUri ? (
                  <Image source={{ uri: gardenQuery.data.photoUri }} style={styles.canvasImage} resizeMode="stretch" />
                ) : (
                    <View style={[styles.canvasImage, styles.placeholder, { backgroundColor: theme.appBackground }]} />
                )}

                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={onCanvasPress}
                  disabled={!isEditingCanvas || canvasMode === "pan"}
                >
                  <Svg width="100%" height="100%">
                    {showGridLayer && gridVerticalLines.map((x, index) => (
                      <Line
                        key={`grid-v-${index.toString()}`}
                        x1={x}
                        y1={0}
                        x2={x}
                        y2={canvas.height}
                        stroke={theme.gridLineColor}
                        strokeWidth={1}
                      />
                    ))}
                    {showGridLayer && gridHorizontalLines.map((y, index) => (
                      <Line
                        key={`grid-h-${index.toString()}`}
                        x1={0}
                        y1={y}
                        x2={canvas.width}
                        y2={y}
                        stroke={theme.gridLineColor}
                        strokeWidth={1}
                      />
                    ))}
                    {!isBoundaryRect(gardenBoundary) && (
                      <Path
                        d={`${rectPath(canvas.width, canvas.height)} ${polygonPath(gardenBoundary, canvas.width, canvas.height)}`}
                        fill={theme.appBackground}
                        fillRule="evenodd"
                      />
                    )}
                    <Polygon
                      points={toSvgPoints(gardenBoundary, canvas)}
                      fill={showBaseImage && gardenQuery.data?.photoUri ? "transparent" : theme.mapBoundaryFill}
                      stroke={theme.mapBoundaryStroke}
                      strokeWidth={showBaseImage && gardenQuery.data?.photoUri ? 3 : 4}
                    />
                    
                    {/* Boundary editing handles */}
                    {canvasMode === "boundary" && gardenBoundary.map((point, index) => {
                      const x = point.x * canvas.width;
                      const y = point.y * canvas.height;
                      const isSelected = selectedBoundaryPoint === index;
                      return (
                        <Circle
                          key={`boundary-handle-${index}`}
                          cx={x}
                          cy={y}
                          r={isSelected ? 8 : 6}
                          fill={isSelected ? theme.dangerActionBackground : theme.primaryActionBackground}
                          stroke={theme.borderColor}
                          strokeWidth={2}
                          onPress={() => setSelectedBoundaryPoint(index)}
                        />
                      );
                    })}
                    {boundaryMeasurements.map((measurement, index) => (
                      <SvgText
                        key={`boundary-measure-${index.toString()}`}
                        x={measurement.x}
                        y={measurement.y}
                        textAnchor="middle"
                        alignmentBaseline="middle"
                        fontSize={11 * annotationScale}
                        fontWeight="700"
                        fill={theme.textPrimary}
                        transform={`rotate(${measurement.angle} ${measurement.x} ${measurement.y})`}
                      >
                        {measurement.label}
                      </SvgText>
                    ))}
                    {zonesToRender.map((zone) => {
                      const points = toSvgPoints(zone.polygon, canvas);
                      const color = zone.source === "bed"
                        ? {
                            fill: zone.containsPerennials ? theme.mapPerennialBedFill : theme.mapBedFill,
                            stroke: theme.mapBedStroke,
                          }
                        : typeColors[zone.type];
                      const isEditingThis = editingZoneId === zone.id;
                      const stripeSpec = getStripeSpecForType(zone.type, theme);
                      const hatchLines = stripeSpec
                        ? buildHatchLines(canvas.width, canvas.height, stripeSpec.spacingPx, stripeSpec.angleDeg)
                        : [];
                      const clippedHatchLines = stripeSpec
                        ? clipHatchLinesToPolygon(hatchLines, zone.polygon, canvas.width, canvas.height)
                        : [];
                      const bedLabel = zone.source === "bed"
                        ? getPolygonLabelPlacement(zone.polygon, canvas.width, canvas.height)
                        : null;
                      const bedMeasurementLabels = showBedMeasurementsLayer && zone.source === "bed"
                        ? getBedMeasurementLabels(zone.polygon, canvas.width, canvas.height, calibration)
                        : [];

                      return (
                        <Fragment key={zone.id}>
                          <Polygon
                            points={points}
                            fill={color.fill}
                            stroke={isEditingThis ? theme.primaryActionBackground : color.stroke}
                            strokeWidth={isEditingThis ? 4 : 2}
                          />
                          {stripeSpec && clippedHatchLines.map((line, index) => (
                            <Line
                              key={`zone-stripe-${zone.id}-${index.toString()}`}
                              x1={line.x1}
                              y1={line.y1}
                              x2={line.x2}
                              y2={line.y2}
                              stroke={stripeSpec.color}
                              strokeWidth={1}
                              opacity={stripeSpec.opacity}
                            />
                          ))}
                          {bedMeasurementLabels.map((measurement, index) => (
                            <SvgText
                              key={`bed-measure-${zone.id}-${index.toString()}`}
                              x={measurement.x}
                              y={measurement.y}
                              textAnchor="middle"
                              alignmentBaseline="middle"
                              fontSize={11 * annotationScale}
                              fontWeight="700"
                              fill={theme.textPrimary}
                              transform={`rotate(${measurement.angle} ${measurement.x} ${measurement.y})`}
                            >
                              {measurement.label}
                            </SvgText>
                          ))}
                          {bedLabel && (
                            <SvgText
                              x={bedLabel.x}
                              y={bedLabel.y}
                              textAnchor="middle"
                              alignmentBaseline="middle"
                              fontSize={bedLabel.fontSize * annotationScale}
                              fontWeight="800"
                              fill={theme.textPrimary}
                            >
                              {truncateLabel(zone.name, 20)}
                            </SvgText>
                          )}
                        </Fragment>
                      );
                    })}

                    {draftPoints.length >= 2 && (
                      <>
                        <Polygon
                          points={toSvgPoints(draftPoints, canvas)}
                          fill={
                            isClosed
                              ? activeType === GardenFeatureType.BED && containsPerennials
                                ? theme.mapPerennialBedFill
                                : typeColors[activeType].fill
                              : withAlpha(theme.textPrimary, 0.1)
                          }
                          stroke={typeColors[activeType].stroke}
                          strokeWidth={3}
                          {...(!isClosed ? { strokeDasharray: [10, 5] } : {})}
                        />
                        {isClosed && getStripeSpecForType(activeType, theme) && clipHatchLinesToPolygon(
                          buildHatchLines(
                            canvas.width,
                            canvas.height,
                            getStripeSpecForType(activeType, theme)!.spacingPx,
                            getStripeSpecForType(activeType, theme)!.angleDeg
                          ),
                          draftPoints,
                          canvas.width,
                          canvas.height
                        ).map((line, index) => (
                          <Line
                            key={`draft-stripe-${index.toString()}`}
                            x1={line.x1}
                            y1={line.y1}
                            x2={line.x2}
                            y2={line.y2}
                            stroke={getStripeSpecForType(activeType, theme)!.color}
                            strokeWidth={1}
                            opacity={getStripeSpecForType(activeType, theme)!.opacity}
                          />
                        ))}
                        {draftBedMeasurementLabels.map((measurement, index) => (
                          <SvgText
                            key={`draft-bed-measure-${index.toString()}`}
                            x={measurement.x}
                            y={measurement.y}
                            textAnchor="middle"
                            alignmentBaseline="middle"
                            fontSize={11 * annotationScale}
                            fontWeight="700"
                            fill={theme.textPrimary}
                            transform={`rotate(${measurement.angle} ${measurement.x} ${measurement.y})`}
                          >
                            {measurement.label}
                          </SvgText>
                        ))}
                      </>
                    )}

                    {draftPoints.filter(isFinitePoint).map((point, index) => (
                      <Circle
                        key={`draft-${index.toString()}`}
                        cx={point.x * canvas.width}
                        cy={point.y * canvas.height}
                        r={selectedPointIndex === index ? 8 : 6}
                        fill={selectedPointIndex === index ? theme.primaryActionBackground : theme.surfaceBackground}
                        stroke={theme.textPrimary}
                        strokeWidth={2}
                      />
                    ))}
                  </Svg>

                  {isEditingCanvas && canvasMode === "draw" && presetShape &&
                    <>
                      <VertexHandle
                        point={presetShape.center}
                        width={canvas.width}
                        height={canvas.height}
                        onSelect={() => setSelectedPointIndex(null)}
                        onDrag={movePresetShape}
                      />
                      <VertexHandle
                        point={getPresetResizeHandlePoint(presetShape)}
                        width={canvas.width}
                        height={canvas.height}
                        onSelect={() => setSelectedPointIndex(null)}
                        onDrag={resizePresetShapeFromHandle}
                      />
                    </>}

                  {isEditingCanvas && canvasMode === "draw" && !presetShape &&
                    draftPoints.filter(isFinitePoint).map((point, index) => (
                    <VertexHandle
                      key={`handle-${index.toString()}`}
                      point={point}
                      width={canvas.width}
                      height={canvas.height}
                      onSelect={() => setSelectedPointIndex(index)}
                      onDrag={(nextPoint) => {
                        const snappedPoint = snapPoint(nextPoint);
                        if (!isPointInsidePolygon(snappedPoint, gardenBoundary)) {
                          return;
                        }
                        setDraftPoints((prev) => prev.map((p, i) => (i === index ? snappedPoint : p)));
                      }}
                    />
                    ))}

                  {/* Boundary editing handles */}
                  {canvasMode === "boundary" && currentBoundary &&
                    currentBoundary.map((point, index) => (
                    <VertexHandle
                      key={`boundary-handle-${index.toString()}`}
                      point={point}
                      width={canvas.width}
                      height={canvas.height}
                      onSelect={() => setSelectedBoundaryPoint(selectedBoundaryPoint === index ? null : index)}
                      onDrag={(nextPoint) => {
                        const snappedPoint = snapPoint(nextPoint);
                        if (!editingBoundary) return;
                        
                        // Update the editing boundary state
                        const updatedBoundary = editingBoundary.map((p, i) => 
                          i === index ? snappedPoint : p
                        );
                        
                        setEditingBoundary(updatedBoundary);
                      }}
                    />
                    ))}
                </Pressable>
                </View>
              </ScrollView>
            </ScrollView>
          </View>
          
          {canvasMode !== "boundary" && (
            <View style={styles.toolbarRow}>
              <Pressable
                style={[
                  styles.secondaryButton,
                  { backgroundColor: isExportingImage ? theme.disabledActionBackground : theme.secondaryActionBackground },
                ]}
                onPress={() => void exportPlannerImage()}
                disabled={isExportingImage}
              >
                <Text style={[styles.secondaryButtonText, { color: isExportingImage ? theme.disabledActionText : theme.secondaryActionText }]}>
                  {isExportingImage ? "Exporting..." : "Export Image"}
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>3. Tools</Text>
          
          {canvasMode === "boundary" ? (
            // Boundary editing tools
            <>
              <View style={styles.toolbarRow}>
                <Text style={[styles.infoText, { color: theme.infoText, flex: 1 }]}>
                  Drag boundary points to reshape your garden area. Beds outside the new boundary may need to be moved.
                </Text>
              </View>
              <View style={styles.toolbarRow}>
                <AppButton
                  label="Cancel"
                  variant="danger"
                  onPress={cancelBoundaryEdit}
                />
                <AppButton
                  label="Save Boundary"
                  variant="primary"
                  onPress={() => void saveBoundary()}
                />
              </View>
            </>
          ) : (
            // Regular drawing tools
            <View style={styles.toolbarRow}>
              <SimpleToggle
                label="Snap"
                value={snapToGrid}
                disabled={!calibration}
                onToggle={setSnapToGrid}
              />
              <Pressable
                style={[
                  styles.secondaryButton,
                  { backgroundColor: canApplyShape || canCloseShape ? theme.choiceControlActiveBackground : theme.choiceControlBackground },
                ]}
                onPress={() => {
                  if (presetShape) {
                    setPresetShape(null);
                    setShapeDraftMode("points");
                    return;
                  }
                  closePolygon();
                }}
                disabled={!canApplyShape && !canCloseShape}
              >
                <Text style={[styles.secondaryButtonText, { color: canApplyShape || canCloseShape ? theme.choiceControlActiveText : theme.choiceControlText }]}>
                  {shapeActionLabel}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.secondaryButton,
                  { backgroundColor: canUndo ? theme.choiceControlActiveBackground : theme.choiceControlBackground },
                ]}
                onPress={handleUndo}
                disabled={!canUndo}
              >
                <Text style={[styles.secondaryButtonText, { color: canUndo ? theme.choiceControlActiveText : theme.choiceControlText }]}>Undo</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.secondaryButton,
                  { backgroundColor: canDeletePoint ? theme.dangerActionBackground : theme.disabledActionBackground },
                ]}
                onPress={deleteSelectedPoint}
                disabled={!canDeletePoint}
              >
                <Text style={[styles.secondaryButtonText, { color: canDeletePoint ? theme.dangerActionText : theme.disabledActionText }]}>Delete Point</Text>
              </Pressable>
            </View>
          )}
          <Text style={[styles.infoText, { color: theme.infoText }]}>Twist and zoom in Pan mode for easier drawing alignment.</Text>
          {showGridLayer && calibration && <Text style={[styles.infoText, { color: theme.infoText }]}>Grid spacing: 1 meter.</Text>}
          {presetShape && (
            <Text style={[styles.infoText, { color: theme.infoText }]}>
              {presetShape.kind === "line"
                ? "Drag center handle to move and end handle to rotate/lengthen, then tap Apply Shape."
                : "Drag center handle to move, corner handle to resize, then tap Apply Shape."}
            </Text>
          )}
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>4. Area Details</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={activeType === GardenFeatureType.BED ? "Bed name" : "Area name"}
            placeholderTextColor={theme.textMuted}
            style={[styles.nameInput, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
          />

          {activeType === GardenFeatureType.BED && (
            <View style={styles.metaRow}>
              <View style={styles.choiceRow}>
                <Text style={[styles.choiceLabel, { color: theme.textMuted }]}>Sun:</Text>
                <SegmentedChoice
                  options={[
                    { id: SunExposure.FULL_SUN, label: "Full Sun" },
                    { id: SunExposure.PART_SUN, label: "Part Sun" },
                    { id: SunExposure.SHADE, label: "Shade" }
                  ]}
                  selectedId={sunExposure}
                  onSelect={(value) => setSunExposure(value as SunExposure)}
                />
              </View>
              <View style={styles.choiceRow}>
                <Text style={[styles.choiceLabel, { color: theme.textMuted }]}>Drainage:</Text>
                <SegmentedChoice
                  options={[
                    { id: Drainage.GOOD, label: "Good" },
                    { id: Drainage.MEDIUM, label: "Medium" },
                    { id: Drainage.POOR, label: "Poor" }
                  ]}
                  selectedId={drainage}
                  onSelect={(value) => setDrainage(value as Drainage)}
                />
              </View>
              <View style={styles.toggleGrid}>
                <SimpleToggle
                  label="Raised Bed"
                  value={isRaisedBed}
                  onToggle={setIsRaisedBed}
                />
                <SimpleToggle
                  label="Perennial"
                  value={containsPerennials}
                  onToggle={setContainsPerennials}
                />
                <SimpleToggle
                  label="Irrigation"
                  value={hasIrrigation}
                  onToggle={setHasIrrigation}
                />
              </View>
              {canPrecisionEditBed && (
                <View style={styles.precisionCard}>
                  <Text style={[styles.precisionTitle, { color: theme.textPrimary }]}>Precision Controls (Beds)</Text>
                  <Text style={[styles.infoText, { color: theme.infoText }]}>Drag updates values. Editing values updates bed size.</Text>
                  {isDraftBedRectangle ? (
                    <View style={styles.precisionDualRow}>
                      <View style={styles.precisionField}>
                        <Text style={[styles.pickerTitle, { color: theme.textPrimary }]}>Length (m)</Text>
                        <TextInput
                          value={rectLengthMInput}
                          onChangeText={handleRectLengthChange}
                          onFocus={() => setIsEditingRectLength(true)}
                          onBlur={() => {
                            setIsEditingRectLength(false);
                            if (rectLengthTimerRef.current) clearTimeout(rectLengthTimerRef.current);
                            const parsed = Number(rectLengthMInput);
                            if (Number.isFinite(parsed) && parsed > 0) {
                              applyRectangleDimension(0, rectLengthMInput);
                            }
                          }}
                          placeholder="Length (m)"
                          placeholderTextColor={theme.textMuted}
                          keyboardType="decimal-pad"
                          style={[styles.nameInput, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
                        />
                      </View>
                      <View style={styles.precisionField}>
                        <Text style={[styles.pickerTitle, { color: theme.textPrimary }]}>Width (m)</Text>
                        <TextInput
                          value={rectWidthMInput}
                          onChangeText={handleRectWidthChange}
                          onFocus={() => setIsEditingRectWidth(true)}
                          onBlur={() => {
                            setIsEditingRectWidth(false);
                            if (rectWidthTimerRef.current) clearTimeout(rectWidthTimerRef.current);
                            const parsed = Number(rectWidthMInput);
                            if (Number.isFinite(parsed) && parsed > 0) {
                              applyRectangleDimension(1, rectWidthMInput);
                            }
                          }}
                          placeholder="Width (m)"
                          placeholderTextColor={theme.textMuted}
                          keyboardType="decimal-pad"
                          style={[styles.nameInput, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
                        />
                      </View>
                    </View>
                  ) : (
                    <Text style={[styles.infoText, { color: theme.infoText }]}>Point/ellipse beds: resize directly on the map.</Text>
                  )}
                </View>
              )}
            </View>
          )}
        </View>

        <View style={[styles.saveCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>5. Save Current Area</Text>
          <Text style={[styles.infoText, { color: theme.infoText }]}>
            {saveDisabled ? "Add at least 3 points and a name to enable save." : "Ready to save."}
          </Text>
          <Pressable
            style={[
              styles.primarySaveButton,
              { backgroundColor: saveDisabled ? theme.disabledActionBackground : theme.primaryActionBackground },
            ]}
            onPress={saveZone}
            disabled={saveDisabled}
          >
            <Text style={[styles.primarySaveButtonText, { color: saveDisabled ? theme.disabledActionText : theme.primaryActionText }]}>
              {editingZoneId ? `Update ${activeType}` : `Save ${activeType}`}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>6. Saved Areas</Text>
          {existingZones.length === 0 && <Text style={[styles.emptyText, { color: theme.textMuted }]}>No saved areas yet.</Text>}
          {existingZones.map((zone) => (
            <View key={zone.id} style={styles.zoneRow}>
              <View style={styles.zoneMeta}>
                <Text style={[styles.zoneName, { color: theme.textPrimary }]}>{zone.name}</Text>
                <Text style={[styles.zoneSub, { color: theme.textMuted }]}>
                  {zone.type} | {zone.polygon.length} pts
                  {zone.source === "bed" && zone.containsPerennials ? " | perennial" : ""}
                  {calibration
                    ? ` | ~${normalizedAreaToSqM(
                        polygonArea(zone.polygon),
                        calibration.metersPerPixel,
                        calibration.baseWidth,
                        calibration.baseHeight
                        ).toFixed(1)} sqm`
                    : ""}
                </Text>
              </View>
              <View style={styles.zoneActions}>
                <Pressable style={[styles.editButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => startEditZone(zone)}>
                  <Text style={[styles.editButtonText, { color: theme.secondaryActionText }]}>Edit</Text>
                </Pressable>
                <Pressable style={[styles.deleteButton, { backgroundColor: theme.dangerActionBackground }]} onPress={() => confirmDeleteZone(zone)}>
                  <Text style={[styles.deleteButtonText, { color: theme.dangerActionText }]}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.footerCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.footerText, { color: theme.textMuted }]}>
            Draft points: {draftPoints.length}
            {" | "}Area ratio: {area.toFixed(3)}
            {areaSqM !== null ? ` | ~${areaSqM.toFixed(1)} sqm` : ""}
            {" | "}Saved zones: {existingZones.length}
          </Text>
        </View>
        </ScrollView>
      </SafeAreaView>

      {/* Delete Zone Modal */}
      <Modal visible={Boolean(deleteZoneDraft)} transparent animationType="fade" onRequestClose={() => setDeleteZoneDraft(null)}>
        <View style={[styles.modalBackdrop, { backgroundColor: theme.modalBackdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.modalSurfaceBackground, borderColor: theme.modalSurfaceBorder }]}>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Delete Area</Text>
            <Text style={[styles.modalText, { color: theme.textMuted }]}>
              {deleteZoneDraft ? `Delete "${deleteZoneDraft.name}"?` : ""}
            </Text>
            <View style={styles.modalActions}>
              <AppButton
                label="Cancel"
                variant="secondary"
                onPress={() => setDeleteZoneDraft(null)}
              />
              <AppButton
                label="Delete"
                variant="danger"
                onPress={() => {
                  if (deleteZoneDraft) {
                    void deleteZone(deleteZoneDraft);
                    setDeleteZoneDraft(null);
                  }
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function VertexHandle(props: {
  point: Point2D;
  width: number;
  height: number;
  onSelect: () => void;
  onDrag: (point: Point2D) => void;
}) {
  const pointRef = useRef(props.point);
  const widthRef = useRef(props.width);
  const heightRef = useRef(props.height);
  const onSelectRef = useRef(props.onSelect);
  const onDragRef = useRef(props.onDrag);
  const dragStartRef = useRef(props.point);

  useEffect(() => {
    pointRef.current = props.point;
    widthRef.current = props.width;
    heightRef.current = props.height;
    onSelectRef.current = props.onSelect;
    onDragRef.current = props.onDrag;
  }, [props.height, props.onDrag, props.onSelect, props.point, props.width]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStartRef.current = pointRef.current;
          onSelectRef.current();
        },
        onPanResponderMove: (_event, gestureState) => {
          const width = widthRef.current;
          const height = heightRef.current;
          if (width <= 0 || height <= 0) return;

          const start = dragStartRef.current;
          onDragRef.current({
            x: clamp(start.x + gestureState.dx / width, 0, 1),
            y: clamp(start.y + gestureState.dy / height, 0, 1),
          });
        },
      }),
    []
  );

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

function SimpleToggle(props: {
  label: string;
  value: boolean;
  onToggle: (nextValue: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      style={[styles.simpleToggleRow, { opacity: props.disabled ? 0.45 : 1 }]}
      onPress={() => {
        if (props.disabled) return;
        props.onToggle(!props.value);
      }}
    >
      <Text style={[styles.simpleToggleLabel, { color: theme.textPrimary }]}>{props.label}</Text>
      <View
        style={[
          styles.simpleToggleTrack,
          { backgroundColor: props.value ? theme.toggleOnBackground : theme.toggleOffBackground },
        ]}
      >
        <View style={[styles.simpleToggleThumb, { backgroundColor: theme.toggleThumbColor }, props.value && styles.simpleToggleThumbActive]} />
      </View>
    </Pressable>
  );
}

function ToggleSwitch(props: {
  label: string;
  value: boolean;
  onToggle: (nextValue: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      style={[
        styles.switchRow,
        { backgroundColor: theme.secondaryActionBackground },
        props.disabled && styles.switchRowDisabled,
      ]}
      onPress={() => {
        if (props.disabled) return;
        props.onToggle(!props.value);
      }}
    >
      <Text style={[styles.switchLabel, { color: theme.secondaryActionText }]}>{props.label}</Text>
      <View
        style={[
          styles.switchTrack,
          { backgroundColor: props.value ? theme.toggleOnBackground : theme.toggleOffBackground },
        ]}
      >
        <View style={[styles.switchThumb, { backgroundColor: theme.toggleThumbColor }, props.value && styles.switchThumbActive]} />
      </View>
    </Pressable>
  );
}

function PickerRow(props: {
  title: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.pickerRow}>
      <Text style={[styles.pickerTitle, { color: theme.textPrimary }]}>{props.title}</Text>
      <View style={styles.pickerOptionsRow}>
        {props.options.map((option) => (
          <Pressable
            key={option}
            onPress={() => props.onSelect(option)}
            style={[
              styles.pickerChip,
              { backgroundColor: props.selected === option ? theme.choiceControlActiveBackground : theme.choiceControlBackground },
            ]}
          >
            <Text style={[styles.pickerChipText, { color: props.selected === option ? theme.choiceControlActiveText : theme.choiceControlText }]}>
              {option.replace("_", " ")}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const FLOAT_TOLERANCE = 1e-6;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= FLOAT_TOLERANCE;
}

function arePointsEquivalent(a: Point2D, b: Point2D): boolean {
  return nearlyEqual(a.x, b.x) && nearlyEqual(a.y, b.y);
}

function arePointArraysEquivalent(a: Point2D[], b: Point2D[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const pointA = a[index];
    const pointB = b[index];
    if (!pointA || !pointB || !arePointsEquivalent(pointA, pointB)) {
      return false;
    }
  }
  return true;
}

function arePresetShapesEquivalent(a: PresetShapeDraft, b: PresetShapeDraft): boolean {
  return (
    a.kind === b.kind &&
    arePointsEquivalent(a.center, b.center) &&
    nearlyEqual(a.width, b.width) &&
    nearlyEqual(a.height, b.height) &&
    nearlyEqual(a.angleDeg ?? 0, b.angleDeg ?? 0) &&
    a.variant === b.variant &&
    Boolean(a.forceCircle) === Boolean(b.forceCircle)
  );
}

function withAlpha(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const hex = color.trim().replace(/^#/, "");
  const a = Math.round(clamped * 255).toString(16).padStart(2, "0").toUpperCase();
  
  // Handle 8-digit hex (RGBA) - replace existing alpha
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    const base = hex.slice(0, 6).toUpperCase();
    return `#${base}${a}`;
  }
  
  // Handle 6-digit hex (RGB)
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex.toUpperCase()}${a}`;
  }
  
  // Handle 3-digit hex (RGB shorthand)
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const expanded = hex.split('').map(char => char + char).join('');
    return `#${expanded.toUpperCase()}${a}`;
  }
  
  // Handle 4-digit hex (RGBA shorthand) - replace existing alpha
  if (/^[0-9a-fA-F]{4}$/.test(hex)) {
    const expanded = hex.slice(0, 3).split('').map(char => char + char).join('');
    return `#${expanded.toUpperCase()}${a}`;
  }
  

  return color;
}

function normalizeDegrees(value: number): number {
  let deg = value;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function getGestureMetrics(
  touches: readonly { pageX: number; pageY: number }[]
): { distance: number; angle: number } | null {
  if (touches.length < 2) return null;
  const a = touches[0];
  const b = touches[1];
  if (!a || !b) return null;
  const dx = b.pageX - a.pageX;
  const dy = b.pageY - a.pageY;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { distance, angle };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function getShapeOptionsForType(type: GardenFeatureType): Array<{ mode: ShapeDraftMode; label: string }> {
  switch (type) {
    case GardenFeatureType.BED:
    case GardenFeatureType.LAWN:
      return [
        { mode: "rectangle", label: "Rectangle" },
        { mode: "ellipse", label: "Ellipse" },
        { mode: "points", label: "Points" },
      ];
    case GardenFeatureType.TREE:
      return [{ mode: "ellipse", label: "Tree" }];
    case GardenFeatureType.SHRUB:
      return [{ mode: "ellipse", label: "Shrub" }];
    case GardenFeatureType.FENCE:
    case GardenFeatureType.WALL:
    case GardenFeatureType.HEDGE:
    case GardenFeatureType.PATH:
    case GardenFeatureType.TRELLIS:
      return [{ mode: "line", label: "Line" }];
    case GardenFeatureType.PATIO:
    case GardenFeatureType.DECK:
      return [
        { mode: "rectangle", label: "Rectangle" },
        { mode: "points", label: "Points" },
      ];
    default:
      return [{ mode: "points", label: "Points" }];
  }
}

function nextZoneName(type: GardenFeatureType, zones: ZonePreview[]): string {
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  const maxNumber = zones.reduce((max, zone) => {
    if (zone.type !== type) return max;
    const match = new RegExp(`^${type}\\s+(\\d+)$`, "i").exec(zone.name.trim());
    if (!match) return max;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  return `${label} ${maxNumber + 1}`;
}

function normalizedAreaToSqM(
  normalizedArea: number,
  metersPerPixel: number,
  baseWidth: number,
  baseHeight: number
): number {
  return normalizedArea * baseWidth * baseHeight * metersPerPixel * metersPerPixel;
}

function getStripeSpecForType(
  type: GardenFeatureType,
  theme: import("@/ui/theme/themeTokens").ThemeTokens
): { spacingPx: number; angleDeg: number; color: string; opacity: number } | null {
  switch (type) {
    case GardenFeatureType.LAWN:
      return { spacingPx: 22, angleDeg: -22, color: theme.mapLawnStroke, opacity: 0.22 };
    case GardenFeatureType.DECK:
      return { spacingPx: 12, angleDeg: -18, color: theme.mapDeckStroke, opacity: 0.24 };
    default:
      return null;
  }
}

function buildHatchLines(
  width: number,
  height: number,
  spacingPx: number,
  angleDeg: number
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  if (width <= 0 || height <= 0 || spacingPx <= 0) return [];
  const angle = (angleDeg * Math.PI) / 180;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const normalX = -dirY;
  const normalY = dirX;
  const diagonal = Math.hypot(width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let offset = -diagonal; offset <= diagonal; offset += spacingPx) {
    const baseX = centerX + normalX * offset;
    const baseY = centerY + normalY * offset;
    lines.push({
      x1: baseX - dirX * diagonal,
      y1: baseY - dirY * diagonal,
      x2: baseX + dirX * diagonal,
      y2: baseY + dirY * diagonal,
    });
  }
  return lines;
}

function clipHatchLinesToPolygon(
  lines: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  polygon: Point2D[],
  width: number,
  height: number
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  if (polygon.length < 3 || width <= 0 || height <= 0 || lines.length === 0) return [];
  const pixelPolygon = polygon.map((point) => ({ x: point.x * width, y: point.y * height }));
  const clipped: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const line of lines) {
    const segments = clipLineToPolygon(
      { x: line.x1, y: line.y1 },
      { x: line.x2, y: line.y2 },
      pixelPolygon
    );
    for (const segment of segments) {
      clipped.push({
        x1: segment.start.x,
        y1: segment.start.y,
        x2: segment.end.x,
        y2: segment.end.y,
      });
    }
  }
  return clipped;
}

function buildGridSeries(start: number, end: number, step: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step <= 0) {
    return [];
  }
  if (end <= start) {
    return [];
  }

  const lines: number[] = [];
  const maxSteps = 5000;
  let index = 0;
  while (index < maxSteps) {
    const value = start + index * step;
    if (value > end + 1e-9) break;
    lines.push(value);
    index += 1;
  }
  return lines;
}

function inferPresetShapeFromZone(zone: ZonePreview): PresetShapeDraft | null {
  const points = zone.polygon.filter(isFinitePoint);
  if (points.length < 3) return null;
  const options = getShapeOptionsForType(zone.type);
  const canLine = options.some((option) => option.mode === "line");
  const canEllipse = options.some((option) => option.mode === "ellipse");
  const canRectangle = options.some((option) => option.mode === "rectangle");

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = clamp(maxX - minX, 0.02, 1.8);
  const height = clamp(maxY - minY, 0.02, 1.8);
  const center: Point2D = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const aspect = Math.max(width, height) / Math.max(Math.min(width, height), 1e-6);

  if (canLine && points.length === 4 && aspect >= 3) {
    const longest = getLongestEdge(points);
    const angleDeg = (Math.atan2(longest.dy, longest.dx) * 180) / Math.PI;
    return {
      kind: "line",
      center,
      width: clamp(longest.length, 0.08, 1.8),
      height: clamp(Math.min(width, height), 0.012, 0.08),
      angleDeg,
    };
  }

  if (canEllipse && (points.length >= 8 || zone.type === GardenFeatureType.TREE || zone.type === GardenFeatureType.SHRUB)) {
    if (isLikelyEllipse(points, center, width, height) || zone.type === GardenFeatureType.TREE || zone.type === GardenFeatureType.SHRUB) {
      const forceCircle = zone.type === GardenFeatureType.TREE || zone.type === GardenFeatureType.SHRUB;
      const size = Math.max(width, height);
      return {
        kind: "ellipse",
        center,
        width: forceCircle ? size : width,
        height: forceCircle ? size : height,
        forceCircle,
        ...(zone.type === GardenFeatureType.TREE ? { variant: "tree" as const } : {}),
        ...(zone.type === GardenFeatureType.SHRUB ? { variant: "shrub" as const } : {}),
      };
    }
  }

  if (canRectangle && points.length === 4 && aspect < 3) {
    return {
      kind: "rectangle",
      center,
      width,
      height,
    };
  }

  return null;
}

function getLongestEdge(points: Point2D[]): { dx: number; dy: number; length: number } {
  let best = { dx: 1, dy: 0, length: 0.001 };
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (!current || !next) continue;
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const length = Math.hypot(dx, dy);
    if (length > best.length) {
      best = { dx, dy, length };
    }
  }
  return best;
}

function isLikelyEllipse(points: Point2D[], center: Point2D, width: number, height: number): boolean {
  const halfW = Math.max(width / 2, 1e-6);
  const halfH = Math.max(height / 2, 1e-6);
  const radii = points.map((p) => Math.hypot((p.x - center.x) / halfW, (p.y - center.y) / halfH));
  if (radii.length < 5) return false;
  const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  const variance = radii.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / radii.length;
  const stdDev = Math.sqrt(variance);
  return stdDev < 0.22;
}

function getPresetResizeHandlePoint(shape: PresetShapeDraft): Point2D {
  if (shape.kind === "line") {
    const angle = ((shape.angleDeg ?? 0) * Math.PI) / 180;
    const halfW = Math.max(shape.width / 2, 0.02);
    return {
      x: clamp(shape.center.x + Math.cos(angle) * halfW, 0, 1),
      y: clamp(shape.center.y + Math.sin(angle) * halfW, 0, 1),
    };
  }
  return {
    x: clamp(shape.center.x + shape.width / 2, 0, 1),
    y: clamp(shape.center.y + shape.height / 2, 0, 1),
  };
}

function getPolygonLabelPlacement(
  polygon: Point2D[],
  width: number,
  height: number
): { x: number; y: number; fontSize: number } | null {
  if (polygon.length < 3 || width <= 0 || height <= 0) return null;
  const centroid = polygon.reduce(
    (acc, point) => ({ x: acc.x + point.x / polygon.length, y: acc.y + point.y / polygon.length }),
    { x: 0, y: 0 }
  );
  const xs = polygon.map((point) => point.x * width);
  const ys = polygon.map((point) => point.y * height);
  const bboxWidth = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const bboxHeight = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const fontSize = clamp(Math.min(bboxWidth * 0.12, bboxHeight * 0.28), 9, 16);
  return {
    x: clamp(centroid.x, 0, 1) * width,
    y: clamp(centroid.y, 0, 1) * height,
    fontSize,
  };
}

function truncateLabel(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}�`;
}

function pointsFromPresetShape(shape: PresetShapeDraft): Point2D[] {
  const cx = Number.isFinite(shape.center?.x) ? shape.center.x : 0.5;
  const cy = Number.isFinite(shape.center?.y) ? shape.center.y : 0.5;
  const width = Math.max(Number.isFinite(shape.width) ? shape.width : 0.2, 0.02);
  const height = Math.max(shape.forceCircle ? width : Number.isFinite(shape.height) ? shape.height : 0.2, 0.02);
  const halfW = width / 2;
  const halfH = height / 2;
  if (shape.kind === "rectangle") {
    return [
      { x: clamp(cx - halfW, 0, 1), y: clamp(cy - halfH, 0, 1) },
      { x: clamp(cx + halfW, 0, 1), y: clamp(cy - halfH, 0, 1) },
      { x: clamp(cx + halfW, 0, 1), y: clamp(cy + halfH, 0, 1) },
      { x: clamp(cx - halfW, 0, 1), y: clamp(cy + halfH, 0, 1) },
    ];
  }

  if (shape.kind === "line") {
    const halfW = width / 2;
    const halfH = Math.max(height / 2, 0.01);
    const angle = ((shape.angleDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const corners = [
      { x: -halfW, y: -halfH },
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH },
    ];
    return corners.map((corner) => ({
      x: clamp(cx + corner.x * cos - corner.y * sin, 0, 1),
      y: clamp(cy + corner.x * sin + corner.y * cos, 0, 1),
    }));
  }

  const isSpiky = shape.variant === "tree" || shape.variant === "shrub";
  const outerSegments = shape.variant === "tree" ? 14 : shape.variant === "shrub" ? 12 : 24;
  const segments = isSpiky ? outerSegments * 2 : outerSegments;
  const points: Point2D[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const spikeFactor = isSpiky && i % 2 === 1 ? (shape.variant === "tree" ? 0.72 : 0.8) : 1;
    points.push({
      x: clamp(cx + Math.cos(t) * halfW * spikeFactor, 0, 1),
      y: clamp(cy + Math.sin(t) * halfH * spikeFactor, 0, 1),
    });
  }
  return points;
}

function rectanglePresetFromPolygon(polygon: Point2D[]): PresetShapeDraft | null {
  if (polygon.length < 4) return null;
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(0.02, maxX - minX);
  const height = Math.max(0.02, maxY - minY);
  return {
    kind: "rectangle",
    center: {
      x: clamp((minX + maxX) / 2, 0, 1),
      y: clamp((minY + maxY) / 2, 0, 1),
    },
    width,
    height,
  };
}

function snapValueToGrid(value: number, origin: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(origin) || !Number.isFinite(step) || step <= 0) {
    return clamp(value, 0, 1);
  }
  const snapped = origin + Math.round((value - origin) / step) * step;
  return clamp(snapped, 0, 1);
}

function getNormalizedTapPoint(
  event: GestureResponderEvent,
  canvas: { width: number; height: number }
): Point2D | null {
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

function isFinitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function toSvgPoints(points: Point2D[], canvas: { width: number; height: number }): string {
  return points
    .filter(isFinitePoint)
    .map((p) => `${p.x * canvas.width},${p.y * canvas.height}`)
    .join(" ");
}

function getBoundaryOrDefault(boundary: { x: number; y: number }[] | undefined): { x: number; y: number }[] {
  if (boundary && boundary.length >= 3) {
    return boundary;
  }
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
}

function isBoundaryRect(boundary: { x: number; y: number }[]): boolean {
  if (boundary.length !== 4) return false;
  const b = boundary;
  return (
    approx(b[0]?.x, 0) && approx(b[0]?.y, 0) &&
    approx(b[1]?.x, 1) && approx(b[1]?.y, 0) &&
    approx(b[2]?.x, 1) && approx(b[2]?.y, 1) &&
    approx(b[3]?.x, 0) && approx(b[3]?.y, 1)
  );
}

function approx(value: number | undefined, target: number): boolean {
  if (value === undefined) return false;
  return Math.abs(value - target) < 0.02;
}

function rectPath(width: number, height: number): string {
  return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
}

function polygonPath(points: { x: number; y: number }[], width: number, height: number): string {
  if (points.length < 3) return "";
  const first = points[0]!;
  const start = `M ${first.x * width} ${first.y * height}`;
  const lines = points.slice(1).map((p) => `L ${p.x * width} ${p.y * height}`).join(" ");
  return `${start} ${lines} Z`;
}

function getBoundaryMeasurementLabels(
  boundary: Point2D[],
  width: number,
  height: number,
  calibration: { metersPerPixel: number; baseWidth: number; baseHeight: number } | null | undefined
): Array<{ x: number; y: number; angle: number; label: string }> {
  if (!calibration || boundary.length < 2 || width <= 0 || height <= 0) return [];
  const labels: Array<{ x: number; y: number; angle: number; label: string }> = [];
  const epsilon = 1e-6;
  const centroid = boundary.reduce(
    (acc, point) => ({ x: acc.x + point.x / boundary.length, y: acc.y + point.y / boundary.length }),
    { x: 0, y: 0 }
  );
  for (let i = 0; i < boundary.length; i += 1) {
    const start = boundary[i];
    const end = boundary[(i + 1) % boundary.length];
    if (!start || !end) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const pixelLength = Math.hypot(dx * calibration.baseWidth, dy * calibration.baseHeight);
    const meters = pixelLength * calibration.metersPerPixel;
    if (!Number.isFinite(meters) || meters < 0.05) continue;
    const midX = ((start.x + end.x) / 2) * width;
    const midY = ((start.y + end.y) / 2) * height;
    const toOutsideX = midX - centroid.x * width;
    const toOutsideY = midY - centroid.y * height;
    const outsideLength = Math.hypot(toOutsideX, toOutsideY);
    const offset = 14;
    const rawX = outsideLength > epsilon ? midX + (toOutsideX / outsideLength) * offset : midX;
    const rawY = outsideLength > epsilon ? midY + (toOutsideY / outsideLength) * offset : midY;
    const edgeMargin = 16;
    const x = clamp(rawX, edgeMargin, Math.max(edgeMargin, width - edgeMargin));
    const y = clamp(rawY, edgeMargin, Math.max(edgeMargin, height - edgeMargin));
    let angle = (Math.atan2(dy * height, dx * width) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    labels.push({
      x,
      y,
      angle,
      label: `${meters.toFixed(1)}m`,
    });
  }
  return labels;
}

function getBedMeasurementLabels(
  polygon: Point2D[],
  width: number,
  height: number,
  calibration: { metersPerPixel: number; baseWidth: number; baseHeight: number } | null | undefined
): Array<{ x: number; y: number; angle: number; label: string }> {
  if (!calibration || polygon.length < 2 || width <= 0 || height <= 0) return [];
  if (isLikelyEllipsePolygon(polygon)) return [];
  if (isRectangleLikePolygon(polygon)) {
    return getPolygonEdgeMeasurementLabels(polygon, width, height, calibration, [0, 1]);
  }
  return getPolygonEdgeMeasurementLabels(polygon, width, height, calibration);
}

function getPolygonEdgeLengthsMeters(
  polygon: Point2D[],
  calibration: { metersPerPixel: number; baseWidth: number; baseHeight: number } | null | undefined
): number[] {
  if (!calibration || polygon.length < 2) return [];
  return polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const pixelLength = Math.hypot(dx * calibration.baseWidth, dy * calibration.baseHeight);
    return pixelLength * calibration.metersPerPixel;
  });
}

function setRectangleDimensionsMeters(
  polygon: Point2D[],
  calibration: { metersPerPixel: number; baseWidth: number; baseHeight: number },
  lengthMeters: number,
  widthMeters: number
): Point2D[] | null {
  if (polygon.length !== 4) return null;
  if (!Number.isFinite(lengthMeters) || !Number.isFinite(widthMeters) || lengthMeters <= 0 || widthMeters <= 0) {
    return null;
  }

  const toPixels = (point: Point2D) => ({
    x: point.x * calibration.baseWidth,
    y: point.y * calibration.baseHeight,
  });
  const toNormalized = (point: { x: number; y: number }): Point2D => ({
    x: point.x / calibration.baseWidth,
    y: point.y / calibration.baseHeight,
  });
  const p0 = toPixels(polygon[0]!);
  const p1 = toPixels(polygon[1]!);
  const p2 = toPixels(polygon[2]!);
  const p3 = toPixels(polygon[3]!);
  const center = {
    x: (p0.x + p1.x + p2.x + p3.x) / 4,
    y: (p0.y + p1.y + p2.y + p3.y) / 4,
  };
  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const vx = p2.x - p1.x;
  const vy = p2.y - p1.y;
  const uLen = Math.hypot(ux, uy);
  const vLen = Math.hypot(vx, vy);
  if (uLen < 1e-6 || vLen < 1e-6) return null;

  const u = { x: ux / uLen, y: uy / uLen };
  const v = { x: vx / vLen, y: vy / vLen };
  const halfLenPx = lengthMeters / calibration.metersPerPixel / 2;
  const halfWidPx = widthMeters / calibration.metersPerPixel / 2;

  const n0 = {
    x: center.x - u.x * halfLenPx - v.x * halfWidPx,
    y: center.y - u.y * halfLenPx - v.y * halfWidPx,
  };
  const n1 = {
    x: center.x + u.x * halfLenPx - v.x * halfWidPx,
    y: center.y + u.y * halfLenPx - v.y * halfWidPx,
  };
  const n2 = {
    x: center.x + u.x * halfLenPx + v.x * halfWidPx,
    y: center.y + u.y * halfLenPx + v.y * halfWidPx,
  };
  const n3 = {
    x: center.x - u.x * halfLenPx + v.x * halfWidPx,
    y: center.y - u.y * halfLenPx + v.y * halfWidPx,
  };

  return [toNormalized(n0), toNormalized(n1), toNormalized(n2), toNormalized(n3)];
}

function isRectangleLikePolygon(polygon: Point2D[]): boolean {
  if (polygon.length !== 4) return false;
  const vectors = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return { x: next.x - point.x, y: next.y - point.y };
  });
  const lengths = vectors.map((vector) => Math.hypot(vector.x, vector.y));
  if (lengths.some((length) => length < 1e-5)) return false;
  const dot0 = Math.abs(vectors[0]!.x * vectors[1]!.x + vectors[0]!.y * vectors[1]!.y) / (lengths[0]! * lengths[1]!);
  const dot1 = Math.abs(vectors[1]!.x * vectors[2]!.x + vectors[1]!.y * vectors[2]!.y) / (lengths[1]! * lengths[2]!);
  return dot0 < 0.2 && dot1 < 0.2;
}

function isLikelyEllipsePolygon(polygon: Point2D[]): boolean {
  if (polygon.length < 8) return false;
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const halfW = Math.max((maxX - minX) / 2, 1e-6);
  const halfH = Math.max((maxY - minY) / 2, 1e-6);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radii = polygon.map((point) =>
    Math.hypot((point.x - centerX) / halfW, (point.y - centerY) / halfH)
  );
  const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  const variance = radii.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / radii.length;
  return Math.sqrt(variance) < 0.22;
}

function getPolygonEdgeMeasurementLabels(
  polygon: Point2D[],
  width: number,
  height: number,
  calibration: { metersPerPixel: number; baseWidth: number; baseHeight: number },
  edgeIndexes?: number[]
): Array<{ x: number; y: number; angle: number; label: string }> {
  if (polygon.length < 2) return [];
  const labels: Array<{ x: number; y: number; angle: number; label: string }> = [];
  const indexes = edgeIndexes ?? polygon.map((_point, index) => index);
  const centroid = polygon.reduce(
    (acc, point) => ({ x: acc.x + point.x / polygon.length, y: acc.y + point.y / polygon.length }),
    { x: 0, y: 0 }
  );
  const epsilon = 1e-6;
  for (const index of indexes) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (!start || !end) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const pixelLength = Math.hypot(dx * calibration.baseWidth, dy * calibration.baseHeight);
    const meters = pixelLength * calibration.metersPerPixel;
    if (!Number.isFinite(meters) || meters < 0.05) continue;
    const midX = ((start.x + end.x) / 2) * width;
    const midY = ((start.y + end.y) / 2) * height;
    const toOutsideX = midX - centroid.x * width;
    const toOutsideY = midY - centroid.y * height;
    const outsideLength = Math.hypot(toOutsideX, toOutsideY);
    const offset = 12;
    const rawX = outsideLength > epsilon ? midX + (toOutsideX / outsideLength) * offset : midX;
    const rawY = outsideLength > epsilon ? midY + (toOutsideY / outsideLength) * offset : midY;
    const edgeMargin = 14;
    const x = clamp(rawX, edgeMargin, Math.max(edgeMargin, width - edgeMargin));
    const y = clamp(rawY, edgeMargin, Math.max(edgeMargin, height - edgeMargin));
    let angle = (Math.atan2(dy * height, dx * width) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    labels.push({
      x,
      y,
      angle,
      label: `${meters.toFixed(1)}m`,
    });
  }
  return labels;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingBottom: 120, gap: 10 },
  header: { marginBottom: 4, paddingTop: 4 },
  title: { fontSize: 26, fontWeight: "800" },
  subtitle: { marginTop: 4 },
  guidanceCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  guidanceText: { fontWeight: "600" },
  setupLinkText: { fontWeight: "800", marginTop: 6 },
  sectionCard: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: "700" },
  sectionTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeRow: { gap: 8, paddingVertical: 2, paddingRight: 4 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  typeChipActive: {},
  typeChipText: { fontWeight: "600", textTransform: "capitalize" },
  typeChipTextActive: {},
  shapeChoiceContainer: { gap: 6, marginTop: 8 },
  shapeChoiceLabel: { fontSize: 12, fontWeight: "600" },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  zoomButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  zoomButtonText: { fontSize: 18, fontWeight: "700" },
  zoomText: { minWidth: 52, textAlign: "center", fontWeight: "700" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  switchRowDisabled: { opacity: 0.45 },
  switchLabel: { fontWeight: "700" },
  switchTrack: {
    width: 40,
    height: 22,
    borderRadius: 999,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  switchTrackActive: {},
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  switchThumbActive: { alignSelf: "flex-end" },
  infoText: { fontWeight: "600" },
  rotationRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rotationInput: {
    width: 90,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  canvasOuterScroll: { maxHeight: 330 },
  canvasViewport: { borderRadius: 16, overflow: "hidden", maxHeight: 330 },
  canvasContainer: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
  },
  canvasImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  placeholder: { justifyContent: "center", alignItems: "center" },
  placeholderText: {},
  toolbarRow: { marginTop: 2, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  secondaryButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  secondaryButtonText: { fontWeight: "600" },
  secondaryButtonReady: {},
  secondaryButtonTextReady: { fontWeight: "700" },
  secondaryButtonActive: {},
  secondaryButtonTextActive: {},
  nameInput: {
    marginTop: 2,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  metaRow: { marginTop: 8, gap: 12 },
  choiceRow: { gap: 6 },
  choiceLabel: { fontSize: 12, fontWeight: "600" },
  toggleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  simpleToggleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  simpleToggleLabel: { fontWeight: "600", fontSize: 14 },
  simpleToggleTrack: {
    width: 40,
    height: 22,
    borderRadius: 999,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  simpleToggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  simpleToggleThumbActive: { alignSelf: "flex-end" },
  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  modalCard: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: "800" },
  modalText: { fontSize: 14 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  precisionCard: {
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  precisionTitle: { fontWeight: "800" },
  precisionDualRow: { flexDirection: "row", gap: 8 },
  precisionField: { flex: 1, gap: 4 },
  pickerRow: { gap: 6 },
  pickerTitle: { fontWeight: "700" },
  pickerOptionsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pickerChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  pickerChipActive: {},
  pickerChipText: { textTransform: "capitalize" },
  zoneRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  zoneMeta: { flex: 1 },
  zoneName: { fontWeight: "700", textTransform: "capitalize" },
  zoneSub: { marginTop: 2, textTransform: "capitalize" },
  zoneActions: { flexDirection: "row", gap: 8 },
  editButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  editButtonText: { fontWeight: "700" },
  deleteButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  deleteButtonText: { fontWeight: "700" },
  emptyText: {},
  saveCard: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    gap: 8,
  },
  primarySaveButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primarySaveButtonDisabled: {},
  primarySaveButtonText: {
    fontWeight: "800",
    fontSize: 16,
    textTransform: "capitalize",
  },
  footerCard: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  footerText: { fontWeight: "600", flex: 1, marginRight: 10 },
  handle: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
  },
});



