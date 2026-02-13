import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Polygon } from "react-native-svg";
import type { Bed, Point2D } from "@/domain/entities/Bed";
import { useTheme } from "@/ui/theme/ThemeProvider";

type BedPreviewInfo = {
  bedName: string;
  lines: string[];
};

export function BedPlanPreview(props: {
  beds: Bed[];
  boundaryPolygon?: Point2D[];
  previewRatio?: number;
  infoByBedId?: Record<string, BedPreviewInfo>;
  title?: string;
  subtitle?: string;
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
  const previewWidth = Math.round(basePreviewWidth * previewZoom);
  const previewHeight = Math.round(basePreviewWidth * ratio * previewZoom);

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
            onPress={() => setPreviewZoom((value) => Math.min(1.8, Number((value + 0.1).toFixed(2))))}
          >
            <Text style={[styles.zoomButtonText, { color: theme.secondaryActionText }]}>+</Text>
          </Pressable>
        </View>
        <Pressable
          style={[styles.toggleChip, { backgroundColor: showBedNames ? theme.primaryActionBackground : theme.secondaryActionBackground }]}
          onPress={() => setShowBedNames((prev) => !prev)}
        >
          <Text style={[styles.toggleChipText, { color: showBedNames ? theme.primaryActionText : theme.secondaryActionText }]}>
            Bed names {showBedNames ? "on" : "off"}
          </Text>
        </Pressable>
      </View>
      <View
        onLayout={(event) => {
          const width = Math.floor(event.nativeEvent.layout.width);
          if (width > 0) setPreviewViewportWidth(width);
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <ScrollView showsVerticalScrollIndicator>
            <View
              style={[
                styles.previewCanvas,
                { width: previewWidth, height: previewHeight, borderColor: theme.borderColor, backgroundColor: theme.appBackground },
              ]}
            >
              <Svg width={previewWidth} height={previewHeight} style={StyleSheet.absoluteFillObject}>
                <Path
                  d={`${rectPath(previewWidth, previewHeight)} ${polygonPath(boundary, previewWidth, previewHeight)}`}
                  fill={theme.mapBoundaryFill}
                  fillRule="evenodd"
                />
                <Polygon points={toSvgPoints(boundary, previewWidth, previewHeight)} fill="transparent" stroke={theme.mapBoundaryStroke} strokeWidth={2} />
                {props.beds.map((bed) => (
                  <Polygon
                    key={`shape-${bed.id}`}
                    points={toSvgPoints(bed.polygon, previewWidth, previewHeight)}
                    fill={bed.containsPerennials ? theme.mapPerennialBedFill : theme.mapBedFill}
                    stroke={theme.mapBedStroke}
                    strokeWidth={1.4}
                  />
                ))}
              </Svg>
              {props.beds.map((bed) => {
                const center = polygonCenter(bed.polygon);
                const left = center.x * previewWidth;
                const top = center.y * previewHeight;
                const info = props.infoByBedId?.[bed.id];
                const openInfo = () => {
                  const infoTitle = info?.bedName ?? bed.name;
                  const lines = info?.lines?.length ? info.lines : ["No details yet"];
                  Alert.alert(infoTitle, lines.join("\n"));
                };
                return (
                  <View key={bed.id} pointerEvents="box-none">
                    {showBedNames && (
                      <Pressable
                        style={[styles.bedNameBadge, { left, top, backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}
                        onPress={openInfo}
                      >
                        <Text style={[styles.bedNameText, { color: theme.textPrimary }]} numberOfLines={1}>
                          {bed.name}
                        </Text>
                        <View
                          style={[
                            styles.bedNameInfoDot,
                            { backgroundColor: theme.primaryActionBackground, borderColor: theme.primaryActionText },
                          ]}
                        >
                          <Text style={[styles.bedNameInfoDotText, { color: theme.primaryActionText }]}>i</Text>
                        </View>
                      </Pressable>
                    )}
                    {!showBedNames && (
                      <Pressable
                        style={[
                          styles.previewPin,
                          { left, top, backgroundColor: theme.primaryActionBackground, borderColor: theme.primaryActionText },
                        ]}
                        onPress={openInfo}
                      >
                        <Text style={[styles.previewPinText, { color: theme.primaryActionText }]}>i</Text>
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

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  meta: { fontSize: 13 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  zoomButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  zoomButtonText: { fontSize: 18, fontWeight: "700" },
  zoomText: { minWidth: 52, textAlign: "center", fontWeight: "700" },
  toggleChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  toggleChipText: { fontWeight: "700" },
  previewCanvas: { borderRadius: 12, overflow: "hidden", borderWidth: 1, position: "relative" },
  previewPin: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -10,
    marginTop: -10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  previewPinText: { fontWeight: "800", fontSize: 11 },
  bedNameBadge: {
    position: "absolute",
    marginLeft: -48,
    marginTop: -11,
    minWidth: 64,
    maxWidth: 120,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  bedNameText: { fontSize: 10, fontWeight: "700", flexShrink: 1, textAlign: "center" },
  bedNameInfoDot: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bedNameInfoDotText: { fontSize: 9, fontWeight: "800" },
});
