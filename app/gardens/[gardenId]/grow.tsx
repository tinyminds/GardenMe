import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { SqlitePlantCatalogRepository } from "@/infra/repositories/sqlite/SqlitePlantCatalogRepository";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { fetchGrowstuffCropDetails, searchGrowstuffPlants, type GrowstuffCropDetails } from "@/features/plants/services/growstuff";
import { queryClient } from "@/state/queryClient";
import { useTheme } from "@/ui/theme/ThemeProvider";
import type { GardenCropWishlistItemView, PlantCatalogEntry } from "@/domain/entities/Plant";

const gardenRepository = new SqliteGardenRepository();
const wishlistRepository = new SqliteGardenCropWishlistRepository();
const plantCatalogRepository = new SqlitePlantCatalogRepository();
const bedRepository = new SqliteBedRepository();

type PlantSuggestion = {
  plantCatalogId: string;
  source: PlantCatalogEntry["source"];
  externalId?: string;
  commonName: string;
  scientificName?: string;
  familyName?: string;
  imageUrl?: string;
  metaJson?: string;
  sourceLabel: "Growstuff" | "Manual";
  detailLine?: string;
  descriptionSnippet?: string;
};

type CropEntryDraft = {
  status: "wanted" | "already_growing";
  bedId: string | null;
  varietyName: string;
  supportNeeded: boolean;
  quantity: number;
};

type PlantDataDraft = {
  category: PlantCategory;
  sunRequirements: string;
  rowSpacing: string;
  spread: string;
  height: string;
  startIndoorsMonths: string;
  directSowMonths: string;
  plantOutMonths: string;
  harvestMonths: string;
};

type BulkImportProgress = {
  current: number;
  total: number;
  currentName?: string;
};

type BulkImportSummary = {
  total: number;
  added: number;
  skipped: number;
  unmatched: number;
  unmatchedNames: string[];
};

type PlantCategory = "unspecified" | "tree" | "shrub" | "herb" | "vegetable" | "fruit" | "flower" | "climber";

const PLANT_CATEGORY_OPTIONS: Array<{ value: PlantCategory; label: string }> = [
  { value: "unspecified", label: "Not chosen" },
  { value: "tree", label: "Tree" },
  { value: "shrub", label: "Shrub" },
  { value: "herb", label: "Herb" },
  { value: "vegetable", label: "Vegetable" },
  { value: "fruit", label: "Fruit" },
  { value: "flower", label: "Flower" },
  { value: "climber", label: "Climber" },
];

export default function GardenGrowListScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [entryDrafts, setEntryDrafts] = useState<Record<string, CropEntryDraft>>({});
  const [listSearch, setListSearch] = useState("");
  const [listSortDirection, setListSortDirection] = useState<"asc" | "desc">("asc");
  const [importSourceGardenId, setImportSourceGardenId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({});
  const [expandedPlantData, setExpandedPlantData] = useState<Record<string, boolean>>({});
  const [expandedWishlistRows, setExpandedWishlistRows] = useState<Record<string, boolean>>({});
  const [plantDataDrafts, setPlantDataDrafts] = useState<Record<string, PlantDataDraft>>({});
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState("");
  const [bulkImportProgress, setBulkImportProgress] = useState<BulkImportProgress | null>(null);
  const [bulkImportMessage, setBulkImportMessage] = useState<string | null>(null);
  const [bulkImportUnmatchedNames, setBulkImportUnmatchedNames] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const listNameCollator = useMemo(
    () =>
      new Intl.Collator(undefined, {
        sensitivity: "base",
        numeric: true,
        ignorePunctuation: true,
      }),
    []
  );

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 280);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setShowAllSuggestions(false);
  }, [debouncedSearch]);

  const gardenQuery = useQuery({
    queryKey: ["garden", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) throw new Error("Missing garden id");
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

  const bedsQuery = useQuery({
    queryKey: ["beds", gardenId],
    enabled: Boolean(gardenId),
    queryFn: async () => {
      if (!gardenId) return [];
      return bedRepository.listByGarden(gardenId);
    },
  });

  const gardensQuery = useQuery({
    queryKey: ["gardens"],
    queryFn: async () => gardenRepository.list(),
  });

  const suggestionsQuery = useQuery({
    queryKey: ["plant-suggestions", debouncedSearch],
    enabled: debouncedSearch.length >= 2,
    queryFn: async () => {
      const query = debouncedSearch.trim().toLowerCase();
      const localMatches = (await plantCatalogRepository.searchByName(debouncedSearch, 20)).filter(
        (item) => item.source === "growstuff" || item.source === "manual"
      );
      let remoteMatches: PlantCatalogEntry[] = [];

      try {
        const growstuffHits = await searchGrowstuffPlants(debouncedSearch, 1, 24);
        const growstuffMatches = await Promise.all(
          growstuffHits.map(async (hit) => {
            const existing = await plantCatalogRepository.getBySourceExternalId("growstuff", hit.externalId);
            return plantCatalogRepository.upsert({
              source: "growstuff",
              externalId: hit.externalId,
              commonName: hit.commonName,
              ...(hit.scientificName ? { scientificName: hit.scientificName } : {}),
              ...(hit.familyName ? { familyName: hit.familyName } : {}),
              ...(hit.imageUrl ? { imageUrl: hit.imageUrl } : {}),
              metaJson: existing?.metaJson ?? hit.rawJson,
            });
          })
        );
        remoteMatches = [...remoteMatches, ...growstuffMatches];
      } catch {
        // Keep local fallback only.
      }

      const mergedById = new Map<string, PlantCatalogEntry>();
      for (const entry of [...remoteMatches, ...localMatches]) {
        if (!mergedById.has(entry.id)) mergedById.set(entry.id, entry);
      }

      const sourcePriority = (source: PlantCatalogEntry["source"]): number => {
        if (source === "growstuff") return 0;
        if (source === "manual") return 1;
        return 9;
      };

      const relevanceScore = (entry: PlantCatalogEntry): number => {
        const common = normalizeSearchText(entry.commonName);
        const scientific = normalizeSearchText(entry.scientificName ?? "");
        if (!query) return 0;
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wordMatch = new RegExp(`\\b${escapedQuery}\\b`);
        let score = 0;
        if (common === query) score += 120;
        if (wordMatch.test(common)) score += 95;
        if (common.startsWith(query)) score += 85;
        if (common.includes(query)) score += 45;
        if (scientific === query) score += 55;
        if (wordMatch.test(scientific)) score += 40;
        if (scientific.startsWith(query)) score += 35;
        if (scientific.includes(query)) score += 20;
        if (isSingularPluralEquivalent(common, query)) score += 30;
        if (isLikelySpecificVarietyName(entry.commonName, query)) score -= 35;
        return score;
      };

      return Array.from(mergedById.values())
        .sort((a, b) => {
          const sourceOrder = sourcePriority(a.source) - sourcePriority(b.source);
          if (sourceOrder !== 0) return sourceOrder;
          const scoreOrder = relevanceScore(b) - relevanceScore(a);
          if (scoreOrder !== 0) return scoreOrder;
          const lengthOrder = a.commonName.trim().length - b.commonName.trim().length;
          if (lengthOrder !== 0) return lengthOrder;
          return a.commonName.localeCompare(b.commonName);
        })
        .slice(0, 36);
    },
  });

  const suggestions = useMemo<PlantSuggestion[]>(() => {
    const dedupedByName = new Map<string, PlantSuggestion>();
    for (const entry of suggestionsQuery.data ?? []) {
      // Deduplicate by common name so a Growstuff hit replaces an older manual placeholder.
      const key = entry.commonName.trim().toLowerCase();
      if (dedupedByName.has(key)) continue;
      dedupedByName.set(key, {
        plantCatalogId: entry.id,
        source: entry.source,
        ...(entry.externalId ? { externalId: entry.externalId } : {}),
        commonName: entry.commonName,
        ...(entry.scientificName ? { scientificName: entry.scientificName } : {}),
        ...(entry.familyName ? { familyName: entry.familyName } : {}),
        ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
        ...(entry.metaJson ? { metaJson: entry.metaJson } : {}),
        sourceLabel: entry.source === "growstuff" ? "Growstuff" : "Manual",
        ...extractSuggestionDetails(entry.metaJson),
      });
    }
    return Array.from(dedupedByName.values());
  }, [suggestionsQuery.data]);

  const visibleSuggestions = useMemo(
    () => (showAllSuggestions ? suggestions : suggestions.slice(0, 12)),
    [suggestions, showAllSuggestions]
  );

  const addToWishlistMutation = useMutation({
    onMutate: () => {
      setAddError(null);
    },
    mutationFn: async (payload: { suggestion?: PlantSuggestion; manualName?: string }) => {
      if (!gardenId) throw new Error("Missing garden id");
      let plantCatalogId = payload.suggestion?.plantCatalogId;
      const suggestion = payload.suggestion;

      if (suggestion?.source === "growstuff") {
        const resolvedIdentifier = await resolveGrowstuffIdentifier(suggestion);
        if (resolvedIdentifier) {
          let canonical = await plantCatalogRepository.upsert({
            source: "growstuff",
            externalId: resolvedIdentifier,
            commonName: suggestion.commonName,
            ...(suggestion.scientificName ? { scientificName: suggestion.scientificName } : {}),
            ...(suggestion.familyName ? { familyName: suggestion.familyName } : {}),
            ...(suggestion.imageUrl ? { imageUrl: suggestion.imageUrl } : {}),
            ...(suggestion.metaJson ? { metaJson: suggestion.metaJson } : {}),
          });

          try {
            const details = await fetchGrowstuffCropDetails(resolvedIdentifier);
            if (details) {
              const resolvedExternalId = details.id ? String(details.id) : resolvedIdentifier;
              const preferredScientificName = pickScientificName(details) || canonical.scientificName;
              canonical = await plantCatalogRepository.upsert({
                source: "growstuff",
                externalId: resolvedExternalId,
                commonName: details.name?.trim() || canonical.commonName,
                ...(preferredScientificName ? { scientificName: preferredScientificName } : {}),
                ...(canonical.familyName ? { familyName: canonical.familyName } : {}),
                ...(details.thumbnail_url?.trim() || canonical.imageUrl
                  ? { imageUrl: details.thumbnail_url?.trim() || canonical.imageUrl }
                  : {}),
                metaJson: buildGrowstuffMetaJson(canonical.metaJson, details),
              });
            }
          } catch {
            // Keep canonical row even when details fetch fails.
          }

          plantCatalogId = canonical.id;
        }
      }

      if (!plantCatalogId) {
        const manualName = payload.manualName?.trim();
        if (!manualName) throw new Error("Missing plant name");
        const entry = await plantCatalogRepository.upsert({
          source: "manual",
          commonName: manualName,
        });
        plantCatalogId = entry.id;
      }

      await wishlistRepository.add({
        gardenId,
        plantCatalogId,
        status: "wanted",
      });
    },
    onSuccess: async () => {
      setAddError(null);
      setSearch("");
      setDebouncedSearch("");
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
    },
    onError: (error) => {
      const message = String((error as { message?: string })?.message ?? "");
      if (message.toLowerCase().includes("unique") || message.toLowerCase().includes("constraint")) {
        setAddError("That plant is already in this grow list.");
        return;
      }
      setAddError("Could not add plant. Try again.");
    },
  });

  const importFromGardenMutation = useMutation({
    onMutate: () => {
      setImportMessage(null);
    },
    mutationFn: async () => {
      if (!gardenId) throw new Error("Missing garden id");
      if (!importSourceGardenId) throw new Error("Choose a source garden");

      const [sourceItems, targetItems] = await Promise.all([
        wishlistRepository.listByGarden(importSourceGardenId),
        wishlistRepository.listByGarden(gardenId),
      ]);

      const keyOf = (plantCatalogId: string, varietyName?: string): string =>
        `${plantCatalogId}::${(varietyName ?? "").trim().toLowerCase()}`;

      const existingKeys = new Set<string>(
        targetItems.map((item) => keyOf(item.plantCatalogId, item.varietyName))
      );

      const candidates = sourceItems.map((item) => ({
          plantCatalogId: item.plantCatalogId,
          varietyName: item.varietyName?.trim(),
          supportNeeded: item.supportNeeded,
          quantity: item.quantity,
        }));

      let imported = 0;
      let skipped = 0;
      for (const candidate of candidates) {
        const key = keyOf(candidate.plantCatalogId, candidate.varietyName);
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }

        await wishlistRepository.add({
          gardenId,
          plantCatalogId: candidate.plantCatalogId,
          status: "wanted",
          ...(candidate.varietyName ? { varietyName: candidate.varietyName } : {}),
          ...(candidate.supportNeeded ? { supportNeeded: true } : {}),
          quantity: Math.max(1, candidate.quantity || 1),
          isPerennial: false,
        });

        existingKeys.add(key);
        imported += 1;
      }

      return { imported, skipped };
    },
    onSuccess: async ({ imported, skipped }) => {
      setImportMessage(`Imported ${imported} item${imported === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.`);
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
    },
    onError: () => {
      setImportMessage("Import failed. Try again.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => wishlistRepository.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
    },
  });

  const cloneEntryMutation = useMutation({
    mutationFn: async (entry: GardenCropWishlistItemView) => {
      if (!gardenId) throw new Error("Missing garden id");
      const bedIds = (bedsQuery.data ?? []).map((bed) => bed.id);
      const nextBedId =
        entry.status === "already_growing"
          ? bedIds.find((id) => id !== entry.bedId) ?? entry.bedId
          : undefined;

      await wishlistRepository.add({
        gardenId,
        plantCatalogId: entry.plantCatalogId,
        status: entry.status,
        ...(entry.status === "already_growing" && nextBedId ? { bedId: nextBedId } : {}),
        ...(entry.isPerennial ? { isPerennial: true } : { isPerennial: false }),
        ...(entry.varietyName ? { varietyName: entry.varietyName } : {}),
        ...(entry.supportNeeded ? { supportNeeded: true } : { supportNeeded: false }),
        quantity: 1,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
    },
  });

  useEffect(() => {
    const next: Record<string, CropEntryDraft> = {};
    for (const item of wishlistQuery.data ?? []) {
      next[item.id] = {
        status: item.status,
        bedId: item.bedId ?? null,
        varietyName: item.varietyName ?? "",
        supportNeeded: item.supportNeeded,
        quantity: Math.max(1, item.quantity ?? 1),
      };
    }
    setEntryDrafts((prev) => (areEntryDraftsEqual(prev, next) ? prev : next));
  }, [wishlistQuery.data]);

  const updateEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const draft = entryDrafts[entryId];
      if (!draft) return;
      await wishlistRepository.update({
        id: entryId,
        status: draft.status,
        ...(draft.status === "already_growing" && draft.bedId ? { bedId: draft.bedId } : {}),
        ...(draft.varietyName.trim() ? { varietyName: draft.varietyName.trim() } : { varietyName: "" }),
        ...(draft.supportNeeded ? { supportNeeded: true } : { supportNeeded: false }),
        quantity: Math.max(1, Math.floor(draft.quantity || 1)),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
    },
  });

  const bulkImportMutation = useMutation({
    onMutate: () => {
      setAddError(null);
      setBulkImportMessage(null);
      setBulkImportUnmatchedNames([]);
      setBulkImportProgress(null);
    },
    mutationFn: async (): Promise<BulkImportSummary> => {
      if (!gardenId) throw new Error("Missing garden id");
      const names = parseBulkPlantNames(bulkImportText);
      if (names.length === 0) return { total: 0, added: 0, skipped: 0, unmatched: 0, unmatchedNames: [] };

      const existing = await wishlistRepository.listByGarden(gardenId);
      const existingPlantIds = new Set(existing.map((item) => item.plantCatalogId));

      let added = 0;
      let skipped = 0;
      let unmatched = 0;
      const unmatchedNames: string[] = [];

      for (let index = 0; index < names.length; index += 1) {
        const name = names[index]!;
        setBulkImportProgress({ current: index + 1, total: names.length, currentName: name });

        const matched = await findBestPlantMatchForBulk(name, plantCatalogRepository);
        if (!matched) {
          unmatched += 1;
          unmatchedNames.push(name);
          continue;
        }

        if (existingPlantIds.has(matched.id)) {
          skipped += 1;
          continue;
        }

        try {
          await wishlistRepository.add({
            gardenId,
            plantCatalogId: matched.id,
            status: "wanted",
          });
          if (matched.source === "growstuff" && matched.externalId) {
            try {
              const details = await fetchGrowstuffCropDetails(matched.externalId);
              if (details) {
                const preferredScientificName = pickScientificName(details) || matched.scientificName;
                await plantCatalogRepository.upsert({
                  source: "growstuff",
                  externalId: matched.externalId,
                  commonName: details.name?.trim() || matched.commonName,
                  ...(preferredScientificName ? { scientificName: preferredScientificName } : {}),
                  ...(matched.familyName ? { familyName: matched.familyName } : {}),
                  ...(details.thumbnail_url?.trim() || matched.imageUrl
                    ? { imageUrl: details.thumbnail_url?.trim() || matched.imageUrl }
                    : {}),
                  metaJson: buildGrowstuffMetaJson(matched.metaJson, details),
                });
              }
            } catch {
              // Keep added plant even if detail enrichment fails.
            }
          }
          existingPlantIds.add(matched.id);
          added += 1;
        } catch {
          skipped += 1;
        }

        if (index < names.length - 1) {
          await waitMs(140);
        }
      }

      return { total: names.length, added, skipped, unmatched, unmatchedNames };
    },
    onSuccess: async (summary) => {
      if (summary.total === 0) {
        setBulkImportMessage("No valid plant names found in that text.");
      } else {
        setBulkImportMessage(
          `Bulk import done: added ${summary.added}, skipped ${summary.skipped}, unmatched ${summary.unmatched} (total ${summary.total}).`
        );
      }
      setBulkImportUnmatchedNames(summary.unmatchedNames);
      setBulkImportProgress(null);
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
    },
    onError: () => {
      setBulkImportProgress(null);
      setBulkImportUnmatchedNames([]);
      setBulkImportMessage("Bulk import failed. Try again.");
    },
  });

  useEffect(() => {
    const next: Record<string, PlantDataDraft> = {};
    for (const item of wishlistQuery.data ?? []) {
      next[item.id] = getPlantDataDraft(item.plant.metaJson);
    }
    setPlantDataDrafts((prev) => (arePlantDataDraftsEqual(prev, next) ? prev : next));
  }, [wishlistQuery.data]);

  const updatePlantDataMutation = useMutation({
    mutationFn: async (item: GardenCropWishlistItemView) => {
      const draft = plantDataDrafts[item.id] ?? getPlantDataDraft(item.plant.metaJson);
      const nextMetaJson = mergePlantDataMetaJson(item.plant.metaJson, draft);
      await plantCatalogRepository.upsert({
        source: item.plant.source,
        ...(item.plant.externalId ? { externalId: item.plant.externalId } : {}),
        commonName: item.plant.commonName,
        ...(item.plant.scientificName ? { scientificName: item.plant.scientificName } : {}),
        ...(item.plant.familyName ? { familyName: item.plant.familyName } : {}),
        ...(item.plant.imageUrl ? { imageUrl: item.plant.imageUrl } : {}),
        metaJson: nextMetaJson,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
      await queryClient.invalidateQueries({ queryKey: ["beds", gardenId] });
    },
  });

  const perennialLookupByBedId = useMemo(() => {
    const lookup = new Map<string, Set<string>>();
    for (const bed of bedsQuery.data ?? []) {
      if (!bed.containsPerennials || !bed.perennialPlantsCsv) continue;
      lookup.set(
        bed.id,
        new Set(
          bed.perennialPlantsCsv
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)
        )
      );
    }
    return lookup;
  }, [bedsQuery.data]);

  const splitOneMutation = useMutation({
    mutationFn: async (entry: GardenCropWishlistItemView) => {
      if (!gardenId) throw new Error("Missing garden id");
      if ((entry.quantity ?? 1) <= 1) return;

      await wishlistRepository.update({
        id: entry.id,
        status: entry.status,
        ...(entry.status === "already_growing" && entry.bedId ? { bedId: entry.bedId } : {}),
        ...(entry.varietyName ? { varietyName: entry.varietyName } : { varietyName: "" }),
        ...(entry.supportNeeded ? { supportNeeded: true } : { supportNeeded: false }),
        quantity: Math.max(1, (entry.quantity ?? 1) - 1),
      });

      await wishlistRepository.add({
        gardenId,
        plantCatalogId: entry.plantCatalogId,
        status: entry.status,
        ...(entry.status === "already_growing" && entry.bedId ? { bedId: entry.bedId } : {}),
        ...(entry.isPerennial ? { isPerennial: true } : { isPerennial: false }),
        ...(entry.varietyName ? { varietyName: entry.varietyName } : {}),
        ...(entry.supportNeeded ? { supportNeeded: true } : { supportNeeded: false }),
        quantity: 1,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
    },
  });

  const visibleWishlistItems = useMemo(() => {
    const searchTerm = listSearch.trim().toLowerCase();
    const list = [...(wishlistQuery.data ?? [])].filter((item) => {
      if (!searchTerm) return true;
      const haystack = [
        item.plant.commonName,
        item.varietyName ?? "",
        item.plant.scientificName ?? "",
        item.plant.familyName ?? "",
        item.bedName ?? "",
        item.status === "already_growing" ? "already growing" : "wanted",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(searchTerm);
    });

    list.sort((a, b) => {
      const nameSort = listNameCollator.compare(a.plant.commonName.trim(), b.plant.commonName.trim());
      if (nameSort !== 0) return listSortDirection === "asc" ? nameSort : -nameSort;
      const varietySort = listNameCollator.compare((a.varietyName ?? "").trim(), (b.varietyName ?? "").trim());
      return listSortDirection === "asc" ? varietySort : -varietySort;
    });
    return list;
  }, [listNameCollator, wishlistQuery.data, listSearch, listSortDirection]);

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="always">
        <Text style={[styles.title, { color: theme.textPrimary }]}>Grow List</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          {gardenQuery.data?.name
            ? `${gardenQuery.data.name}: track wanted and growing plants`
            : "Track wanted and growing plants"}
        </Text>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Add Plant</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search plants or type your own"
            style={[styles.input, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
            autoCapitalize="none"
          />
          {debouncedSearch.length >= 2 && (
            <View style={[styles.suggestionsBox, { borderColor: theme.borderColor }]}>
              {suggestionsQuery.isLoading && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={theme.secondaryActionText} />
                  <Text style={[styles.loadingText, { color: theme.textMuted }]}>Searching plants...</Text>
                </View>
              )}
              {!suggestionsQuery.isLoading && suggestions.length === 0 && (
                <Text style={[styles.emptySuggestion, { color: theme.textMuted }]}>No matches.</Text>
              )}
              {visibleSuggestions.map((item) => (
                <Pressable
                  key={item.plantCatalogId}
                  style={[styles.suggestionRow, { borderTopColor: theme.borderColor }]}
                  disabled={addToWishlistMutation.isPending}
                  onPress={() => addToWishlistMutation.mutate({ suggestion: item })}
                >
                  <View style={styles.suggestionMain}>
                    <Text style={[styles.suggestionName, { color: theme.textPrimary }]}>{item.commonName}</Text>
                    {item.scientificName && <Text style={[styles.suggestionMeta, { color: theme.textMuted }]}>{item.scientificName}</Text>}
                    {item.familyName && <Text style={[styles.suggestionMeta, { color: theme.textMuted }]}>Family: {item.familyName}</Text>}
                    {item.detailLine && <Text style={[styles.suggestionMeta, { color: theme.textMuted }]}>{item.detailLine}</Text>}
                  </View>
                  <Text style={[styles.suggestionTag, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}>{item.sourceLabel}</Text>
                </Pressable>
              ))}
              {suggestions.length > 12 && (
                <Pressable style={[styles.suggestionMoreButton, { borderTopColor: theme.borderColor }]} onPress={() => setShowAllSuggestions((value) => !value)}>
                  <Text style={[styles.suggestionMoreText, { color: theme.secondaryActionText }]}>{showAllSuggestions ? "Show less" : "Show more"}</Text>
                </Pressable>
              )}
            </View>
          )}
          <View style={styles.addRow}>
            <Pressable
              style={[
                styles.primaryButton,
                { backgroundColor: search.trim() ? theme.primaryActionBackground : theme.disabledActionBackground },
                !search.trim() && styles.buttonDisabled,
              ]}
              disabled={!search.trim() || addToWishlistMutation.isPending}
              onPress={() => addToWishlistMutation.mutate({ manualName: search })}
            >
              <Text style={[styles.primaryButtonText, { color: search.trim() ? theme.primaryActionText : theme.disabledActionText }]}>Add Typed Plant</Text>
            </Pressable>
          </View>
          <View style={styles.addRow}>
            <Pressable
              style={[styles.secondaryButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
              disabled={bulkImportMutation.isPending}
              onPress={() => setBulkImportOpen((value) => !value)}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.secondaryActionText }]}>
                {bulkImportOpen ? "Hide Bulk Import" : "Bulk Import"}
              </Text>
            </Pressable>
          </View>
          {bulkImportOpen && (
            <View style={styles.importSection}>
              <Text style={[styles.helper, { color: theme.textMuted }]}>Paste comma/newline/semicolon separated plant names.</Text>
              <TextInput
                value={bulkImportText}
                onChangeText={setBulkImportText}
                placeholder={"e.g. tomato, basil\nquince\naubergine"}
                style={[styles.bulkInput, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
                multiline
                textAlignVertical="top"
                editable={!bulkImportMutation.isPending}
              />
              <View style={styles.addRow}>
                <Pressable
                  style={[
                    styles.primaryButton,
                    { backgroundColor: bulkImportText.trim() ? theme.primaryActionBackground : theme.disabledActionBackground },
                    !bulkImportText.trim() && styles.buttonDisabled,
                  ]}
                  disabled={!bulkImportText.trim() || bulkImportMutation.isPending}
                  onPress={() => bulkImportMutation.mutate()}
                >
                  <Text style={[styles.primaryButtonText, { color: bulkImportText.trim() ? theme.primaryActionText : theme.disabledActionText }]}>
                    {bulkImportMutation.isPending ? "Importing..." : "Run Bulk Import"}
                  </Text>
                </Pressable>
              </View>
              {bulkImportProgress && (
                <Text style={[styles.helper, { color: theme.textMuted }]}>
                  {`Processing ${bulkImportProgress.current}/${bulkImportProgress.total}${bulkImportProgress.currentName ? `: ${bulkImportProgress.currentName}` : ""}`}
                </Text>
              )}
              {bulkImportMessage && <Text style={[styles.helper, { color: theme.textMuted }]}>{bulkImportMessage}</Text>}
              {bulkImportUnmatchedNames.length > 0 && (
                <View style={styles.unmatchedSection}>
                  <Text style={[styles.configLabel, { color: theme.textPrimary }]}>Unmatched (tap to put in search)</Text>
                  <View style={styles.configChips}>
                    {bulkImportUnmatchedNames.map((name) => (
                      <Pressable
                        key={`unmatched-${name}`}
                        style={[styles.configChip, { backgroundColor: theme.secondaryActionBackground }]}
                        onPress={() => {
                          setSearch(name);
                          setBulkImportOpen(false);
                        }}
                      >
                        <Text style={[styles.configChipText, { color: theme.secondaryActionText }]}>{name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
          {addError && <Text style={[styles.errorText, { color: theme.dangerActionBackground }]}>{addError}</Text>}
        </View>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Import From Garden</Text>
          <View style={styles.importSection}>
            <View style={styles.configChips}>
              {(gardensQuery.data ?? [])
                .filter((garden) => garden.id !== gardenId)
                .map((garden) => (
                  <Pressable
                    key={garden.id}
                    style={[styles.configChip, { backgroundColor: importSourceGardenId === garden.id ? theme.primaryActionBackground : theme.secondaryActionBackground }]}
                    onPress={() => setImportSourceGardenId((current) => (current === garden.id ? null : garden.id))}
                  >
                    <Text style={[styles.configChipText, { color: importSourceGardenId === garden.id ? theme.primaryActionText : theme.secondaryActionText }]}>{garden.name}</Text>
                  </Pressable>
                ))}
            </View>
            {!gardensQuery.isLoading &&
              (gardensQuery.data ?? []).filter((garden) => garden.id !== gardenId).length === 0 && (
                <Text style={[styles.helper, { color: theme.textMuted }]}>No other gardens yet.</Text>
              )}
            <View style={styles.addRow}>
              <Pressable
                style={[
                  styles.secondaryButton,
                  { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor },
                  (!importSourceGardenId || importFromGardenMutation.isPending) && styles.buttonDisabled,
                ]}
                disabled={!importSourceGardenId || importFromGardenMutation.isPending}
                onPress={() => importFromGardenMutation.mutate()}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.secondaryActionText }]}>
                  {importFromGardenMutation.isPending ? "Importing..." : "Import"}
                </Text>
              </Pressable>
            </View>
            {importMessage && <Text style={[styles.helper, { color: theme.textMuted }]}>{importMessage}</Text>}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Plant List</Text>
          <View style={styles.listControls}>
            <TextInput
              value={listSearch}
              onChangeText={setListSearch}
              placeholder="Search list"
              style={[styles.input, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
              autoCapitalize="none"
            />
            <View style={styles.configChips}>
              <Pressable
                style={[styles.configChip, { backgroundColor: listSortDirection === "asc" ? theme.primaryActionBackground : theme.secondaryActionBackground }]}
                onPress={() => setListSortDirection("asc")}
              >
                <Text style={[styles.configChipText, { color: listSortDirection === "asc" ? theme.primaryActionText : theme.secondaryActionText }]}>A-Z</Text>
              </Pressable>
              <Pressable
                style={[styles.configChip, { backgroundColor: listSortDirection === "desc" ? theme.primaryActionBackground : theme.secondaryActionBackground }]}
                onPress={() => setListSortDirection("desc")}
              >
                <Text style={[styles.configChipText, { color: listSortDirection === "desc" ? theme.primaryActionText : theme.secondaryActionText }]}>Z-A</Text>
              </Pressable>
            </View>
          </View>
          {wishlistQuery.isLoading && <Text style={[styles.helper, { color: theme.textMuted }]}>Loading...</Text>}
          {!wishlistQuery.isLoading && (wishlistQuery.data?.length ?? 0) === 0 && (
            <Text style={[styles.helper, { color: theme.textMuted }]}>No plants yet.</Text>
          )}
          {!wishlistQuery.isLoading && (wishlistQuery.data?.length ?? 0) > 0 && visibleWishlistItems.length === 0 && (
            <Text style={[styles.helper, { color: theme.textMuted }]}>No plants match that filter.</Text>
          )}
          {visibleWishlistItems.map((item) => (
            <View key={item.id} style={[styles.wishRow, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground }]}>
              <Pressable
                style={[styles.compactHeader, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}
                onPress={() =>
                  setExpandedWishlistRows((prev) => ({
                    ...prev,
                    [item.id]: !Boolean(prev[item.id]),
                  }))
                }
              >
                <View style={styles.compactHeaderMain}>
                  <Text style={[styles.wishName, { color: theme.textPrimary }]}>{item.plant.commonName}</Text>
                  <Text style={[styles.compactHeaderMeta, { color: theme.textMuted }]}>
                    {(entryDrafts[item.id]?.status ?? item.status) === "already_growing" ? "Growing now" : "Planned"}
                    {item.bedName ? ` - ${item.bedName}` : ""}
                    {` - Qty ${Math.max(1, entryDrafts[item.id]?.quantity ?? item.quantity ?? 1)}`}
                  </Text>
                </View>
                <Text style={[styles.compactHeaderCaret, { color: theme.textMuted }]}>
                  {Boolean(expandedWishlistRows[item.id]) ? "v" : ">"}
                </Text>
              </Pressable>
              {Boolean(expandedWishlistRows[item.id]) && (
              <>
              <View style={styles.wishMain}>
                {(() => {
                  const normalizedName = item.plant.commonName.trim().toLowerCase();
                  const isPerennialFromBed = Boolean(
                    item.bedId &&
                      perennialLookupByBedId.get(item.bedId)?.has(normalizedName)
                  );
                  const description = extractPlantDescription(item.plant.metaJson);
                  const isDescriptionExpanded = Boolean(expandedDescriptions[item.id]);
                  return (
                    <>
                <Text style={[styles.wishName, { color: theme.textPrimary }]}>{item.plant.commonName}</Text>
                {description && (
                  <>
                    <Pressable
                      style={styles.descriptionToggle}
                      onPress={() =>
                        setExpandedDescriptions((prev) => ({
                          ...prev,
                          [item.id]: !Boolean(prev[item.id]),
                        }))
                      }
                    >
                      <Text style={[styles.descriptionToggleText, { color: theme.secondaryActionText }]}>
                        {isDescriptionExpanded ? "v Description" : "> Description"}
                      </Text>
                    </Pressable>
                    {isDescriptionExpanded && <Text style={[styles.descriptionBody, { backgroundColor: theme.appBackground, color: theme.textMuted }]}>{description}</Text>}
                  </>
                )}
                {item.varietyName && <Text style={[styles.wishMeta, { color: theme.textMuted }]}>Variety: {item.varietyName}</Text>}
                {item.plant.scientificName && <Text style={[styles.wishMeta, { color: theme.textMuted }]}>{item.plant.scientificName}</Text>}
                {item.plant.familyName && <Text style={[styles.wishMeta, { color: theme.textMuted }]}>Family: {item.plant.familyName}</Text>}
                {(() => {
                  const category = plantDataDrafts[item.id]?.category ?? getPlantDataDraft(item.plant.metaJson).category;
                  if (category === "unspecified") return null;
                  const label = PLANT_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category;
                  return <Text style={[styles.wishMeta, { color: theme.textMuted }]}>Category: {label}</Text>;
                })()}
                {(() => {
                  const isPlantDataExpanded = Boolean(expandedPlantData[item.id]);
                  const plantDataDraft = plantDataDrafts[item.id] ?? getPlantDataDraft(item.plant.metaJson);
                  const missingLabels = getMissingPlantDataLabels(plantDataDraft);
                  return (
                    <>
                      <Pressable
                        style={styles.descriptionToggle}
                        onPress={() =>
                          setExpandedPlantData((prev) => ({
                            ...prev,
                            [item.id]: !Boolean(prev[item.id]),
                          }))
                        }
                      >
                        <Text style={[styles.descriptionToggleText, { color: theme.secondaryActionText }]}>
                          {isPlantDataExpanded ? "v Plant data" : "> Plant data"}
                        </Text>
                      </Pressable>
                      {!isPlantDataExpanded && (
                        <Text style={[styles.wishMeta, { color: theme.textMuted }]}>
                          {missingLabels.length > 0 ? `Missing: ${missingLabels.join(", ")}` : "Data complete"}
                        </Text>
                      )}
                      {isPlantDataExpanded && (
                        <View style={[styles.dataPanel, { backgroundColor: theme.appBackground, borderColor: theme.borderColor }]}>
                          <View style={styles.dataField}>
                            <Text style={[styles.dataLabel, { color: theme.textPrimary }]}>Category</Text>
                            <View style={styles.configChips}>
                              {PLANT_CATEGORY_OPTIONS.map((option) => {
                                const selected = plantDataDraft.category === option.value;
                                return (
                                  <Pressable
                                    key={`${item.id}-category-${option.value}`}
                                    style={[
                                      styles.configChip,
                                      { backgroundColor: selected ? theme.primaryActionBackground : theme.secondaryActionBackground },
                                    ]}
                                    onPress={() =>
                                      setPlantDataDrafts((prev) => ({
                                        ...prev,
                                        [item.id]: { ...(prev[item.id] ?? getPlantDataDraft(item.plant.metaJson)), category: option.value },
                                      }))
                                    }
                                  >
                                    <Text style={[styles.configChipText, { color: selected ? theme.primaryActionText : theme.secondaryActionText }]}>
                                      {option.label}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                          <View style={styles.dataField}>
                            <Text style={[styles.dataLabel, { color: theme.textPrimary }]}>Sun requirements</Text>
                            <TextInput
                              value={plantDataDraft.sunRequirements}
                              onChangeText={(value) =>
                                setPlantDataDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...(prev[item.id] ?? getPlantDataDraft(item.plant.metaJson)), sunRequirements: value },
                                }))
                              }
                              placeholder="e.g. Full sun / Part shade"
                              style={[styles.inlineInput, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                              autoCapitalize="sentences"
                            />
                          </View>
                          <View style={styles.dataGrid}>
                            <View style={styles.dataField}>
                              <Text style={[styles.dataLabel, { color: theme.textPrimary }]}>Row spacing (cm)</Text>
                              <TextInput
                                value={plantDataDraft.rowSpacing}
                                onChangeText={(value) =>
                                  setPlantDataDrafts((prev) => ({
                                    ...prev,
                                    [item.id]: { ...(prev[item.id] ?? getPlantDataDraft(item.plant.metaJson)), rowSpacing: value },
                                  }))
                                }
                                placeholder="-"
                                style={[styles.inlineInput, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                                keyboardType="numeric"
                              />
                            </View>
                            <View style={styles.dataField}>
                              <Text style={[styles.dataLabel, { color: theme.textPrimary }]}>Spread (cm)</Text>
                              <TextInput
                                value={plantDataDraft.spread}
                                onChangeText={(value) =>
                                  setPlantDataDrafts((prev) => ({
                                    ...prev,
                                    [item.id]: { ...(prev[item.id] ?? getPlantDataDraft(item.plant.metaJson)), spread: value },
                                  }))
                                }
                                placeholder="-"
                                style={[styles.inlineInput, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                                keyboardType="numeric"
                              />
                            </View>
                            <View style={styles.dataField}>
                              <Text style={[styles.dataLabel, { color: theme.textPrimary }]}>Height (cm)</Text>
                              <TextInput
                                value={plantDataDraft.height}
                                onChangeText={(value) =>
                                  setPlantDataDrafts((prev) => ({
                                    ...prev,
                                    [item.id]: { ...(prev[item.id] ?? getPlantDataDraft(item.plant.metaJson)), height: value },
                                  }))
                                }
                                placeholder="-"
                                style={[styles.inlineInput, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                                keyboardType="numeric"
                              />
                            </View>
                          </View>
                          <View style={styles.dataField}>
                            <Text style={[styles.dataLabel, { color: theme.textPrimary }]}>Task months (1-12 or Jan-Dec)</Text>
                            <TextInput
                              value={plantDataDraft.startIndoorsMonths}
                              onChangeText={(value) =>
                                setPlantDataDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...(prev[item.id] ?? getPlantDataDraft(item.plant.metaJson)), startIndoorsMonths: value },
                                }))
                              }
                              placeholder="Start indoors: e.g. 2,3"
                              style={[styles.inlineInput, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                              autoCapitalize="none"
                            />
                            <TextInput
                              value={plantDataDraft.directSowMonths}
                              onChangeText={(value) =>
                                setPlantDataDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...(prev[item.id] ?? getPlantDataDraft(item.plant.metaJson)), directSowMonths: value },
                                }))
                              }
                              placeholder="Direct sow: e.g. 4,5"
                              style={[styles.inlineInput, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                              autoCapitalize="none"
                            />
                            <TextInput
                              value={plantDataDraft.plantOutMonths}
                              onChangeText={(value) =>
                                setPlantDataDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...(prev[item.id] ?? getPlantDataDraft(item.plant.metaJson)), plantOutMonths: value },
                                }))
                              }
                              placeholder="Plant out: e.g. 5,6"
                              style={[styles.inlineInput, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                              autoCapitalize="none"
                            />
                            <TextInput
                              value={plantDataDraft.harvestMonths}
                              onChangeText={(value) =>
                                setPlantDataDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...(prev[item.id] ?? getPlantDataDraft(item.plant.metaJson)), harvestMonths: value },
                                }))
                              }
                              placeholder="Harvest: e.g. 8,9,10"
                              style={[styles.inlineInput, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground, color: theme.textPrimary }]}
                              autoCapitalize="none"
                            />
                          </View>
                          <View style={styles.dataActions}>
                            <Pressable
                              style={[styles.cloneInlineButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                              onPress={() =>
                                setPlantDataDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: getPlantDataDraft(item.plant.metaJson),
                                }))
                              }
                            >
                              <Text style={[styles.cloneInlineButtonText, { color: theme.secondaryActionText }]}>Reset</Text>
                            </Pressable>
                            <Pressable
                              style={[styles.saveInlineButton, { backgroundColor: theme.primaryActionBackground, borderColor: theme.primaryActionBackground }]}
                              disabled={updatePlantDataMutation.isPending}
                              onPress={() => updatePlantDataMutation.mutate(item)}
                            >
                              <Text style={[styles.saveInlineButtonText, { color: theme.primaryActionText }]}>
                                {updatePlantDataMutation.isPending ? "Saving..." : "Save plant data"}
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </>
                  );
                })()}
                <Text style={[styles.wishMeta, { color: theme.textMuted }]}>
                  {(entryDrafts[item.id]?.status ?? item.status) === "already_growing" ? "Growing now" : "Planned"}
                  {item.bedName ? ` - ${item.bedName}` : ""}
                  {isPerennialFromBed ? " - Perennial" : ""}
                  {(entryDrafts[item.id]?.supportNeeded ?? item.supportNeeded) ? " - Needs support" : ""}
                  {` - Qty ${Math.max(1, entryDrafts[item.id]?.quantity ?? item.quantity ?? 1)}`}
                </Text>
                <View style={styles.inlineControls}>
                  <View style={styles.qtyRow}>
                    <Text style={[styles.qtyLabel, { color: theme.textPrimary }]}>Quantity</Text>
                    <Pressable
                      style={[styles.qtyButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                      onPress={() =>
                        setEntryDrafts((prev) => ({
                          ...prev,
                          [item.id]: {
                            status: prev[item.id]?.status ?? item.status,
                            bedId: prev[item.id]?.bedId ?? item.bedId ?? null,
                            varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                            supportNeeded: prev[item.id]?.supportNeeded ?? item.supportNeeded,
                            quantity: Math.max(1, (prev[item.id]?.quantity ?? item.quantity ?? 1) - 1),
                          },
                        }))
                      }
                    >
                      <Text style={[styles.qtyButtonText, { color: theme.secondaryActionText }]}>-</Text>
                    </Pressable>
                    <Text style={[styles.qtyValue, { color: theme.textPrimary }]}>{Math.max(1, entryDrafts[item.id]?.quantity ?? item.quantity ?? 1)}</Text>
                    <Pressable
                      style={[styles.qtyButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                      onPress={() =>
                        setEntryDrafts((prev) => ({
                          ...prev,
                          [item.id]: {
                            status: prev[item.id]?.status ?? item.status,
                            bedId: prev[item.id]?.bedId ?? item.bedId ?? null,
                            varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                            supportNeeded: prev[item.id]?.supportNeeded ?? item.supportNeeded,
                            quantity: Math.max(1, (prev[item.id]?.quantity ?? item.quantity ?? 1) + 1),
                          },
                        }))
                      }
                    >
                      <Text style={[styles.qtyButtonText, { color: theme.secondaryActionText }]}>+</Text>
                    </Pressable>
                  </View>
                  <TextInput
                    value={entryDrafts[item.id]?.varietyName ?? item.varietyName ?? ""}
                    onChangeText={(value) =>
                      setEntryDrafts((prev) => ({
                        ...prev,
                        [item.id]: {
                          status: prev[item.id]?.status ?? item.status,
                          bedId: prev[item.id]?.bedId ?? item.bedId ?? null,
                          varietyName: value,
                          supportNeeded: prev[item.id]?.supportNeeded ?? item.supportNeeded,
                          quantity: prev[item.id]?.quantity ?? item.quantity ?? 1,
                        },
                      }))
                    }
                    placeholder="Variety (optional)"
                    style={[styles.inlineInput, { borderColor: theme.borderColor, backgroundColor: theme.appBackground, color: theme.textPrimary }]}
                    autoCapitalize="words"
                  />
                  <ToggleSwitch
                    label={(entryDrafts[item.id]?.supportNeeded ?? item.supportNeeded) ? "Needs support" : "No support"}
                    value={entryDrafts[item.id]?.supportNeeded ?? item.supportNeeded}
                    theme={theme}
                    onToggle={(nextValue) =>
                      setEntryDrafts((prev) => ({
                        ...prev,
                        [item.id]: {
                          status: prev[item.id]?.status ?? item.status,
                          bedId: prev[item.id]?.bedId ?? item.bedId ?? null,
                          varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                          supportNeeded: nextValue,
                          quantity: prev[item.id]?.quantity ?? item.quantity ?? 1,
                        },
                      }))
                    }
                  />
                  <ToggleSwitch
                    label={(entryDrafts[item.id]?.status ?? item.status) === "already_growing" ? "Growing now" : "Planned"}
                    value={(entryDrafts[item.id]?.status ?? item.status) === "already_growing"}
                    theme={theme}
                    onToggle={(isGrowing) =>
                      setEntryDrafts((prev) => ({
                        ...prev,
                        [item.id]: {
                          status: isGrowing ? "already_growing" : "wanted",
                          bedId: isGrowing ? (prev[item.id]?.bedId ?? item.bedId ?? null) : null,
                          varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                          supportNeeded: prev[item.id]?.supportNeeded ?? item.supportNeeded,
                          quantity: prev[item.id]?.quantity ?? item.quantity ?? 1,
                        },
                      }))
                    }
                  />
                  {(entryDrafts[item.id]?.status ?? item.status) === "already_growing" && (
                    <>
                      <View style={styles.configChips}>
                        {(bedsQuery.data ?? []).map((bed) => {
                          const selected = (entryDrafts[item.id]?.bedId ?? item.bedId ?? null) === bed.id;
                          return (
                            <Pressable
                              key={`${item.id}-${bed.id}`}
                              style={[styles.configChip, { backgroundColor: selected ? theme.primaryActionBackground : theme.secondaryActionBackground }]}
                              onPress={() =>
                                setEntryDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: {
                                    status: "already_growing",
                                    bedId: selected ? null : bed.id,
                                    varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                                    supportNeeded: prev[item.id]?.supportNeeded ?? item.supportNeeded,
                                    quantity: prev[item.id]?.quantity ?? item.quantity ?? 1,
                                  },
                                }))
                              }
                            >
                              <Text style={[styles.configChipText, { color: selected ? theme.primaryActionText : theme.secondaryActionText }]}>{bed.name}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                </View>
                    </>
                  );
                })()}
              </View>
              <View style={styles.rowActions}>
                <Pressable
                  style={[styles.cloneInlineButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                  disabled={cloneEntryMutation.isPending}
                  onPress={() => cloneEntryMutation.mutate(item)}
                >
                  <Text style={[styles.cloneInlineButtonText, { color: theme.secondaryActionText }]}>Clone</Text>
                </Pressable>
                <Pressable
                  style={[styles.cloneInlineButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
                  disabled={
                    splitOneMutation.isPending ||
                    Math.max(1, entryDrafts[item.id]?.quantity ?? item.quantity ?? 1) <= 1 ||
                    Math.max(1, entryDrafts[item.id]?.quantity ?? item.quantity ?? 1) !== Math.max(1, item.quantity ?? 1)
                  }
                  onPress={() => splitOneMutation.mutate(item)}
                >
                  <Text style={[styles.cloneInlineButtonText, { color: theme.secondaryActionText }]}>
                    {Math.max(1, entryDrafts[item.id]?.quantity ?? item.quantity ?? 1) !== Math.max(1, item.quantity ?? 1)
                      ? "Split 1 (Save qty)"
                      : "Split 1"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.saveInlineButton, { backgroundColor: theme.primaryActionBackground, borderColor: theme.primaryActionBackground }]}
                  disabled={updateEntryMutation.isPending}
                  onPress={() => updateEntryMutation.mutate(item.id)}
                >
                  <Text style={[styles.saveInlineButtonText, { color: theme.primaryActionText }]}>Save</Text>
                </Pressable>
                <Pressable
                  style={[styles.removeButton, { backgroundColor: theme.dangerActionBackground, borderColor: theme.dangerActionBackground }]}
                  disabled={removeMutation.isPending}
                  onPress={() => removeMutation.mutate(item.id)}
                >
                  <Text style={[styles.removeButtonText, { color: theme.dangerActionText }]}>Remove</Text>
                </Pressable>
              </View>
              </>
              )}
            </View>
          ))}
        </View>

      </ScrollView>
      {bulkImportMutation.isPending && (
        <View style={[styles.blockingOverlay, { backgroundColor: theme.appBackground }]}>
          <ActivityIndicator size="large" color={theme.primaryActionBackground} />
          <Text style={[styles.blockingOverlayText, { color: theme.textPrimary }]}>
            {bulkImportProgress
              ? `Bulk import in progress (${bulkImportProgress.current}/${bulkImportProgress.total})`
              : "Bulk import in progress"}
          </Text>
          {bulkImportProgress?.currentName ? (
            <Text style={[styles.blockingOverlaySubtext, { color: theme.textMuted }]}>
              {bulkImportProgress.currentName}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

function areEntryDraftsEqual(
  a: Record<string, CropEntryDraft>,
  b: Record<string, CropEntryDraft>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const left = a[key];
    const right = b[key];
    if (!left || !right) return false;
    if (
      left.status !== right.status ||
      left.bedId !== right.bedId ||
      left.varietyName !== right.varietyName ||
      left.supportNeeded !== right.supportNeeded ||
      left.quantity !== right.quantity
    ) {
      return false;
    }
  }
  return true;
}

function arePlantDataDraftsEqual(
  current: Record<string, PlantDataDraft>,
  incoming: Record<string, PlantDataDraft>
): boolean {
  const currentKeys = Object.keys(current);
  const incomingKeys = Object.keys(incoming);
  if (currentKeys.length !== incomingKeys.length) return false;
  for (const key of incomingKeys) {
    const left = current[key];
    const right = incoming[key];
    if (!left || !right) return false;
    if (
      left.category !== right.category ||
      left.sunRequirements !== right.sunRequirements ||
      left.rowSpacing !== right.rowSpacing ||
      left.spread !== right.spread ||
      left.height !== right.height ||
      left.startIndoorsMonths !== right.startIndoorsMonths ||
      left.directSowMonths !== right.directSowMonths ||
      left.plantOutMonths !== right.plantOutMonths ||
      left.harvestMonths !== right.harvestMonths
    ) {
      return false;
    }
  }
  return true;
}

function getPlantDataDraft(metaJson?: string): PlantDataDraft {
  const parsed = extractPlantSizing(metaJson);
  const timing = extractPlantTaskTiming(metaJson);
  return {
    category: parsed.category ?? "unspecified",
    sunRequirements: parsed.sunRequirements ?? "",
    rowSpacing: parsed.rowSpacing ?? "",
    spread: parsed.spread ?? "",
    height: parsed.height ?? "",
    startIndoorsMonths: timing.startIndoorsMonths ?? "",
    directSowMonths: timing.directSowMonths ?? "",
    plantOutMonths: timing.plantOutMonths ?? "",
    harvestMonths: timing.harvestMonths ?? "",
  };
}

function getMissingPlantDataLabels(draft: PlantDataDraft): string[] {
  const missing: string[] = [];
  if (!draft.sunRequirements.trim()) missing.push("sun");
  if (!draft.rowSpacing.trim()) missing.push("row");
  if (!draft.spread.trim()) missing.push("spread");
  if (!draft.height.trim()) missing.push("height");
  return missing;
}

function mergePlantDataMetaJson(existingMetaJson: string | undefined, draft: PlantDataDraft): string {
  const existing = parseMetaJsonObject(existingMetaJson);
  const gardenme = asRecord(existing.gardenme) ?? {};
  const category = normalizePlantCategory(draft.category);
  const sunRequirements = draft.sunRequirements.trim();
  const rowSpacing = toPositiveNumber(draft.rowSpacing);
  const spread = toPositiveNumber(draft.spread);
  const height = toPositiveNumber(draft.height);
  const startIndoorsMonths = parseMonthCsv(draft.startIndoorsMonths);
  const directSowMonths = parseMonthCsv(draft.directSowMonths);
  const plantOutMonths = parseMonthCsv(draft.plantOutMonths);
  const harvestMonths = parseMonthCsv(draft.harvestMonths);

  const nextGardenme: Record<string, unknown> = {
    ...gardenme,
    ...(category !== "unspecified" ? { category } : {}),
    ...(sunRequirements ? { sunRequirements } : {}),
    ...(typeof rowSpacing === "number" ? { rowSpacing } : {}),
    ...(typeof spread === "number" ? { spread } : {}),
    ...(typeof height === "number" ? { height } : {}),
    taskMonths: {
      ...(startIndoorsMonths.length > 0 ? { startIndoors: startIndoorsMonths } : {}),
      ...(directSowMonths.length > 0 ? { directSow: directSowMonths } : {}),
      ...(plantOutMonths.length > 0 ? { plantOut: plantOutMonths } : {}),
      ...(harvestMonths.length > 0 ? { harvest: harvestMonths } : {}),
    },
  };

  const nextRoot: Record<string, unknown> = {
    ...existing,
    gardenme: nextGardenme,
    ...(category !== "unspecified" ? { plant_category: category } : {}),
    ...(sunRequirements ? { sun_requirements: sunRequirements } : {}),
    ...(typeof rowSpacing === "number" ? { row_spacing: rowSpacing } : {}),
    ...(typeof spread === "number" ? { spread } : {}),
    ...(typeof height === "number" ? { height } : {}),
  };

  return JSON.stringify(nextRoot);
}

async function resolveGrowstuffIdentifier(suggestion: PlantSuggestion): Promise<string | null> {
  const direct = suggestion.externalId?.trim();
  if (direct) return direct;

  const metaFallback = extractGrowstuffIdentifierFromMeta(suggestion.metaJson);
  if (metaFallback) return metaFallback;

  try {
    const hits = await searchGrowstuffPlants(suggestion.commonName, 1, 8);
    if (hits.length === 0) return null;
    const target = normalizeSearchText(suggestion.commonName);
    const exact = hits.find((hit) => normalizeSearchText(hit.commonName) === target);
    return (exact ?? hits[0])?.externalId ?? null;
  } catch {
    return null;
  }
}

function extractGrowstuffIdentifierFromMeta(metaJson?: string): string | null {
  if (!metaJson) return null;
  try {
    const parsed = JSON.parse(metaJson) as {
      id?: string | number;
      _id?: string | number;
      slug?: string;
    };
    if (parsed.id !== undefined && parsed.id !== null) return String(parsed.id);
    if (parsed._id !== undefined && parsed._id !== null) return String(parsed._id);
    if (typeof parsed.slug === "string" && parsed.slug.trim()) return parsed.slug.trim();
  } catch {
    // ignore
  }
  return null;
}

async function findBestPlantMatchForBulk(
  rawName: string,
  repository: SqlitePlantCatalogRepository
): Promise<PlantCatalogEntry | null> {
  const query = rawName.trim();
  if (!query) return null;

  const localCandidates = (await repository.searchByName(query, 20)).filter(
    (entry) => entry.source === "growstuff" || entry.source === "manual"
  );
  const bestLocal = pickBestPlantMatch(query, localCandidates);
  if (bestLocal && bestLocal.score >= 95) return bestLocal.entry;

  if (query.length >= 2) {
    try {
      const remoteHits = await searchGrowstuffPlants(query, 1, 8);
      const remoteCandidates = await Promise.all(
        remoteHits.map(async (hit) => {
          const existing = await repository.getBySourceExternalId("growstuff", hit.externalId);
          return repository.upsert({
            source: "growstuff",
            externalId: hit.externalId,
            commonName: hit.commonName,
            ...(hit.scientificName ? { scientificName: hit.scientificName } : {}),
            ...(hit.familyName ? { familyName: hit.familyName } : {}),
            ...(hit.imageUrl ? { imageUrl: hit.imageUrl } : {}),
            metaJson: existing?.metaJson ?? hit.rawJson,
          });
        })
      );
      const bestRemote = pickBestPlantMatch(query, remoteCandidates);
      if (bestRemote && bestRemote.score >= 70) return bestRemote.entry;
      if (bestLocal) return bestLocal.entry;
      if (bestRemote) return bestRemote.entry;
    } catch {
      // Fall back to local result only.
    }
  }

  return bestLocal?.entry ?? null;
}

function pickBestPlantMatch(
  query: string,
  candidates: PlantCatalogEntry[]
): { entry: PlantCatalogEntry; score: number } | null {
  if (candidates.length === 0) return null;
  const scored = candidates
    .map((entry) => ({
      entry,
      score: computePlantMatchScore(query, entry),
      sourcePriority: entry.source === "growstuff" ? 0 : 1,
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
      return a.entry.commonName.localeCompare(b.entry.commonName, undefined, { sensitivity: "base" });
    });
  return scored[0] ?? null;
}

function computePlantMatchScore(query: string, entry: PlantCatalogEntry): number {
  const normalizedQuery = normalizeSearchText(query);
  const common = normalizeSearchText(entry.commonName);
  const scientific = normalizeSearchText(entry.scientificName ?? "");
  if (!normalizedQuery) return 0;
  const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordMatch = new RegExp(`\\b${escapedQuery}\\b`);
  let score = 0;
  if (common === normalizedQuery) score += 120;
  if (wordMatch.test(common)) score += 95;
  if (common.startsWith(normalizedQuery)) score += 85;
  if (common.includes(normalizedQuery)) score += 45;
  if (scientific === normalizedQuery) score += 55;
  if (wordMatch.test(scientific)) score += 40;
  if (scientific.startsWith(normalizedQuery)) score += 35;
  if (scientific.includes(normalizedQuery)) score += 20;
  if (isSingularPluralEquivalent(common, normalizedQuery)) score += 30;
  if (isLikelySpecificVarietyName(entry.commonName, normalizedQuery)) score -= 35;
  return score;
}

function parseBulkPlantNames(input: string): string[] {
  const values = input
    .split(/[\n,;]+/g)
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGrowstuffMetaJson(existingMetaJson: string | undefined, details: GrowstuffCropDetails): string {
  const existing = parseMetaJsonObject(existingMetaJson);
  const companionPlantingNotes = extractCompanionPlantingNotes(details.description);

  const merged: Record<string, unknown> = {
    ...existing,
    ...details,
    gardenme: {
      ...(asRecord(existing.gardenme) ?? {}),
      ...(companionPlantingNotes.length > 0 ? { companionPlantingNotes } : {}),
      ...(typeof details.row_spacing === "number" ? { rowSpacing: details.row_spacing } : {}),
      ...(typeof details.spread === "number" ? { spread: details.spread } : {}),
      ...(typeof details.height === "number" ? { height: details.height } : {}),
      ...(details.sun_requirements?.trim() ? { sunRequirements: details.sun_requirements.trim() } : {}),
      ...(details.sowing_method?.trim() ? { sowingMethod: details.sowing_method.trim() } : {}),
      ...(typeof details.median_days_to_first_harvest === "number"
        ? { daysToFirstHarvest: details.median_days_to_first_harvest }
        : {}),
      ...(typeof details.median_days_to_last_harvest === "number"
        ? { daysToLastHarvest: details.median_days_to_last_harvest }
        : {}),
    },
  };

  return JSON.stringify(merged);
}

function parseMetaJsonObject(metaJson?: string): Record<string, unknown> {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Ignore invalid or non-object meta payloads.
  }
  return {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickScientificName(details: GrowstuffCropDetails): string | undefined {
  const single = typeof details.scientific_name === "string" ? details.scientific_name.trim() : "";
  if (single) return single;
  const list = Array.isArray(details.scientific_names) ? details.scientific_names : [];
  for (const value of list) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function extractCompanionPlantingNotes(description?: string | null): string[] {
  const text = description?.trim();
  if (!text) return [];
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.filter((sentence) => /companion|interplant|inter-plant|plant with/i.test(sentence));
}

function extractPlantDescription(metaJson?: string): string | undefined {
  if (!metaJson) return undefined;
  try {
    const parsed = JSON.parse(metaJson) as { description?: string };
    const description = parsed.description?.trim();
    if (!description) return undefined;
    return description;
  } catch {
    return undefined;
  }
}

function extractPlantSizing(metaJson?: string): {
  category?: PlantCategory;
  sunRequirements?: string;
  rowSpacing?: string;
  spread?: string;
  height?: string;
} {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as {
      plant_category?: string;
      sun_requirements?: string;
      row_spacing?: number | string;
      spread?: number | string;
      height?: number | string;
      gardenme?: {
        category?: string;
        sunRequirements?: string;
        rowSpacing?: number | string;
        spread?: number | string;
        height?: number | string;
      };
    };
    const category = normalizePlantCategory(parsed.gardenme?.category ?? parsed.plant_category);
    const sun = parsed.gardenme?.sunRequirements ?? parsed.sun_requirements;
    const row = parsed.gardenme?.rowSpacing ?? parsed.row_spacing;
    const spread = parsed.gardenme?.spread ?? parsed.spread;
    const height = parsed.gardenme?.height ?? parsed.height;
    return {
      ...(category ? { category } : {}),
      ...(typeof sun === "string" && sun.trim() ? { sunRequirements: sun.trim() } : {}),
      ...(row !== undefined ? { rowSpacing: `${row}` } : {}),
      ...(spread !== undefined ? { spread: `${spread}` } : {}),
      ...(height !== undefined ? { height: `${height}` } : {}),
    };
  } catch {
    return {};
  }
}

function extractPlantTaskTiming(metaJson?: string): {
  startIndoorsMonths?: string;
  directSowMonths?: string;
  plantOutMonths?: string;
  harvestMonths?: string;
} {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as {
      gardenme?: {
        taskMonths?: {
          startIndoors?: unknown;
          directSow?: unknown;
          plantOut?: unknown;
          harvest?: unknown;
        };
      };
      growth_months?: unknown;
      fruit_months?: unknown;
    };
    const startIndoors = monthArrayToCsv(parsed.gardenme?.taskMonths?.startIndoors);
    const directSow = monthArrayToCsv(parsed.gardenme?.taskMonths?.directSow);
    const plantOut = monthArrayToCsv(parsed.gardenme?.taskMonths?.plantOut);
    const harvest = monthArrayToCsv(parsed.gardenme?.taskMonths?.harvest ?? parsed.fruit_months ?? parsed.growth_months);
    return {
      ...(startIndoors ? { startIndoorsMonths: startIndoors } : {}),
      ...(directSow ? { directSowMonths: directSow } : {}),
      ...(plantOut ? { plantOutMonths: plantOut } : {}),
      ...(harvest ? { harvestMonths: harvest } : {}),
    };
  } catch {
    return {};
  }
}

function monthArrayToCsv(value: unknown): string | undefined {
  const months = parseMonthInput(value);
  if (months.length === 0) return undefined;
  return months.join(",");
}

function parseMonthCsv(value: string): number[] {
  return parseMonthInput(value);
}

function parseMonthInput(value: unknown): number[] {
  const asArray = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;|/]+/g).map((part) => part.trim()).filter(Boolean)
      : [];
  const parsed = asArray
    .map((item) => {
      if (typeof item === "number" && Number.isFinite(item)) {
        const month = Math.round(item);
        return month >= 1 && month <= 12 ? month : null;
      }
      if (typeof item !== "string") return null;
      const normalized = item.trim().toLowerCase();
      if (!normalized) return null;
      const numeric = Number(normalized);
      if (Number.isFinite(numeric)) {
        const month = Math.round(numeric);
        return month >= 1 && month <= 12 ? month : null;
      }
      const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const idx = names.findIndex((name) => name === normalized.slice(0, 3));
      return idx >= 0 ? idx + 1 : null;
    })
    .filter((month): month is number => typeof month === "number");
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

function toPositiveNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function normalizePlantCategory(value: unknown): PlantCategory {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "tree") return "tree";
  if (raw === "shrub") return "shrub";
  if (raw === "herb") return "herb";
  if (raw === "vegetable") return "vegetable";
  if (raw === "fruit") return "fruit";
  if (raw === "flower") return "flower";
  if (raw === "climber") return "climber";
  return "unspecified";
}

function extractSuggestionDetails(metaJson?: string): {
  detailLine?: string;
  descriptionSnippet?: string;
} {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as {
      perennial?: boolean;
      median_days_to_first_harvest?: number;
      median_days_to_last_harvest?: number;
      median_lifespan?: number;
      row_spacing?: number;
      spread?: number;
      height?: number;
      sun_requirements?: string;
      sowing_method?: string;
      description?: string;
      gardenme?: {
        companionPlantingNotes?: string[];
      };
    };

    const detailParts: string[] = [];
    if (typeof parsed.perennial === "boolean") detailParts.push(parsed.perennial ? "Perennial" : "Annual");
    if (typeof parsed.median_days_to_first_harvest === "number") {
      detailParts.push(`First harvest ~${parsed.median_days_to_first_harvest}d`);
    }
    if (typeof parsed.median_days_to_last_harvest === "number") {
      detailParts.push(`Last harvest ~${parsed.median_days_to_last_harvest}d`);
    } else if (typeof parsed.median_lifespan === "number") {
      detailParts.push(`Lifespan ~${parsed.median_lifespan}d`);
    }
    if (typeof parsed.row_spacing === "number") detailParts.push(`Row spacing ${parsed.row_spacing}`);
    if (typeof parsed.spread === "number") detailParts.push(`Spread ${parsed.spread}`);
    if (typeof parsed.height === "number") detailParts.push(`Height ${parsed.height}`);
    if (parsed.sun_requirements?.trim()) detailParts.push(`Sun: ${parsed.sun_requirements.trim()}`);
    if (parsed.sowing_method?.trim()) detailParts.push(`Sow: ${parsed.sowing_method.trim()}`);

    const companionSnippet = parsed.gardenme?.companionPlantingNotes?.[0]?.trim();
    const bestSnippetSource = companionSnippet || parsed.description?.trim();
    const descriptionSnippet = bestSnippetSource
      ? `${bestSnippetSource.slice(0, 120)}${bestSnippetSource.length > 120 ? "..." : ""}`
      : undefined;

    return {
      ...(detailParts.length > 0 ? { detailLine: detailParts.join(" - ") } : {}),
      ...(descriptionSnippet ? { descriptionSnippet } : {}),
    };
  } catch {
    return {};
  }
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[()[\],.:;'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSingularPluralEquivalent(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const singular = (value: string): string => {
    if (value.endsWith("es") && value.length > 3) return value.slice(0, -2);
    if (value.endsWith("s") && value.length > 2) return value.slice(0, -1);
    return value;
  };
  return singular(left) === singular(right);
}

function isLikelySpecificVarietyName(commonName: string, query: string): boolean {
  const normalized = normalizeSearchText(commonName);
  if (!normalized || !query) return false;
  if (normalized === query) return false;
  if (!normalized.includes(query)) return false;

  const tokenCount = normalized.split(" ").length;
  const hasDelimiter = /[()\-:,/]/.test(commonName);
  const hasVarietyKeyword = /\b(variety|cultivar|hybrid|f1|heirloom)\b/i.test(commonName);

  return hasVarietyKeyword || hasDelimiter || tokenCount >= 3;
}

function ToggleSwitch(props: {
  label: string;
  value: boolean;
  onToggle: (nextValue: boolean) => void;
  theme: import("@/ui/theme/themeTokens").ThemeTokens;
}) {
  return (
    <Pressable style={[styles.switchRow, { backgroundColor: props.theme.secondaryActionBackground }]} onPress={() => props.onToggle(!props.value)}>
      <Text style={[styles.switchLabel, { color: props.theme.secondaryActionText }]}>{props.label}</Text>
      <View style={[styles.switchTrack, { backgroundColor: props.value ? props.theme.toggleOnBackground : props.theme.toggleOffBackground }]}>
        <View style={[styles.switchThumb, { backgroundColor: props.theme.toggleThumbColor }, props.value && styles.switchThumbActive]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F0F6EE" },
  container: { padding: 16, gap: 12, paddingBottom: 28 },
  title: { fontSize: 26, fontWeight: "800", color: "#1D3D2A" },
  subtitle: { color: "#4A6553", marginTop: -2 },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D8E5D5",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#274634" },
  listControls: { gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#BFD2BC",
    backgroundColor: "#F8FCF7",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#1F3B2D",
  },
  bulkInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 110,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#1F3B2D",
  },
  addRow: { flexDirection: "row", justifyContent: "flex-end" },
  primaryButton: {
    backgroundColor: "#2E6C49",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700" },
  secondaryButton: {
    backgroundColor: "#E7EFE5",
    borderColor: "#BDD6C3",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  secondaryButtonText: { color: "#2A5E40", fontWeight: "700" },
  buttonDisabled: { opacity: 0.45 },
  helper: { color: "#587261", fontSize: 13 },
  errorText: { color: "#8C3A2D", fontSize: 12, fontWeight: "600" },
  importSection: { gap: 8, marginTop: 2 },
  unmatchedSection: { gap: 6, marginTop: 4 },
  configRow: { gap: 6 },
  configLabel: { color: "#244130", fontWeight: "700" },
  configChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  configChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#D9E7D8",
  },
  configChipActive: { backgroundColor: "#9BC8A4" },
  configChipText: { color: "#264433", textTransform: "capitalize" },
  suggestionsBox: {
    borderWidth: 1,
    borderColor: "#D4E2D2",
    borderRadius: 10,
    overflow: "hidden",
  },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  loadingText: { color: "#466252" },
  emptySuggestion: { padding: 10, color: "#587261" },
  suggestionRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#E6EEE4",
  },
  suggestionMain: { flex: 1, gap: 2 },
  suggestionName: { color: "#1E3E2E", fontWeight: "700" },
  suggestionMeta: { color: "#597363", fontSize: 12 },
  suggestionTag: {
    backgroundColor: "#E7EFE5",
    color: "#2A5E40",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontWeight: "700",
    fontSize: 11,
    overflow: "hidden",
  },
  suggestionMoreButton: {
    borderTopWidth: 1,
    borderTopColor: "#E6EEE4",
    paddingHorizontal: 10,
    paddingVertical: 9,
    alignItems: "center",
  },
  suggestionMoreText: { color: "#2A5E40", fontWeight: "700", fontSize: 12 },
  wishRow: {
    borderWidth: 1,
    borderColor: "#D8E5D5",
    borderRadius: 10,
    padding: 10,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 10,
  },
  compactHeader: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  compactHeaderMain: { flex: 1, gap: 2 },
  compactHeaderMeta: { fontSize: 12 },
  compactHeaderCaret: { fontSize: 16, fontWeight: "700" },
  wishMain: { flex: 1, gap: 2 },
  wishName: { color: "#20402F", fontWeight: "700" },
  descriptionToggle: { marginTop: 2 },
  descriptionToggleText: { color: "#2A5E40", fontSize: 12, fontWeight: "700" },
  descriptionBody: {
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#F4F9F2",
    color: "#4D6758",
    fontSize: 12,
  },
  dataPanel: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    gap: 8,
  },
  dataGrid: { gap: 8 },
  dataField: { gap: 4 },
  dataLabel: { fontSize: 12, fontWeight: "700" },
  dataActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  wishMeta: { color: "#5A7363", fontSize: 12 },
  inlineControls: { marginTop: 6, gap: 6 },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  qtyLabel: { color: "#355847", fontWeight: "700", fontSize: 12 },
  qtyButton: {
    backgroundColor: "#E7EFE5",
    borderColor: "#BDD6C3",
    borderWidth: 1,
    borderRadius: 999,
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyButtonText: { color: "#2A5E40", fontWeight: "800", fontSize: 14 },
  qtyValue: { minWidth: 20, textAlign: "center", color: "#20402F", fontWeight: "700" },
  inlineInput: {
    borderWidth: 1,
    borderColor: "#D0DFCD",
    backgroundColor: "#FAFCF9",
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#1F3B2D",
  },
  rowActions: { gap: 8, alignItems: "flex-end" },
  cloneInlineButton: {
    backgroundColor: "#EAF2E7",
    borderColor: "#C9DAC7",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cloneInlineButtonText: { color: "#2F6246", fontWeight: "700", fontSize: 12 },
  saveInlineButton: {
    backgroundColor: "#E5F0E7",
    borderColor: "#BDD6C3",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  saveInlineButtonText: { color: "#2C6547", fontWeight: "700", fontSize: 12 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    backgroundColor: "#EAF2E7",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
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
  removeButton: {
    backgroundColor: "#F4E6E4",
    borderColor: "#E3C3BE",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  removeButtonText: { color: "#8C3A2D", fontWeight: "700", fontSize: 12 },
  blockingOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  blockingOverlayText: { fontSize: 14, fontWeight: "700", textAlign: "center" },
  blockingOverlaySubtext: { fontSize: 12, textAlign: "center" },
});
