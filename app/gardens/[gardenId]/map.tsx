import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import Svg, { Circle, Path, Polygon } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/state/queryClient";
import { makeId } from "@/utils/id";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { Drainage, SunExposure, type Point2D } from "@/domain/entities/Bed";
import { GardenFeatureType } from "@/domain/entities/GardenFeature";
import { isPointInsidePolygon, polygonArea } from "@/features/garden-mapping/utils/geometry";
import { PersistentNav } from "@/ui/components/PersistentNav";

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
  bed: { fill: "rgba(53,130,82,0.35)", stroke: "#226744" },
  lawn: { fill: "rgba(104,168,81,0.28)", stroke: "#4B8E35" },
  tree: { fill: "rgba(45,120,73,0.25)", stroke: "#1D6E43" },
  shrub: { fill: "rgba(88,146,93,0.25)", stroke: "#34784B" },
  hedge: { fill: "rgba(54,110,73,0.26)", stroke: "#2C6D49" },
  path: { fill: "rgba(167,139,92,0.28)", stroke: "#8A6A3A" },
  wall: { fill: "rgba(130,130,130,0.28)", stroke: "#666666" },
  fence: { fill: "rgba(170,152,118,0.28)", stroke: "#8A7754" },
  trellis: { fill: "rgba(121,166,127,0.28)", stroke: "#5A8A5B" },
  patio: { fill: "rgba(153,121,95,0.3)", stroke: "#7E5E45" },
  deck: { fill: "rgba(140,103,66,0.3)", stroke: "#704A28" },
};

type ZonePreview = {
  id: string;
  name: string;
  type: GardenFeatureType;
  polygon: Point2D[];
  source: "bed" | "feature";
  sunExposure?: SunExposure;
  drainage?: Drainage;
};
type CanvasMode = "draw" | "pan";

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
  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("draw");
  const [rotationInput, setRotationInput] = useState("0");
  const [applyingRotation, setApplyingRotation] = useState(false);
  const [viewport, setViewport] = useState({ width: 320, height: 220 });
  const [canvas, setCanvas] = useState({ width: BASE_CANVAS_WIDTH, height: BASE_CANVAS_HEIGHT });

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

  useEffect(() => {
    if (editingZoneId) return;
    setName(activeType === GardenFeatureType.BED ? nextBedName(existingZones) : "");
  }, [activeType, existingZones, editingZoneId]);

  const zoomedWidth = Math.max(1, Math.round(viewport.width * zoom));
  const zoomedHeight = Math.max(1, Math.round(viewport.height * zoom));

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
  };

  const undoPoint = () => {
    setDraftPoints((prev) => prev.slice(0, -1));
    setSelectedPointIndex(null);
    if (draftPoints.length <= 3) {
      setIsClosed(false);
    }
  };

  const deleteSelectedPoint = () => {
    if (selectedPointIndex === null) return;
    setDraftPoints((prev) => prev.filter((_point, index) => index !== selectedPointIndex));
    setSelectedPointIndex(null);
    setIsClosed(false);
  };

  const startEditZone = (zone: ZonePreview) => {
    setEditingZoneId(zone.id);
    setActiveType(zone.type);
    setName(zone.name);
    setDraftPoints(zone.polygon.map((p) => ({ ...p })));
    setIsClosed(true);
    setSelectedPointIndex(null);

    if (zone.source === "bed") {
      setSunExposure(zone.sunExposure ?? SunExposure.FULL_SUN);
      setDrainage(zone.drainage ?? Drainage.GOOD);
    }
  };

  const onCanvasPress = (event: GestureResponderEvent) => {
    if (canvasMode !== "draw") return;

    const tapPoint = getNormalizedTapPoint(event, canvas);
    if (!tapPoint) return;
    if (!isPointInsidePolygon(tapPoint, gardenBoundary)) {
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

  const pickPhoto = async () => {
    if (!gardenId) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Enable photo access to map beds on a real garden image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) return;

    const firstAsset = result.assets[0];
    if (!firstAsset?.uri) return;

    await gardenRepository.updatePhoto(gardenId, firstAsset.uri);
    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
  };

  const applyPlannerRotation = async () => {
    if (!gardenId) return;
    const rotationDegrees = Number(rotationInput);
    if (!Number.isFinite(rotationDegrees) || Math.abs(rotationDegrees) < 0.1) {
      Alert.alert("Rotation needed", "Enter a non-zero rotation in degrees.");
      return;
    }

    const garden = gardenQuery.data;
    if (!garden?.photoUri) {
      Alert.alert("No image", "Set a planner image first before rotating.");
      return;
    }

    setApplyingRotation(true);
    try {
      const rotatedImage = await ImageManipulator.manipulateAsync(
        garden.photoUri,
        [{ rotate: rotationDegrees }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );

      const now = new Date().toISOString();
      const boundary = garden.scaleCalibration?.boundaryPolygon;
      if (garden.scaleCalibration && boundary && boundary.length >= 3) {
        await gardenRepository.updateScaleCalibration(gardenId, {
          ...garden.scaleCalibration,
          boundaryPolygon: boundary.map((point) => rotatePoint(point, rotationDegrees)),
        });
      }

      const beds = bedsQuery.data ?? [];
      for (const bed of beds) {
        await bedRepository.update({
          ...bed,
          polygon: bed.polygon.map((point) => rotatePoint(point, rotationDegrees)),
          updatedAt: now,
        });
      }

      const features = featuresQuery.data ?? [];
      for (const feature of features) {
        await featureRepository.update({
          ...feature,
          polygon: feature.polygon.map((point) => rotatePoint(point, rotationDegrees)),
          updatedAt: now,
        });
      }

      setDraftPoints((prev) => prev.map((point) => rotatePoint(point, rotationDegrees)));

      await gardenRepository.updatePhoto(
        gardenId,
        rotatedImage.uri,
        garden.imageSourceType === "satellite" ? "satellite" : "photo"
      );
      await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["garden-features", gardenId] });
      setRotationInput("0");
      Alert.alert("Rotation applied", `Rotated by ${rotationDegrees.toFixed(1)} degrees.`);
    } catch (error) {
      Alert.alert("Rotation failed", error instanceof Error ? error.message : "Could not rotate planner image.");
    } finally {
      setApplyingRotation(false);
    }
  };

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
        if (editingZoneId) {
          await bedRepository.update({
            id: editingZoneId,
            gardenId,
            name: trimmedName,
            polygon: draftPoints,
            sunExposure,
            drainage,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          await bedRepository.create({
            id: makeId("bed"),
            gardenId,
            name: trimmedName,
            polygon: draftPoints,
            sunExposure,
            drainage,
            createdAt: now,
            updatedAt: now,
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
  const calibration = gardenQuery.data?.scaleCalibration;
  const gardenBoundary = getBoundaryOrDefault(calibration?.boundaryPolygon);
  const areaSqM = calibration
    ? normalizedAreaToSqM(area, calibration.metersPerPixel, calibration.baseWidth, calibration.baseHeight)
    : null;
  const saveDisabled = draftPoints.length < 3 || !name.trim();

  const guidanceText = (() => {
    if (editingZoneId) return "Editing mode: drag points, update details, then tap Update.";
    if (draftPoints.length === 0) return "Tap canvas to start a new area. Tap an existing area to edit.";
    if (!isClosed) return "Keep adding points. Tap near the first point or tap Finish Shape.";
    return "Shape ready. Add details and tap Save.";
  })();

  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} scrollEnabled={canvasMode === "draw"}>
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
                    setName(type === GardenFeatureType.BED ? nextBedName(existingZones) : "");
                  }}
                  style={[styles.typeChip, selected && styles.typeChipActive]}
                >
                  <Text style={[styles.typeChipText, selected && styles.typeChipTextActive]}>{type}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>2. Draw On Photo</Text>
            <View style={styles.zoomRow}>
              <Pressable style={styles.zoomButton} onPress={() => setZoom((z) => clamp(z - 0.25, 1, 10))}>
                <Text style={styles.zoomButtonText}>-</Text>
              </Pressable>
              <Text style={styles.zoomText}>{Math.round(zoom * 100)}%</Text>
              <Pressable style={styles.zoomButton} onPress={() => setZoom((z) => clamp(z + 0.25, 1, 10))}>
                <Text style={styles.zoomButtonText}>+</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, canvasMode === "pan" && styles.secondaryButtonActive]}
                onPress={() => setCanvasMode((mode) => (mode === "draw" ? "pan" : "draw"))}
              >
                <Text style={[styles.secondaryButtonText, canvasMode === "pan" && styles.secondaryButtonTextActive]}>
                  {canvasMode === "draw" ? "Pan Canvas" : "Draw"}
                </Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.infoText}>
            Mode: {canvasMode === "draw" ? "Draw/edit points and scroll page." : "Pan/zoom canvas without point edits."}
          </Text>
          <Text style={styles.infoText}>Rotate image + zones together if map snapshot orientation is off.</Text>
          <View style={styles.rotationRow}>
            <TextInput
              value={rotationInput}
              onChangeText={setRotationInput}
              keyboardType="decimal-pad"
              style={styles.rotationInput}
              placeholder="Degrees"
            />
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                const current = Number(rotationInput);
                const next = Number.isFinite(current) ? current - 5 : -5;
                setRotationInput(next.toString());
              }}
            >
              <Text style={styles.secondaryButtonText}>-5deg</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                const current = Number(rotationInput);
                const next = Number.isFinite(current) ? current + 5 : 5;
                setRotationInput(next.toString());
              }}
            >
              <Text style={styles.secondaryButtonText}>+5deg</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => void applyPlannerRotation()} disabled={applyingRotation}>
              {applyingRotation ? <ActivityIndicator size="small" color="#1F3F2B" /> : <Text style={styles.secondaryButtonText}>Apply</Text>}
            </Pressable>
          </View>

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
                  style={[styles.canvasContainer, { width: zoomedWidth, height: zoomedHeight }]}
                  onLayout={onCanvasLayout}
                >
                {gardenQuery.data?.photoUri ? (
                  <Image source={{ uri: gardenQuery.data.photoUri }} style={styles.canvasImage} resizeMode="contain" />
                ) : (
                  <View style={[styles.canvasImage, styles.placeholder]}>
                    <Text style={styles.placeholderText}>No image yet. Using configured garden outline.</Text>
                  </View>
                )}

                <Pressable style={StyleSheet.absoluteFill} onPress={onCanvasPress} disabled={canvasMode === "pan"}>
                  <Svg width="100%" height="100%">
                    {!isBoundaryRect(gardenBoundary) && (
                      <Path
                        d={`${rectPath(canvas.width, canvas.height)} ${polygonPath(gardenBoundary, canvas.width, canvas.height)}`}
                        fill="rgba(255,255,255,0.45)"
                        fillRule="evenodd"
                      />
                    )}
                    <Polygon
                      points={toSvgPoints(gardenBoundary, canvas)}
                      fill={gardenQuery.data?.photoUri ? "transparent" : "rgba(39,98,66,0.12)"}
                      stroke="#2D6A49"
                      strokeWidth={3}
                    />
                    {existingZones.map((zone) => {
                      const points = toSvgPoints(zone.polygon, canvas);
                      const color = typeColors[zone.type];
                      const isEditingThis = editingZoneId === zone.id;

                      return (
                        <Polygon
                          key={zone.id}
                          points={points}
                          fill={color.fill}
                          stroke={isEditingThis ? "#E85D2A" : color.stroke}
                          strokeWidth={isEditingThis ? 4 : 2}
                        />
                      );
                    })}

                    {draftPoints.length >= 2 && (
                      <Polygon
                        points={toSvgPoints(draftPoints, canvas)}
                        fill={isClosed ? typeColors[activeType].fill : "rgba(0,0,0,0.06)"}
                        stroke={typeColors[activeType].stroke}
                        strokeWidth={3}
                        {...(!isClosed ? { strokeDasharray: [10, 5] } : {})}
                      />
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

                  {canvasMode === "draw" &&
                    draftPoints.filter(isFinitePoint).map((point, index) => (
                    <VertexHandle
                      key={`handle-${index.toString()}`}
                      point={point}
                      width={canvas.width}
                      height={canvas.height}
                      onSelect={() => setSelectedPointIndex(index)}
                      onDrag={(nextPoint) => {
                        if (!isPointInsidePolygon(nextPoint, gardenBoundary)) {
                          return;
                        }
                        setDraftPoints((prev) => prev.map((p, i) => (i === index ? nextPoint : p)));
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
          <Text style={styles.sectionTitle}>3. Editing Tools</Text>
          <View style={styles.toolbarRow}>
            <Pressable style={styles.secondaryButton} onPress={pickPhoto}>
              <Text style={styles.secondaryButtonText}>Photo</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={undoPoint}>
              <Text style={styles.secondaryButtonText}>Undo</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={deleteSelectedPoint}>
              <Text style={styles.secondaryButtonText}>Delete Point</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={closePolygon}>
              <Text style={styles.secondaryButtonText}>Finish Shape</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={resetDraft}>
              <Text style={styles.secondaryButtonText}>{editingZoneId ? "Cancel Edit" : "Reset"}</Text>
            </Pressable>
          </View>
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
            </View>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>5. Saved Areas</Text>
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
          <Pressable style={[styles.saveButton, saveDisabled && styles.saveButtonDisabled]} onPress={saveZone} disabled={saveDisabled}>
            <Text style={styles.saveButtonText}>{editingZoneId ? `Update ${activeType}` : `Save ${activeType}`}</Text>
          </Pressable>
        </View>
        </ScrollView>
      </SafeAreaView>
      <PersistentNav />
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

function rotatePoint(point: Point2D, degrees: number): Point2D {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - 0.5;
  const dy = point.y - 0.5;

  return {
    x: clamp(0.5 + dx * cos - dy * sin, 0, 1),
    y: clamp(0.5 + dx * sin + dy * cos, 0, 1),
  };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function nextBedName(zones: ZonePreview[]): string {
  const maxNumber = zones.reduce((max, zone) => {
    if (zone.type !== GardenFeatureType.BED) return max;
    const match = /^bed\s+(\d+)$/i.exec(zone.name.trim());
    if (!match) return max;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  return `Bed ${maxNumber + 1}`;
}

function normalizedAreaToSqM(
  normalizedArea: number,
  metersPerPixel: number,
  baseWidth: number,
  baseHeight: number
): number {
  return normalizedArea * baseWidth * baseHeight * metersPerPixel * metersPerPixel;
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
  saveButton: { backgroundColor: "#2F6F4F", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  saveButtonDisabled: { backgroundColor: "#9AB8A4" },
  saveButtonText: { color: "#FFFFFF", fontWeight: "700", textTransform: "capitalize" },
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
