import { Link, useLocalSearchParams } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  PanResponder,
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
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/state/queryClient";
import { makeId } from "@/utils/id";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { Drainage, SunExposure, type Point2D } from "@/domain/entities/Bed";
import { GardenFeatureType } from "@/domain/entities/GardenFeature";
import { clipLineToPolygon, isPointInsidePolygon, polygonArea } from "@/features/garden-mapping/utils/geometry";

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

const typeColors: Record<GardenFeatureType, { fill: string; stroke: string }> = {
  bed: { fill: "rgba(53,130,82,0.3)", stroke: "#101010" },
  lawn: { fill: "rgba(111,171,95,0.22)", stroke: "#101010" },
  tree: { fill: "rgba(33,108,60,0.3)", stroke: "#1A5C35" },
  shrub: { fill: "rgba(96,168,95,0.28)", stroke: "#3B7F45" },
  hedge: { fill: "rgba(63,130,73,0.26)", stroke: "#2D7A40" },
  path: { fill: "rgba(154,154,154,0.28)", stroke: "#7A7A7A" },
  wall: { fill: "rgba(118,118,118,0.35)", stroke: "#4D4D4D" },
  fence: { fill: "rgba(145,106,74,0.3)", stroke: "#7F5738" },
  trellis: { fill: "rgba(187,171,76,0.3)", stroke: "#9F8D2E" },
  patio: { fill: "rgba(148,148,148,0.32)", stroke: "#6A6A6A" },
  deck: { fill: "rgba(147,103,62,0.32)", stroke: "#7A4E2B" },
};

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
type CanvasMode = "draw" | "pan";
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
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;

  const [activeType, setActiveType] = useState<GardenFeatureType>(GardenFeatureType.BED);
  const [name, setName] = useState("Bed 1");
  const [sunExposure, setSunExposure] = useState<SunExposure>(SunExposure.FULL_SUN);
  const [drainage, setDrainage] = useState<Drainage>(Drainage.GOOD);
  const [containsPerennials, setContainsPerennials] = useState(false);
  const [perennialPlantsCsv, setPerennialPlantsCsv] = useState("");
  const [isRaisedBed, setIsRaisedBed] = useState(false);
  const [hasIrrigation, setHasIrrigation] = useState(false);
  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [isEditingCanvas, setIsEditingCanvas] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("draw");
  const [shapeDraftMode, setShapeDraftMode] = useState<ShapeDraftMode>("points");
  const [presetShape, setPresetShape] = useState<PresetShapeDraft | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [viewRotationDeg, setViewRotationDeg] = useState(0);
  const [showImageLayer, setShowImageLayer] = useState(true);
  const [showGridLayer, setShowGridLayer] = useState(false);
  const [viewport, setViewport] = useState({ width: 320, height: 220 });
  const [canvas, setCanvas] = useState({ width: BASE_CANVAS_WIDTH, height: BASE_CANVAS_HEIGHT });
  const gestureStartRef = useRef<{ distance: number; angle: number; zoom: number; rotation: number } | null>(null);
  const [didNormalizeLegacyCalibration, setDidNormalizeLegacyCalibration] = useState(false);

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
  const gardenBoundary = getBoundaryOrDefault(calibration?.boundaryPolygon);
  const boundaryXs = gardenBoundary.map((p) => p.x);
  const boundaryYs = gardenBoundary.map((p) => p.y);
  const boundaryMinX = boundaryXs.length > 0 ? Math.min(...boundaryXs) : 0;
  const boundaryMaxX = boundaryXs.length > 0 ? Math.max(...boundaryXs) : 1;
  const boundaryMinY = boundaryYs.length > 0 ? Math.min(...boundaryYs) : 0;
  const boundaryMaxY = boundaryYs.length > 0 ? Math.max(...boundaryYs) : 1;
  const gridStepX = calibration ? 1 / Math.max(calibration.metersPerPixel * calibration.baseWidth, 1e-6) : 0;
  const gridStepY = calibration ? 1 / Math.max(calibration.metersPerPixel * calibration.baseHeight, 1e-6) : 0;
  const shapeOptions = getShapeOptionsForType(activeType);
  const defaultShapeMode = shapeOptions[0]?.mode ?? "points";

  useEffect(() => {
    if (editingZoneId) return;
    setName(nextZoneName(activeType, existingZones));
  }, [activeType, existingZones, editingZoneId]);

  useEffect(() => {
    if (editingZoneId) return;
    if (activeType !== GardenFeatureType.BED) return;
    setContainsPerennials(false);
    setPerennialPlantsCsv("");
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
  }, [
    gardenId,
    gardenQuery.isFetched,
    calibration?.showBaseImage,
    calibration?.showGridOverlay,
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
      setPerennialPlantsCsv(zone.perennialPlantsCsv ?? "");
      setIsRaisedBed(zone.isRaisedBed ?? false);
      setHasIrrigation(zone.hasIrrigation ?? false);
    } else {
      setContainsPerennials(false);
      setPerennialPlantsCsv("");
      setIsRaisedBed(false);
      setHasIrrigation(false);
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
    setPresetShape(candidate);
    setDraftPoints(points);
    setSelectedPointIndex(null);
    setIsClosed(true);
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
    if (!isEditingCanvas || canvasMode !== "draw") return;

    const tapPointRaw = getNormalizedTapPoint(event, canvas);
    if (!tapPointRaw) return;
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
    Alert.alert("Delete area", `Delete ${zone.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void deleteZone(zone) },
    ]);
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
        const perennialCsv = perennialPlantsCsv.trim();
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
          ...(containsPerennials && perennialCsv ? { perennialPlantsCsv: perennialCsv } : {}),
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

  const persistCanvasViewSettings = async (nextShowImage: boolean, nextShowGrid: boolean) => {
    if (!gardenId || !calibration) return;
    const nextCalibration: typeof calibration = {
      ...calibration,
      showBaseImage: nextShowImage,
      showGridOverlay: nextShowGrid,
    };
    await gardenRepository.updateScaleCalibration(gardenId, nextCalibration);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    await queryClient.invalidateQueries({ queryKey: ["gardens"] });
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
    <View style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
        <ScrollView contentContainerStyle={styles.scrollContent} scrollEnabled={!isEditingCanvas || canvasMode === "draw"}>
        <View style={styles.header}>
          <Text style={styles.title}>Garden Mapper</Text>
          <Text style={styles.subtitle}>Map beds and spaces quickly with tap-to-draw and tap-to-edit.</Text>
        </View>

        <View style={styles.guidanceCard}>
          <Text style={styles.guidanceText}>{guidanceText}</Text>
          {!calibration && gardenId && (
            <Link href={`/gardens/${gardenId}/setup`} style={styles.setupLinkText}>
              Set scale in Setup to enable sqm estimates
            </Link>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>1. Select Area Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow}>
            {featureTypes.map((type) => {
              const selected = type === activeType;
              return (
                <Pressable
                  key={type}
                  onPress={() => {
                    if (editingZoneId) {
                      Alert.alert("Finish editing first", "Tap Cancel Edit before switching area type.");
                      return;
                    }
                    setActiveType(type);
                    const nextOptions = getShapeOptionsForType(type);
                    setShapeDraftMode(nextOptions[0]?.mode ?? "points");
                    setPresetShape(null);
                    setName(nextZoneName(type, existingZones));
                  }}
                  style={[styles.typeChip, selected && styles.typeChipActive]}
                >
                  <Text style={[styles.typeChipText, selected && styles.typeChipTextActive]}>{type}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.toolbarRow}>
            {shapeOptions.map((option) => (
              <Pressable
                key={option.mode}
                style={[styles.secondaryButton, shapeDraftMode === option.mode && styles.secondaryButtonActive]}
                onPress={() => setShapeDraftMode(option.mode)}
              >
                <Text style={[styles.secondaryButtonText, shapeDraftMode === option.mode && styles.secondaryButtonTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>2. Planner Canvas</Text>
            <View style={styles.zoomRow}>
              <Pressable style={styles.zoomButton} onPress={() => setZoom((z) => clamp(z - 0.25, 0.2, 15))}>
                <Text style={styles.zoomButtonText}>-</Text>
              </Pressable>
              <Text style={styles.zoomText}>{Math.round(zoom * 100)}%</Text>
              <Pressable style={styles.zoomButton} onPress={() => setZoom((z) => clamp(z + 0.25, 0.2, 15))}>
                <Text style={styles.zoomButtonText}>+</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.toolbarRow}>
            <ToggleSwitch
              label="Image"
              value={showImageLayer}
              onToggle={(next) => {
                setShowImageLayer(next);
                void persistCanvasViewSettings(next, showGridLayer);
              }}
            />
            <ToggleSwitch
              label="Grid"
              value={showGridLayer}
              disabled={!calibration}
              onToggle={(next) => {
                setShowGridLayer(next);
                void persistCanvasViewSettings(showImageLayer, next);
              }}
            />
          </View>
          <View style={styles.toolbarRow}>
            <Pressable
              style={[styles.secondaryButton, canvasMode === "draw" && styles.secondaryButtonActive]}
              onPress={() => setCanvasMode("draw")}
            >
              <Text style={[styles.secondaryButtonText, canvasMode === "draw" && styles.secondaryButtonTextActive]}>Draw</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, canvasMode === "pan" && styles.secondaryButtonActive]}
              onPress={() => {
                setCanvasMode("pan");
                setSelectedPointIndex(null);
              }}
            >
              <Text style={[styles.secondaryButtonText, canvasMode === "pan" && styles.secondaryButtonTextActive]}>Pan</Text>
            </Pressable>
          </View>
          <Text style={styles.infoText}>
            Mode: {canvasMode === "draw" ? "Draw/edit points." : "Pan/zoom/twist canvas."}
          </Text>
          <Text style={styles.infoText}>View rotation: {viewRotationDeg.toFixed(1)}deg</Text>

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
                  style={[
                    styles.canvasContainer,
                    { width: zoomedWidth, height: zoomedHeight, transform: [{ rotate: `${viewRotationDeg}deg` }] },
                  ]}
                  onLayout={onCanvasLayout}
                  {...(canvasMode === "pan" ? gestureResponder.panHandlers : {})}
                >
                {showBaseImage && gardenQuery.data?.photoUri ? (
                  <Image source={{ uri: gardenQuery.data.photoUri }} style={styles.canvasImage} resizeMode="stretch" />
                ) : (
                  <View style={[styles.canvasImage, styles.placeholder]} />
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
                        stroke="rgba(20,67,46,0.3)"
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
                        stroke="rgba(20,67,46,0.3)"
                        strokeWidth={1}
                      />
                    ))}
                    {!isBoundaryRect(gardenBoundary) && (
                      <Path
                        d={`${rectPath(canvas.width, canvas.height)} ${polygonPath(gardenBoundary, canvas.width, canvas.height)}`}
                        fill="#E7EFE5"
                        fillRule="evenodd"
                      />
                    )}
                    <Polygon
                      points={toSvgPoints(gardenBoundary, canvas)}
                      fill={showBaseImage && gardenQuery.data?.photoUri ? "transparent" : "rgba(39,98,66,0.12)"}
                      stroke="#2D6A49"
                      strokeWidth={showBaseImage && gardenQuery.data?.photoUri ? 3 : 4}
                    />
                    {boundaryMeasurements.map((measurement, index) => (
                      <SvgText
                        key={`boundary-measure-${index.toString()}`}
                        x={measurement.x}
                        y={measurement.y}
                        textAnchor="middle"
                        alignmentBaseline="middle"
                        fontSize={11}
                        fontWeight="700"
                        fill="#173A29"
                        transform={`rotate(${measurement.angle} ${measurement.x} ${measurement.y})`}
                      >
                        {measurement.label}
                      </SvgText>
                    ))}
                    {existingZones.map((zone) => {
                      const points = toSvgPoints(zone.polygon, canvas);
                      const color = typeColors[zone.type];
                      const isEditingThis = editingZoneId === zone.id;
                      const stripeSpec = getStripeSpecForType(zone.type);
                      const hatchLines = stripeSpec
                        ? buildHatchLines(canvas.width, canvas.height, stripeSpec.spacingPx, stripeSpec.angleDeg)
                        : [];
                      const clippedHatchLines = stripeSpec
                        ? clipHatchLinesToPolygon(hatchLines, zone.polygon, canvas.width, canvas.height)
                        : [];
                      const bedLabel = zone.source === "bed"
                        ? getPolygonLabelPlacement(zone.polygon, canvas.width, canvas.height)
                        : null;

                      return (
                        <Fragment key={zone.id}>
                          <Polygon
                            points={points}
                            fill={color.fill}
                            stroke={isEditingThis ? "#E85D2A" : color.stroke}
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
                          {bedLabel && (
                            <SvgText
                              x={bedLabel.x}
                              y={bedLabel.y}
                              textAnchor="middle"
                              alignmentBaseline="middle"
                              fontSize={bedLabel.fontSize}
                              fontWeight="800"
                              fill="#000000"
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
                          fill={isClosed ? typeColors[activeType].fill : "rgba(0,0,0,0.06)"}
                          stroke={typeColors[activeType].stroke}
                          strokeWidth={3}
                          {...(!isClosed ? { strokeDasharray: [10, 5] } : {})}
                        />
                        {isClosed && getStripeSpecForType(activeType) && clipHatchLinesToPolygon(
                          buildHatchLines(
                            canvas.width,
                            canvas.height,
                            getStripeSpecForType(activeType)!.spacingPx,
                            getStripeSpecForType(activeType)!.angleDeg
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
                            stroke={getStripeSpecForType(activeType)!.color}
                            strokeWidth={1}
                            opacity={getStripeSpecForType(activeType)!.opacity}
                          />
                        ))}
                      </>
                    )}

                    {draftPoints.filter(isFinitePoint).map((point, index) => (
                      <Circle
                        key={`draft-${index.toString()}`}
                        cx={point.x * canvas.width}
                        cy={point.y * canvas.height}
                        r={selectedPointIndex === index ? 8 : 6}
                        fill={selectedPointIndex === index ? "#E85D2A" : "#F4F4F4"}
                        stroke="#1F3D2A"
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
                </Pressable>
                </View>
              </ScrollView>
            </ScrollView>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>3. Tools</Text>
          <View style={styles.toolbarRow}>
            <ToggleSwitch
              label="Snap"
              value={snapToGrid}
              disabled={!calibration}
              onToggle={setSnapToGrid}
            />
            <Pressable
              style={[styles.secondaryButton, (canApplyShape || canCloseShape) && styles.secondaryButtonReady]}
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
              <Text style={[styles.secondaryButtonText, (canApplyShape || canCloseShape) && styles.secondaryButtonTextReady]}>
                {shapeActionLabel}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, canUndo && styles.secondaryButtonReady]}
              onPress={handleUndo}
              disabled={!canUndo}
            >
              <Text style={[styles.secondaryButtonText, canUndo && styles.secondaryButtonTextReady]}>Undo</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, canDeletePoint && styles.secondaryButtonReady]}
              onPress={deleteSelectedPoint}
              disabled={!canDeletePoint}
            >
              <Text style={[styles.secondaryButtonText, canDeletePoint && styles.secondaryButtonTextReady]}>Delete Point</Text>
            </Pressable>
            {canCancelEdit && (
              <Pressable style={[styles.secondaryButton, styles.secondaryButtonReady]} onPress={resetDraft}>
                <Text style={[styles.secondaryButtonText, styles.secondaryButtonTextReady]}>Cancel Edit</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.infoText}>Twist and zoom in Pan mode for easier drawing alignment.</Text>
          {showGridLayer && calibration && <Text style={styles.infoText}>Grid spacing: 1 meter.</Text>}
          {presetShape && (
            <Text style={styles.infoText}>
              {presetShape.kind === "line"
                ? "Drag center handle to move and end handle to rotate/lengthen, then tap Apply Shape."
                : "Drag center handle to move, corner handle to resize, then tap Apply Shape."}
            </Text>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>4. Area Details</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={activeType === GardenFeatureType.BED ? "Bed name" : "Area name"}
            style={styles.nameInput}
          />

          {activeType === GardenFeatureType.BED && (
            <View style={styles.metaRow}>
              <PickerRow
                title="Sun"
                options={[SunExposure.FULL_SUN, SunExposure.PART_SUN, SunExposure.SHADE]}
                selected={sunExposure}
                onSelect={(value) => setSunExposure(value as SunExposure)}
              />
              <PickerRow
                title="Drainage"
                options={[Drainage.GOOD, Drainage.MEDIUM, Drainage.POOR]}
                selected={drainage}
                onSelect={(value) => setDrainage(value as Drainage)}
              />
              <PickerRow
                title="Raised Bed"
                options={["yes", "no"]}
                selected={isRaisedBed ? "yes" : "no"}
                onSelect={(value) => setIsRaisedBed(value === "yes")}
              />
              <PickerRow
                title="Irrigation"
                options={["yes", "no"]}
                selected={hasIrrigation ? "yes" : "no"}
                onSelect={(value) => setHasIrrigation(value === "yes")}
              />
              <PickerRow
                title="Contains Perennials"
                options={["yes", "no"]}
                selected={containsPerennials ? "yes" : "no"}
                onSelect={(value) => {
                  const next = value === "yes";
                  setContainsPerennials(next);
                  if (!next) {
                    setPerennialPlantsCsv("");
                  }
                }}
              />
              {containsPerennials && (
                <View style={styles.perennialWrap}>
                  <Text style={styles.infoText}>List perennial plants separated by commas, e.g. lavender, salvia, echinacea.</Text>
                  <TextInput
                    value={perennialPlantsCsv}
                    onChangeText={setPerennialPlantsCsv}
                    placeholder="Perennials in this bed (comma-separated)"
                    style={styles.nameInput}
                    multiline
                  />
                </View>
              )}
            </View>
          )}
        </View>

        <View style={styles.saveCard}>
          <Text style={styles.sectionTitle}>5. Save Current Area</Text>
          <Text style={styles.infoText}>
            {saveDisabled ? "Add at least 3 points and a name to enable save." : "Ready to save."}
          </Text>
          <Pressable style={[styles.primarySaveButton, saveDisabled && styles.primarySaveButtonDisabled]} onPress={saveZone} disabled={saveDisabled}>
            <Text style={styles.primarySaveButtonText}>{editingZoneId ? `Update ${activeType}` : `Save ${activeType}`}</Text>
          </Pressable>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>6. Saved Areas</Text>
          {existingZones.length === 0 && <Text style={styles.emptyText}>No saved areas yet.</Text>}
          {existingZones.map((zone) => (
            <View key={zone.id} style={styles.zoneRow}>
              <View style={styles.zoneMeta}>
                <Text style={styles.zoneName}>{zone.name}</Text>
                <Text style={styles.zoneSub}>
                  {zone.type} · {zone.polygon.length} pts
                  {calibration
                    ? ` · ~${normalizedAreaToSqM(
                        polygonArea(zone.polygon),
                        calibration.metersPerPixel,
                        calibration.baseWidth,
                        calibration.baseHeight
                      ).toFixed(1)} sqm`
                    : ""}
                </Text>
              </View>
              <View style={styles.zoneActions}>
                <Pressable style={styles.editButton} onPress={() => startEditZone(zone)}>
                  <Text style={styles.editButtonText}>Edit</Text>
                </Pressable>
                <Pressable style={styles.deleteButton} onPress={() => confirmDeleteZone(zone)}>
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footerCard}>
          <Text style={styles.footerText}>
            Draft points: {draftPoints.length}
            {" · "}Area ratio: {area.toFixed(3)}
            {areaSqM !== null ? ` · ~${areaSqM.toFixed(1)} sqm` : ""}
            {" · "}Saved zones: {existingZones.length}
          </Text>
        </View>
        </ScrollView>
      </SafeAreaView>
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

function ToggleSwitch(props: {
  label: string;
  value: boolean;
  onToggle: (nextValue: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.switchRow, props.disabled && styles.switchRowDisabled]}
      onPress={() => {
        if (props.disabled) return;
        props.onToggle(!props.value);
      }}
    >
      <Text style={styles.switchLabel}>{props.label}</Text>
      <View style={[styles.switchTrack, props.value && styles.switchTrackActive]}>
        <View style={[styles.switchThumb, props.value && styles.switchThumbActive]} />
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
  return (
    <View style={styles.pickerRow}>
      <Text style={styles.pickerTitle}>{props.title}</Text>
      <View style={styles.pickerOptionsRow}>
        {props.options.map((option) => (
          <Pressable
            key={option}
            onPress={() => props.onSelect(option)}
            style={[styles.pickerChip, props.selected === option && styles.pickerChipActive]}
          >
            <Text style={styles.pickerChipText}>{option.replace("_", " ")}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
        { mode: "points", label: "Points" },
        { mode: "rectangle", label: "Rectangle" },
        { mode: "ellipse", label: "Ellipse" },
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
  type: GardenFeatureType
): { spacingPx: number; angleDeg: number; color: string; opacity: number } | null {
  switch (type) {
    case GardenFeatureType.LAWN:
      return { spacingPx: 22, angleDeg: -22, color: "#4D8A55", opacity: 0.22 };
    case GardenFeatureType.DECK:
      return { spacingPx: 12, angleDeg: -18, color: "#6F4B2F", opacity: 0.24 };
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
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`;
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
      label: meters >= 10 ? `${Math.round(meters)}m` : `${meters.toFixed(1)}m`,
    });
  }
  return labels;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F0F6EE" },
  safeArea: { flex: 1, backgroundColor: "#F0F6EE" },
  scrollContent: { paddingHorizontal: 14, paddingBottom: 120, gap: 10 },
  header: { marginBottom: 4, paddingTop: 4 },
  title: { fontSize: 26, fontWeight: "800", color: "#1E402C" },
  subtitle: { color: "#4E6857", marginTop: 4 },
  guidanceCard: {
    backgroundColor: "#E6F3E8",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C3DCC6",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  guidanceText: { color: "#27513A", fontWeight: "600" },
  setupLinkText: { color: "#1E5D40", fontWeight: "800", marginTop: 6 },
  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#D8E5D5",
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#2C4737" },
  sectionTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeRow: { gap: 8, paddingVertical: 2, paddingRight: 4 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#DFE9DB" },
  typeChipActive: { backgroundColor: "#2F6F4F" },
  typeChipText: { color: "#2C4737", fontWeight: "600", textTransform: "capitalize" },
  typeChipTextActive: { color: "#FFFFFF" },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  zoomButton: { backgroundColor: "#DFEADF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  zoomButtonText: { fontSize: 18, fontWeight: "700", color: "#23412E" },
  zoomText: { minWidth: 52, textAlign: "center", fontWeight: "700", color: "#375947" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#EAF2E7",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  switchRowDisabled: { opacity: 0.45 },
  switchLabel: { color: "#1F3F2B", fontWeight: "700" },
  switchTrack: {
    width: 40,
    height: 22,
    borderRadius: 999,
    backgroundColor: "#BFD1BC",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  switchTrackActive: { backgroundColor: "#2D6A49" },
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    alignSelf: "flex-start",
  },
  switchThumbActive: { alignSelf: "flex-end" },
  infoText: { color: "#587063", fontWeight: "600" },
  rotationRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rotationInput: {
    width: 90,
    borderWidth: 1,
    borderColor: "#BFD1BC",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
  },
  canvasOuterScroll: { maxHeight: 330 },
  canvasViewport: { borderRadius: 16, overflow: "hidden", maxHeight: 330 },
  canvasContainer: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#C5D4C5",
    backgroundColor: "#E5EDE4",
  },
  canvasImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  placeholder: { justifyContent: "center", alignItems: "center", backgroundColor: "#E5EDE4" },
  placeholderText: { color: "#5E7262" },
  toolbarRow: { marginTop: 2, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  secondaryButton: { backgroundColor: "#DFEADF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  secondaryButtonText: { color: "#1F3F2B", fontWeight: "600" },
  secondaryButtonReady: { backgroundColor: "#CDE2D2", borderWidth: 1, borderColor: "#94B9A0" },
  secondaryButtonTextReady: { color: "#1D4A33", fontWeight: "700" },
  secondaryButtonActive: { backgroundColor: "#245A3E" },
  secondaryButtonTextActive: { color: "#FFFFFF" },
  nameInput: {
    marginTop: 2,
    borderWidth: 1,
    borderColor: "#BFD1BC",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
  },
  metaRow: { marginTop: 8, gap: 8 },
  perennialWrap: { gap: 6 },
  pickerRow: { gap: 6 },
  pickerTitle: { fontWeight: "700", color: "#1D3D2A" },
  pickerOptionsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pickerChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99, backgroundColor: "#DCE8DA" },
  pickerChipActive: { backgroundColor: "#A9CFB2" },
  pickerChipText: { textTransform: "capitalize", color: "#274431" },
  zoneRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E8EFE6",
  },
  zoneMeta: { flex: 1 },
  zoneName: { fontWeight: "700", color: "#264534", textTransform: "capitalize" },
  zoneSub: { color: "#557061", marginTop: 2, textTransform: "capitalize" },
  zoneActions: { flexDirection: "row", gap: 8 },
  editButton: { backgroundColor: "#E6F0E4", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  editButtonText: { color: "#275239", fontWeight: "700" },
  deleteButton: { backgroundColor: "#FBE3DE", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  deleteButtonText: { color: "#9A3B2B", fontWeight: "700" },
  emptyText: { color: "#60766A" },
  saveCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    borderWidth: 2,
    borderColor: "#C4D8C8",
    gap: 8,
  },
  primarySaveButton: {
    backgroundColor: "#1E6A42",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primarySaveButtonDisabled: {
    backgroundColor: "#A0B2A4",
  },
  primarySaveButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 16,
    textTransform: "capitalize",
  },
  footerCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#D8E5D5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  footerText: { color: "#4A6253", fontWeight: "600", flex: 1, marginRight: 10 },
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


