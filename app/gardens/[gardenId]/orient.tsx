import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as ImageManipulator from "expo-image-manipulator";
import {
  Alert,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Svg, { Path, Polygon } from "react-native-svg";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { queryClient } from "@/state/queryClient";
import { polygonArea } from "@/features/garden-mapping/utils/geometry";
import type { Point2D } from "@/domain/entities/Bed";
import { useTheme } from "@/ui/theme/ThemeProvider";

const DEFAULT_BOUNDARY = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const gardenRepository = new SqliteGardenRepository();
const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();

export default function GardenOrientationScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;
  const [canvas, setCanvas] = useState({ width: 320, height: 220 });

  useEffect(() => {
    if (!gardenId) return;
    router.replace(`/gardens/${gardenId}/map`);
  }, [gardenId]);

  const gardenQuery = useQuery({
    queryKey: ["garden", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing garden id");
      return gardenRepository.getById(gardenId);
    },
  });

  const calibration = gardenQuery.data?.scaleCalibration;
  const boundary = calibration?.boundaryPolygon && calibration.boundaryPolygon.length >= 3
    ? calibration.boundaryPolygon
    : DEFAULT_BOUNDARY;

  const suggestedRotation = useMemo(() => suggestOrientationDegrees(boundary), [boundary]);
  const [rotationDegrees, setRotationDegrees] = useState(suggestedRotation);
  const [keepImage, setKeepImage] = useState(calibration?.showBaseImage !== false);
  const gestureStartRef = useRef<{ angle: number; distance: number; rotation: number } | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!calibration || hydratedRef.current) return;
    setRotationDegrees(calibration.orientationDegrees ?? suggestedRotation);
    setKeepImage(calibration.showBaseImage !== false);
    hydratedRef.current = true;
  }, [calibration, suggestedRotation]);

  const transform = useMemo(
    () => buildFitTransform(boundary, rotationDegrees, canvas.width, canvas.height, 14),
    [boundary, rotationDegrees, canvas.height, canvas.width]
  );

  const transformedLayerStyle = useMemo(
    () => ({
      transform: [
        { rotate: `${rotationDegrees}deg` },
        { scale: transform.scale },
        { translateX: transform.translateX },
        { translateY: transform.translateY },
      ],
    }),
    [rotationDegrees, transform.scale, transform.translateX, transform.translateY]
  );

  const gestureResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
        onPanResponderGrant: (event) => {
          const metrics = getGestureMetrics(event.nativeEvent.touches);
          if (!metrics) {
            gestureStartRef.current = null;
            return;
          }
          gestureStartRef.current = {
            angle: metrics.angle,
            distance: metrics.distance,
            rotation: rotationDegrees,
          };
        },
        onPanResponderMove: (event) => {
          const start = gestureStartRef.current;
          if (!start) return;
          const metrics = getGestureMetrics(event.nativeEvent.touches);
          if (!metrics) return;

          const angleDelta = metrics.angle - start.angle;
          const pinchDelta = (metrics.distance - start.distance) * 0.12;
          const next = normalizeDegrees(start.rotation + angleDelta + pinchDelta);
          setRotationDegrees(next);
        },
      }),
    [rotationDegrees]
  );

  const onPreviewLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setCanvas({ width, height });
    }
  };

  const saveAndContinue = async () => {
    if (!gardenId || !calibration) {
      Alert.alert("Setup missing", "Save map/image setup first.");
      return;
    }

    const shouldRotate = Number.isFinite(rotationDegrees) && Math.abs(rotationDegrees) >= 0.1;
    const baseBoundary =
      calibration.boundaryPolygon && calibration.boundaryPolygon.length >= 3
        ? calibration.boundaryPolygon
        : DEFAULT_BOUNDARY;

    const rotatedBoundary = shouldRotate
      ? baseBoundary.map((point) => rotatePoint(point, rotationDegrees))
      : [...baseBoundary];

    let finalPhotoUri = gardenQuery.data?.photoUri ?? null;
    let remapPoint: ((point: Point2D) => Point2D) | null = null;
    let remappedBoundary = rotatedBoundary;

    if (gardenQuery.data?.photoUri && shouldRotate) {
      const rotatedImage = await ImageManipulator.manipulateAsync(
        gardenQuery.data.photoUri,
        [{ rotate: rotationDegrees }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      const cropResult = await cropImageToBoundary(rotatedImage.uri, rotatedBoundary);
      finalPhotoUri = cropResult.uri;
      remappedBoundary = cropResult.remappedBoundary;
      remapPoint = cropResult.remapPoint;
    } else if (shouldRotate) {
      const remap = buildRemapFromBounds(rotatedBoundary);
      remappedBoundary = rotatedBoundary.map(remap);
      remapPoint = remap;
    }

    const oldBoundaryArea = polygonArea(baseBoundary);
    const newBoundaryArea = polygonArea(remappedBoundary);
    const nextCalibration: typeof calibration = {
      ...calibration,
      boundaryPolygon: remappedBoundary,
      orientationDegrees: 0,
      showBaseImage: keepImage,
    };
    if (calibration.boundaryAreaSqM !== undefined) {
      nextCalibration.boundaryAreaSqM = calibration.boundaryAreaSqM;
    }
    if (oldBoundaryArea > 0 && newBoundaryArea > 0) {
      nextCalibration.metersPerPixel =
        calibration.metersPerPixel * Math.sqrt(oldBoundaryArea / newBoundaryArea);
    }

    await gardenRepository.updateScaleCalibration(gardenId, nextCalibration);
    if (finalPhotoUri && finalPhotoUri !== gardenQuery.data?.photoUri) {
      await gardenRepository.updatePhoto(
        gardenId,
        finalPhotoUri,
        gardenQuery.data?.imageSourceType === "satellite" ? "satellite" : "photo"
      );
    }

    if (shouldRotate) {
      const now = new Date().toISOString();
      const mapPoint = remapPoint ?? ((point: Point2D) => point);

      const beds = await bedRepository.listByGarden(gardenId);
      for (const bed of beds) {
        const rotatedPolygon = bed.polygon.map((point) => rotatePoint(point, rotationDegrees)).map(mapPoint);
        await bedRepository.update({ ...bed, polygon: rotatedPolygon, updatedAt: now });
      }

      const features = await featureRepository.listByGarden(gardenId);
      for (const feature of features) {
        const rotatedPolygon = feature.polygon
          .map((point) => rotatePoint(point, rotationDegrees))
          .map(mapPoint);
        await featureRepository.update({ ...feature, polygon: rotatedPolygon, updatedAt: now });
      }
    }

    await queryClient.invalidateQueries({ queryKey: ["garden", gardenId] });
    await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
    await queryClient.invalidateQueries({ queryKey: ["garden-features", gardenId] });
    router.replace(`/gardens/${gardenId}/map`);
  };

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.appBackground }]} edges={["left", "right"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Opening Garden Design...</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>Orientation step has been folded into the design flow.</Text>

          <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Preview</Text>
            <View style={styles.preview} onLayout={onPreviewLayout} {...gestureResponder.panHandlers}>
              <View style={[StyleSheet.absoluteFillObject, styles.placeholder]} />
              <View style={[StyleSheet.absoluteFillObject, transformedLayerStyle]}>
                {keepImage && gardenQuery.data?.photoUri && (
                  <Image
                    source={{ uri: gardenQuery.data.photoUri }}
                    style={StyleSheet.absoluteFillObject}
                    resizeMode="stretch"
                  />
                )}
                <Svg width="100%" height="100%">
                  <Path
                    d={`${rectPath(canvas.width, canvas.height)} ${polygonPath(boundary, canvas.width, canvas.height)}`}
                    fill={theme.mapBoundaryFill}
                    fillRule="evenodd"
                  />
                  <Polygon
                    points={toSvgPoints(boundary, canvas.width, canvas.height)}
                    fill="transparent"
                    stroke={theme.mapBoundaryStroke}
                    strokeWidth={3}
                  />
                </Svg>
              </View>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Orientation</Text>
            <View style={styles.row}>
              <Pressable style={[styles.button, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={() => setRotationDegrees(suggestedRotation)}>
                <Text style={[styles.buttonText, { color: theme.secondaryActionText }]}>Auto Orient</Text>
              </Pressable>
            </View>
            <Text style={[styles.infoText, { color: theme.infoText }]}>
              Use two fingers on preview to rotate/pinch and fine-tune.
            </Text>
            <Text style={[styles.infoText, { color: theme.infoText }]}>Current rotation: {rotationDegrees.toFixed(1)}deg</Text>
            <Text style={[styles.infoText, { color: theme.infoText }]}>Suggested: {suggestedRotation.toFixed(1)}deg</Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Base Image</Text>
            <Text style={[styles.cardText, { color: theme.textMuted }]}>Keep the map image as drawing reference, or remove it for a clean plan.</Text>
            <View style={styles.row}>
              <Pressable
                style={[
                  styles.chip,
                  {
                    backgroundColor: keepImage ? theme.choiceControlActiveBackground : theme.choiceControlBackground,
                    borderColor: keepImage ? theme.filterControlActiveBorder : theme.filterControlBorder,
                  },
                ]}
                onPress={() => setKeepImage(true)}
              >
                <Text style={[styles.chipText, { color: keepImage ? theme.choiceControlActiveText : theme.choiceControlText }]}>Keep Image</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.chip,
                  {
                    backgroundColor: !keepImage ? theme.choiceControlActiveBackground : theme.choiceControlBackground,
                    borderColor: !keepImage ? theme.filterControlActiveBorder : theme.filterControlBorder,
                  },
                ]}
                onPress={() => setKeepImage(false)}
              >
                <Text style={[styles.chipText, { color: !keepImage ? theme.choiceControlActiveText : theme.choiceControlText }]}>Remove Image</Text>
              </Pressable>
            </View>
          </View>

          <Pressable style={[styles.saveButton, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor }]} onPress={() => void saveAndContinue()}>
            <Text style={[styles.saveButtonText, { color: theme.primaryActionText }]}>Save Orientation + Continue</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function suggestOrientationDegrees(points: { x: number; y: number }[]): number {
  if (points.length < 3) return 0;
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const angleDeg = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI;
  const candidateA = normalizeDegrees(90 - angleDeg);
  const candidateB = normalizeDegrees(candidateA + 180);
  const scoreA = topHeaviness(points, candidateA);
  const scoreB = topHeaviness(points, candidateB);
  return scoreA >= scoreB ? candidateA : candidateB;
}

function topHeaviness(points: { x: number; y: number }[], degrees: number): number {
  const rotated = points.map((p) => rotatePoint(p, degrees));
  return rotated.reduce((sum, p) => sum + (1 - p.y), 0);
}

function normalizeDegrees(value: number): number {
  let deg = value;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function rotatePoint(point: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - 0.5;
  const dy = point.y - 0.5;
  return {
    x: 0.5 + dx * cos - dy * sin,
    y: 0.5 + dx * sin + dy * cos,
  };
}

function buildFitTransform(
  points: { x: number; y: number }[],
  degrees: number,
  width: number,
  height: number,
  paddingPx: number
): { scale: number; translateX: number; translateY: number } {
  if (points.length < 3 || width <= 0 || height <= 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const cx = width / 2;
  const cy = height / 2;
  const rotatedPx = points.map((p) => {
    const px = p.x * width;
    const py = p.y * height;
    return rotatePixel(px, py, cx, cy, degrees);
  });

  const minX = Math.min(...rotatedPx.map((p) => p.x));
  const maxX = Math.max(...rotatedPx.map((p) => p.x));
  const minY = Math.min(...rotatedPx.map((p) => p.y));
  const maxY = Math.max(...rotatedPx.map((p) => p.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const fitScale = Math.min((width - paddingPx * 2) / spanX, (height - paddingPx * 2) / spanY);
  const scaledMinX = cx + (minX - cx) * fitScale;
  const scaledMaxX = cx + (maxX - cx) * fitScale;
  const scaledMinY = cy + (minY - cy) * fitScale;
  const scaledMaxY = cy + (maxY - cy) * fitScale;

  return {
    scale: fitScale,
    translateX: cx - (scaledMinX + scaledMaxX) / 2,
    translateY: cy - (scaledMinY + scaledMaxY) / 2,
  };
}

function rotatePixel(
  x: number,
  y: number,
  cx: number,
  cy: number,
  degrees: number
): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

function toSvgPoints(points: { x: number; y: number }[], width: number, height: number): string {
  return points.map((p) => `${p.x * width},${p.y * height}`).join(" ");
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

function buildRemapFromBounds(boundary: Point2D[]): (point: Point2D) => Point2D {
  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  return (point: Point2D) => ({
    x: clamp((point.x - minX) / spanX, 0, 1),
    y: clamp((point.y - minY) / spanY, 0, 1),
  });
}

async function cropImageToBoundary(
  uri: string,
  boundary: Point2D[]
): Promise<{ uri: string; remappedBoundary: Point2D[]; remapPoint: (point: Point2D) => Point2D }> {
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
    { compress: 1, format: ImageManipulator.SaveFormat.PNG }
  );

  const remapPoint = (point: Point2D): Point2D => ({
    x: clamp((point.x - minX) / Math.max(maxX - minX, 1e-6), 0, 1),
    y: clamp((point.y - minY) / Math.max(maxY - minY, 1e-6), 0, 1),
  });

  return {
    uri: result.uri,
    remappedBoundary: boundary.map(remapPoint),
    remapPoint,
  };
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

function getGestureMetrics(
  touches: readonly { pageX: number; pageY: number }[]
): { angle: number; distance: number } | null {
  if (touches.length < 2) return null;
  const a = touches[0];
  const b = touches[1];
  if (!a || !b) return null;
  const dx = b.pageX - a.pageX;
  const dy = b.pageY - a.pageY;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { angle, distance };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#EFF6EC" },
  safeArea: { flex: 1, backgroundColor: "#EFF6EC" },
  content: { padding: 14, gap: 10, paddingBottom: 120 },
  title: { fontSize: 28, fontWeight: "800", color: "#1B3D2A" },
  subtitle: { color: "#4E6759" },
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
  preview: { height: 340, borderRadius: 12, overflow: "hidden", backgroundColor: "#E7EFE5" },
  placeholder: { backgroundColor: "#E7EFE5" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  button: { backgroundColor: "#E9F1E6", borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  buttonText: { color: "#2D4B3C", fontWeight: "700", fontSize: 12 },
  chip: { backgroundColor: "#D8E4D8", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: "#2F6F4F" },
  chipText: { color: "#2F4A3A", fontWeight: "700" },
  chipTextActive: { color: "#FFFFFF" },
  infoText: { color: "#587063", fontWeight: "600" },
  saveButton: { backgroundColor: "#245A3E", borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  saveButtonText: { color: "#FFFFFF", fontWeight: "800", textAlign: "center" },
});

