import { Link } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Line, Path, Polygon, Text as SvgText } from "react-native-svg";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useGardensQuery } from "@/features/gardens/hooks/useGardensQuery";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteGardenFeatureRepository } from "@/infra/repositories/sqlite/SqliteGardenFeatureRepository";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { clipLineToPolygon, polygonArea } from "@/features/garden-mapping/utils/geometry";
import { queryClient } from "@/state/queryClient";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { Drainage, SunExposure, type Bed, type Point2D } from "@/domain/entities/Bed";
import { GardenFeatureType, type GardenFeature } from "@/domain/entities/GardenFeature";

const bedRepository = new SqliteBedRepository();
const featureRepository = new SqliteGardenFeatureRepository();
const gardenRepository = new SqliteGardenRepository();
const BASE_CANVAS_WIDTH = 1000;
const BASE_CANVAS_HEIGHT = 700;

type ZonePreview = {
  id: string;
  name: string;
  type: GardenFeatureType;
  polygon: Point2D[];
  source: "bed" | "feature";
};

type BedDraft = {
  name: string;
  sunExposure: SunExposure;
  drainage: Drainage;
  containsPerennials: boolean;
  perennialPlantsCsv: string;
  isRaisedBed: boolean;
  hasIrrigation: boolean;
};

const zoneColors: Record<GardenFeatureType, { fill: string; stroke: string }> = {
  bed: { fill: "rgba(53,130,82,0.3)", stroke: "#111111" },
  lawn: { fill: "rgba(111,171,95,0.22)", stroke: "#111111" },
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

export default function PlannerTabScreen() {
  const gardensQuery = useGardensQuery();
  const gardens = gardensQuery.data ?? [];
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);
  const [showImage, setShowImage] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showBedMeasurements, setShowBedMeasurements] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [previewViewport, setPreviewViewport] = useState({ width: 320, height: 224 });
  const [bedDrafts, setBedDrafts] = useState<Record<string, BedDraft>>({});
  const horizontalScrollRef = useRef<ScrollView | null>(null);
  const verticalScrollRef = useRef<ScrollView | null>(null);
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  const [verticalOffset, setVerticalOffset] = useState(0);

  useEffect(() => {
    if (selectedGardenId && gardens.some((g) => g.id === selectedGardenId)) return;
    const nextSelectedGardenId = gardens[0]?.id ?? null;
    if (nextSelectedGardenId === selectedGardenId) return;
    setSelectedGardenId(nextSelectedGardenId);
  }, [gardens, selectedGardenId, setSelectedGardenId]);

  const selectedGarden = useMemo(
    () => gardens.find((garden) => garden.id === selectedGardenId) ?? null,
    [gardens, selectedGardenId]
  );

  useEffect(() => {
    if (!selectedGarden) return;
    setShowImage(selectedGarden.scaleCalibration?.showBaseImage ?? true);
    setShowGrid(selectedGarden.scaleCalibration?.showGridOverlay ?? false);
    setShowBedMeasurements(selectedGarden.scaleCalibration?.showBedMeasurements ?? false);
  }, [
    selectedGarden?.id,
    selectedGarden?.scaleCalibration?.showBaseImage,
    selectedGarden?.scaleCalibration?.showGridOverlay,
    selectedGarden?.scaleCalibration?.showBedMeasurements,
  ]);

  const bedsQuery = useQuery({
    queryKey: ["beds", selectedGardenId],
    enabled: Boolean(selectedGardenId),
    queryFn: async () => {
      if (!selectedGardenId) return [];
      return bedRepository.listByGarden(selectedGardenId);
    },
  });

  const featuresQuery = useQuery({
    queryKey: ["garden-features", selectedGardenId],
    enabled: Boolean(selectedGardenId),
    queryFn: async () => {
      if (!selectedGardenId) return [];
      return featureRepository.listByGarden(selectedGardenId);
    },
  });

  const beds = bedsQuery.data ?? [];
  const features = featuresQuery.data ?? [];

  useEffect(() => {
    const sourceBeds = bedsQuery.data ?? [];
    const nextDrafts: Record<string, BedDraft> = {};
    for (const bed of sourceBeds) {
      nextDrafts[bed.id] = {
        name: bed.name,
        sunExposure: bed.sunExposure,
        drainage: bed.drainage,
        containsPerennials: bed.containsPerennials,
        perennialPlantsCsv: bed.perennialPlantsCsv ?? "",
        isRaisedBed: bed.isRaisedBed,
        hasIrrigation: bed.hasIrrigation,
      };
    }
    setBedDrafts((previous) => (areBedDraftMapsEqual(previous, nextDrafts) ? previous : nextDrafts));
  }, [bedsQuery.data]);

  const zones: ZonePreview[] = [
    ...features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      type: feature.type,
      polygon: feature.polygon,
      source: "feature" as const,
    })),
    ...beds.map((bed) => ({
      id: bed.id,
      name: bed.name,
      type: GardenFeatureType.BED,
      polygon: bed.polygon,
      source: "bed" as const,
    })),
  ];

  const saveBedMutation = useMutation({
    mutationFn: async (bedId: string) => {
      const existing = beds.find((bed) => bed.id === bedId);
      const draft = bedDrafts[bedId];
      if (!existing || !draft) return;
      const perennialCsv = draft.perennialPlantsCsv.trim();
      const payload: Bed = {
        ...existing,
        name: draft.name.trim() || existing.name,
        sunExposure: draft.sunExposure,
        drainage: draft.drainage,
        containsPerennials: draft.containsPerennials,
        isRaisedBed: draft.isRaisedBed,
        hasIrrigation: draft.hasIrrigation,
        ...(draft.containsPerennials && perennialCsv ? { perennialPlantsCsv: perennialCsv } : {}),
        updatedAt: new Date().toISOString(),
      };
      await bedRepository.update(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["beds", selectedGardenId] });
    },
  });

  const totalBedAreaRatio = beds.reduce((sum, bed) => sum + polygonArea(bed.polygon), 0);
  const calibration = selectedGarden?.scaleCalibration;
  const baseWidth = calibration?.baseWidth ?? BASE_CANVAS_WIDTH;
  const baseHeight = calibration?.baseHeight ?? BASE_CANVAS_HEIGHT;
  const boundary = getBoundaryOrDefault(calibration?.boundaryPolygon);
  const boundaryXs = boundary.map((p) => p.x);
  const boundaryYs = boundary.map((p) => p.y);
  const boundaryMinX = boundaryXs.length > 0 ? Math.min(...boundaryXs) : 0;
  const boundaryMaxX = boundaryXs.length > 0 ? Math.max(...boundaryXs) : 1;
  const boundaryMinY = boundaryYs.length > 0 ? Math.min(...boundaryYs) : 0;
  const boundaryMaxY = boundaryYs.length > 0 ? Math.max(...boundaryYs) : 1;
  const gridStepX = calibration ? 1 / Math.max(calibration.metersPerPixel * baseWidth, 1e-6) : 0;
  const gridStepY = calibration ? 1 / Math.max(calibration.metersPerPixel * baseHeight, 1e-6) : 0;

  const previewBaseWidth = Math.max(1, Math.floor(previewViewport.width));
  const previewBaseHeight = Math.max(180, Math.floor((previewBaseWidth * baseHeight) / Math.max(baseWidth, 1)));
  const zoomedWidth = Math.max(1, Math.round(previewBaseWidth * zoom));
  const zoomedHeight = Math.max(1, Math.round(previewBaseHeight * zoom));
  const previewPanPadding = Math.max(72, Math.round(previewBaseWidth * 0.18));
  const previewContentWidth = zoomedWidth + previewPanPadding * 2;
  const previewContentHeight = zoomedHeight + previewPanPadding * 2;
  const maxPreviewOffsetX = Math.max(0, previewContentWidth - previewBaseWidth);
  const maxPreviewOffsetY = Math.max(0, previewContentHeight - previewBaseHeight);
  const canPanPreview = maxPreviewOffsetX > 0 || maxPreviewOffsetY > 0;
  const boundaryMeasurements = getBoundaryMeasurementLabels(boundary, zoomedWidth, zoomedHeight, calibration);
  const panStep = Math.max(80, Math.round(previewBaseWidth * 0.22));
  const gridVerticalLines = showGrid
    ? buildGridSeries(boundaryMinX, boundaryMaxX, gridStepX).map((x) => x * zoomedWidth)
    : [];
  const gridHorizontalLines = showGrid
    ? buildGridSeries(boundaryMinY, boundaryMaxY, gridStepY).map((y) => y * zoomedHeight)
    : [];

  const nudgePreview = (dx: number, dy: number) => {
    if (!canPanPreview) return;
    const nextX = clamp(horizontalOffset + dx, 0, maxPreviewOffsetX);
    const nextY = clamp(verticalOffset + dy, 0, maxPreviewOffsetY);
    horizontalScrollRef.current?.scrollTo({ x: nextX, animated: true });
    verticalScrollRef.current?.scrollTo({ y: nextY, animated: true });
    setHorizontalOffset(nextX);
    setVerticalOffset(nextY);
  };

  useEffect(() => {
    const targetX = clamp(previewPanPadding, 0, maxPreviewOffsetX);
    const targetY = clamp(previewPanPadding, 0, maxPreviewOffsetY);
    horizontalScrollRef.current?.scrollTo({ x: targetX, animated: false });
    verticalScrollRef.current?.scrollTo({ y: targetY, animated: false });
    setHorizontalOffset(targetX);
    setVerticalOffset(targetY);
  }, [selectedGardenId, zoomedWidth, zoomedHeight, previewPanPadding, maxPreviewOffsetX, maxPreviewOffsetY]);

  const persistPreviewViewSettings = async (
    nextShowImage: boolean,
    nextShowGrid: boolean,
    nextShowBedMeasurements: boolean
  ) => {
    if (!selectedGardenId || !selectedGarden?.scaleCalibration) return;
    const nextCalibration = {
      ...selectedGarden.scaleCalibration,
      showBaseImage: nextShowImage,
      showGridOverlay: nextShowGrid,
      showBedMeasurements: nextShowBedMeasurements,
    };
    await gardenRepository.updateScaleCalibration(selectedGardenId, nextCalibration);
    await queryClient.invalidateQueries({ queryKey: ["gardens"] });
    await queryClient.invalidateQueries({ queryKey: ["garden", selectedGardenId] });
  };

  if (gardensQuery.isLoading) {
    return <View style={styles.center}><Text style={styles.state}>Loading planner...</Text></View>;
  }

  if (gardens.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Planner</Text>
        <Text style={styles.state}>No gardens yet.</Text>
        <Link href="/(tabs)/gardens" style={styles.primaryLink}>Create or open a garden</Link>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Planner</Text>
      <Text style={styles.subtitle}>Pick a garden and review/edit mapped bed details.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Garden</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {gardens.map((garden) => {
            const selected = garden.id === selectedGardenId;
            return (
              <Text
                key={garden.id}
                onPress={() => setSelectedGardenId(garden.id)}
                style={[styles.chip, selected && styles.chipActive]}
              >
                {garden.name}
              </Text>
            );
          })}
        </ScrollView>
      </View>

      {selectedGarden && (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Plan Preview</Text>
            <View style={styles.toggleRow}>
              <ToggleSwitch
                label="Image"
                value={showImage}
                onToggle={(next) => {
                  setShowImage(next);
                  void persistPreviewViewSettings(next, showGrid, showBedMeasurements);
                }}
              />
              <ToggleSwitch
                label="Grid"
                value={showGrid}
                disabled={!calibration}
                onToggle={(next) => {
                  setShowGrid(next);
                  void persistPreviewViewSettings(showImage, next, showBedMeasurements);
                }}
              />
              <ToggleSwitch
                label="Bed Sizes"
                value={showBedMeasurements}
                disabled={!calibration}
                onToggle={(next) => {
                  setShowBedMeasurements(next);
                  void persistPreviewViewSettings(showImage, showGrid, next);
                }}
              />
              <View style={styles.zoomRow}>
                <Pressable style={styles.zoomButton} onPress={() => setZoom((z) => clamp(z - 0.25, 0.5, 4))}>
                  <Text style={styles.zoomButtonText}>-</Text>
                </Pressable>
                <Text style={styles.zoomText}>{Math.round(zoom * 100)}%</Text>
                <Pressable style={styles.zoomButton} onPress={() => setZoom((z) => clamp(z + 0.25, 0.5, 4))}>
                  <Text style={styles.zoomButtonText}>+</Text>
                </Pressable>
              </View>
              <View style={styles.dPadWrap}>
                <View style={styles.dPadRow}>
                  <Pressable style={styles.dPadButton} onPress={() => nudgePreview(0, -panStep)} disabled={!canPanPreview}>
                    <Text style={styles.dPadText}>↑</Text>
                  </Pressable>
                </View>
                <View style={styles.dPadRow}>
                  <Pressable style={styles.dPadButton} onPress={() => nudgePreview(-panStep, 0)} disabled={!canPanPreview}>
                    <Text style={styles.dPadText}>←</Text>
                  </Pressable>
                  <Pressable style={styles.dPadButton} onPress={() => nudgePreview(panStep, 0)} disabled={!canPanPreview}>
                    <Text style={styles.dPadText}>→</Text>
                  </Pressable>
                </View>
                <View style={styles.dPadRow}>
                  <Pressable style={styles.dPadButton} onPress={() => nudgePreview(0, panStep)} disabled={!canPanPreview}>
                    <Text style={styles.dPadText}>↓</Text>
                  </Pressable>
                </View>
              </View>
            </View>
            {!calibration ? (
              <Text style={styles.state}>Set boundary/scale first in Setup to preview this plan.</Text>
            ) : (
              <View
                style={[styles.previewViewport, { height: previewBaseHeight }]}
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  if (width > 0 && height > 0) {
                    setPreviewViewport({ width, height });
                  }
                }}
              >
                <ScrollView
                  ref={horizontalScrollRef}
                  horizontal
                  bounces={false}
                  scrollEnabled={canPanPreview}
                  onScroll={(event) => setHorizontalOffset(event.nativeEvent.contentOffset.x)}
                  scrollEventThrottle={16}
                >
                  <ScrollView
                    ref={verticalScrollRef}
                    bounces={false}
                    scrollEnabled={canPanPreview}
                    onScroll={(event) => setVerticalOffset(event.nativeEvent.contentOffset.y)}
                    scrollEventThrottle={16}
                  >
                    <View style={[styles.previewInner, { width: previewContentWidth, height: previewContentHeight }]}>
                      <View
                        style={[
                          styles.previewCanvasFrame,
                          {
                            width: zoomedWidth,
                            height: zoomedHeight,
                            left: previewPanPadding,
                            top: previewPanPadding,
                          },
                        ]}
                      >
                        {showImage && selectedGarden.photoUri && (
                          <Image source={{ uri: selectedGarden.photoUri }} style={styles.previewImage} resizeMode="stretch" />
                        )}
                        <Svg width={zoomedWidth} height={zoomedHeight}>
                        {showGrid && gridVerticalLines.map((x, index) => (
                          <Line
                            key={`grid-v-${index.toString()}`}
                            x1={x}
                            y1={0}
                            x2={x}
                            y2={zoomedHeight}
                            stroke="rgba(20,67,46,0.28)"
                            strokeWidth={1}
                          />
                        ))}
                        {showGrid && gridHorizontalLines.map((y, index) => (
                          <Line
                            key={`grid-h-${index.toString()}`}
                            x1={0}
                            y1={y}
                            x2={zoomedWidth}
                            y2={y}
                            stroke="rgba(20,67,46,0.28)"
                            strokeWidth={1}
                          />
                        ))}
                        {!isBoundaryRect(boundary) && (
                          <Path
                            d={`${rectPath(zoomedWidth, zoomedHeight)} ${polygonPath(boundary, zoomedWidth, zoomedHeight)}`}
                            fill="rgba(231,239,229,0.9)"
                            fillRule="evenodd"
                          />
                        )}
                          <Polygon
                            points={toSvgPoints(boundary, zoomedWidth, zoomedHeight)}
                            fill={showImage && selectedGarden.photoUri ? "transparent" : "rgba(39,98,66,0.12)"}
                            stroke="#2D6A49"
                            strokeWidth={3}
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
                        {zones.map((zone) => {
                          const color = zoneColors[zone.type];
                          const label = zone.source === "bed"
                            ? getPolygonLabelPlacement(zone.polygon, zoomedWidth, zoomedHeight)
                            : null;
                          const bedMeasurementLabels = showBedMeasurements && zone.source === "bed"
                            ? getBedMeasurementLabels(zone.polygon, zoomedWidth, zoomedHeight, calibration)
                            : [];
                          const stripeSpec = getStripeSpecForType(zone.type);
                          const hatchLines = stripeSpec
                            ? buildHatchLines(zoomedWidth, zoomedHeight, stripeSpec.spacingPx, stripeSpec.angleDeg)
                            : [];
                          const clippedHatchLines = stripeSpec
                            ? clipHatchLinesToPolygon(hatchLines, zone.polygon, zoomedWidth, zoomedHeight)
                            : [];
                          return (
                            <Fragment key={zone.id}>
                              <Polygon
                                points={toSvgPoints(zone.polygon, zoomedWidth, zoomedHeight)}
                                fill={color.fill}
                                stroke={color.stroke}
                                strokeWidth={2}
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
                                  fontSize={11}
                                  fontWeight="700"
                                  fill="#1B3D2B"
                                  transform={`rotate(${measurement.angle} ${measurement.x} ${measurement.y})`}
                                >
                                  {measurement.label}
                                </SvgText>
                              ))}
                              {label && (
                                <SvgText
                                  x={label.x}
                                  y={label.y}
                                  textAnchor="middle"
                                  alignmentBaseline="middle"
                                  fontSize={label.fontSize}
                                  fontWeight="800"
                                  fill="#000000"
                                >
                                  {truncateLabel(zone.name, 20)}
                                </SvgText>
                              )}
                            </Fragment>
                          );
                        })}
                        </Svg>
                      </View>
                    </View>
                  </ScrollView>
                </ScrollView>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Current Snapshot</Text>
            <Text style={styles.metric}>Beds: {beds.length}</Text>
            <Text style={styles.metric}>Other areas: {features.length}</Text>
            <Text style={styles.metric}>Mapped bed area ratio: {totalBedAreaRatio.toFixed(3)}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Beds (Editable)</Text>
            {beds.length === 0 && <Text style={styles.state}>No beds mapped yet.</Text>}
            {beds.map((bed) => {
              const draft = bedDrafts[bed.id];
              if (!draft) return null;
              return (
                <View key={bed.id} style={styles.bedCard}>
                  <Text style={styles.bedTitle}>{bed.name}</Text>
                  <TextInput
                    value={draft.name}
                    onChangeText={(value) => setBedDrafts((prev) => ({ ...prev, [bed.id]: { ...prev[bed.id]!, name: value } }))}
                    placeholder="Bed name"
                    style={styles.input}
                  />
                  <PickerRow
                    title="Sun"
                    options={[SunExposure.FULL_SUN, SunExposure.PART_SUN, SunExposure.SHADE]}
                    selected={draft.sunExposure}
                    onSelect={(value) => setBedDrafts((prev) => ({ ...prev, [bed.id]: { ...prev[bed.id]!, sunExposure: value as SunExposure } }))}
                  />
                  <PickerRow
                    title="Drainage"
                    options={[Drainage.GOOD, Drainage.MEDIUM, Drainage.POOR]}
                    selected={draft.drainage}
                    onSelect={(value) => setBedDrafts((prev) => ({ ...prev, [bed.id]: { ...prev[bed.id]!, drainage: value as Drainage } }))}
                  />
                  <PickerRow
                    title="Raised Bed"
                    options={["yes", "no"]}
                    selected={draft.isRaisedBed ? "yes" : "no"}
                    onSelect={(value) => setBedDrafts((prev) => ({ ...prev, [bed.id]: { ...prev[bed.id]!, isRaisedBed: value === "yes" } }))}
                  />
                  <PickerRow
                    title="Irrigation"
                    options={["yes", "no"]}
                    selected={draft.hasIrrigation ? "yes" : "no"}
                    onSelect={(value) => setBedDrafts((prev) => ({ ...prev, [bed.id]: { ...prev[bed.id]!, hasIrrigation: value === "yes" } }))}
                  />
                  <PickerRow
                    title="Contains Perennials"
                    options={["yes", "no"]}
                    selected={draft.containsPerennials ? "yes" : "no"}
                    onSelect={(value) => {
                      const next = value === "yes";
                      setBedDrafts((prev) => ({
                        ...prev,
                        [bed.id]: {
                          ...prev[bed.id]!,
                          containsPerennials: next,
                          perennialPlantsCsv: next ? prev[bed.id]!.perennialPlantsCsv : "",
                        },
                      }));
                    }}
                  />
                  {draft.containsPerennials && (
                    <TextInput
                      value={draft.perennialPlantsCsv}
                      onChangeText={(value) => setBedDrafts((prev) => ({ ...prev, [bed.id]: { ...prev[bed.id]!, perennialPlantsCsv: value } }))}
                      placeholder="Perennials (comma-separated)"
                      style={styles.input}
                      multiline
                    />
                  )}
                  <Pressable
                    style={styles.saveBedButton}
                    onPress={() => saveBedMutation.mutate(bed.id)}
                    disabled={saveBedMutation.isPending}
                  >
                    <Text style={styles.saveBedButtonText}>Save Bed</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Open</Text>
            <Link href={`/gardens/${selectedGarden.id}/map`} style={styles.linkButton}>Open Garden Mapper</Link>
            <Link href={`/gardens/${selectedGarden.id}/setup`} style={styles.linkButtonSecondary}>Open Setup</Link>
          </View>
        </>
      )}
    </ScrollView>
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

function buildGridSeries(start: number, end: number, step: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step <= 0) return [];
  if (end <= start) return [];
  const values: number[] = [];
  const maxSteps = 5000;
  for (let i = 0; i < maxSteps; i += 1) {
    const value = start + i * step;
    if (value > end + 1e-9) break;
    values.push(value);
  }
  return values;
}

function toSvgPoints(points: Point2D[], width: number, height: number): string {
  return points.map((p) => `${p.x * width},${p.y * height}`).join(" ");
}

function getBoundaryOrDefault(boundary: { x: number; y: number }[] | undefined): { x: number; y: number }[] {
  if (boundary && boundary.length >= 3) return boundary;
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
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}...`;
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
      label: meters >= 10 ? `${Math.round(meters)}m` : `${meters.toFixed(1)}m`,
    });
  }
  return labels;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function areBedDraftMapsEqual(
  a: Record<string, BedDraft>,
  b: Record<string, BedDraft>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const left = a[key];
    const right = b[key];
    if (!left || !right) return false;
    if (
      left.name !== right.name ||
      left.sunExposure !== right.sunExposure ||
      left.drainage !== right.drainage ||
      left.containsPerennials !== right.containsPerennials ||
      left.perennialPlantsCsv !== right.perennialPlantsCsv ||
      left.isRaisedBed !== right.isRaisedBed ||
      left.hasIrrigation !== right.hasIrrigation
    ) {
      return false;
    }
  }
  return true;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F0F6EE" },
  content: { padding: 14, gap: 10, paddingBottom: 120 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F0F6EE", padding: 20 },
  title: { fontSize: 28, fontWeight: "800", color: "#1E402C" },
  subtitle: { color: "#4E6857" },
  state: { color: "#4E6857", marginTop: 8 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D8E5D5",
    padding: 12,
    gap: 8,
  },
  cardTitle: { color: "#2C4737", fontWeight: "800" },
  chipRow: { gap: 8 },
  chip: {
    backgroundColor: "#DFEADF",
    color: "#23412E",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: "hidden",
    fontWeight: "700",
  },
  chipActive: { backgroundColor: "#245A3E", color: "#FFFFFF" },
  metric: { color: "#365648", fontWeight: "600" },
  previewViewport: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#C5D4C5",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#E5EDE4",
  },
  previewInner: {
    position: "relative",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#E5EDE4",
  },
  previewCanvasFrame: {
    position: "absolute",
    borderRadius: 12,
    overflow: "hidden",
  },
  previewImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  toggleRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
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
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  zoomButton: { backgroundColor: "#DFEADF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  zoomButtonText: { fontSize: 18, fontWeight: "700", color: "#23412E" },
  zoomText: { minWidth: 52, textAlign: "center", fontWeight: "700", color: "#375947" },
  dPadWrap: { gap: 4 },
  dPadRow: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dPadButton: {
    backgroundColor: "#DFEADF",
    borderRadius: 8,
    minWidth: 34,
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  dPadText: { color: "#23412E", fontWeight: "800", fontSize: 16, lineHeight: 18 },
  bedCard: {
    borderWidth: 1,
    borderColor: "#D8E5D5",
    borderRadius: 12,
    padding: 10,
    gap: 8,
    backgroundColor: "#F9FCF8",
  },
  bedTitle: { fontWeight: "800", color: "#2C4737" },
  input: {
    borderWidth: 1,
    borderColor: "#BFD1BC",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
  },
  pickerRow: { gap: 6 },
  pickerTitle: { fontWeight: "700", color: "#1D3D2A" },
  pickerOptionsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pickerChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99, backgroundColor: "#DCE8DA" },
  pickerChipActive: { backgroundColor: "#A9CFB2" },
  pickerChipText: { textTransform: "capitalize", color: "#274431" },
  saveBedButton: {
    backgroundColor: "#245A3E",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  saveBedButtonText: { color: "#FFFFFF", fontWeight: "800" },
  linkButton: {
    backgroundColor: "#245A3E",
    color: "#FFFFFF",
    fontWeight: "800",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
    textAlign: "center",
  },
  linkButtonSecondary: {
    backgroundColor: "#DFEADF",
    color: "#1F3F2B",
    fontWeight: "700",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
    textAlign: "center",
  },
  primaryLink: {
    marginTop: 10,
    color: "#FFFFFF",
    fontWeight: "800",
    backgroundColor: "#245A3E",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    overflow: "hidden",
  },
});
