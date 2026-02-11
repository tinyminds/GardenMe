import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { SqliteGardenCropWishlistRepository } from "@/infra/repositories/sqlite/SqliteGardenCropWishlistRepository";
import { SqlitePlantCatalogRepository } from "@/infra/repositories/sqlite/SqlitePlantCatalogRepository";
import { SqliteBedRepository } from "@/infra/repositories/sqlite/SqliteBedRepository";
import { searchTreflePlants } from "@/features/plants/services/trefle";
import { polygonArea } from "@/features/garden-mapping/utils/geometry";
import { queryClient } from "@/state/queryClient";
import type { GardenCropWishlistItemView, PlantCatalogEntry } from "@/domain/entities/Plant";

const gardenRepository = new SqliteGardenRepository();
const wishlistRepository = new SqliteGardenCropWishlistRepository();
const plantCatalogRepository = new SqlitePlantCatalogRepository();
const bedRepository = new SqliteBedRepository();

type PlantSuggestion = {
  plantCatalogId: string;
  commonName: string;
  scientificName?: string;
  familyName?: string;
  sourceLabel: "Trefle" | "Manual";
};

type BedSuggestion = {
  bedId: string;
  bedName: string;
  areaRatio: number;
  suggestedPlants: string[];
  needsSupport: boolean;
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
  const [entryStatus, setEntryStatus] = useState<"wanted" | "already_growing">("wanted");
  const [selectedBedId, setSelectedBedId] = useState<string | null>(null);
  const [entryVarietyName, setEntryVarietyName] = useState("");
  const [entrySupportNeeded, setEntrySupportNeeded] = useState(false);
  const [entryDrafts, setEntryDrafts] = useState<Record<string, CropEntryDraft>>({});
  const [listSearch, setListSearch] = useState("");
  const [listSort, setListSort] = useState<"alpha" | "status" | "bed">("alpha");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 280);
    return () => clearTimeout(timeout);
  }, [search]);

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

  const suggestionsQuery = useQuery({
    queryKey: ["plant-suggestions", debouncedSearch],
    enabled: debouncedSearch.length >= 2,
    queryFn: async () => {
      const localMatches = await plantCatalogRepository.searchByName(debouncedSearch, 12);
      let remoteMatches: PlantCatalogEntry[] = [];

      try {
        const trefleHits = await searchTreflePlants(debouncedSearch);
        remoteMatches = await Promise.all(
          trefleHits.map((hit) =>
            plantCatalogRepository.upsert({
              source: "trefle",
              externalId: hit.externalId,
              commonName: hit.commonName,
              ...(hit.scientificName ? { scientificName: hit.scientificName } : {}),
              ...(hit.familyName ? { familyName: hit.familyName } : {}),
              ...(hit.imageUrl ? { imageUrl: hit.imageUrl } : {}),
              metaJson: hit.rawJson,
            })
          )
        );
      } catch {
        // Keep local fallback only.
      }

      const mergedById = new Map<string, PlantCatalogEntry>();
      for (const entry of [...remoteMatches, ...localMatches]) {
        if (!mergedById.has(entry.id)) mergedById.set(entry.id, entry);
      }
      return Array.from(mergedById.values()).slice(0, 12);
    },
  });

  const suggestions = useMemo<PlantSuggestion[]>(() => {
    const dedupedByName = new Map<string, PlantSuggestion>();
    for (const entry of suggestionsQuery.data ?? []) {
      const key = `${entry.commonName.trim().toLowerCase()}::${(entry.scientificName ?? "").trim().toLowerCase()}`;
      if (dedupedByName.has(key)) continue;
      dedupedByName.set(key, {
        plantCatalogId: entry.id,
        commonName: entry.commonName,
        ...(entry.scientificName ? { scientificName: entry.scientificName } : {}),
        ...(entry.familyName ? { familyName: entry.familyName } : {}),
        sourceLabel: entry.source === "trefle" ? "Trefle" : "Manual",
      });
    }
    return Array.from(dedupedByName.values());
  }, [suggestionsQuery.data]);

  const addToWishlistMutation = useMutation({
    mutationFn: async (payload: { plantCatalogId?: string; manualName?: string }) => {
      if (!gardenId) throw new Error("Missing garden id");
      let plantCatalogId = payload.plantCatalogId;
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
        status: entryStatus,
        ...(entryStatus === "already_growing" && selectedBedId ? { bedId: selectedBedId } : {}),
        ...(entryVarietyName.trim() ? { varietyName: entryVarietyName.trim() } : {}),
        ...(entrySupportNeeded ? { supportNeeded: true } : {}),
      });
    },
    onSuccess: async () => {
      setSearch("");
      setDebouncedSearch("");
      setEntryStatus("wanted");
      setSelectedBedId(null);
      setEntryVarietyName("");
      setEntrySupportNeeded(false);
      await queryClient.invalidateQueries({ queryKey: ["garden-grow-list", gardenId] });
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

  const seasonalBedSuggestions = useMemo<BedSuggestion[]>(() => {
    const beds = bedsQuery.data ?? [];
    const wishlist = wishlistQuery.data ?? [];
    if (beds.length === 0 || wishlist.length === 0) return [];

    const occupiedBedIds = new Set(
      wishlist
        .filter((item) => item.status === "already_growing")
        .map((item) => item.bedId)
        .filter((id): id is string => Boolean(id))
    );

    const eligibleBeds = beds
      .filter((bed) => !bed.containsPerennials && !occupiedBedIds.has(bed.id))
      .map((bed) => ({ ...bed, areaRatio: polygonArea(bed.polygon) }))
      .sort((a, b) => b.areaRatio - a.areaRatio);

    if (eligibleBeds.length === 0) return [];

    const wantedPlants = wishlist
      .filter((item) => item.status === "wanted")
      .map((item) => ({
        name: item.varietyName?.trim()
          ? `${item.plant.commonName.trim()} (${item.varietyName.trim()})`
          : item.plant.commonName.trim(),
        supportNeeded: item.supportNeeded,
      }))
      .filter((item) => item.name.length > 0);
    if (wantedPlants.length === 0) return [];

    const dedupedWantedPlants = Array.from(
      wantedPlants.reduce((acc, item) => {
        const key = item.name.trim().toLowerCase();
        if (!acc.has(key)) acc.set(key, item);
        return acc;
      }, new Map<string, (typeof wantedPlants)[number]>()).values()
    );
    if (dedupedWantedPlants.length === 0) return [];

    const prioritizedPlants = [...dedupedWantedPlants].sort(
      (a, b) => Number(b.supportNeeded) - Number(a.supportNeeded)
    );

    const suggestionsOut: BedSuggestion[] = [];
    let cursor = 0;
    for (const bed of eligibleBeds) {
      if (cursor >= prioritizedPlants.length) break;
      const primary = prioritizedPlants[cursor];
      const secondary = prioritizedPlants[cursor + 1];
      const picks = [primary?.name, secondary?.name].filter((value): value is string => Boolean(value));
      if (picks.length === 0 || !primary) continue;
      suggestionsOut.push({
        bedId: bed.id,
        bedName: bed.name,
        areaRatio: bed.areaRatio,
        suggestedPlants: picks,
        needsSupport: Boolean(primary.supportNeeded || secondary?.supportNeeded),
      });
      cursor += 2;
    }
    return suggestionsOut;
  }, [bedsQuery.data, wishlistQuery.data]);

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

  const perennialBedDetails = useMemo(() => {
    const details: Array<{ bedName: string; plants: string[] }> = [];
    for (const bed of bedsQuery.data ?? []) {
      if (!bed.containsPerennials) continue;
      const plants = bed.perennialPlantsCsv
        ? bed.perennialPlantsCsv.split(",").map((value) => value.trim()).filter(Boolean)
        : [];
      details.push({ bedName: bed.name, plants });
    }
    return details;
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
      if (listSort === "status") {
        const statusSort = a.status.localeCompare(b.status);
        if (statusSort !== 0) return statusSort;
      }
      if (listSort === "bed") {
        const bedSort = (a.bedName ?? "").localeCompare(b.bedName ?? "");
        if (bedSort !== 0) return bedSort;
      }
      const nameSort = a.plant.commonName.localeCompare(b.plant.commonName);
      if (nameSort !== 0) return nameSort;
      return (a.varietyName ?? "").localeCompare(b.varietyName ?? "");
    });
    return list;
  }, [wishlistQuery.data, listSearch, listSort]);

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Grow List</Text>
        <Text style={styles.subtitle}>
          {gardenQuery.data?.name
            ? `${gardenQuery.data.name}: track what you want and what is already growing`
            : "Track what is wanted and already growing"}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add Plant Entry</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search plants (Trefle) or type your own"
            style={styles.input}
            autoCapitalize="words"
          />
          <TextInput
            value={entryVarietyName}
            onChangeText={setEntryVarietyName}
            placeholder="Variety (optional, e.g. Beefsteak, Roma)"
            style={styles.input}
            autoCapitalize="words"
          />
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Support Needed</Text>
            <View style={styles.configChips}>
              <Pressable
                style={[styles.configChip, entrySupportNeeded && styles.configChipActive]}
                onPress={() => setEntrySupportNeeded(true)}
              >
                <Text style={styles.configChipText}>Yes</Text>
              </Pressable>
              <Pressable
                style={[styles.configChip, !entrySupportNeeded && styles.configChipActive]}
                onPress={() => setEntrySupportNeeded(false)}
              >
                <Text style={styles.configChipText}>No</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Entry Type</Text>
            <View style={styles.configChips}>
              <Pressable
                style={[styles.configChip, entryStatus === "wanted" && styles.configChipActive]}
                onPress={() => setEntryStatus("wanted")}
              >
                <Text style={styles.configChipText}>Wanted</Text>
              </Pressable>
              <Pressable
                style={[styles.configChip, entryStatus === "already_growing" && styles.configChipActive]}
                onPress={() => setEntryStatus("already_growing")}
              >
                <Text style={styles.configChipText}>Already Growing</Text>
              </Pressable>
            </View>
          </View>
          {entryStatus === "already_growing" && (
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Bed</Text>
              <View style={styles.configChips}>
                {(bedsQuery.data ?? []).map((bed) => (
                  <Pressable
                    key={bed.id}
                    style={[styles.configChip, selectedBedId === bed.id && styles.configChipActive]}
                    onPress={() => setSelectedBedId((current) => (current === bed.id ? null : bed.id))}
                  >
                    <Text style={styles.configChipText}>{bed.name}</Text>
                  </Pressable>
                ))}
              </View>
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
          {!process.env.EXPO_PUBLIC_TREFLE_API_TOKEN && (
            <Text style={styles.helper}>
              Trefle key not set, showing local/manual entries only. Add `EXPO_PUBLIC_TREFLE_API_TOKEN` in `.env` to enable API search.
            </Text>
          )}
          {debouncedSearch.length >= 2 && (
            <View style={styles.suggestionsBox}>
              {suggestionsQuery.isLoading && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#2A5E40" />
                  <Text style={styles.loadingText}>Searching plants...</Text>
                </View>
              )}
              {!suggestionsQuery.isLoading && suggestions.length === 0 && (
                <Text style={styles.emptySuggestion}>No matches. Add as typed plant.</Text>
              )}
              {suggestions.map((item) => (
                <Pressable
                  key={item.plantCatalogId}
                  style={styles.suggestionRow}
                  disabled={addToWishlistMutation.isPending}
                  onPress={() => addToWishlistMutation.mutate({ plantCatalogId: item.plantCatalogId })}
                >
                  <View style={styles.suggestionMain}>
                    <Text style={styles.suggestionName}>{item.commonName}</Text>
                    {item.scientificName && <Text style={styles.suggestionMeta}>{item.scientificName}</Text>}
                    {item.familyName && <Text style={styles.suggestionMeta}>Family: {item.familyName}</Text>}
                  </View>
                  <Text style={styles.suggestionTag}>{item.sourceLabel}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Growing + Wanted</Text>
          <View style={styles.listControls}>
            <TextInput
              value={listSearch}
              onChangeText={setListSearch}
              placeholder="Filter list (name, variety, bed...)"
              style={styles.input}
              autoCapitalize="none"
            />
            <View style={styles.configChips}>
              <Pressable
                style={[styles.configChip, listSort === "alpha" && styles.configChipActive]}
                onPress={() => setListSort("alpha")}
              >
                <Text style={styles.configChipText}>A-Z</Text>
              </Pressable>
              <Pressable
                style={[styles.configChip, listSort === "status" && styles.configChipActive]}
                onPress={() => setListSort("status")}
              >
                <Text style={styles.configChipText}>Status</Text>
              </Pressable>
              <Pressable
                style={[styles.configChip, listSort === "bed" && styles.configChipActive]}
                onPress={() => setListSort("bed")}
              >
                <Text style={styles.configChipText}>Bed</Text>
              </Pressable>
            </View>
          </View>
          {wishlistQuery.isLoading && <Text style={styles.helper}>Loading list...</Text>}
          {!wishlistQuery.isLoading && (wishlistQuery.data?.length ?? 0) === 0 && (
            <Text style={styles.helper}>No plants added yet.</Text>
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
                  return (
                    <>
                <Text style={styles.wishName}>{item.plant.commonName}</Text>
                {item.varietyName && <Text style={styles.wishMeta}>Variety: {item.varietyName}</Text>}
                {item.plant.scientificName && <Text style={styles.wishMeta}>{item.plant.scientificName}</Text>}
                {item.plant.familyName && <Text style={styles.wishMeta}>Family: {item.plant.familyName}</Text>}
                <Text style={styles.wishMeta}>
                  {item.status === "already_growing" ? "Already growing" : "Wanted"}
                  {item.bedName ? ` - ${item.bedName}` : ""}
                  {isPerennialFromBed ? " - Perennial" : ""}
                  {item.supportNeeded ? " - Support needed" : ""}
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
                  <View style={styles.configChips}>
                    <Pressable
                      style={[styles.configChip, (entryDrafts[item.id]?.supportNeeded ?? item.supportNeeded) && styles.configChipActive]}
                      onPress={() =>
                        setEntryDrafts((prev) => ({
                          ...prev,
                          [item.id]: {
                            status: prev[item.id]?.status ?? item.status,
                            bedId: prev[item.id]?.bedId ?? item.bedId ?? null,
                            varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                            supportNeeded: true,
                          },
                        }))
                      }
                    >
                      <Text style={styles.configChipText}>Support Yes</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.configChip, !(entryDrafts[item.id]?.supportNeeded ?? item.supportNeeded) && styles.configChipActive]}
                      onPress={() =>
                        setEntryDrafts((prev) => ({
                          ...prev,
                          [item.id]: {
                            status: prev[item.id]?.status ?? item.status,
                            bedId: prev[item.id]?.bedId ?? item.bedId ?? null,
                            varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                            supportNeeded: false,
                          },
                        }))
                      }
                    >
                      <Text style={styles.configChipText}>Support No</Text>
                    </Pressable>
                  </View>
                  <View style={styles.configChips}>
                    <Pressable
                      style={[styles.configChip, (entryDrafts[item.id]?.status ?? item.status) === "wanted" && styles.configChipActive]}
                      onPress={() =>
                        setEntryDrafts((prev) => ({
                          ...prev,
                          [item.id]: {
                            status: "wanted",
                            bedId: null,
                            varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                            supportNeeded: prev[item.id]?.supportNeeded ?? item.supportNeeded,
                          },
                        }))
                      }
                    >
                      <Text style={styles.configChipText}>Wanted</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.configChip, (entryDrafts[item.id]?.status ?? item.status) === "already_growing" && styles.configChipActive]}
                      onPress={() =>
                        setEntryDrafts((prev) => ({
                          ...prev,
                          [item.id]: {
                            status: "already_growing",
                            bedId: prev[item.id]?.bedId ?? item.bedId ?? null,
                            varietyName: prev[item.id]?.varietyName ?? item.varietyName ?? "",
                            supportNeeded: prev[item.id]?.supportNeeded ?? item.supportNeeded,
                          },
                        }))
                      }
                    >
                      <Text style={styles.configChipText}>Already Growing</Text>
                    </Pressable>
                  </View>
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Suggested Bed Plan (Phase 2)</Text>
          <Text style={styles.helper}>
            Perennial and already-occupied beds are excluded from suggestions.
          </Text>
          {bedsQuery.isLoading && <Text style={styles.helper}>Loading beds...</Text>}
          {!bedsQuery.isLoading && (bedsQuery.data?.length ?? 0) === 0 && (
            <Text style={styles.helper}>No beds yet. Add beds in Garden Mapper first.</Text>
          )}
          {!bedsQuery.isLoading && (wishlistQuery.data?.length ?? 0) === 0 && (
            <Text style={styles.helper}>Add wanted plants to generate suggestions.</Text>
          )}
          {seasonalBedSuggestions.map((suggestion) => (
            <View key={suggestion.bedId} style={styles.suggestionPlanRow}>
              <View style={styles.suggestionPlanMain}>
                <Text style={styles.suggestionPlanBed}>{suggestion.bedName}</Text>
                <Text style={styles.suggestionPlanMeta}>Suggested: {suggestion.suggestedPlants.join(" + ")}</Text>
                {suggestion.needsSupport && <Text style={styles.suggestionPlanMeta}>Supports needed in this bed.</Text>}
              </View>
              <Text style={styles.suggestionPlanArea}>{(suggestion.areaRatio * 100).toFixed(1)}%</Text>
            </View>
          ))}
          {perennialBedDetails.length > 0 && (
            <View style={styles.perennialSection}>
              <Text style={styles.perennialTitle}>Perennial Beds (excluded)</Text>
              {perennialBedDetails.map((detail) => (
                <Text key={detail.bedName} style={styles.perennialItem}>
                  {detail.bedName}: {detail.plants.join(", ")}
                </Text>
              ))}
            </View>
          )}
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
  buttonDisabled: { opacity: 0.45 },
  helper: { color: "#587261", fontSize: 13 },
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
  removeButton: {
    backgroundColor: "#F4E6E4",
    borderColor: "#E3C3BE",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  removeButtonText: { color: "#8C3A2D", fontWeight: "700", fontSize: 12 },
  suggestionPlanRow: {
    borderWidth: 1,
    borderColor: "#D8E5D5",
    borderRadius: 10,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  suggestionPlanMain: { flex: 1, gap: 2 },
  suggestionPlanBed: { color: "#1D3D2A", fontWeight: "800" },
  suggestionPlanMeta: { color: "#567061", fontSize: 12 },
  suggestionPlanArea: {
    backgroundColor: "#E7EFE5",
    color: "#2A5E40",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontWeight: "700",
    fontSize: 11,
  },
  perennialSection: {
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: "#E6EEE4",
    paddingTop: 8,
    gap: 3,
  },
  perennialTitle: { color: "#2D513C", fontWeight: "800", fontSize: 13 },
  perennialItem: { color: "#587261", fontSize: 12 },
});
