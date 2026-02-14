
import { Link, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { BedPlanPreview } from "@/features/garden-mapping/components/BedPlanPreview";
import { loadGardenBedPlannerSettings, saveGardenBedPlannerSettings, type GardenBedPlannerSettings } from "@/core/settings/gardenBedPlannerSettings";
import { loadBedPhotoLogSettings, saveBedPhotoLogSettings, type BedPhotoLogEntry, type BedPhotoLogSettings } from "@/core/settings/bedPhotoLogSettings";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { SqliteCompanionPlantingRepository } from "@/infra/repositories/sqlite/SqliteCompanionPlantingRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { polygonArea } from "@/features/garden-mapping/utils/geometry";
import { getCompanionMatchSummary, normalizePlantKey } from "@/features/plants/services/companionMatching";
import { queryClient } from "@/state/queryClient";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { SegmentedChoice } from "@/ui/components/SegmentedChoice";
import { StatusChip } from "@/ui/components/StatusChip";
import { AppButton } from "@/ui/components/AppButton";
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
  diseaseReason: string;
  rotationReason: string;
  sunReason: string;
  spacingReason: string;
  companionMessages: string[];
  companionGoodCount: number;
  companionAvoidCount: number;
  score: number;
  scoreLabel: string;
  confidenceLabel: string;
  scoreComponents: Array<{ label: string; value: number }>;
  scoreBreakdown: string[];
  fitCount?: number;
};

type WhyNotCandidate = {
  entry: GardenCropWishlistItemView;
  scoreLabel: string;
  reason: string;
};

type ActiveGrowingRow = {
  entry: GardenCropWishlistItemView;
  plantedAt?: string;
  plantingId?: string;
};

type EntrySnapshot = {
  id: string;
  status: "wanted" | "already_growing";
  bedId?: string;
  isPerennial: boolean;
  varietyName?: string;
  supportNeeded: boolean;
  quantity: number;
};

type UndoToastState = {
  label: string;
  action: () => Promise<void>;
};

type FinishDialogState = {
  entry: GardenCropWishlistItemView;
  bedId?: string;
  endState: PlantingEndState;
  keepInBed: boolean;
  goodHarvest: boolean;
  fertilized: boolean;
  bugsObserved: boolean;
  bugName: string;
  diseaseObserved: boolean;
  diseaseName: string;
  notes: string;
};

type PhotoViewerState = {
  photo: BedPhotoLogEntry;
  bedName: string;
};

type PlannerMode = "list" | "visual";

const MAX_SUGGESTIONS_PER_BED = 2;

export default function BedsListScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;
  const [hasSpareSpaceByBed, setHasSpareSpaceByBed] = useState<Record<string, boolean>>({});
  const [historyExpandedByBed, setHistoryExpandedByBed] = useState<Record<string, boolean>>({});
  const [bedExpandedById, setBedExpandedById] = useState<Record<string, boolean>>({});
  const [scoreExpandedByKey, setScoreExpandedByKey] = useState<Record<string, boolean>>({});
  const [rejectedSuggestionIdsByBed, setRejectedSuggestionIdsByBed] = useState<Record<string, string[]>>({});
  const [dismissedSpaceWarningSig, setDismissedSpaceWarningSig] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToastState | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [finishDialog, setFinishDialog] = useState<FinishDialogState | null>(null);
  const [photoViewer, setPhotoViewer] = useState<PhotoViewerState | null>(null);
  const [photoNotesInputFocused, setPhotoNotesInputFocused] = useState(false);
  const [plannerMode, setPlannerMode] = useState<PlannerMode>("list");
  const [selectedVisualBedId, setSelectedVisualBedId] = useState<string | null>(null);
  const [plannerSettingsHydratedGardenId, setPlannerSettingsHydratedGardenId] = useState<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const bedPlannerSettingsQuery = useQuery({
    queryKey: ["garden-bed-planner-settings"],
    queryFn: loadGardenBedPlannerSettings,
  });
  const bedPhotoLogSettingsQuery = useQuery({
    queryKey: ["bed-photo-log-settings"],
    queryFn: loadBedPhotoLogSettings,
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
    mutationFn: async (payload: { entryId: string; endState: PlantingEndState; notes?: string }) => {
      await wishlistRepository.finishPlanting(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["garden-plantings", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
    },
  });

  const plantAllInBedMutation = useMutation({
    mutationFn: async (payload: { entries: GardenCropWishlistItemView[]; bedId: string }) => {
      for (const entry of payload.entries) {
        await wishlistRepository.markPlanted({ entryId: entry.id, bedId: payload.bedId });
      }
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

  const updateBedPerennialMutation = useMutation({
    mutationFn: async (payload: { bedId: string; containsPerennials: boolean }) => {
      const bed = (bedsQuery.data ?? []).find((item) => item.id === payload.bedId);
      if (!bed) throw new Error("Bed not found");
      await bedRepository.update({
        ...bed,
        containsPerennials: payload.containsPerennials,
        updatedAt: new Date().toISOString(),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
    },
  });

  const invalidateBedsQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
    await queryClient.invalidateQueries({ queryKey: ["garden-plantings", gardenId] });
    await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
  };

  const queueUndoToast = (label: string, action: () => Promise<void>) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ label, action });
    undoTimerRef.current = setTimeout(() => {
      setUndoToast(null);
      undoTimerRef.current = null;
    }, 6500);
  };

  const entrySnapshot = (entry: GardenCropWishlistItemView): EntrySnapshot => ({
    id: entry.id,
    status: entry.status,
    ...(entry.bedId ? { bedId: entry.bedId } : {}),
    isPerennial: entry.isPerennial,
    ...(entry.varietyName ? { varietyName: entry.varietyName } : {}),
    supportNeeded: entry.supportNeeded,
    quantity: entry.quantity,
  });

  const handleUndoPress = async () => {
    if (!undoToast || undoPending) return;
    setUndoPending(true);
    try {
      await undoToast.action();
      setUndoToast(null);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    } catch {
      Alert.alert("Undo failed", "Could not undo that action.");
    } finally {
      setUndoPending(false);
    }
  };

  const handleClearPlan = async (entry: GardenCropWishlistItemView) => {
    const snapshot = entrySnapshot(entry);
    try {
      await clearPlanMutation.mutateAsync(entry);
      queueUndoToast(`Cleared ${formatEntryName(entry)}`, async () => {
        await wishlistRepository.update({
          id: snapshot.id,
          status: snapshot.status,
          ...(snapshot.bedId ? { bedId: snapshot.bedId } : {}),
          isPerennial: snapshot.isPerennial,
          varietyName: snapshot.varietyName ?? "",
          supportNeeded: snapshot.supportNeeded,
          quantity: snapshot.quantity,
        });
        await invalidateBedsQueries();
      });
    } catch {
      Alert.alert("Could not clear", "Please try again.");
    }
  };

  const handleMarkPlanted = async (entry: GardenCropWishlistItemView, bedId: string) => {
    const snapshot = entrySnapshot(entry);
    try {
      await markPlantedMutation.mutateAsync({ entryId: entry.id, bedId });
      queueUndoToast(`Marked ${formatEntryName(entry)} as planted`, async () => {
        await wishlistRepository.undoMarkPlanted({
          entryId: snapshot.id,
          previousStatus: snapshot.status,
          ...(snapshot.bedId ? { previousBedId: snapshot.bedId } : {}),
          previousIsPerennial: snapshot.isPerennial,
          ...(snapshot.varietyName ? { previousVarietyName: snapshot.varietyName } : {}),
          previousSupportNeeded: snapshot.supportNeeded,
          previousQuantity: snapshot.quantity,
        });
        await invalidateBedsQueries();
      });
    } catch {
      Alert.alert("Could not mark planted", "Please try again.");
    }
  };

  const openFinishDialog = (row: ActiveGrowingRow, endState: PlantingEndState) => {
    setFinishDialog({
      entry: row.entry,
      ...(row.entry.bedId ? { bedId: row.entry.bedId } : {}),
      endState,
      keepInBed: false,
      goodHarvest: endState === "harvested",
      fertilized: false,
      bugsObserved: false,
      bugName: "",
      diseaseObserved: false,
      diseaseName: "",
      notes: "",
    });
  };

  const handleFinishPlanting = async (row: ActiveGrowingRow, endState: PlantingEndState, options?: {
    keepInBed?: boolean;
    notes?: string;
  }) => {
    const snapshot = entrySnapshot(row.entry);
    const plantingId = row.plantingId;
    try {
      await finishPlantingMutation.mutateAsync({
        entryId: row.entry.id,
        endState,
        ...(options?.notes ? { notes: options.notes } : {}),
      });
      if (options?.keepInBed && row.entry.bedId) {
        await markPlantedMutation.mutateAsync({ entryId: row.entry.id, bedId: row.entry.bedId });
      }
      if (!plantingId || options?.keepInBed) return;
      queueUndoToast(`${formatEntryName(row.entry)} set to ${formatEndStateLabel(endState).toLowerCase()}`, async () => {
        await wishlistRepository.undoFinishPlanting({
          entryId: snapshot.id,
          plantingId,
          previousStatus: snapshot.status,
          ...(snapshot.bedId ? { previousBedId: snapshot.bedId } : {}),
          previousIsPerennial: snapshot.isPerennial,
          ...(snapshot.varietyName ? { previousVarietyName: snapshot.varietyName } : {}),
          previousSupportNeeded: snapshot.supportNeeded,
          previousQuantity: snapshot.quantity,
        });
        await invalidateBedsQueries();
      });
    } catch {
      Alert.alert("Could not update planting", "Please try again.");
    }
  };

  const submitFinishDialog = async () => {
    if (!finishDialog) return;
    const row = bedCards
      .flatMap((card) => card.activeGrowingRows)
      .find((candidate) => candidate.entry.id === finishDialog.entry.id);
    if (!row) {
      setFinishDialog(null);
      return;
    }

    const notesParts: string[] = [];
    if (finishDialog.endState === "harvested") notesParts.push(`good_harvest:${finishDialog.goodHarvest ? "yes" : "no"}`);
    notesParts.push(`fertilized:${finishDialog.fertilized ? "yes" : "no"}`);
    notesParts.push(`bugs_observed:${finishDialog.bugsObserved ? "yes" : "no"}`);
    if (finishDialog.bugsObserved && finishDialog.bugName.trim()) notesParts.push(`bugs:${finishDialog.bugName.trim()}`);
    const normalizedDisease = normalizeDiseaseKey(finishDialog.diseaseName);
    notesParts.push(`disease_observed:${finishDialog.diseaseObserved ? "yes" : "no"}`);
    if (finishDialog.diseaseObserved && finishDialog.diseaseName.trim()) notesParts.push(`disease:${finishDialog.diseaseName.trim()}`);
    if (finishDialog.diseaseObserved && normalizedDisease) notesParts.push(`disease_key:${normalizedDisease}`);
    if (finishDialog.notes.trim()) notesParts.push(`notes:${finishDialog.notes.trim()}`);

    await handleFinishPlanting(row, finishDialog.endState, {
      keepInBed: finishDialog.keepInBed,
      notes: notesParts.join(" | "),
    });
    setFinishDialog(null);
  };

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

    const draftCards = beds.map((bed) => {
      const growingInBed = growingByBed.get(bed.id) ?? [];
      const plannedInBed = plannedByBed.get(bed.id) ?? [];
      const perennialNames = parsePerennialPlants(bed.perennialPlantsCsv);
      const areaSqM = areaByBed.get(bed.id);
      const historicalRows = historicalByBedId.get(bed.id) ?? [];
      const diseaseProfile = buildBedDiseaseProfile(historicalRows);
      const rotationProfile = buildBedRotationProfile(historicalRows);

      const activeGrowingRows: ActiveGrowingRow[] = growingInBed.map((entry) => {
        const activePlanting = activePlantingByEntryId.get(entry.id);
        return {
          entry,
          ...(activePlanting?.plantedAt ? { plantedAt: activePlanting.plantedAt } : {}),
          ...(activePlanting?.id ? { plantingId: activePlanting.id } : {}),
        };
      });

      const growingNames = Array.from(new Set([...activeGrowingRows.map((row) => formatEntryName(row.entry)), ...perennialNames]));
      const plannedNames = plannedInBed.map((entry) => formatEntryName(entry));
      const companionContextNames = Array.from(new Set([...growingNames, ...plannedNames]));
      const excludedNames = new Set<string>(growingNames.map(normalizePlantName));
      const alreadyPlannedIds = new Set(plannedInBed.map((entry) => entry.id));

      const rankedCandidates = plannedPool
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
          const scoreParts = scoreSuggestion({
            entry,
            bedSunExposure: bed.sunExposure,
            companionDelta: companion.scoreDelta,
            fitCount,
            meta,
            diseaseProfile,
            rotationProfile,
          });
          return {
            entry,
            diseaseReason: getDiseaseReason(entry, diseaseProfile),
            rotationReason: getRotationReason(entry, rotationProfile),
            sunReason: getSunReason(bed.sunExposure, meta.sunRequirements),
            spacingReason: getSpacingReason(meta, fitCount, areaSqM),
            companionMessages: companion.messages,
            companionGoodCount: companion.goodCount,
            companionAvoidCount: companion.avoidCount,
            score: scoreParts.total,
            scoreLabel: getScoreLabel(scoreParts.total),
            confidenceLabel: scoreParts.confidenceLabel,
            scoreComponents: scoreParts.components,
            scoreBreakdown: scoreParts.breakdown,
            ...(typeof fitCount === "number" ? { fitCount } : {}),
          };
        })
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          return a.entry.plant.commonName.localeCompare(b.entry.plant.commonName, undefined, { sensitivity: "base" });
        });

      return {
        bed,
        areaSqM,
        growingNames,
        activeGrowingRows,
        plannedInBed,
        rankedCandidates,
        diseaseProfile,
        historicalRows,
      };
    });

    const globallySuggestedEntryIds = new Set<string>();
    return draftCards.map((card) => {
      const suggestions: BedSuggestion[] = [];
      const rejectedIds = new Set(rejectedSuggestionIdsByBed[card.bed.id] ?? []);
      for (const candidate of card.rankedCandidates) {
        if (suggestions.length >= MAX_SUGGESTIONS_PER_BED) break;
        if (rejectedIds.has(candidate.entry.id)) continue;
        if (globallySuggestedEntryIds.has(candidate.entry.id)) continue;
        suggestions.push(candidate);
        globallySuggestedEntryIds.add(candidate.entry.id);
      }

      const localSuggestionIds = new Set(suggestions.map((item) => item.entry.id));
      const contraryOptions = card.rankedCandidates
        .filter((candidate) => !localSuggestionIds.has(candidate.entry.id))
        .slice(0, 6)
        .map((candidate) => candidate.entry);
      const allOtherOptions = card.rankedCandidates
        .filter((candidate) => !localSuggestionIds.has(candidate.entry.id))
        .map((candidate) => candidate.entry);
      const whyNot: WhyNotCandidate[] = card.rankedCandidates
        .filter((candidate) => !rejectedIds.has(candidate.entry.id))
        .filter((candidate) => !localSuggestionIds.has(candidate.entry.id))
        .slice(0, 4)
        .map((candidate) => ({
          entry: candidate.entry,
          scoreLabel: candidate.scoreLabel,
          reason: getWhyNotReason(candidate),
        }));

      return {
        bed: card.bed,
        areaSqM: card.areaSqM,
        growingNames: card.growingNames,
        activeGrowingRows: card.activeGrowingRows,
        plannedInBed: card.plannedInBed,
        suggestions,
        rejectedSuggestionIds: Array.from(rejectedIds),
        contraryOptions,
        allOtherOptions,
        whyNot,
        candidateEntryIds: card.rankedCandidates.map((candidate) => candidate.entry.id),
        diseaseProfile: card.diseaseProfile,
        historicalRows: card.historicalRows,
      };
    });
  }, [beds, companionRelations, gardenQuery.data?.scaleCalibration, plannedPool, wishlist, activePlantingByEntryId, historicalByBedId, rejectedSuggestionIdsByBed]);

  useEffect(() => {
    if (bedCards.length === 0) {
      setSelectedVisualBedId(null);
      return;
    }
    if (!selectedVisualBedId || !bedCards.some((card) => card.bed.id === selectedVisualBedId)) {
      setSelectedVisualBedId(bedCards[0]?.bed.id ?? null);
    }
  }, [bedCards, selectedVisualBedId]);

  useEffect(() => {
    if (!gardenId) {
      setPlannerSettingsHydratedGardenId(null);
      return;
    }
    if (!bedPlannerSettingsQuery.isSuccess) return;
    if (plannerSettingsHydratedGardenId === gardenId) return;
    const saved = bedPlannerSettingsQuery.data?.[gardenId] ?? {};
    setHasSpareSpaceByBed(saved.spareSpaceByBedId ?? {});
    setRejectedSuggestionIdsByBed(saved.rejectedSuggestionIdsByBed ?? {});
    setPlannerSettingsHydratedGardenId(gardenId);
  }, [gardenId, bedPlannerSettingsQuery.data, bedPlannerSettingsQuery.isSuccess, plannerSettingsHydratedGardenId]);

  useEffect(() => {
    if (!gardenId || plannerSettingsHydratedGardenId !== gardenId) return;
    void (async () => {
      const cached = queryClient.getQueryData<GardenBedPlannerSettings>(["garden-bed-planner-settings"]);
      const current = cached ?? (await loadGardenBedPlannerSettings());
      const existing = current[gardenId] ?? {};
      const next: GardenBedPlannerSettings = {
        ...current,
        [gardenId]: {
          ...existing,
          spareSpaceByBedId: hasSpareSpaceByBed,
          rejectedSuggestionIdsByBed,
        },
      };
      await saveGardenBedPlannerSettings(next);
      queryClient.setQueryData(["garden-bed-planner-settings"], next);
    })();
  }, [gardenId, plannerSettingsHydratedGardenId, hasSpareSpaceByBed, rejectedSuggestionIdsByBed]);

  useEffect(() => {
    if (bedCards.length === 0) return;
    const savedByBed = gardenId
      ? bedPlannerSettingsQuery.data?.[gardenId]?.spareSpaceByBedId ?? {}
      : {};
    setHasSpareSpaceByBed((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const card of bedCards) {
        const savedValue = savedByBed[card.bed.id];
        if (typeof savedValue === "boolean") {
          if (next[card.bed.id] !== savedValue) {
            next[card.bed.id] = savedValue;
            changed = true;
          }
          continue;
        }
        if (next[card.bed.id] === undefined) {
          next[card.bed.id] = card.growingNames.length === 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [bedCards, bedPlannerSettingsQuery.data, gardenId]);

  useEffect(() => {
    if (bedCards.length === 0) return;
    setBedExpandedById((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const card of bedCards) {
        if (next[card.bed.id] === undefined) {
          next[card.bed.id] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [bedCards]);

  useEffect(() => {
    if (bedCards.length === 0) return;
    setRejectedSuggestionIdsByBed((prev) => {
      let changed = false;
      const next: Record<string, string[]> = { ...prev };
      for (const card of bedCards) {
        const validIds = new Set(card.candidateEntryIds);
        const existing = next[card.bed.id] ?? [];
        const filtered = existing.filter((id) => validIds.has(id));
        if (filtered.length !== existing.length) {
          next[card.bed.id] = filtered;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [bedCards]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const rejectSuggestion = (bedId: string, entryId: string) => {
    setRejectedSuggestionIdsByBed((prev) => {
      const existing = prev[bedId] ?? [];
      if (existing.includes(entryId)) return prev;
      return { ...prev, [bedId]: [entryId, ...existing] };
    });
  };

  const clearRejectedSuggestionsForBed = (bedId: string) => {
    setRejectedSuggestionIdsByBed((prev) => {
      if (!prev[bedId] || prev[bedId].length === 0) return prev;
      return { ...prev, [bedId]: [] };
    });
  };

  const setSpareSpace = (bedId: string, hasSpare: boolean) => {
    setHasSpareSpaceByBed((prev) => {
      if (prev[bedId] === hasSpare) return prev;
      return { ...prev, [bedId]: hasSpare };
    });
  };

  const bedPreviewInfoById = useMemo(() => {
    const map: Record<string, { bedName: string; lines: string[] }> = {};
    for (const card of bedCards) {
      const hasExistingPlants = card.growingNames.length > 0;
      const hasSpareSpace = hasSpareSpaceByBed[card.bed.id] ?? false;
      const showSuggestions = !hasExistingPlants || hasSpareSpace;
      const growing = card.growingNames;
      const planned = card.plannedInBed.map((entry) => formatEntryName(entry));
      const suggestions = showSuggestions ? card.suggestions.map((entry) => formatEntryName(entry.entry)) : [];
      map[card.bed.id] = {
        bedName: card.bed.name,
        lines: [
          growing.length > 0 ? `Growing: ${growing.join(", ")}` : "Growing: none",
          planned.length > 0 ? `Planned: ${planned.join(", ")}` : "Planned: none",
          ...(suggestions.length > 0 ? [`Suggestions: ${suggestions.join(", ")}`] : []),
        ],
      };
    }
    return map;
  }, [bedCards, hasSpareSpaceByBed]);

  const bedStatusById = useMemo(() => {
    const map: Record<string, { growingCount: number; plannedCount: number; suggestionCount: number }> = {};
    for (const card of bedCards) {
      const hasExistingPlants = card.growingNames.length > 0;
      const hasSpareSpace = hasSpareSpaceByBed[card.bed.id] ?? false;
      const showSuggestions = !hasExistingPlants || hasSpareSpace;
      map[card.bed.id] = {
        growingCount: card.activeGrowingRows.length,
        plannedCount: card.plannedInBed.length,
        suggestionCount: showSuggestions ? card.suggestions.length : 0,
      };
    }
    return map;
  }, [bedCards, hasSpareSpaceByBed]);

  const bedPlantDotsById = useMemo(() => {
    const map: Record<string, { plantedCount: number; perennialCount: number; plannedCount: number }> = {};
    for (const card of bedCards) {
      const plantedCount = card.activeGrowingRows.length;
      const perennialCount = card.activeGrowingRows.filter((row) => row.entry.isPerennial).length;
      const plannedCount = card.plannedInBed.length;
      map[card.bed.id] = { plantedCount, perennialCount, plannedCount };
    }
    return map;
  }, [bedCards]);

  const bedPhotoRowsByBedId = useMemo(() => {
    const map = new Map<string, BedPhotoLogEntry[]>();
    if (!gardenId) return map;
    const rows = bedPhotoLogSettingsQuery.data?.[gardenId] ?? [];
    for (const row of rows) {
      const existing = map.get(row.bedId) ?? [];
      existing.push(row);
      map.set(row.bedId, existing);
    }
    for (const [bedId, rowsForBed] of map.entries()) {
      rowsForBed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      map.set(bedId, rowsForBed);
    }
    return map;
  }, [bedPhotoLogSettingsQuery.data, gardenId]);

  const addBedPhoto = async (bedId: string, source: "camera" | "gallery") => {
    if (!gardenId) return;
    if (source === "camera") {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (!cameraPermission.granted) {
        Alert.alert("Camera permission needed", "Enable camera access to take a bed photo.");
        return;
      }
    } else {
      const galleryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!galleryPermission.granted) {
        Alert.alert("Photos permission needed", "Enable photo library access to attach bed photos.");
        return;
      }
    }

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.85,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsMultipleSelection: false,
            quality: 0.85,
          });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    const cached = queryClient.getQueryData<BedPhotoLogSettings>(["bed-photo-log-settings"]);
    const current = cached ?? (await loadBedPhotoLogSettings());
    const nextRow: BedPhotoLogEntry = {
      id: `bed-photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      bedId,
      uri: asset.uri,
      source,
      createdAt: new Date().toISOString(),
    };
    const next: BedPhotoLogSettings = {
      ...current,
      [gardenId]: [nextRow, ...(current[gardenId] ?? [])],
    };
    await saveBedPhotoLogSettings(next);
    queryClient.setQueryData(["bed-photo-log-settings"], next);
  };

  const deleteBedPhoto = async (bedId: string, photoId: string) => {
    if (!gardenId) return;
    Alert.alert(
      "Delete Photo",
      "Remove this photo from the bed log?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: async () => {
            const cached = queryClient.getQueryData<BedPhotoLogSettings>(["bed-photo-log-settings"]);
            const current = cached ?? (await loadBedPhotoLogSettings());
            const currentPhotos = current[gardenId] ?? [];
            const filteredPhotos = currentPhotos.filter(photo => photo.id !== photoId);
            const next: BedPhotoLogSettings = {
              ...current,
              [gardenId]: filteredPhotos,
            };
            await saveBedPhotoLogSettings(next);
            queryClient.setQueryData(["bed-photo-log-settings"], next);
          }
        }
      ]
    );
  };

  const updatePhotoNotes = async (photoId: string, notes: string) => {
    if (!gardenId) return;
    const cached = queryClient.getQueryData<BedPhotoLogSettings>(["bed-photo-log-settings"]);
    const current = cached ?? (await loadBedPhotoLogSettings());
    const currentPhotos = current[gardenId] ?? [];
    const updatedPhotos = currentPhotos.map(photo => 
      photo.id === photoId ? { ...photo, notes: notes.trim() || undefined } : photo
    );
    const next: BedPhotoLogSettings = {
      ...current,
      [gardenId]: updatedPhotos,
    };
    await saveBedPhotoLogSettings(next);
    queryClient.setQueryData(["bed-photo-log-settings"], next);
  };

  const openPhotoViewer = (photo: BedPhotoLogEntry, bedName: string) => {
    setPhotoViewer({ photo, bedName });
  };

  const selectedVisualCard = useMemo(
    () => bedCards.find((card) => card.bed.id === selectedVisualBedId) ?? null,
    [bedCards, selectedVisualBedId]
  );

  const growListCount = wishlist.length;
  const plannedCount = wishlist.filter((item) => item.status === "wanted" && Boolean(item.bedId)).length;
  const plantedCount = wishlist.filter((item) => item.status === "already_growing").length;
  const unplannedCount = wishlist.filter((item) => item.status === "wanted" && !item.bedId).length;

  const spaceWarning = useMemo(() => {
    const overBeds: string[] = [];
    for (const card of bedCards) {
      if (card.bed.containsPerennials) continue;
      if (!Number.isFinite(card.areaSqM) || !card.areaSqM || card.areaSqM <= 0) continue;
      const entries = [...card.activeGrowingRows.map((row) => row.entry), ...card.plannedInBed];
      let requiredAreaSqM = 0;
      let trackedEntries = 0;
      for (const entry of entries) {
        const required = estimateRequiredAreaSqM(entry);
        if (!required) continue;
        requiredAreaSqM += required;
        trackedEntries += 1;
      }
      if (trackedEntries === 0) continue;
      if (requiredAreaSqM > card.areaSqM * 1.05) overBeds.push(card.bed.name);
    }
    const signature = overBeds.join("|");
    return { overBeds, signature };
  }, [bedCards]);

  const showSpaceWarning = spaceWarning.overBeds.length > 0 && dismissedSpaceWarningSig !== spaceWarning.signature;

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Bed Planner</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>Review beds and place crops from your grow list.</Text>
        <View style={styles.statsRow}>
          <StatusChip label={`Grow list ${growListCount}`} />
          <StatusChip label={`Planned ${plannedCount}`} />
          <StatusChip label={`Planted ${plantedCount}`} />
          <StatusChip label={`Unplanned ${unplannedCount}`} />
        </View>
        <SegmentedChoice
          options={[
            { id: "list", label: "List" },
            { id: "visual", label: "Visual" }
          ]}
          selectedId={plannerMode}
          onSelect={(mode) => setPlannerMode(mode as PlannerMode)}
        />
        {showSpaceWarning && (
          <View style={[styles.warningCard, { backgroundColor: theme.dangerActionBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.warningText, { color: theme.dangerActionText }]}>
              Potential over-capacity: {spaceWarning.overBeds.join(", ")}
            </Text>
            <View style={styles.warningActions}>
              <Pressable
                style={[styles.smallActionButton, { backgroundColor: theme.appBackground }]}
                onPress={() => setDismissedSpaceWarningSig(spaceWarning.signature)}
              >
                <Text style={[styles.smallActionButtonText, { color: theme.textPrimary }]}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        )}

        {bedsQuery.isLoading && <Text style={[styles.empty, { color: theme.textMuted }]}>Loading beds...</Text>}
        {bedsQuery.isError && <Text style={[styles.empty, { color: theme.textMuted }]}>Could not load beds.</Text>}
        {!bedsQuery.isLoading && !bedsQuery.isError && bedCards.length === 0 && (
          <Text style={[styles.empty, { color: theme.textMuted }]}>No beds yet. Add beds in Garden Design.</Text>
        )}

        {plannerMode === "list" && bedCards.map((card) => {
          const hasExistingPlants = card.growingNames.length > 0;
          const hasSpareSpace = hasSpareSpaceByBed[card.bed.id] ?? false;
          const showSuggestions = !hasExistingPlants || hasSpareSpace;
          const historyExpanded = Boolean(historyExpandedByBed[card.bed.id]);
          const bedExpanded = Boolean(bedExpandedById[card.bed.id]);
          const rejectedCount = card.rejectedSuggestionIds.length;

          return (
            <View key={card.bed.id} style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
              <Pressable
                style={[styles.bedHeader, { backgroundColor: theme.appBackground, borderColor: theme.borderColor }]}
                onPress={() => setBedExpandedById((prev) => ({ ...prev, [card.bed.id]: !bedExpanded }))}
              >
                <View style={styles.bedHeaderMain}>
                  <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{card.bed.name}</Text>
                  <Text style={[styles.meta, { color: theme.textMuted }]}>
                    {card.activeGrowingRows.length} growing - {card.plannedInBed.length} planned{showSuggestions ? ` - ${card.suggestions.length} suggestions` : ""}
                  </Text>
                </View>
                <Text style={[styles.bedHeaderCaret, { color: theme.textMuted }]}>{bedExpanded ? "v" : ">"}</Text>
              </Pressable>
              {card.diseaseProfile.diseases.length > 0 && (
                <View style={[styles.diseaseBanner, { backgroundColor: theme.dangerActionBackground }]}>
                  <Text style={[styles.diseaseBannerText, { color: theme.dangerActionText }]}>
                    Disease history: {card.diseaseProfile.diseases.join(", ")}
                  </Text>
                </View>
              )}
              {bedExpanded && (
                <>
              <Text style={[styles.meta, { color: theme.textMuted }]}>Sun: {formatLabel(card.bed.sunExposure)} - Drainage: {formatLabel(card.bed.drainage)}</Text>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: theme.textMuted }]}>Perennial bed</Text>
                <SimpleToggle
                  value={card.bed.containsPerennials}
                  onToggle={(value) => updateBedPerennialMutation.mutate({ bedId: card.bed.id, containsPerennials: value })}
                  disabled={updateBedPerennialMutation.isPending}
                />
              </View>
              <Text style={[styles.meta, { color: theme.textMuted }]}>
                {typeof card.areaSqM === "number" ? `Area ~${card.areaSqM.toFixed(1)} sqm` : "Area unavailable (set garden scale)"}
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
                      <Pressable style={[styles.finishChip, { backgroundColor: theme.secondaryActionBackground }]} disabled={finishPlantingMutation.isPending} onPress={() => openFinishDialog(row, "harvested")}><Text style={[styles.finishChipText, { color: theme.secondaryActionText }]}>Harvested</Text></Pressable>
                      <Pressable style={[styles.finishChip, { backgroundColor: theme.secondaryActionBackground }]} disabled={finishPlantingMutation.isPending} onPress={() => openFinishDialog(row, "done")}><Text style={[styles.finishChipText, { color: theme.secondaryActionText }]}>Done</Text></Pressable>
                      <Pressable style={[styles.finishChipDanger, { backgroundColor: theme.dangerActionBackground }]} disabled={finishPlantingMutation.isPending} onPress={() => openFinishDialog(row, "dead")}><Text style={[styles.finishChipDangerText, { color: theme.dangerActionText }]}>Lost</Text></Pressable>
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
                  <View style={styles.toggleRow}>
                    <Text style={[styles.toggleLabel, { color: theme.textMuted }]}>Spare space</Text>
                    <SimpleToggle
                      value={hasSpareSpace}
                      onToggle={(value) => setSpareSpace(card.bed.id, value)}
                    />
                  </View>
                </View>
              )}

              {card.plannedInBed.length > 0 && (
                <View style={styles.block}>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Planned for this bed</Text>
                    {card.plannedInBed.length > 1 && (
                      <Pressable
                        style={[styles.smallActionButton, { backgroundColor: theme.primaryActionBackground }]}
                        onPress={() => plantAllInBedMutation.mutate({ entries: card.plannedInBed, bedId: card.bed.id })}
                        disabled={plantAllInBedMutation.isPending}
                      >
                        <Text style={[styles.smallActionButtonText, { color: theme.primaryActionText }]}>Plant all</Text>
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.chips}>
                    {card.plannedInBed.map((entry) => (
                      <View key={entry.id} style={[styles.planChip, { backgroundColor: theme.secondaryActionBackground }]}>
                        <Text style={[styles.planChipText, { color: theme.secondaryActionText }]}>{formatEntryName(entry)}</Text>
                        <Pressable style={[styles.planChipPlantButton, { backgroundColor: theme.primaryActionBackground }]} onPress={() => handleMarkPlanted(entry, card.bed.id)} disabled={markPlantedMutation.isPending}><Text style={[styles.planChipPlantButtonText, { color: theme.primaryActionText }]}>Planted</Text></Pressable>
                        <Pressable style={[styles.planChipButton, { backgroundColor: theme.dangerActionBackground }]} onPress={() => handleClearPlan(entry)} disabled={clearPlanMutation.isPending}><Text style={[styles.planChipButtonText, { color: theme.dangerActionText }]}>Clear</Text></Pressable>
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
                      {row.notes ? <Text style={[styles.historyMeta, { color: theme.textMuted }]}>{row.notes}</Text> : null}
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.block}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Bed photos</Text>
                  <View style={styles.row}>
                    <Pressable style={[styles.smallActionButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => void addBedPhoto(card.bed.id, "camera")}>
                      <Text style={[styles.smallActionButtonText, { color: theme.secondaryActionText }]}>Take photo</Text>
                    </Pressable>
                    <Pressable style={[styles.smallActionButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => void addBedPhoto(card.bed.id, "gallery")}>
                      <Text style={[styles.smallActionButtonText, { color: theme.secondaryActionText }]}>Upload</Text>
                    </Pressable>
                  </View>
                </View>
                {(bedPhotoRowsByBedId.get(card.bed.id) ?? []).length === 0 ? (
                  <Text style={[styles.blockText, { color: theme.textMuted }]}>No photos yet.</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                    {(bedPhotoRowsByBedId.get(card.bed.id) ?? []).map((photo) => (
                      <View key={photo.id} style={[styles.photoCard, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}>
                        <Pressable
                          style={[styles.photoDeleteButton, { backgroundColor: theme.dangerActionBackground }]}
                          onPress={() => deleteBedPhoto(card.bed.id, photo.id)}
                        >
                          <Text style={[styles.photoDeleteButtonText, { color: theme.dangerActionText }]}>×</Text>
                        </Pressable>
                        <Pressable onPress={() => openPhotoViewer(photo, card.bed.name)}>
                          <Image source={{ uri: photo.uri }} style={[styles.photoThumb, { backgroundColor: theme.chipBackground }]} />
                        </Pressable>
                        <Text style={[styles.photoMeta, { color: theme.textMuted }]}>{formatDate(photo.createdAt)}</Text>
                        <Text style={[styles.photoMeta, { color: theme.textMuted }]}>{photo.source === "camera" ? "Camera" : "Gallery"}</Text>
                        {photo.notes && (
                          <Pressable onPress={() => openPhotoViewer(photo, card.bed.name)}>
                            <Text style={[styles.photoNotes, { color: theme.textPrimary }]} numberOfLines={2}>{photo.notes}</Text>
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>

              <View style={styles.block}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Suggested plans</Text>
                  {rejectedCount > 0 && (
                    <Pressable
                      style={[styles.smallActionButton, { backgroundColor: theme.secondaryActionBackground }]}
                      onPress={() => clearRejectedSuggestionsForBed(card.bed.id)}
                    >
                      <Text style={[styles.smallActionButtonText, { color: theme.secondaryActionText }]}>Reset hidden ({rejectedCount})</Text>
                    </Pressable>
                  )}
                </View>
                {!showSuggestions ? (
                  <Text style={[styles.blockText, { color: theme.textMuted }]}>Suggestions hidden while this bed is marked as full.</Text>
                ) : card.suggestions.length === 0 ? (
                  <Text style={[styles.blockText, { color: theme.textMuted }]}>No clear suggestions yet. Add more crops in Grow List.</Text>
                ) : (
                  card.suggestions.map((suggestion) => (
                    <View key={suggestion.entry.id} style={[styles.suggestionRow, { borderColor: theme.borderColor }]}>
                      <View style={styles.suggestionMain}>
                        {(() => {
                          const scoreKey = `${card.bed.id}:${suggestion.entry.id}`;
                          const scoreExpanded = Boolean(scoreExpandedByKey[scoreKey]);
                          return (
                            <>
                              <View style={styles.rowBetween}>
                                <Text style={[styles.suggestionName, { color: theme.textPrimary }]}>{formatEntryName(suggestion.entry)}</Text>
                                <View style={styles.row}>
                                  {(suggestion.companionGoodCount > 0 || suggestion.companionAvoidCount > 0) && (
                                    <View style={[styles.companionSummaryChip, { backgroundColor: theme.appBackground, borderColor: theme.borderColor }]}>
                                      <Text style={[styles.companionSummaryChipText, { color: theme.textMuted }]}>+{suggestion.companionGoodCount} / -{suggestion.companionAvoidCount}</Text>
                                    </View>
                                  )}
                                  {suggestion.fitCount && (
                                    <View style={[styles.fitChip, { backgroundColor: theme.chipBackground, borderColor: theme.chipBorder }]}>
                                      <Text style={[styles.fitChipText, { color: theme.chipText }]}>Fit {suggestion.fitCount}</Text>
                                    </View>
                                  )}
                                  <Text style={[styles.suggestionScore, { color: theme.textMuted }]}>{suggestion.scoreLabel}</Text>
                                </View>
                              </View>
                              <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.diseaseReason}</Text>
                              <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.rotationReason}</Text>
                              <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.sunReason}</Text>
                              <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.spacingReason}</Text>
                              <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>Confidence: {suggestion.confidenceLabel}</Text>
                              <View style={styles.scoreChipRow}>
                                {suggestion.scoreComponents.map((part) => (
                                  <View key={`${scoreKey}-${part.label}`} style={[styles.scoreChip, { backgroundColor: theme.appBackground, borderColor: theme.borderColor }]}>
                                    <Text style={[styles.scoreChipText, { color: theme.textMuted }]}>
                                      {part.label} {formatSignedScore(part.value)}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                              {suggestion.companionMessages.map((message) => (
                                <Text key={`${suggestion.entry.id}-${normalizePlantKey(message)}`} style={[styles.suggestionReason, { color: theme.textMuted }]}>
                                  {message}
                                </Text>
                              ))}
                              <Pressable
                                style={[styles.whyButton, { backgroundColor: theme.appBackground }]}
                                onPress={() => setScoreExpandedByKey((prev) => ({ ...prev, [scoreKey]: !scoreExpanded }))}
                              >
                                <Text style={[styles.whyButtonText, { color: theme.textPrimary }]}>{scoreExpanded ? "Hide score details" : "Why this rank?"}</Text>
                              </Pressable>
                              {scoreExpanded && (
                                <View style={[styles.whyPanel, { borderColor: theme.borderColor }]}>
                                  {suggestion.scoreBreakdown.map((line) => (
                                    <Text key={`${scoreKey}-${line}`} style={[styles.whyLine, { color: theme.textMuted }]}>
                                      {line}
                                    </Text>
                                  ))}
                                </View>
                              )}
                            </>
                          );
                        })()}
                      </View>
                      <View style={styles.suggestionActions}>
                        <Pressable
                          style={[styles.suggestionButton, { backgroundColor: theme.dangerActionBackground, borderColor: theme.borderColor }]}
                          onPress={() => rejectSuggestion(card.bed.id, suggestion.entry.id)}
                        >
                          <Text style={[styles.suggestionButtonText, { color: theme.dangerActionText }]}>Reject</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.suggestionButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                          onPress={() => planInBedMutation.mutate({ entry: suggestion.entry, bedId: card.bed.id })}
                          disabled={planInBedMutation.isPending}
                        >
                          <Text style={[styles.suggestionButtonText, { color: theme.secondaryActionText }]}>Plan</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.suggestionButton, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor }]}
                          onPress={() => handleMarkPlanted(suggestion.entry, card.bed.id)}
                          disabled={markPlantedMutation.isPending}
                        >
                          <Text style={[styles.suggestionButtonText, { color: theme.primaryActionText }]}>Plant now</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {showSuggestions && card.whyNot.length > 0 && (
                <View style={styles.block}>
                  <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Why not these (right now)</Text>
                  {card.whyNot.map((item) => (
                    <View key={`${card.bed.id}-why-${item.entry.id}`} style={[styles.historyRow, { borderColor: theme.borderColor }]}>
                      <Text style={[styles.historyName, { color: theme.textPrimary }]}>{formatEntryName(item.entry)} - {item.scoreLabel}</Text>
                      <Text style={[styles.historyMeta, { color: theme.textMuted }]}>{item.reason}</Text>
                    </View>
                  ))}
                </View>
              )}

              {showSuggestions && (
                <View style={styles.block}>
                  <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Other options</Text>
                  {card.contraryOptions.length === 0 ? (
                    <Text style={[styles.blockText, { color: theme.textMuted }]}>No extra planned crops available.</Text>
                  ) : (
                    <View style={styles.chips}>
                      {card.contraryOptions.map((entry) => (
                        <Pressable key={entry.id} style={[styles.optionChip, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={() => planInBedMutation.mutate({ entry, bedId: card.bed.id })} disabled={planInBedMutation.isPending}><Text style={[styles.optionChipText, { color: theme.secondaryActionText }]}>{formatEntryName(entry)}</Text></Pressable>
                      ))}
                    </View>
                  )}
                  <Link href={`/gardens/${gardenId}/grow`}>
                    <AppButton
                      label="Add more crops in Grow List"
                      variant="primary"
                      style={{ width: '100%' }}
                    />
                  </Link>
                </View>
              )}
                </>
              )}
            </View>
          );
        })}

        {plannerMode === "visual" && (
          <>
            <BedPlanPreview
              beds={beds}
              {...(gardenQuery.data?.scaleCalibration?.boundaryPolygon
                ? { boundaryPolygon: gardenQuery.data.scaleCalibration.boundaryPolygon }
                : {})}
              {...(gardenQuery.data?.scaleCalibration?.baseWidth && gardenQuery.data?.scaleCalibration?.baseHeight
                ? { previewRatio: gardenQuery.data.scaleCalibration.baseHeight / gardenQuery.data.scaleCalibration.baseWidth }
                : {})}
              infoByBedId={bedPreviewInfoById}
              bedStatusById={bedStatusById}
              bedPlantDotsById={bedPlantDotsById}
              {...(selectedVisualBedId ? { selectedBedId: selectedVisualBedId } : {})}
              onBedPress={setSelectedVisualBedId}
              subtitle="Tap a bed to view and place crops. Planted crops appear as in-bed dots."
            />
            {selectedVisualCard && (() => {
              const card = selectedVisualCard;
              const hasExistingPlants = card.growingNames.length > 0;
              const hasSpareSpace = hasSpareSpaceByBed[card.bed.id] ?? false;
              const showSuggestions = !hasExistingPlants || hasSpareSpace;
              const rejectedCount = card.rejectedSuggestionIds.length;
              return (
                <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
                  <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{card.bed.name}</Text>
                  <Text style={[styles.meta, { color: theme.textMuted }]}>
                    {card.activeGrowingRows.length} growing - {card.plannedInBed.length} planned - {showSuggestions ? `${card.suggestions.length} suggestions` : "suggestions hidden"}
                  </Text>
                  <View style={styles.toggleRow}>
                    <Text style={[styles.toggleLabel, { color: theme.textMuted }]}>Spare space</Text>
                    <SimpleToggle
                      value={hasSpareSpace}
                      onToggle={(value) => setSpareSpace(card.bed.id, value)}
                    />
                  </View>
                  <View style={styles.block}>
                    <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Growing now</Text>
                    {card.activeGrowingRows.length === 0 ? (
                      <Text style={[styles.blockText, { color: theme.textMuted }]}>Nothing growing here yet.</Text>
                    ) : (
                      <View style={styles.block}>
                        {card.activeGrowingRows.map((row) => (
                          <View key={`visual-grow-${row.entry.id}`} style={[styles.growingRow, { borderColor: theme.borderColor }]}>
                            <View style={styles.growingMain}>
                              <Text style={[styles.growingName, { color: theme.textPrimary }]}>{formatEntryName(row.entry)}</Text>
                              <Text style={[styles.blockText, { color: theme.textMuted }]}>{row.plantedAt ? `Planted ${formatDate(row.plantedAt)}` : "Planted date not set"}</Text>
                            </View>
                            <View style={styles.row}>
                              <Pressable style={[styles.finishChip, { backgroundColor: theme.secondaryActionBackground }]} disabled={finishPlantingMutation.isPending} onPress={() => openFinishDialog(row, "harvested")}><Text style={[styles.finishChipText, { color: theme.secondaryActionText }]}>Harvested</Text></Pressable>
                              <Pressable style={[styles.finishChip, { backgroundColor: theme.secondaryActionBackground }]} disabled={finishPlantingMutation.isPending} onPress={() => openFinishDialog(row, "done")}><Text style={[styles.finishChipText, { color: theme.secondaryActionText }]}>Done</Text></Pressable>
                              <Pressable style={[styles.finishChipDanger, { backgroundColor: theme.dangerActionBackground }]} disabled={finishPlantingMutation.isPending} onPress={() => openFinishDialog(row, "dead")}><Text style={[styles.finishChipDangerText, { color: theme.dangerActionText }]}>Lost</Text></Pressable>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                  {card.plannedInBed.length > 0 && (
                    <View style={styles.block}>
                      <View style={styles.rowBetween}>
                        <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Planned for this bed</Text>
                        {card.plannedInBed.length > 1 && (
                          <Pressable
                            style={[styles.smallActionButton, { backgroundColor: theme.primaryActionBackground }]}
                            onPress={() => plantAllInBedMutation.mutate({ entries: card.plannedInBed, bedId: card.bed.id })}
                            disabled={plantAllInBedMutation.isPending}
                          >
                            <Text style={[styles.smallActionButtonText, { color: theme.primaryActionText }]}>Plant all</Text>
                          </Pressable>
                        )}
                      </View>
                      <View style={styles.chips}>
                        {card.plannedInBed.map((entry) => (
                          <View key={`visual-plan-${entry.id}`} style={[styles.planChip, { backgroundColor: theme.secondaryActionBackground }]}>
                            <Text style={[styles.planChipText, { color: theme.secondaryActionText }]}>{formatEntryName(entry)}</Text>
                            <Pressable style={[styles.planChipPlantButton, { backgroundColor: theme.primaryActionBackground }]} onPress={() => handleMarkPlanted(entry, card.bed.id)} disabled={markPlantedMutation.isPending}><Text style={[styles.planChipPlantButtonText, { color: theme.primaryActionText }]}>Planted</Text></Pressable>
                            <Pressable style={[styles.planChipButton, { backgroundColor: theme.dangerActionBackground }]} onPress={() => handleClearPlan(entry)} disabled={clearPlanMutation.isPending}><Text style={[styles.planChipButtonText, { color: theme.dangerActionText }]}>Clear</Text></Pressable>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                  <View style={styles.block}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Bed photos</Text>
                      <View style={styles.row}>
                        <Pressable style={[styles.smallActionButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => void addBedPhoto(card.bed.id, "camera")}>
                          <Text style={[styles.smallActionButtonText, { color: theme.secondaryActionText }]}>Take photo</Text>
                        </Pressable>
                        <Pressable style={[styles.smallActionButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={() => void addBedPhoto(card.bed.id, "gallery")}>
                          <Text style={[styles.smallActionButtonText, { color: theme.secondaryActionText }]}>Upload</Text>
                        </Pressable>
                      </View>
                    </View>
                    {(bedPhotoRowsByBedId.get(card.bed.id) ?? []).length === 0 ? (
                      <Text style={[styles.blockText, { color: theme.textMuted }]}>No photos yet.</Text>
                    ) : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                        {(bedPhotoRowsByBedId.get(card.bed.id) ?? []).map((photo) => (
                          <View key={`visual-${photo.id}`} style={[styles.photoCard, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}>
                            <Pressable
                              style={[styles.photoDeleteButton, { backgroundColor: theme.dangerActionBackground }]}
                              onPress={() => deleteBedPhoto(card.bed.id, photo.id)}
                            >
                              <Text style={[styles.photoDeleteButtonText, { color: theme.dangerActionText }]}>×</Text>
                            </Pressable>
                            <Pressable onPress={() => openPhotoViewer(photo, card.bed.name)}>
                              <Image source={{ uri: photo.uri }} style={[styles.photoThumb, { backgroundColor: theme.chipBackground }]} />
                            </Pressable>
                            <Text style={[styles.photoMeta, { color: theme.textMuted }]}>{formatDate(photo.createdAt)}</Text>
                            <Text style={[styles.photoMeta, { color: theme.textMuted }]}>{photo.source === "camera" ? "Camera" : "Gallery"}</Text>
                            {photo.notes && <Text style={[styles.photoNotes, { color: theme.textPrimary }]} numberOfLines={2}>{photo.notes}</Text>}
                          </View>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                  <View style={styles.block}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>Suggested</Text>
                      {rejectedCount > 0 && (
                        <Pressable
                          style={[styles.smallActionButton, { backgroundColor: theme.secondaryActionBackground }]}
                          onPress={() => clearRejectedSuggestionsForBed(card.bed.id)}
                        >
                          <Text style={[styles.smallActionButtonText, { color: theme.secondaryActionText }]}>Reset hidden ({rejectedCount})</Text>
                        </Pressable>
                      )}
                    </View>
                    {!showSuggestions ? (
                      <Text style={[styles.blockText, { color: theme.textMuted }]}>Suggestions hidden while this bed is marked full.</Text>
                    ) : card.suggestions.length === 0 ? (
                      <Text style={[styles.blockText, { color: theme.textMuted }]}>No clear suggestions yet.</Text>
                    ) : (
                      <View style={styles.chips}>
                        {card.suggestions.map((suggestion) => {
                          const scoreKey = `visual:${card.bed.id}:${suggestion.entry.id}`;
                          const scoreExpanded = Boolean(scoreExpandedByKey[scoreKey]);
                          return (
                            <View key={`visual-suggestion-${suggestion.entry.id}`} style={[styles.suggestionRow, { borderColor: theme.borderColor, width: "100%" }]}>
                              <View style={styles.suggestionMain}>
                                <View style={styles.rowBetween}>
                                  <Text style={[styles.suggestionName, { color: theme.textPrimary }]}>{formatEntryName(suggestion.entry)}</Text>
                                  <View style={styles.row}>
                                    {(suggestion.companionGoodCount > 0 || suggestion.companionAvoidCount > 0) && (
                                      <View style={[styles.companionSummaryChip, { backgroundColor: theme.appBackground, borderColor: theme.borderColor }]}>
                                        <Text style={[styles.companionSummaryChipText, { color: theme.textMuted }]}>
                                          +{suggestion.companionGoodCount} / -{suggestion.companionAvoidCount}
                                        </Text>
                                      </View>
                                    )}
                                    <Text style={[styles.suggestionScore, { color: theme.textMuted }]}>{suggestion.scoreLabel}</Text>
                                  </View>
                                </View>
                                <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>Confidence: {suggestion.confidenceLabel}</Text>
                                <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.diseaseReason}</Text>
                                <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.rotationReason}</Text>
                                <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.sunReason}</Text>
                                <Text style={[styles.suggestionReason, { color: theme.textMuted }]}>{suggestion.spacingReason}</Text>
                                <View style={styles.scoreChipRow}>
                                  {suggestion.scoreComponents.map((part) => (
                                    <View key={`${scoreKey}-${part.label}`} style={[styles.scoreChip, { backgroundColor: theme.appBackground, borderColor: theme.borderColor }]}>
                                      <Text style={[styles.scoreChipText, { color: theme.textMuted }]}>
                                        {part.label} {formatSignedScore(part.value)}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                                <Pressable
                                  style={[styles.whyButton, { backgroundColor: theme.appBackground }]}
                                  onPress={() => setScoreExpandedByKey((prev) => ({ ...prev, [scoreKey]: !scoreExpanded }))}
                                >
                                  <Text style={[styles.whyButtonText, { color: theme.textPrimary }]}>{scoreExpanded ? "Hide fit details" : "Why this fit?"}</Text>
                                </Pressable>
                                {scoreExpanded && (
                                  <View style={[styles.whyPanel, { borderColor: theme.borderColor }]}>
                                    {suggestion.scoreBreakdown.map((line) => (
                                      <Text key={`${scoreKey}-${line}`} style={[styles.whyLine, { color: theme.textMuted }]}>
                                        {line}
                                      </Text>
                                    ))}
                                  </View>
                                )}
                              </View>
                              <View style={styles.suggestionActions}>
                                <Pressable style={[styles.suggestionButton, { backgroundColor: theme.dangerActionBackground, borderColor: theme.borderColor }]} onPress={() => rejectSuggestion(card.bed.id, suggestion.entry.id)}>
                                  <Text style={[styles.suggestionButtonText, { color: theme.dangerActionText }]}>Reject</Text>
                                </Pressable>
                                <Pressable style={[styles.suggestionButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={() => planInBedMutation.mutate({ entry: suggestion.entry, bedId: card.bed.id })} disabled={planInBedMutation.isPending}>
                                  <Text style={[styles.suggestionButtonText, { color: theme.secondaryActionText }]}>Plan</Text>
                                </Pressable>
                                <Pressable style={[styles.suggestionButton, { backgroundColor: theme.primaryActionBackground, borderColor: theme.borderColor }]} onPress={() => handleMarkPlanted(suggestion.entry, card.bed.id)} disabled={markPlantedMutation.isPending}>
                                  <Text style={[styles.suggestionButtonText, { color: theme.primaryActionText }]}>Plant</Text>
                                </Pressable>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                  <View style={styles.block}>
                    <Text style={[styles.blockTitle, { color: theme.textPrimary }]}>All other grow list options</Text>
                    {card.allOtherOptions.length === 0 ? (
                      <Text style={[styles.blockText, { color: theme.textMuted }]}>No extra planned crops available.</Text>
                    ) : (
                      <ScrollView style={styles.optionsScroll} nestedScrollEnabled>
                        <View style={styles.chips}>
                          {card.allOtherOptions.map((entry) => (
                            <Pressable key={`visual-option-${entry.id}`} style={[styles.optionChip, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]} onPress={() => planInBedMutation.mutate({ entry, bedId: card.bed.id })} disabled={planInBedMutation.isPending}><Text style={[styles.optionChipText, { color: theme.secondaryActionText }]}>{formatEntryName(entry)}</Text></Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    )}
                  </View>
                </View>
              );
            })()}
          </>
        )}

        {plannerMode === "list" && (
        <BedPlanPreview
          beds={beds}
          {...(gardenQuery.data?.scaleCalibration?.boundaryPolygon
            ? { boundaryPolygon: gardenQuery.data.scaleCalibration.boundaryPolygon }
            : {})}
          {...(gardenQuery.data?.scaleCalibration?.baseWidth && gardenQuery.data?.scaleCalibration?.baseHeight
            ? { previewRatio: gardenQuery.data.scaleCalibration.baseHeight / gardenQuery.data.scaleCalibration.baseWidth }
            : {})}
          infoByBedId={bedPreviewInfoById}
          bedPlantDotsById={bedPlantDotsById}
          subtitle="No image or grid here. This is a clean bed layout."
        />
        )}
      </ScrollView>
      {finishDialog && (
        <View style={[styles.dialogOverlay, { backgroundColor: theme.appBackground }]}>
          <View style={[styles.dialogCard, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>
              Finish: {formatEntryName(finishDialog.entry)}
            </Text>
            <View style={styles.toggleRow}>
              <Text style={[styles.toggleLabel, { color: theme.textMuted }]}>Keep in bed</Text>
              <SimpleToggle
                value={finishDialog.keepInBed}
                onToggle={(value) => setFinishDialog((prev) => (prev ? { ...prev, keepInBed: value } : prev))}
              />
            </View>
            <View style={styles.row}>
              {finishDialog.endState === "harvested" && (
                <Pressable style={[styles.toggleChip, { backgroundColor: finishDialog.goodHarvest ? theme.choiceControlActiveBackground : theme.choiceControlBackground }]} onPress={() => setFinishDialog((prev) => (prev ? { ...prev, goodHarvest: !prev.goodHarvest } : prev))}><Text style={[styles.toggleChipText, { color: finishDialog.goodHarvest ? theme.choiceControlActiveText : theme.choiceControlText }]}>Good harvest</Text></Pressable>
              )}
              <Pressable style={[styles.toggleChip, { backgroundColor: finishDialog.fertilized ? theme.choiceControlActiveBackground : theme.choiceControlBackground }]} onPress={() => setFinishDialog((prev) => (prev ? { ...prev, fertilized: !prev.fertilized } : prev))}><Text style={[styles.toggleChipText, { color: finishDialog.fertilized ? theme.choiceControlActiveText : theme.choiceControlText }]}>Fertilized</Text></Pressable>
              <Pressable style={[styles.toggleChip, { backgroundColor: finishDialog.bugsObserved ? theme.choiceControlActiveBackground : theme.choiceControlBackground }]} onPress={() => setFinishDialog((prev) => (prev ? { ...prev, bugsObserved: !prev.bugsObserved } : prev))}><Text style={[styles.toggleChipText, { color: finishDialog.bugsObserved ? theme.choiceControlActiveText : theme.choiceControlText }]}>Bugs</Text></Pressable>
              <Pressable style={[styles.toggleChip, { backgroundColor: finishDialog.diseaseObserved ? theme.choiceControlActiveBackground : theme.choiceControlBackground }]} onPress={() => setFinishDialog((prev) => (prev ? { ...prev, diseaseObserved: !prev.diseaseObserved } : prev))}><Text style={[styles.toggleChipText, { color: finishDialog.diseaseObserved ? theme.choiceControlActiveText : theme.choiceControlText }]}>Disease</Text></Pressable>
            </View>
            {finishDialog.bugsObserved && (
              <TextInput
                value={finishDialog.bugName}
                onChangeText={(value) => setFinishDialog((prev) => (prev ? { ...prev, bugName: value } : prev))}
                placeholder="Bug/pest details (e.g. aphids, caterpillars)"
                style={[styles.dialogInput, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
              />
            )}
            {finishDialog.diseaseObserved && (
              <TextInput
                value={finishDialog.diseaseName}
                onChangeText={(value) => setFinishDialog((prev) => (prev ? { ...prev, diseaseName: value } : prev))}
                placeholder="Disease name (e.g. tomato blight)"
                style={[styles.dialogInput, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
              />
            )}
            <TextInput
              value={finishDialog.notes}
              onChangeText={(value) => setFinishDialog((prev) => (prev ? { ...prev, notes: value } : prev))}
              placeholder="Notes (optional)"
              style={[styles.dialogInput, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
              multiline
            />
            <View style={styles.row}>
              <AppButton
                label="Cancel"
                variant="danger"
                onPress={() => setFinishDialog(null)}
              />
              <AppButton
                label="Save"
                variant="primary"
                onPress={submitFinishDialog}
              />
            </View>
          </View>
        </View>
      )}
      {undoToast && (
        <View style={[styles.undoToast, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.undoToastText, { color: theme.textPrimary }]}>{undoToast.label}</Text>
          <Pressable style={[styles.undoButton, { backgroundColor: theme.secondaryActionBackground }]} onPress={handleUndoPress} disabled={undoPending}>
            <Text style={[styles.undoButtonText, { color: theme.secondaryActionText }]}>{undoPending ? "Undoing..." : "Undo"}</Text>
          </Pressable>
        </View>
      )}
      {photoViewer && (
        <View style={[styles.photoViewerOverlay, { backgroundColor: theme.modalBackdrop }]}>
          <View style={[styles.photoViewerModal, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
            <View style={styles.photoViewerHeader}>
              <Text style={[styles.photoViewerTitle, { color: theme.textPrimary }]}>
                {photoViewer.bedName} - {formatDate(photoViewer.photo.createdAt)}
              </Text>
              <Pressable
                style={[styles.photoViewerClose, { backgroundColor: theme.appBackground }]}
                onPress={() => setPhotoViewer(null)}
              >
                <Text style={[styles.photoViewerCloseText, { color: theme.textPrimary }]}>×</Text>
              </Pressable>
            </View>
            
            <ScrollView contentContainerStyle={styles.photoViewerContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Image 
                source={{ uri: photoViewer.photo.uri }} 
                style={styles.photoViewerImage}
                resizeMode="contain"
              />
              
              <View style={styles.photoViewerFooter}>
                <Text style={[styles.photoViewerSource, { color: theme.textMuted }]}>
                  Source: {photoViewer.photo.source === "camera" ? "Camera" : "Gallery"}
                </Text>
                <TextInput
                  value={photoViewer.photo.notes || ""}
                  onChangeText={(text) => {
                    setPhotoViewer(prev => prev ? {
                      ...prev,
                      photo: { ...prev.photo, notes: text }
                    } : null);
                  }}
                  onFocus={() => setPhotoNotesInputFocused(true)}
                  onBlur={() => {
                    setPhotoNotesInputFocused(false);
                    if (photoViewer) {
                      updatePhotoNotes(photoViewer.photo.id, photoViewer.photo.notes || "");
                    }
                  }}
                  placeholder="Add notes about this photo..."
                  style={[styles.photoViewerNotesInput, { 
                    borderColor: theme.borderColor, 
                    backgroundColor: theme.appBackground, 
                    color: theme.textPrimary 
                  }]}
                  multiline
                  numberOfLines={4}
                />
                {photoNotesInputFocused && (
                  <Text style={[styles.photoViewerSaveInfo, { color: theme.textMuted }]}>
                    Tap away to save notes
                  </Text>
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

function SimpleToggle(props: {
  value: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      style={[
        styles.simpleToggleContainer,
        { backgroundColor: props.value ? theme.toggleOnBackground : theme.toggleOffBackground },
        props.disabled && styles.disabledToggle,
      ]}
      onPress={() => !props.disabled && props.onToggle(!props.value)}
      disabled={props.disabled}
    >
      <View style={[styles.simpleToggleThumb, { backgroundColor: theme.toggleThumbColor }, props.value && styles.simpleToggleThumbActive]} />
    </Pressable>
  );
}

function scoreSuggestion(params: {
  entry: GardenCropWishlistItemView;
  bedSunExposure: string;
  companionDelta: number;
  fitCount: number | null;
  meta: PlantMeta;
  diseaseProfile: BedDiseaseProfile;
  rotationProfile: BedRotationProfile;
}): {
  total: number;
  confidenceLabel: string;
  components: Array<{ label: string; value: number }>;
  breakdown: string[];
} {
  const { entry, bedSunExposure, companionDelta, fitCount, meta, diseaseProfile, rotationProfile } = params;
  const sunScore = getSunMatchScore(bedSunExposure, meta.sunRequirements);
  const diseaseScore = getDiseaseScore(entry, diseaseProfile);
  const rotationScore = getRotationScore(entry, rotationProfile);
  const supportScore = entry.supportNeeded ? -2 : 1;
  const spacingScore = typeof meta.rowSpacing === "number" || typeof meta.spread === "number" ? 4 : -1;
  const quantityScore =
    typeof fitCount === "number" ? (entry.quantity <= fitCount ? 6 : Math.max(-8, fitCount - entry.quantity)) : 0;
  const dataCoverage = getDataCoverageScore(meta, fitCount);
  const total = sunScore + diseaseScore + rotationScore + companionDelta + supportScore + spacingScore + quantityScore + dataCoverage;
  const components = [
    { label: "Sun", value: sunScore },
    { label: "Companion", value: companionDelta },
    { label: "Disease", value: diseaseScore },
    { label: "Rotation", value: rotationScore },
    { label: "Capacity", value: quantityScore },
  ];
  const breakdown = [
    `Disease history: ${formatSignedScore(diseaseScore)}`,
    `Rotation memory: ${formatSignedScore(rotationScore)}`,
    `Sun fit: ${formatSignedScore(sunScore)}`,
    `Companion: ${formatSignedScore(companionDelta)}`,
    `Support impact: ${formatSignedScore(supportScore)}`,
    `Spacing data: ${formatSignedScore(spacingScore)}`,
    `Capacity vs quantity: ${formatSignedScore(quantityScore)}`,
    `Data confidence boost: ${formatSignedScore(dataCoverage)}`,
    `Total score: ${total}`,
  ];
  return { total, confidenceLabel: getConfidenceLabel(meta, fitCount), components, breakdown };
}

function getDataCoverageScore(meta: PlantMeta, fitCount: number | null): number {
  let score = 0;
  if (meta.sunRequirements?.trim()) score += 2;
  if (typeof meta.rowSpacing === "number" || typeof meta.spread === "number") score += 2;
  if (typeof fitCount === "number") score += 2;
  return score;
}

function getConfidenceLabel(meta: PlantMeta, fitCount: number | null): string {
  const hasSun = Boolean(meta.sunRequirements?.trim());
  const hasSpacing = typeof meta.rowSpacing === "number" || typeof meta.spread === "number";
  if (hasSun && hasSpacing && typeof fitCount === "number") return "high";
  if (hasSun || hasSpacing) return "medium";
  return "low";
}

function getScoreLabel(score: number): string {
  if (score >= 38) return "Excellent fit";
  if (score >= 28) return "Good fit";
  if (score >= 18) return "Possible fit";
  return "Weak fit";
}

function getWhyNotReason(candidate: BedSuggestion): string {
  const lines = [
    candidate.diseaseReason,
    candidate.rotationReason,
    candidate.sunReason,
    candidate.spacingReason,
  ];
  const caution = lines.find((line) => /caution|weak|unknown|unavailable|note/i.test(line));
  if (caution) return caution;
  return lines[0] ?? "Lower rank than current picks";
}

type BedDiseaseProfile = {
  diseases: string[];
  diseaseKeys: string[];
  diseasedFamilies: string[];
};

type BedRotationProfile = {
  recentFamilies: string[];
  recentNames: string[];
};

function buildBedDiseaseProfile(rows: GardenCropPlantingHistoryItem[]): BedDiseaseProfile {
  const diseases = new Set<string>();
  const diseaseKeys = new Set<string>();
  const diseasedFamilies = new Set<string>();
  for (const row of rows) {
    const notes = row.notes?.toLowerCase() ?? "";
    if (!notes) continue;
    const diseaseMatch = notes.match(/disease:([^|]+)/i);
    const diseaseName = diseaseMatch?.[1]?.trim();
    const diseaseKeyMatch = notes.match(/disease_key:([^|]+)/i);
    const diseaseKeyFromNotes = diseaseKeyMatch?.[1]?.trim();
    const diseaseObserved = /disease_observed:yes/i.test(notes) || Boolean(diseaseName);
    if (!diseaseObserved) continue;
    if (diseaseName) diseases.add(diseaseName);
    if (diseaseKeyFromNotes) diseaseKeys.add(diseaseKeyFromNotes);
    const normalized = normalizeDiseaseKey(diseaseName);
    if (normalized) diseaseKeys.add(normalized);
    if (row.plant.familyName?.trim()) diseasedFamilies.add(row.plant.familyName.trim().toLowerCase());
  }
  return { diseases: Array.from(diseases), diseaseKeys: Array.from(diseaseKeys), diseasedFamilies: Array.from(diseasedFamilies) };
}

function getDiseaseScore(entry: GardenCropWishlistItemView, profile: BedDiseaseProfile): number {
  if (profile.diseases.length === 0 && profile.diseaseKeys.length === 0 && profile.diseasedFamilies.length === 0) return 0;
  const family = entry.plant.familyName?.trim().toLowerCase() ?? "";
  let score = 0;
  if (family && profile.diseasedFamilies.includes(family)) score -= 10;
  const name = entry.plant.commonName.trim().toLowerCase();
  if (profile.diseaseKeys.includes("blight")) {
    if (family.includes("solanaceae")) score -= 8;
    if (/(tomato|potato|pepper|eggplant|aubergine)/i.test(name)) score -= 6;
  }
  if (profile.diseaseKeys.includes("powdery_mildew") && /(cucumber|zucchini|pumpkin|squash|melon)/i.test(name)) score -= 5;
  if (profile.diseaseKeys.includes("root_rot") && /(bean|pea|onion|garlic|carrot)/i.test(name)) score -= 4;
  return score;
}

function getDiseaseReason(entry: GardenCropWishlistItemView, profile: BedDiseaseProfile): string {
  if (profile.diseases.length === 0) return "Disease history: none recorded";
  const score = getDiseaseScore(entry, profile);
  if (score <= -12) return `Disease history caution: ${profile.diseases.join(", ")}`;
  if (score < 0) return `Disease history note: ${profile.diseases.join(", ")}`;
  return `Disease history: ${profile.diseases.join(", ")}`;
}

function buildBedRotationProfile(rows: GardenCropPlantingHistoryItem[]): BedRotationProfile {
  const recentFamilies = new Set<string>();
  const recentNames = new Set<string>();
  const recentRows = rows.slice(0, 8);
  for (const row of recentRows) {
    const family = row.plant.familyName?.trim().toLowerCase();
    if (family) recentFamilies.add(family);
    const name = row.plant.commonName?.trim().toLowerCase();
    if (name) recentNames.add(name);
  }
  return {
    recentFamilies: Array.from(recentFamilies),
    recentNames: Array.from(recentNames),
  };
}

function getRotationScore(entry: GardenCropWishlistItemView, profile: BedRotationProfile): number {
  if (profile.recentFamilies.length === 0 && profile.recentNames.length === 0) return 0;
  const family = entry.plant.familyName?.trim().toLowerCase() ?? "";
  const name = entry.plant.commonName.trim().toLowerCase();
  let score = 0;
  if (family && profile.recentFamilies.includes(family)) score -= 8;
  if (profile.recentNames.includes(name)) score -= 4;
  return score;
}

function getRotationReason(entry: GardenCropWishlistItemView, profile: BedRotationProfile): string {
  if (profile.recentFamilies.length === 0 && profile.recentNames.length === 0) return "Rotation: no recent crop history";
  const family = entry.plant.familyName?.trim().toLowerCase() ?? "";
  const name = entry.plant.commonName.trim().toLowerCase();
  if (family && profile.recentFamilies.includes(family)) {
    return `Rotation caution: same family recently used (${entry.plant.familyName ?? "unknown family"})`;
  }
  if (profile.recentNames.includes(name)) return "Rotation note: same crop was planted recently";
  return "Rotation: no immediate repeat risk";
}

function normalizeDiseaseKey(value?: string): string | undefined {
  const raw = value?.trim().toLowerCase() ?? "";
  if (!raw) return undefined;
  if (raw.includes("blight")) return "blight";
  if (raw.includes("powdery mildew")) return "powdery_mildew";
  if (raw.includes("downy mildew")) return "downy_mildew";
  if (raw.includes("rust")) return "rust";
  if (raw.includes("root rot") || raw.includes("rot")) return "root_rot";
  if (raw.includes("mosaic")) return "mosaic_virus";
  if (raw.includes("wilt")) return "wilt";
  return raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
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

function estimateRequiredAreaSqM(entry: GardenCropWishlistItemView): number | null {
  const meta = parsePlantMeta(entry.plant.metaJson);
  const spacingCm = Math.max(meta.rowSpacing ?? 0, meta.spread ?? 0);
  if (!Number.isFinite(spacingCm) || spacingCm <= 0) return null;
  const spacingM = spacingCm / 100;
  if (spacingM <= 0) return null;
  const quantity = Math.max(1, entry.quantity ?? 1);
  return spacingM * spacingM * quantity;
}

function parsePlantMeta(metaJson?: string): PlantMeta {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as {
      sun_requirements?: string;
      row_spacing?: number | string;
      spread?: number | string;
      height?: number | string;
      gardenme?: {
        sunRequirements?: string;
        rowSpacing?: number | string;
        spread?: number | string;
        height?: number | string;
      };
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

function formatSignedScore(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  container: { padding: 14, gap: 10, paddingBottom: 96 },
  title: { fontSize: 26, fontWeight: "800" },
  subtitle: { marginTop: -2 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  statChipText: { fontSize: 12, fontWeight: "700" },
  warningCard: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  warningText: { fontSize: 12, fontWeight: "700" },
  warningActions: { flexDirection: "row", justifyContent: "flex-end" },
  empty: {},
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  bedHeader: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  bedHeaderMain: { flex: 1, gap: 2 },
  bedHeaderCaret: { fontSize: 16, fontWeight: "700" },
  diseaseBanner: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  diseaseBannerText: { fontSize: 12, fontWeight: "700" },
  meta: { fontSize: 13 },
  block: { gap: 6 },
  blockTitle: { fontWeight: "700", fontSize: 13 },
  blockText: { fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  growingRow: { gap: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  growingMain: { gap: 2 },
  growingName: { fontWeight: "700" },
  finishChip: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  finishChipText: { fontWeight: "700", fontSize: 12 },
  finishChipDanger: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  finishChipDangerText: { fontWeight: "700", fontSize: 12 },
  historyHeader: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  historyRow: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  historyName: { fontWeight: "700" },
  historyMeta: { fontSize: 12 },
  toggleChip: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  toggleChipActive: {},
  toggleChipText: { fontWeight: "700" },
  toggleChipTextActive: {},
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  planChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  planChipText: { fontWeight: "700", fontSize: 12 },
  planChipPlantButton: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  planChipPlantButtonText: { fontWeight: "700", fontSize: 11 },
  planChipButton: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  planChipButtonText: { fontWeight: "700", fontSize: 11 },
  smallActionButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  smallActionButtonText: { fontWeight: "700", fontSize: 11 },
  suggestionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  suggestionMain: { flex: 1, gap: 2 },
  suggestionName: { fontWeight: "700" },
  suggestionScore: { fontSize: 11, fontWeight: "700" },
  scoreChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  scoreChip: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  scoreChipText: { fontSize: 10, fontWeight: "700" },
  companionSummaryChip: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  companionSummaryChipText: { fontSize: 10, fontWeight: "700" },
  fitChip: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  fitChipText: { fontSize: 10, fontWeight: "700" },
  suggestionReason: { fontSize: 12 },
  whyButton: { marginTop: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, alignSelf: "flex-start" },
  whyButtonText: { fontSize: 11, fontWeight: "700" },
  whyPanel: { marginTop: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, gap: 2 },
  whyLine: { fontSize: 11 },
  suggestionActions: { alignItems: "flex-end", gap: 8 },
  suggestionButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  suggestionButtonText: { fontWeight: "700", fontSize: 12 },
  optionChip: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  optionChipText: { textTransform: "capitalize", fontSize: 12 },
  optionsScroll: { maxHeight: 170 },
  photoStrip: { gap: 8, paddingRight: 6 },
  photoCard: { borderRadius: 10, padding: 6, gap: 2, width: 120, position: "relative" },
  photoThumb: { width: 106, height: 72, borderRadius: 7 },
  photoMeta: { fontSize: 10 },
  photoDeleteButton: { position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", zIndex: 1 },
  photoDeleteButtonText: { fontSize: 16, fontWeight: "800", lineHeight: 16 },
  linkText: { fontWeight: "700", marginTop: 2 },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  zoomButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  zoomButtonText: { fontSize: 18, fontWeight: "700" },
  zoomText: { minWidth: 52, textAlign: "center", fontWeight: "700" },
  previewCanvas: { borderRadius: 12, overflow: "hidden", position: "relative" },
  previewPin: { position: "absolute", width: 20, height: 20, borderRadius: 10, marginLeft: -10, marginTop: -10, alignItems: "center", justifyContent: "center" },
  previewPinText: { fontWeight: "800", fontSize: 11 },
  undoToast: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  undoToastText: { flex: 1, fontSize: 12, fontWeight: "600" },
  undoButton: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  undoButtonText: { fontWeight: "700", fontSize: 12 },
  dialogOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  dialogCard: {
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  dialogInput: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 72,
    textAlignVertical: "top",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  simpleToggleContainer: {
    width: 44,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 2,
    justifyContent: "center",
  },
  simpleToggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignSelf: "flex-start",
  },
  simpleToggleThumbActive: {
    alignSelf: "flex-end",
  },
  disabledToggle: {
    opacity: 0.5,
  },
  photoNotes: {
    fontSize: 10,
    marginTop: 4,
    flexWrap: "wrap",
    lineHeight: 12,
  },
  photoViewerOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  photoViewerModal: {
    borderRadius: 12,
    padding: 0,
    overflow: "hidden",
    width: "100%",
    maxHeight: "70%",
    flex: 0,
  },
  photoViewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  photoViewerTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  photoViewerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  photoViewerImage: {
    width: "100%",
    height: 300,
    resizeMode: "contain",
  },
  photoViewerFooter: {
    padding: 16,
    paddingBottom: 120,
  },
  photoViewerNotesInput: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 80,
    textAlignVertical: "top",
    fontSize: 14,
  },
  photoViewerCloseText: {
    fontSize: 18,
    fontWeight: "600",
  },
  photoViewerSource: {
    fontSize: 12,
    marginBottom: 8,
  },
  photoViewerSaveInfo: {
    fontSize: 11,
    marginTop: 8,
    textAlign: "center",
    fontStyle: "italic",
  },

});

