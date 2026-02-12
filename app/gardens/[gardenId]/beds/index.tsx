
import { Link, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Polygon } from "react-native-svg";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteCompanionPlantingRepository } from "@/infra/repositories/sqlite/SqliteCompanionPlantingRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { polygonArea } from "@/features/garden-mapping/utils/geometry";
import { getCompanionMatchSummary, normalizePlantKey } from "@/features/plants/services/companionMatching";
import { queryClient } from "@/state/queryClient";
import { useTheme } from "@/ui/theme/ThemeProvider";
import type {
  GardenCropPlantingHistoryItem,
  GardenCropWishlistItemView,
  PlantingEndState,
} from "@/domain/entities/Plant";

const bedRepository = new SqliteBedRepository();
const companionRepository = new SqliteCompanionPlantingRepository();
const wishlistRepository = new SqliteGardenCropWishlistRepository();
const gardenRepository = new SqliteGardenRepository();

type PlantMeta = {
  sunRequirements?: string;
  rowSpacing?: number;
  spread?: number;
  height?: number;
};

type BedSuggestion = {
  entry: GardenCropWishlistItemView;
  sunReason: string;
  spacingReason: string;
  companionMessages: string[];
  score: number;
  fitCount?: number;
};

type ActiveGrowingRow = {
  entry: GardenCropWishlistItemView;
  plantedAt?: string;
};

const DEFAULT_BOUNDARY = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export default function BedsListScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewViewportWidth, setPreviewViewportWidth] = useState(0);
  const [hasSpareSpaceByBed, setHasSpareSpaceByBed] = useState<Record<string, boolean>>({});
  const [historyExpandedByBed, setHistoryExpandedByBed] = useState<Record<string, boolean>>({});

  const bedsQuery = useQuery({
    queryKey: ["beds", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing gardenId");
      return bedRepository.listByGarden(gardenId);
    },
  });

  const gardenQuery = useQuery({
    queryKey: ["garden", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing gardenId");
      return gardenRepository.getById(gardenId);
    },
  });

  const wishlistQuery = useQuery({
    queryKey: ["garden-grow-list", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) return [];
      return wishlistRepository.listByGarden(gardenId);
    },
  });

  const plantingsQuery = useQuery({
    queryKey: ["garden-plantings", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) return [];
      return wishlistRepository.listPlantingsByGarden(gardenId);
    },
  });

  const companionQuery = useQuery({
    queryKey: ["companion-relations"],
    queryFn: async () => {
      return companionRepository.listAll();
    },
  });

  const planInBedMutation = useMutation({
    mutationFn: async (payload: { entry: GardenCropWishlistItemView; bedId: string }) => {
      await wishlistRepository.update({
        id: payload.entry.id,
        status: "wanted",
        bedId: payload.bedId,
        isPerennial: false,
        varietyName: payload.entry.varietyName ?? "",
        supportNeeded: payload.entry.supportNeeded,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
    },
  });

  const markPlantedMutation = useMutation({
    mutationFn: async (payload: { entryId: string; bedId: string }) => {
      await wishlistRepository.markPlanted(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["garden-plantings", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
    },
  });

  const finishPlantingMutation = useMutation({
    mutationFn: async (payload: { entryId: string; endState: PlantingEndState }) => {
      await wishlistRepository.finishPlanting(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["garden-plantings", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
    },
  });

  const clearPlanMutation = useMutation({
    mutationFn: async (entry: GardenCropWishlistItemView) => {
      await wishlistRepository.update({
        id: entry.id,
        status: "wanted",
        varietyName: entry.varietyName ?? "",
        supportNeeded: entry.supportNeeded,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
    },
  });

  const wishlist = wishlistQuery.data ?? [];
  const beds = bedsQuery.data ?? [];
  const companionRelations = companionQuery.data ?? [];
  const plantings = plantingsQuery.data ?? [];
  const plannedPool = wishlist.filter((item) => item.status === "wanted");

  const activePlantingByEntryId = useMemo(() => {
    const map = new Map<string, GardenCropPlantingHistoryItem>();
    for (const planting of plantings) {
      if (!planting.endedAt) map.set(planting.entryId, planting);
    }
    return map;
  }, [plantings]);

  const historicalByBedId = useMemo(() => {
    const map = new Map<string, GardenCropPlantingHistoryItem[]>();
    for (const planting of plantings) {
      if (!planting.endedAt || !planting.bedId) continue;
      const existing = map.get(planting.bedId) ?? [];
      existing.push(planting);
      map.set(planting.bedId, existing);
    }
    for (const [bedId, rows] of map.entries()) {
      rows.sort((a, b) => b.plantedAt.localeCompare(a.plantedAt));
      map.set(bedId, rows);
    }
    return map;
  }, [plantings]);

  const bedCards = useMemo(() => {
    const growingByBed = new Map<string, GardenCropWishlistItemView[]>();
    const plannedByBed = new Map<string, GardenCropWishlistItemView[]>();
    const areaByBed = new Map<string, number | undefined>();

    const calibration = gardenQuery.data?.scaleCalibration;
    const hasScale =
      calibration &&
      Number.isFinite(calibration.baseWidth) &&
      Number.isFinite(calibration.baseHeight) &&
      Number.isFinite(calibration.metersPerPixel);

    for (const bed of beds) {
      const growing = wishlist.filter((item) => item.status === "already_growing" && item.bedId === bed.id);
      const planned = plannedPool.filter((item) => item.bedId === bed.id);
      growingByBed.set(bed.id, growing);
      plannedByBed.set(bed.id, planned);

      if (hasScale) {
        const normalizedArea = polygonArea(bed.polygon);
        const areaSqM =
          normalizedArea *
          calibration.baseWidth *
          calibration.baseHeight *
          calibration.metersPerPixel *
          calibration.metersPerPixel;
        areaByBed.set(bed.id, Number.isFinite(areaSqM) ? areaSqM : undefined);
      } else {
        areaByBed.set(bed.id, undefined);
      }
    }

    return beds.map((bed) => {
      const growingInBed = growingByBed.get(bed.id) ?? [];
      const plannedInBed = plannedByBed.get(bed.id) ?? [];
      const perennialNames = parsePerennialPlants(bed.perennialPlantsCsv);
      const areaSqM = areaByBed.get(bed.id);

      const activeGrowingRows: ActiveGrowingRow[] = growingInBed.map((entry) => {
        const activePlanting = activePlantingByEntryId.get(entry.id);
        return {
          entry,
          ...(activePlanting?.plantedAt ? { plantedAt: activePlanting.plantedAt } : {}),
        };
      });

      const growingNames = Array.from(new Set([...activeGrowingRows.map((row) => formatEntryName(row.entry)), ...perennialNames]));
      const plannedNames = plannedInBed.map((entry) => formatEntryName(entry));
      const companionContextNames = Array.from(new Set([...growingNames, ...plannedNames]));

      const excludedNames = new Set<string>(growingNames.map(normalizePlantName));
      const alreadyPlannedIds = new Set(plannedInBed.map((entry) => entry.id));

      const suggestions: BedSuggestion[] = plannedPool
        .filter((entry) => !entry.bedId)
        .filter((entry) => !excludedNames.has(normalizePlantName(entry.plant.commonName)))
        .filter((entry) => !alreadyPlannedIds.has(entry.id))
        .map((entry) => {
          const meta = parsePlantMeta(entry.plant.metaJson);
          const fitCount = estimateFitCount(areaSqM, meta);
          const companion = getCompanionMatchSummary({
            candidateName: entry.plant.commonName,
            nearbyNames: companionContextNames,
            relations: companionRelations,
          });
          const baseScore = scoreSuggestion(entry, bed.sunExposure);
          return {
            entry,
            sunReason: getSunReason(bed.sunExposure, meta.sunRequirements),
            spacingReason: getSpacingReason(meta, fitCount, areaSqM),
            companionMessages: companion.messages,
            score: baseScore + companion.scoreDelta,
            ...(typeof fitCount === "number" ? { fitCount } : {}),
          };
        })
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          return a.entry.plant.commonName.localeCompare(b.entry.plant.commonName);
        })
        .slice(0, 3);

      const suggestionIds = new Set(suggestions.map((item) => item.entry.id));
      const contraryOptions = plannedPool
        .filter((entry) => !entry.bedId && !suggestionIds.has(entry.id))
        .filter((entry) => !excludedNames.has(normalizePlantName(entry.plant.commonName)))
        .slice(0, 6);

      return {
        bed,
        areaSqM,
        growingNames,
        activeGrowingRows,
        plannedInBed,
        suggestions,
        contraryOptions,
        historicalRows: historicalByBedId.get(bed.id) ?? [],
      };
    });
  }, [beds, companionRelations, gardenQuery.data?.scaleCalibration, plannedPool, wishlist, activePlantingByEntryId, historicalByBedId]);

  useEffect(() => {
    if (bedCards.length === 0) return;
    setHasSpareSpaceByBed((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const card of bedCards) {
        if (next[card.bed.id] === undefined) {
          next[card.bed.id] = card.growingNames.length === 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [bedCards]);

  const boundary = useMemo(() => {
    const points = gardenQuery.data?.scaleCalibration?.boundaryPolygon;
    if (points && points.length >= 3) return points;
    return DEFAULT_BOUNDARY;
  }, [gardenQuery.data?.scaleCalibration?.boundaryPolygon]);

  const previewRatio = useMemo(() => {
    const calibration = gardenQuery.data?.scaleCalibration;
    if (!calibration || !calibration.baseWidth || !calibration.baseHeight) return 0.66;
    return calibration.baseHeight / calibration.baseWidth;
  }, [gardenQuery.data?.scaleCalibration]);

  const basePreviewWidth = Math.max(280, Math.round(previewViewportWidth || 320));
  const previewWidth = Math.round(basePreviewWidth * previewZoom);
  const previewHeight = Math.round(previewWidth * previewRatio);

  const bedInfoById = useMemo(() => {
    const map = new Map<string, { bedName: string; growing: string[]; planned: string[]; isPerennialBed: boolean }>();
    for (const card of bedCards) {
      map.set(card.bed.id, {
        bedName: card.bed.name,
        growing: card.growingNames,
        planned: card.plannedInBed.map((entry) => formatEntryName(entry)),
        isPerennialBed: card.bed.containsPerennials,
      });
    }
    return map;
  }, [bedCards]);

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Beds</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>Review beds and place crops from your grow list.</Text>

        {bedsQuery.isLoading && <Text style={[styles.empty, { color: theme.textMuted }]}>Loading beds...</Text>}
        {bedsQuery.isError && <Text style={[styles.empty, { color: theme.textMuted }]}>Could not load beds.</Text>}
        {!bedsQuery.isLoading && !bedsQuery.isError && bedCards.length === 0 && (
          <Text style={[styles.empty, { color: theme.textMuted }]}>No beds yet. Add beds in Garden Planner.</Text>
        )}

        {bedCards.map((card) => {
          const hasExistingPlants = card.growingNames.length > 0;
          const hasSpareSpace = hasSpareSpaceByBed[card.bed.id] ?? false;
          const showSuggestions = !hasExistingPlants || hasSpareSpace;
          const historyExpanded = Boolean(historyExpandedByBed[card.bed.id]);

          return (
            <View key={card.bed.id} style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
              <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{card.bed.name}</Text>
              <Text style={[styles.meta, { color: theme.textMuted }]}>Sun: {formatLabel(card.bed.sunExposure)} - Drainage: {formatLabel(card.bed.drainage)}</Text>
              <Text style={[styles.meta, { color: theme.textMuted }]}>
                {card.bed.containsPerennials ? "Perennial bed" : "Annual/mixed bed"}
                {typeof card.areaSqM === "number" ? ` - Area ~${card.areaSqM.toFixed(1)} sqm` : ""}
              </Text>

              <View style={styles.block}>
                <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Growing now</Text>
                {card.activeGrowingRows.length === 0 && card.growingNames.length === 0 && <Text style={[styles.blockText, { color: theme.textMuted }]}>Nothing added yet</Text>}
                {card.activeGrowingRows.map((row) => (
                  <View key={row.entry.id} style={[styles.growingRow, { borderColor: theme.borderColor }]}>
                    <View style={styles.growingMain}>
                      <Text style={[styles.growingName, { color: theme.textPrimary }]}>{formatEntryName(row.entry)}</Text>
                      <Text style={[styles.blockText, { color: theme.textMuted }]}>{row.plantedAt ? `Planted ${formatDate(row.plantedAt)}` : "Planted date not set"}</Text>
                    </View>
                    <View style={styles.row}>
                      <Pressable style={[styles.finishChip, { backgroundColor: theme.secondaryActionBackground }]} disabled={finishPlantingMutation.isPending} onPress={() => finishPlantingMutation.mutate({ entryId: row.entry.id, endState: "harvested" })}><Text style={[styles.finishChipText, { color: theme.secondaryActionText }]}>Harvested</Text></Pressable>
                      <Pressable style={[styles.finishChip, { backgroundColor: theme.secondaryActionBackground }]} disabled={finishPlantingMutation.isPending} onPress={() => finishPlantingMutation.mutate({ entryId: row.entry.id, endState: "done" })}><Text style={[styles.finishChipText, { color: theme.secondaryActionText }]}>Done</Text></Pressable>
                      <Pressable style={[styles.finishChipDanger, { backgroundColor: theme.dangerActionBackground }]} disabled={finishPlantingMutation.isPending} onPress={() => finishPlantingMutation.mutate({ entryId: row.entry.id, endState: "dead" })}><Text style={[styles.finishChipDangerText, { color: theme.dangerActionText }]}>Lost</Text></Pressable>
                    </View>
                  </View>
                ))}
                {card.growingNames.length > card.activeGrowingRows.length && (
                  <Text style={[styles.blockText, { color: theme.textMuted }]}>
                    Perennials listed in bed profile: {card.growingNames.filter((name) => !card.activeGrowingRows.some((row) => formatEntryName(row.entry) === name)).join(", ")}
                  </Text>
                )}
              </View>

              {card.growingNames.length > 0 && (
                <View style={styles.block}>
                  <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Spare space</Text>
                  <View style={styles.row}>
                    <Pressable style={[styles.toggleChip, { backgroundColor: hasSpareSpace ? theme.primaryActionBackground : theme.secondaryActionBackground }]} onPress={() => setHasSpareSpaceByBed((prev) => ({ ...prev, [card.bed.id]: true }))}><Text style={[styles.toggleChipText, { color: hasSpareSpace ? theme.primaryActionText : theme.secondaryActionText }]}>Yes</Text></Pressable>
                    <Pressable style={[styles.toggleChip, { backgroundColor: !hasSpareSpace ? theme.primaryActionBackground : theme.secondaryActionBackground }]} onPress={() => setHasSpareSpaceByBed((prev) => ({ ...prev, [card.bed.id]: false }))}><Text style={[styles.toggleChipText, { color: !hasSpareSpace ? theme.primaryActionText : theme.secondaryActionText }]}>No</Text></Pressable>
                  </View>
                </View>
              )}

              {card.plannedInBed.length > 0 && (
                <View style={styles.block}>
                  <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Planned for this bed</Text>
                  <View style={styles.chips}>
                    {card.plannedInBed.map((entry) => (
                      <View key={entry.id} style={[styles.planChip, { backgroundColor: theme.secondaryActionBackground }]}>
                        <Text style={[styles.planChipText, { color: theme.secondaryActionText }]}>{formatEntryName(entry)}</Text>
                        <Pressable style={[styles.planChipPlantButton, { backgroundColor: theme.primaryActionBackground }]} onPress={() => markPlantedMutation.mutate({ entryId: entry.id, bedId: card.bed.id })} disabled={markPlantedMutation.isPending}><Text style={[styles.planChipPlantButtonText, { color: theme.primaryActionText }]}>Planted</Text></Pressable>
                        <Pressable style={[styles.planChipButton, { backgroundColor: theme.dangerActionBackground }]} onPress={() => clearPlanMutation.mutate(entry)} disabled={clearPlanMutation.isPending}><Text style={[styles.planChipButtonText, { color: theme.dangerActionText }]}>Clear</Text></Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {card.historicalRows.length > 0 && (
                <View style={styles.block}>
                  <Pressable style={[styles.historyHeader, { backgroundColor: theme.appBackground }]} onPress={() => setHistoryExpandedByBed((prev) => ({ ...prev, [card.bed.id]: !historyExpanded }))}>
                    <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>{historyExpanded ? "History - hide" : "History - show"} ({card.historicalRows.length})</Text>
                  </Pressable>
                  {historyExpanded && card.historicalRows.map((row) => (
                    <View key={row.id} style={[styles.historyRow, { borderColor: theme.borderColor }]}>
                      <Text style={[styles.historyName, { color: theme.textPrimary }]}>{formatHistoryName(row)}</Text>
                      <Text style={[styles.historyMeta, { color: theme.textMuted }]}>{formatDate(row.plantedAt)} - {row.endedAt ? formatDate(row.endedAt) : "ongoing"}{row.endState ? ` - ${formatEndStateLabel(row.endState)}` : ""}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.block}>
                <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Suggested plans</Text>
                {!showSuggestions ? (
                  <Text style={[styles.blockText, { color: theme.textMuted }]}>Suggestions hidden while this bed is marked as full.</Text>
                ) : card.suggestions.length === 0 ? (
                  <Text style={[styles.blockText, { color: theme.textMuted }]}>No clear suggestions yet. Add more crops in Grow List.</Text>
                ) : (
                  card.suggestions.map((suggestion) => (
                    <View key={suggestion.entry.id} style={[styles.suggestionRow, { borderColor: theme.borderColor }]}>
                      <View style={styles.suggestionMain}>
                        <Text style={[styles.suggestionName, { color: theme.textPrimary }]}>{formatEntryName(suggestion.entry)}</Text>
                        <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.sunReason}</Text>
                        <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.spacingReason}</Text>
                        {suggestion.companionMessages.map((message) => (
                          <Text key={`${suggestion.entry.id}-${normalizePlantKey(message)}`} style={[styles.suggestionReason, { color: theme.textMuted }]}>
                            {message}
                          </Text>
                        ))}
                      </View>
                      <Pressable style={[styles.suggestionButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => planInBedMutation.mutate({ entry: suggestion.entry, bedId: card.bed.id })} disabled={planInBedMutation.isPending}><Text style={[styles.suggestionButtonText, { color: theme.secondaryActionText }]}>Plan Here</Text></Pressable>
                    </View>
                  ))
                )}
              </View>

              {showSuggestions && (
                <View style={styles.block}>
                  <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Other options</Text>
                  {card.contraryOptions.length === 0 ? (
                    <Text style={[styles.blockText, { color: theme.textMuted }]}>No extra planned crops available.</Text>
                  ) : (
                    <View style={styles.chips}>
                      {card.contraryOptions.map((entry) => (
                        <Pressable key={entry.id} style={[styles.optionChip, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => planInBedMutation.mutate({ entry, bedId: card.bed.id })} disabled={planInBedMutation.isPending}><Text style={[styles.optionChipText, { color: theme.secondaryActionText }]}>{formatEntryName(entry)}</Text></Pressable>
                      ))}
                    </View>
                  )}
                  <Link href={`/gardens/${gardenId}/grow`} style={[styles.linkText, { color: theme.primaryActionBackground }]}>Add more crops in Grow List</Link>
                </View>
              )}
            </View>
          );
        })}

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Garden Layout</Text>
          <Text style={[styles.meta, { color: theme.textMuted }]}>No image or grid here. This is a clean bed layout.</Text>
          <View style={styles.zoomRow}>
            <Pressable style={[styles.zoomButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => setPreviewZoom((value) => Math.max(0.7, Number((value - 0.1).toFixed(2))))}><Text style={[styles.zoomButtonText, { color: theme.secondaryActionText }]}>-</Text></Pressable>
            <Text style={[styles.zoomText, { color: theme.textPrimary }]}>{Math.round(previewZoom * 100)}%</Text>
            <Pressable style={[styles.zoomButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => setPreviewZoom((value) => Math.min(1.8, Number((value + 0.1).toFixed(2))))}><Text style={[styles.zoomButtonText, { color: theme.secondaryActionText }]}>+</Text></Pressable>
          </View>
          <View onLayout={(event) => {
            const width = Math.floor(event.nativeEvent.layout.width);
            if (width > 0) setPreviewViewportWidth(width);
          }}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <ScrollView showsVerticalScrollIndicator>
                <View style={[styles.previewCanvas, { width: previewWidth, height: previewHeight, borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}>
                  <Svg width={previewWidth} height={previewHeight} style={StyleSheet.absoluteFillObject}>
                    <Path d={`${rectPath(previewWidth, previewHeight)} ${polygonPath(boundary, previewWidth, previewHeight)}`} fill={theme.mapBoundaryFill} fillRule="evenodd" />
                    <Polygon points={toSvgPoints(boundary, previewWidth, previewHeight)} fill="transparent" stroke={theme.mapBoundaryStroke} strokeWidth={2} />
                    {beds.map((bed) => (
                      <Polygon key={`shape-${bed.id}`} points={toSvgPoints(bed.polygon, previewWidth, previewHeight)} fill={theme.mapBedFill} stroke={theme.mapBedStroke} strokeWidth={1.4} />
                    ))}
                  </Svg>
                  {beds.map((bed) => {
                    const center = polygonCenter(bed.polygon);
                    const left = center.x * previewWidth;
                    const top = center.y * previewHeight;
                    const info = bedInfoById.get(bed.id);
                    return (
                      <Pressable key={bed.id} style={[styles.previewPin, { left, top, backgroundColor: theme.primaryActionBackground, borderColor: theme.primaryActionText }]} onPress={() => {
                        if (!info) return;
                        Alert.alert(info.bedName, [
                          info.isPerennialBed ? "Type: perennial bed" : "Type: annual/mixed bed",
                          info.growing.length > 0 ? `Growing: ${info.growing.join(", ")}` : "Growing: none",
                          info.planned.length > 0 ? `Planned: ${info.planned.join(", ")}` : "Planned: none",
                        ].join("\n"));
                      }}>
                        <Text style={[styles.previewPinText, { color: theme.primaryActionText }]}>i</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </ScrollView>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function scoreSuggestion(entry: GardenCropWishlistItemView, bedSunExposure: string): number {
  const meta = parsePlantMeta(entry.plant.metaJson);
  const sunScore = getSunMatchScore(bedSunExposure, meta.sunRequirements);
  const supportScore = entry.supportNeeded ? 0 : 2;
  const spacingScore = typeof meta.rowSpacing === "number" || typeof meta.spread === "number" ? 2 : 0;
  return sunScore + supportScore + spacingScore;
}

function getSunReason(bedSunExposure: string, sunRequirements?: string): string {
  if (!sunRequirements?.trim()) return `Sun fit: unknown for crop (bed is ${formatLabel(bedSunExposure)})`;
  const score = getSunMatchScore(bedSunExposure, sunRequirements);
  if (score >= 20) return `Sun fit: good (${sunRequirements.trim()})`;
  if (score >= 10) return `Sun fit: possible (${sunRequirements.trim()})`;
  return `Sun fit: weak (${sunRequirements.trim()})`;
}

function getSunMatchScore(bedSunExposure: string, sunRequirements?: string): number {
  if (!sunRequirements?.trim()) return 6;
  const bed = bedSunExposure.trim().toLowerCase();
  const req = sunRequirements.trim().toLowerCase();
  if (req.includes("full") && bed.includes("full")) return 26;
  if (req.includes("part") && bed.includes("part")) return 24;
  if (req.includes("shade") && bed.includes("shade")) return 24;
  if ((req.includes("sun") && bed.includes("full")) || (req.includes("part") && bed.includes("full"))) return 15;
  return 5;
}

function getSpacingReason(meta: PlantMeta, fitCount: number | null, areaSqM: number | undefined): string {
  const spacingParts: string[] = [];
  if (typeof meta.rowSpacing === "number" && meta.rowSpacing > 0) spacingParts.push(`row ${Math.round(meta.rowSpacing)}cm`);
  if (typeof meta.spread === "number" && meta.spread > 0) spacingParts.push(`spread ${Math.round(meta.spread)}cm`);
  if (typeof meta.height === "number" && meta.height > 0) spacingParts.push(`height ${Math.round(meta.height)}cm`);

  if (spacingParts.length === 0) return "Size: no row/spread/height data yet";

  const pieces = [`Size: ${spacingParts.join(" - ")}`];
  if (typeof fitCount === "number") {
    pieces.push(`capacity ~${fitCount} plants`);
  } else if (!Number.isFinite(areaSqM) || !areaSqM || areaSqM <= 0) {
    pieces.push("capacity unavailable (set garden scale)");
  } else {
    pieces.push("capacity unavailable (need row/spread)");
  }
  return pieces.join(" - ");
}

function estimateFitCount(areaSqM: number | undefined, meta: PlantMeta): number | null {
  if (!Number.isFinite(areaSqM) || !areaSqM || areaSqM <= 0) return null;
  const spacingCm = Math.max(meta.rowSpacing ?? 0, meta.spread ?? 0);
  if (!Number.isFinite(spacingCm) || spacingCm <= 0) return null;
  const spacingM = spacingCm / 100;
  if (spacingM <= 0) return null;
  const perPlantSqM = spacingM * spacingM;
  if (perPlantSqM <= 0) return null;
  return Math.max(1, Math.floor(areaSqM / perPlantSqM));
}

function parsePlantMeta(metaJson?: string): PlantMeta {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as {
      sun_requirements?: string;
      row_spacing?: number | string;
      spread?: number | string;
      height?: number | string;
      gardenme?: { sunRequirements?: string; rowSpacing?: number | string; spread?: number | string; height?: number | string };
    };
    const sunRequirements = parsed.gardenme?.sunRequirements ?? parsed.sun_requirements;
    const rowSpacing = toNumber(parsed.gardenme?.rowSpacing ?? parsed.row_spacing);
    const spread = toNumber(parsed.gardenme?.spread ?? parsed.spread);
    const height = toNumber(parsed.gardenme?.height ?? parsed.height);
    return {
      ...(sunRequirements ? { sunRequirements } : {}),
      ...(typeof rowSpacing === "number" ? { rowSpacing } : {}),
      ...(typeof spread === "number" ? { spread } : {}),
      ...(typeof height === "number" ? { height } : {}),
    };
  } catch {
    return {};
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function polygonCenter(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function parsePerennialPlants(csv?: string): string[] {
  if (!csv) return [];
  return Array.from(new Set(csv.split(",").map((value) => value.trim()).filter(Boolean)));
}

function normalizePlantName(value: string): string {
  return value.trim().toLowerCase();
}

function formatEntryName(entry: GardenCropWishlistItemView): string {
  const base = entry.plant.commonName.trim();
  if (entry.varietyName?.trim()) return `${base} (${entry.varietyName.trim()})`;
  return base;
}

function formatHistoryName(row: GardenCropPlantingHistoryItem): string {
  const base = row.plant.commonName.trim();
  if (row.varietyName?.trim()) return `${base} (${row.varietyName.trim()})`;
  return base;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function formatEndStateLabel(value: PlantingEndState): string {
  if (value === "harvested") return "Harvested";
  if (value === "done") return "Finished";
  return "Lost";
}

function toSvgPoints(points: { x: number; y: number }[], width: number, height: number): string {
  return points.map((point) => `${point.x * width},${point.y * height}`).join(" ");
}

function rectPath(width: number, height: number): string {
  return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
}

function polygonPath(points: { x: number; y: number }[], width: number, height: number): string {
  if (points.length < 3) return "";
  const first = points[0]!;
  const start = `M ${first.x * width} ${first.y * height}`;
  const lines = points.slice(1).map((point) => `L ${point.x * width} ${point.y * height}`).join(" ");
  return `${start} ${lines} Z`;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F0F6EE" },
  container: { padding: 14, gap: 10, paddingBottom: 28 },
  title: { fontSize: 26, fontWeight: "800", color: "#1D3D2A" },
  subtitle: { color: "#4A6553", marginTop: -2 },
  empty: { color: "#54645A" },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D8E5D5",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#274634" },
  meta: { color: "#587261", fontSize: 13 },
  block: { gap: 6 },
  blockTitle: { color: "#254432", fontWeight: "700", fontSize: 13 },
  blockText: { color: "#587261", fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  growingRow: { gap: 6, borderWidth: 1, borderColor: "#DDE9DA", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  growingMain: { gap: 2 },
  growingName: { color: "#1E3E2E", fontWeight: "700" },
  finishChip: { backgroundColor: "#E7EFE5", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  finishChipText: { color: "#2A5E40", fontWeight: "700", fontSize: 12 },
  finishChipDanger: { backgroundColor: "#F3E5E2", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  finishChipDangerText: { color: "#8C3A2D", fontWeight: "700", fontSize: 12 },
  historyHeader: { backgroundColor: "#F4F8F2", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  historyRow: { borderWidth: 1, borderColor: "#E2EBDF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  historyName: { color: "#274634", fontWeight: "700" },
  historyMeta: { color: "#587261", fontSize: 12 },
  toggleChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#DFEADF" },
  toggleChipActive: { backgroundColor: "#2F6F4F" },
  toggleChipText: { color: "#2D4B3C", fontWeight: "700" },
  toggleChipTextActive: { color: "#FFFFFF" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  planChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EAF2E7", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  planChipText: { color: "#2A5E40", fontWeight: "700", fontSize: 12 },
  planChipPlantButton: { backgroundColor: "#D7E8D8", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  planChipPlantButtonText: { color: "#1F5A3B", fontWeight: "700", fontSize: 11 },
  planChipButton: { backgroundColor: "#F3E5E2", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  planChipButtonText: { color: "#8C3A2D", fontWeight: "700", fontSize: 11 },
  suggestionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderWidth: 1, borderColor: "#DDE9DA", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  suggestionMain: { flex: 1, gap: 2 },
  suggestionName: { color: "#1E3E2E", fontWeight: "700" },
  suggestionReason: { color: "#597363", fontSize: 12 },
  suggestionButton: { backgroundColor: "#E7EFE5", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  suggestionButtonText: { color: "#2A5E40", fontWeight: "700", fontSize: 12 },
  optionChip: { backgroundColor: "#D9E7D8", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  optionChipText: { color: "#264433", textTransform: "capitalize", fontSize: 12 },
  linkText: { color: "#2A5E40", fontWeight: "700", marginTop: 2 },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  zoomButton: { backgroundColor: "#DFEADF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  zoomButtonText: { fontSize: 18, fontWeight: "700", color: "#23412E" },
  zoomText: { minWidth: 52, textAlign: "center", fontWeight: "700", color: "#375947" },
  previewCanvas: { borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#C5D4C5", backgroundColor: "#E5EDE4", position: "relative" },
  previewPin: { position: "absolute", width: 20, height: 20, borderRadius: 10, marginLeft: -10, marginTop: -10, backgroundColor: "#1E6A42", borderWidth: 1, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  previewPinText: { color: "#FFFFFF", fontWeight: "800", fontSize: 11 },
});
