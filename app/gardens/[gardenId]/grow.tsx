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
};

export default function GardenGrowListScreen() {
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
  const [addError, setAddError] = useState<string | null>(null);

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
        const common = entry.commonName.trim().toLowerCase();
        const scientific = (entry.scientificName ?? "").trim().toLowerCase();
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
        return score;
      };

      return Array.from(mergedById.values())
        .sort((a, b) => {
          const sourceOrder = sourcePriority(a.source) - sourcePriority(b.source);
          if (sourceOrder !== 0) return sourceOrder;
          const scoreOrder = relevanceScore(b) - relevanceScore(a);
          if (scoreOrder !== 0) return scoreOrder;
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

      // Enrich Growstuff catalog metadata in the background so tap-to-add stays instant.
      if (suggestion?.source === "growstuff" && suggestion.externalId) {
        const externalId = suggestion.externalId;
        void (async () => {
          try {
            const details = await fetchGrowstuffCropDetails(externalId);
            if (!details) return;
            const preferredScientificName = pickScientificName(details) || suggestion.scientificName;
            await plantCatalogRepository.upsert({
              source: "growstuff",
              externalId,
              commonName: details.name?.trim() || suggestion.commonName,
              ...(preferredScientificName ? { scientificName: preferredScientificName } : {}),
              ...(suggestion.familyName ? { familyName: suggestion.familyName } : {}),
              ...(details.thumbnail_url?.trim() || suggestion.imageUrl
                ? { imageUrl: details.thumbnail_url?.trim() || suggestion.imageUrl }
                : {}),
              metaJson: buildGrowstuffMetaJson(suggestion.metaJson, details),
            });
          } catch {
            // Ignore enrich failures; entry is already added.
          }
        })();
      }
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
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
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
      const nameSort = a.plant.commonName.localeCompare(b.plant.commonName);
      if (nameSort !== 0) return listSortDirection === "asc" ? nameSort : -nameSort;
      const varietySort = (a.varietyName ?? "").localeCompare(b.varietyName ?? "");
      return listSortDirection === "asc" ? varietySort : -varietySort;
    });
    return list;
  }, [wishlistQuery.data, listSearch, listSortDirection]);

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="always">
        <Text style={styles.title}>Grow List</Text>
        <Text style={styles.subtitle}>
          {gardenQuery.data?.name
            ? `${gardenQuery.data.name}: track wanted and growing plants`
            : "Track wanted and growing plants"}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add Plant</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search plants or type your own"
            style={styles.input}
            autoCapitalize="none"
          />
          {debouncedSearch.length >= 2 && (
            <View style={styles.suggestionsBox}>
              {suggestionsQuery.isLoading && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#2A5E40" />
                  <Text style={styles.loadingText}>Searching plants...</Text>
                </View>
              )}
              {!suggestionsQuery.isLoading && suggestions.length === 0 && (
                <Text style={styles.emptySuggestion}>No matches.</Text>
              )}
              {visibleSuggestions.map((item) => (
                <Pressable
                  key={item.plantCatalogId}
                  style={styles.suggestionRow}
                  disabled={addToWishlistMutation.isPending}
                  onPress={() => addToWishlistMutation.mutate({ suggestion: item })}
                >
                  <View style={styles.suggestionMain}>
                    <Text style={styles.suggestionName}>{item.commonName}</Text>
                    {item.scientificName && <Text style={styles.suggestionMeta}>{item.scientificName}</Text>}
                    {item.familyName && <Text style={styles.suggestionMeta}>Family: {item.familyName}</Text>}
                    {item.detailLine && <Text style={styles.suggestionMeta}>{item.detailLine}</Text>}
                  </View>
                  <Text style={styles.suggestionTag}>{item.sourceLabel}</Text>
                </Pressable>
              ))}
              {suggestions.length > 12 && (
                <Pressable style={styles.suggestionMoreButton} onPress={() => setShowAllSuggestions((value) => !value)}>
                  <Text style={styles.suggestionMoreText}>{showAllSuggestions ? "Show less" : "Show more"}</Text>
                </Pressable>
              )}
            </View>
          )}
          <View style={styles.addRow}>
            <Pressable
              style={[styles.primaryButton, !search.trim() && styles.buttonDisabled]}
              disabled={!search.trim() || addToWishlistMutation.isPending}
              onPress={() => addToWishlistMutation.mutate({ manualName: search })}
            >
              <Text style={styles.primaryButtonText}>Add Typed Plant</Text>
            </Pressable>
          </View>
          {addError && <Text style={styles.errorText}>{addError}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Import From Garden</Text>
          <View style={styles.importSection}>
            <View style={styles.configChips}>
              {(gardensQuery.data ?? [])
                .filter((garden) => garden.id !== gardenId)
                .map((garden) => (
                  <Pressable
                    key={garden.id}
                    style={[styles.configChip, importSourceGardenId === garden.id && styles.configChipActive]}
                    onPress={() => setImportSourceGardenId((current) => (current === garden.id ? null : garden.id))}
                  >
                    <Text style={styles.configChipText}>{garden.name}</Text>
                  </Pressable>
                ))}
            </View>
            {!gardensQuery.isLoading &&
              (gardensQuery.data ?? []).filter((garden) => garden.id !== gardenId).length === 0 && (
                <Text style={styles.helper}>No other gardens yet.</Text>
              )}
            <View style={styles.addRow}>
              <Pressable
                style={[
                  styles.secondaryButton,
                  (!importSourceGardenId || importFromGardenMutation.isPending) && styles.buttonDisabled,
                ]}
                disabled={!importSourceGardenId || importFromGardenMutation.isPending}
                onPress={() => importFromGardenMutation.mutate()}
              >
                <Text style={styles.secondaryButtonText}>
                  {importFromGardenMutation.isPending ? "Importing..." : "Import"}
                </Text>
              </Pressable>
            </View>
            {importMessage && <Text style={styles.helper}>{importMessage}</Text>}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Plant List</Text>
          <View style={styles.listControls}>
            <TextInput
              value={listSearch}
              onChangeText={setListSearch}
              placeholder="Search list"
              style={styles.input}
              autoCapitalize="none"
            />
            <View style={styles.configChips}>
              <Pressable
                style={[styles.configChip, listSortDirection === "asc" && styles.configChipActive]}
                onPress={() => setListSortDirection("asc")}
              >
                <Text style={styles.configChipText}>A-Z</Text>
              </Pressable>
              <Pressable
                style={[styles.configChip, listSortDirection === "desc" && styles.configChipActive]}
                onPress={() => setListSortDirection("desc")}
              >
                <Text style={styles.configChipText}>Z-A</Text>
              </Pressable>
            </View>
          </View>
          {wishlistQuery.isLoading && <Text style={styles.helper}>Loading...</Text>}
          {!wishlistQuery.isLoading && (wishlistQuery.data?.length ?? 0) === 0 && (
            <Text style={styles.helper}>No plants yet.</Text>
          )}
          {!wishlistQuery.isLoading && (wishlistQuery.data?.length ?? 0) > 0 && visibleWishlistItems.length === 0 && (
            <Text style={styles.helper}>No plants match that filter.</Text>
          )}
          {visibleWishlistItems.map((item) => (
            <View key={item.id} style={styles.wishRow}>
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
                <Text style={styles.wishName}>{item.plant.commonName}</Text>
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
                      <Text style={styles.descriptionToggleText}>
                        {isDescriptionExpanded ? "▾ Description" : "▸ Description"}
                      </Text>
                    </Pressable>
                    {isDescriptionExpanded && <Text style={styles.descriptionBody}>{description}</Text>}
                  </>
                )}
                {item.varietyName && <Text style={styles.wishMeta}>Variety: {item.varietyName}</Text>}
                {item.plant.scientificName && <Text style={styles.wishMeta}>{item.plant.scientificName}</Text>}
                {item.plant.familyName && <Text style={styles.wishMeta}>Family: {item.plant.familyName}</Text>}
                <Text style={styles.wishMeta}>
                  {(entryDrafts[item.id]?.status ?? item.status) === "already_growing" ? "Growing now" : "Planned"}
                  {item.bedName ? ` - ${item.bedName}` : ""}
                  {isPerennialFromBed ? " - Perennial" : ""}
                  {(entryDrafts[item.id]?.supportNeeded ?? item.supportNeeded) ? " - Needs support" : ""}
                </Text>
                <View style={styles.inlineControls}>
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
                        },
                      }))
                    }
                    placeholder="Variety (optional)"
                    style={styles.inlineInput}
                    autoCapitalize="words"
                  />
                  <ToggleSwitch
                    label={(entryDrafts[item.id]?.supportNeeded ?? item.supportNeeded) ? "Needs support" : "No support"}
                    value={entryDrafts[item.id]?.supportNeeded ?? item.supportNeeded}
                    onToggle={(nextValue) =>
                      setEntryDrafts((prev) => ({
                        ...prev,
                        [item.id]: {
                          status: prev[item.id]?.status ?? item.status,
                          bedId: prev[item.id]?.bedId ?? item.bedId ?? null,
                          varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                          supportNeeded: nextValue,
                        },
                      }))
                    }
                  />
                  <ToggleSwitch
                    label={(entryDrafts[item.id]?.status ?? item.status) === "already_growing" ? "Growing now" : "Planned"}
                    value={(entryDrafts[item.id]?.status ?? item.status) === "already_growing"}
                    onToggle={(isGrowing) =>
                      setEntryDrafts((prev) => ({
                        ...prev,
                        [item.id]: {
                          status: isGrowing ? "already_growing" : "wanted",
                          bedId: isGrowing ? (prev[item.id]?.bedId ?? item.bedId ?? null) : null,
                          varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                          supportNeeded: prev[item.id]?.supportNeeded ?? item.supportNeeded,
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
                              style={[styles.configChip, selected && styles.configChipActive]}
                              onPress={() =>
                                setEntryDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: {
                                    status: "already_growing",
                                    bedId: selected ? null : bed.id,
                                    varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                                    supportNeeded: prev[item.id]?.supportNeeded ?? item.supportNeeded,
                                  },
                                }))
                              }
                            >
                              <Text style={styles.configChipText}>{bed.name}</Text>
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
                  style={styles.cloneInlineButton}
                  disabled={cloneEntryMutation.isPending}
                  onPress={() => cloneEntryMutation.mutate(item)}
                >
                  <Text style={styles.cloneInlineButtonText}>Clone</Text>
                </Pressable>
                <Pressable
                  style={styles.saveInlineButton}
                  disabled={updateEntryMutation.isPending}
                  onPress={() => updateEntryMutation.mutate(item.id)}
                >
                  <Text style={styles.saveInlineButtonText}>Save</Text>
                </Pressable>
                <Pressable
                  style={styles.removeButton}
                  disabled={removeMutation.isPending}
                  onPress={() => removeMutation.mutate(item.id)}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>

      </ScrollView>
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
      left.supportNeeded !== right.supportNeeded
    ) {
      return false;
    }
  }
  return true;
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
  const single = details.scientific_name?.trim();
  if (single) return single;
  return details.scientific_names?.find((name): name is string => Boolean(name?.trim()))?.trim();
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

function ToggleSwitch(props: {
  label: string;
  value: boolean;
  onToggle: (nextValue: boolean) => void;
}) {
  return (
    <Pressable style={styles.switchRow} onPress={() => props.onToggle(!props.value)}>
      <Text style={styles.switchLabel}>{props.label}</Text>
      <View style={[styles.switchTrack, props.value && styles.switchTrackActive]}>
        <View style={[styles.switchThumb, props.value && styles.switchThumbActive]} />
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
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
  wishMeta: { color: "#5A7363", fontSize: 12 },
  inlineControls: { marginTop: 6, gap: 6 },
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
});
