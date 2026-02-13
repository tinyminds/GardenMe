import { useMemo, useState, type RefObject } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Polygon } from "react-native-svg";
import type { Bed, Point2D } from "@/domain/entities/Bed";
import { GardenFeatureType, type GardenFeature } from "@/domain/entities/GardenFeature";
import { clipLineToPolygon } from "@/features/garden-mapping/utils/geometry";
import { useTheme } from "@/ui/theme/ThemeProvider";

type BedPreviewInfo = {
  bedName: string;
  lines: string[];
};

type BedStatusCounts = {
  growingCount?: number;
  plannedCount?: number;
  suggestionCount?: number;
};

type BedPlantDots = {
  plantedCount?: number;
  perennialCount?: number;
  plannedCount?: number;
};

export function BedPlanPreview(props: {
  beds: Bed[];
  features?: GardenFeature[];
  boundaryPolygon?: Point2D[];
  previewRatio?: number;
  infoByBedId?: Record<string, BedPreviewInfo>;
  bedStatusById?: Record<string, BedStatusCounts>;
  bedPlantDotsById?: Record<string, BedPlantDots>;
  selectedBedId?: string;
  onBedPress?: (bedId: string) => void;
  title?: string;
  subtitle?: string;
  mapCaptureRef?: RefObject<View | null>;
  onMapLayout?: (size: { width: number; height: number }) => void;
  bedNameScale?: number;
}) {
  const { theme } = useTheme();
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewViewportWidth, setPreviewViewportWidth] = useState(0);
  const [showBedNames, setShowBedNames] = useState(true);

  const boundary = useMemo(() => {
    if (props.boundaryPolygon && props.boundaryPolygon.length >= 3) return props.boundaryPolygon;
    return DEFAULT_BOUNDARY;
  }, [props.boundaryPolygon]);

  const ratio = props.previewRatio && Number.isFinite(props.previewRatio) && props.previewRatio > 0 ? props.previewRatio : 0.66;
  const basePreviewWidth = Math.max(280, Math.round(previewViewportWidth || 320));
  const viewportWidth = basePreviewWidth;
  const viewportHeight = Math.round(basePreviewWidth * ratio);
  const zoomedWidth = Math.max(1, Math.round(viewportWidth * previewZoom));
  const zoomedHeight = Math.max(1, Math.round(viewportHeight * previewZoom));
  const selectedStroke = theme.mapTrellisStroke;
  const selectedFill = withAlpha(selectedStroke, 0.2);
  const bedNameScale = typeof props.bedNameScale === "number" ? Math.max(0.55, Math.min(1.5, props.bedNameScale)) : 1;
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

  const handleBedPress = (bed: Bed) => {
    if (props.onBedPress) {
      props.onBedPress(bed.id);
      return;
    }
    const info = props.infoByBedId?.[bed.id];
    const infoTitle = info?.bedName ?? bed.name;
    const lines = info?.lines?.length ? info.lines : ["No details yet"];
    Alert.alert(infoTitle, lines.join("\n"));
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
      <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{props.title ?? "Garden Layout"}</Text>
      {props.subtitle ? <Text style={[styles.meta, { color: theme.textMuted }]}>{props.subtitle}</Text> : null}
      <View style={styles.rowBetween}>
        <View style={styles.zoomRow}>
          <Pressable
            style={[styles.zoomButton, { backgroundColor: theme.secondaryActionBackground }]}
            onPress={() => setPreviewZoom((value) => Math.max(0.7, Number((value - 0.1).toFixed(2))))}
          >
            <Text style={[styles.zoomButtonText, { color: theme.secondaryActionText }]}>-</Text>
          </Pressable>
          <Text style={[styles.zoomText, { color: theme.textPrimary }]}>{Math.round(previewZoom * 100)}%</Text>
          <Pressable
            style={[styles.zoomButton, { backgroundColor: theme.secondaryActionBackground }]}
            onPress={() => setPreviewZoom((value) => Math.min(4, Number((value + 0.1).toFixed(2))))}
          >
            <Text style={[styles.zoomButtonText, { color: theme.secondaryActionText }]}>+</Text>
          </Pressable>
        </View>
        <Pressable style={styles.bedNamesToggleWrap} onPress={() => setShowBedNames((prev) => !prev)}>
          <Text style={[styles.bedNamesToggleLabel, { color: theme.textPrimary }]}>Bed names</Text>
          <View
            style={[
              styles.bedNamesToggleTrack,
              {
                backgroundColor: showBedNames ? theme.toggleOnBackground : theme.toggleOffBackground,
              },
            ]}
          >
            <View
              style={[
                styles.bedNamesToggleThumb,
                {
                  backgroundColor: theme.toggleThumbColor,
                  marginLeft: showBedNames ? 20 : 2,
                },
              ]}
            />
          </View>
        </Pressable>
      </View>
      <View
        onLayout={(event) => {
          const width = Math.floor(event.nativeEvent.layout.width);
          if (width > 0) setPreviewViewportWidth(width);
        }}
      >
        <View
          ref={props.mapCaptureRef}
          collapsable={false}
          onLayout={(event) => {
            props.onMapLayout?.({
              width: Math.floor(event.nativeEvent.layout.width),
              height: Math.floor(event.nativeEvent.layout.height),
            });
          }}
          style={[
            styles.previewViewport,
            { width: viewportWidth, height: viewportHeight, borderColor: theme.borderColor, backgroundColor: theme.appBackground },
          ]}
        >
          <ScrollView
            showsVerticalScrollIndicator
            style={{ width: viewportWidth, height: viewportHeight }}
            nestedScrollEnabled
          >
            <ScrollView horizontal showsHorizontalScrollIndicator style={{ width: viewportWidth }} nestedScrollEnabled>
            <View
              style={[
                styles.previewCanvas,
                { width: zoomedWidth, height: zoomedHeight, backgroundColor: theme.appBackground },
              ]}
            >
              <Svg width={zoomedWidth} height={zoomedHeight} style={StyleSheet.absoluteFillObject}>
                <Path
                  d={`${rectPath(zoomedWidth, zoomedHeight)} ${polygonPath(boundary, zoomedWidth, zoomedHeight)}`}
                  fill={theme.mapBoundaryFill}
                  fillRule="evenodd"
                />
                <Polygon points={toSvgPoints(boundary, zoomedWidth, zoomedHeight)} fill="transparent" stroke={theme.mapBoundaryStroke} strokeWidth={2} />
                {(props.features ?? []).map((feature) => {
                  const colors = typeColors[feature.type] ?? { fill: theme.mapBedFill, stroke: theme.mapBedStroke };
                  return (
                    <Polygon
                      key={`feature-${feature.id}`}
                      points={toSvgPoints(feature.polygon, zoomedWidth, zoomedHeight)}
                      fill={colors.fill}
                      stroke={colors.stroke}
                      strokeWidth={1.5}
                    />
                  );
                })}
                {(props.features ?? []).flatMap((feature) => {
                  const stripeSpec = getStripeSpecForType(feature.type, theme);
                  if (!stripeSpec) return [];
                  const lines = buildHatchLines(zoomedWidth, zoomedHeight, stripeSpec.spacingPx, stripeSpec.angleDeg);
                  const clipped = clipHatchLinesToPolygon(lines, feature.polygon, zoomedWidth, zoomedHeight);
                  return clipped.map((line, index) => (
                    <Line
                      key={`feature-stripe-${feature.id}-${index.toString()}`}
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      stroke={stripeSpec.color}
                      strokeWidth={1}
                      opacity={stripeSpec.opacity}
                    />
                  ));
                })}
                {props.beds.map((bed) => (
                  <Polygon
                    key={`shape-${bed.id}`}
                    points={toSvgPoints(bed.polygon, zoomedWidth, zoomedHeight)}
                    fill={bed.containsPerennials ? theme.mapPerennialBedFill : theme.mapBedFill}
                    stroke={theme.mapBedStroke}
                    strokeWidth={1.4}
                    onPress={() => handleBedPress(bed)}
                    onPressIn={() => handleBedPress(bed)}
                  />
                ))}
                {props.beds.flatMap((bed) => {
                  const planted = Math.max(0, props.bedPlantDotsById?.[bed.id]?.plantedCount ?? 0);
                  const perennial = Math.min(planted, Math.max(0, props.bedPlantDotsById?.[bed.id]?.perennialCount ?? 0));
                  const planned = Math.max(0, props.bedPlantDotsById?.[bed.id]?.plannedCount ?? 0);
                  const dots = buildPlantDotsForBed({
                    polygon: bed.polygon,
                    width: zoomedWidth,
                    height: zoomedHeight,
                    plantedCount: planted,
                    perennialCount: perennial,
                    plannedCount: planned,
                    annualColor: withAlpha("#16A34A", 0.9), // Strong green for annuals
                    perennialColor: withAlpha("#2563EB", 0.9), // Strong blue for perennials  
                    plannedColor: withAlpha(theme.textMuted, 0.6), // Muted grey for planned
                  });
                  return dots.map((dot, index) => (
                    <Circle key={`plant-dot-${bed.id}-${index.toString()}`} cx={dot.x} cy={dot.y} r={dot.r} fill={dot.color} />
                  ));
                })}
                {props.beds.map((bed) => (
                  props.selectedBedId === bed.id ? (
                    <Polygon
                      key={`selected-${bed.id}`}
                      points={toSvgPoints(bed.polygon, zoomedWidth, zoomedHeight)}
                      fill={selectedFill}
                      stroke={selectedStroke}
                      strokeWidth={3.2}
                      onPress={() => handleBedPress(bed)}
                      onPressIn={() => handleBedPress(bed)}
                    />
                  ) : null
                ))}
                {props.beds.map((bed) => (
                  props.selectedBedId === bed.id ? (
                    <Polygon
                      key={`selected-outline-${bed.id}`}
                      points={toSvgPoints(bed.polygon, zoomedWidth, zoomedHeight)}
                      fill="transparent"
                      stroke={selectedStroke}
                      strokeWidth={5}
                      opacity={0.35}
                      onPress={() => handleBedPress(bed)}
                      onPressIn={() => handleBedPress(bed)}
                    />
                  ) : null
                ))}
                {props.beds.map((bed) => (
                  <Polygon
                    key={`tap-${bed.id}`}
                    points={toSvgPoints(bed.polygon, zoomedWidth, zoomedHeight)}
                    fill="#00000001"
                    stroke="#00000001"
                    strokeWidth={18}
                    onPress={() => handleBedPress(bed)}
                    onPressIn={() => handleBedPress(bed)}
                  />
                ))}
              </Svg>
              {props.beds.map((bed) => {
                const center = polygonCenter(bed.polygon);
                const left = center.x * zoomedWidth;
                const top = center.y * zoomedHeight;
                const openInfo = () => handleBedPress(bed);
                return (
                  <View key={bed.id} pointerEvents="box-none">
                    {showBedNames && (
                      <Pressable
                        style={[
                          styles.bedNameBadge,
                          {
                            left,
                            top,
                            backgroundColor: theme.surfaceBackground,
                            borderColor: props.selectedBedId === bed.id ? selectedStroke : theme.borderColor,
                          },
                        ]}
                        onPress={openInfo}
                      >
                        <Text
                          style={[styles.bedNameText, { color: theme.textPrimary, fontSize: 11 * bedNameScale }]}
                          numberOfLines={1}
                        >
                          {bed.name}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const DEFAULT_BOUNDARY: Point2D[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function polygonCenter(points: Point2D[]): Point2D {
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function toSvgPoints(points: Point2D[], width: number, height: number): string {
  return points.map((point) => `${point.x * width},${point.y * height}`).join(" ");
}

function rectPath(width: number, height: number): string {
  return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
}

function polygonPath(points: Point2D[], width: number, height: number): string {
  if (points.length < 3) return "";
  const first = points[0]!;
  const start = `M ${first.x * width} ${first.y * height}`;
  const lines = points.slice(1).map((point) => `L ${point.x * width} ${point.y * height}`).join(" ");
  return `${start} ${lines} Z`;
}

function withAlpha(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const hex = color.trim().replace(/^#/, "");
  const a = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  
  // Handle 6-digit hex (RGB)
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}${a}`;
  
  // Handle 8-digit hex (RGBA) - replace existing alpha
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(0, 6).toUpperCase()}${a}`;
  
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

function buildPlantDotsForBed(params: {
  polygon: Point2D[];
  width: number;
  height: number;
  plantedCount: number;
  perennialCount: number;
  plannedCount: number;
  annualColor: string;
  perennialColor: string;
  plannedColor: string;
}): Array<{ x: number; y: number; r: number; color: string }> {
  const plantedTarget = Math.max(0, Math.floor(params.plantedCount));
  const plannedTarget = Math.max(0, Math.floor(params.plannedCount));
  const target = plantedTarget + plannedTarget;
  if (target <= 0 || params.polygon.length < 3) return [];
  const pxPolygon = params.polygon.map((point) => ({ x: point.x * params.width, y: point.y * params.height }));
  const bounds = getBounds(pxPolygon);
  const area = polygonAreaPx(pxPolygon);
  if (area <= 0) return [];

  let spacing = clamp(Math.sqrt(area / target) * 0.85, 6, 28);
  const perennialCount = Math.min(plantedTarget, Math.max(0, Math.floor(params.perennialCount)));
  const annualPlantedCount = Math.max(0, plantedTarget - perennialCount);
  
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const dots: Array<{ x: number; y: number; r: number; color: string }> = [];
    const radius = clamp(spacing * 0.22, 1.8, 3.8);
    for (let y = bounds.minY + spacing * 0.5; y <= bounds.maxY - spacing * 0.5; y += spacing) {
      for (let x = bounds.minX + spacing * 0.5; x <= bounds.maxX - spacing * 0.5; x += spacing) {
        if (!isPointInsidePolygonPx({ x, y }, pxPolygon)) continue;
        const index = dots.length;
        const color =
          index < perennialCount
            ? params.perennialColor
            : index < perennialCount + annualPlantedCount
              ? params.annualColor
              : params.plannedColor;
        
        dots.push({
          x,
          y,
          r: radius,
          color,
        });
        if (dots.length >= target) return dots;
      }
    }
    spacing = Math.max(5, spacing * 0.82);
  }
  return [];
}

function getBounds(points: Array<{ x: number; y: number }>): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function getStripeSpecForType(
  type: GardenFeatureType,
  theme: ReturnType<typeof useTheme>["theme"]
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

function polygonAreaPx(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    total += a.x * b.y - b.x * a.y;
  }
  return Math.abs(total) / 2;
}

function isPointInsidePolygonPx(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-7) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}


const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  meta: { fontSize: 13 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  zoomButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  zoomButtonText: { fontSize: 18, fontWeight: "700" },
  zoomText: { minWidth: 52, textAlign: "center", fontWeight: "700" },
  bedNamesToggleWrap: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  bedNamesToggleLabel: { fontWeight: "700", fontSize: 12 },
  bedNamesToggleTrack: { width: 42, height: 24, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 2, justifyContent: "center" },
  bedNamesToggleThumb: { width: 18, height: 18, borderRadius: 999 },
  previewViewport: { borderRadius: 12, overflow: "hidden", borderWidth: 1 },
  previewCanvas: { borderRadius: 12, overflow: "hidden", position: "relative" },
  bedNameBadge: {
    position: "absolute",
    marginLeft: -44,
    marginTop: -11,
    minWidth: 56,
    maxWidth: 120,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignItems: "center",
  },
  bedNameText: { fontSize: 10, fontWeight: "700", flexShrink: 1, textAlign: "center" },
});
