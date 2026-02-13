import { useMutation } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as FileSystem from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { useGardensQuery } from "@/features/gardens/hooks/useGardensQuery";
import { useGardenSummariesQuery } from "@/features/gardens/hooks/useGardenSummariesQuery";
import { SqliteGardenRepository, type GardenBackupBundle } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { queryClient } from "@/state/queryClient";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { useTheme } from "@/ui/theme/ThemeProvider";

const repository = new SqliteGardenRepository();

export default function GardensTabScreen() {
  const { theme } = useTheme();
  const { data, isLoading, isError } = useGardensQuery();
  const gardens = data ?? [];
  const summariesQuery = useGardenSummariesQuery(gardens);
  const summaries = summariesQuery.data ?? {};
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);
  const [cloneDraft, setCloneDraft] = useState<{ id: string; sourceName: string; name: string } | null>(null);
  const [importDraft, setImportDraft] = useState<{ bundle: GardenBackupBundle; name: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repository.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: async (payload: { id: string; name: string }) => repository.clone(payload.id, { name: payload.name }),
    onSuccess: async (cloned) => {
      setCloneDraft(null);
      setSelectedGardenId(cloned.id);
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
      Alert.alert("Garden cloned", `Created "${cloned.name}".`);
    },
  });

  const exportBackupMutation = useMutation({
    mutationFn: async (payload: { id: string; name: string }) => {
      const bundle = await repository.exportBackupBundle(payload.id);
      const shareAvailable = await Sharing.isAvailableAsync();
      if (!shareAvailable) throw new Error("Sharing is not available on this device.");
      const safeName =
        payload.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "garden";
      const file = new FileSystem.File(FileSystem.Paths.cache, `garden-backup-${safeName}-${Date.now()}.json`);
      file.create({ intermediates: true, overwrite: true });
      file.write(JSON.stringify(bundle, null, 2));
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Export Garden Backup",
        UTI: "public.json",
      });
    },
    onError: (error) => {
      Alert.alert("Export failed", error instanceof Error ? error.message : "Could not export garden backup.");
    },
  });

  const importBackupMutation = useMutation({
    mutationFn: async (payload: { bundle: GardenBackupBundle; name: string }) =>
      repository.importBackupBundle(payload.bundle, { name: payload.name }),
    onSuccess: async (created) => {
      setImportDraft(null);
      setSelectedGardenId(created.id);
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
      Alert.alert("Garden imported", `Created "${created.name}".`);
    },
    onError: (error) => {
      Alert.alert("Import failed", error instanceof Error ? error.message : "Could not import garden backup.");
    },
  });

  const confirmDelete = (id: string, name: string) => {
    Alert.alert("Delete garden", `Delete "${name}" and all beds/features?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  const confirmClone = (id: string, name: string) => {
    setCloneDraft({ id, sourceName: name, name: `${name} (Copy)` });
  };

  const submitClone = () => {
    if (!cloneDraft || cloneMutation.isPending) return;
    const nextName = cloneDraft.name.trim();
    if (!nextName) {
      Alert.alert("Name required", "Enter a name for the cloned garden.");
      return;
    }
    cloneMutation.mutate({ id: cloneDraft.id, name: nextName });
  };

  const startImportBackup = async () => {
    const pick = await DocumentPicker.getDocumentAsync({
      type: ["application/json", "text/plain"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (pick.canceled) return;
    const asset = pick.assets?.[0];
    if (!asset?.uri) {
      Alert.alert("Import failed", "No file selected.");
      return;
    }
    try {
      const file = new FileSystem.File(asset.uri);
      const text = await file.text();
      const parsed = JSON.parse(text) as GardenBackupBundle;
      if (!parsed || parsed.format !== "gardenme-garden-backup-v1" || !parsed.garden?.name) {
        Alert.alert("Invalid backup", "That file is not a valid GardenMe garden backup.");
        return;
      }
      setImportDraft({
        bundle: parsed,
        name: `${parsed.garden.name} (Imported)`,
      });
    } catch {
      Alert.alert("Import failed", "Could not read that backup file.");
    }
  };

  const submitImport = () => {
    if (!importDraft || importBackupMutation.isPending) return;
    const nextName = importDraft.name.trim();
    if (!nextName) {
      Alert.alert("Name required", "Enter a name for the imported garden.");
      return;
    }
    importBackupMutation.mutate({ bundle: importDraft.bundle, name: nextName });
  };

  if (isLoading) return <Text style={[styles.state, { color: theme.textMuted }]}>Loading gardens...</Text>;
  if (isError) return <Text style={[styles.state, { color: theme.textMuted }]}>Could not load gardens.</Text>;

  return (
    <View style={[styles.container, { backgroundColor: theme.appBackground }]}>
      <View style={styles.topActions}>
        <Link href="/gardens/new" style={[styles.addLink, { color: theme.primaryActionBackground }]}>+ New Garden</Link>
        <Pressable
          style={[styles.importButton, { backgroundColor: theme.secondaryActionBackground, borderColor: theme.borderColor }]}
          onPress={() => void startImportBackup()}
          disabled={importBackupMutation.isPending || cloneMutation.isPending || deleteMutation.isPending}
        >
          <Text style={[styles.importButtonText, { color: theme.secondaryActionText }]}>Import backup</Text>
        </Pressable>
      </View>
      <Text style={[styles.noteText, { color: theme.textMuted }]}>Backups do not include bed photos.</Text>
      {cloneMutation.isPending ? (
        <Text style={[styles.state, { color: theme.textMuted, paddingTop: 0, paddingBottom: 8 }]}>Cloning garden...</Text>
      ) : null}
      <FlatList
        data={gardens}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={[styles.state, { color: theme.textMuted }]}>No gardens yet.</Text>}
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.surfaceBackground,
                borderColor: selectedGardenId === item.id ? theme.primaryActionBackground : theme.borderColor,
              },
              selectedGardenId === item.id && styles.cardActive,
            ]}
          >
            <Link href={`/gardens/${item.id}`} asChild>
              <Pressable
                style={styles.cardMain}
                onPress={() => {
                  setSelectedGardenId(item.id);
                }}
              >
                <Text style={[styles.name, { color: theme.textPrimary }]}>{item.name}</Text>
                {item.locationLabel && <Text style={[styles.locationText, { color: theme.textMuted }]}>{item.locationLabel}</Text>}
                <Text style={[styles.coordsText, { color: theme.infoText }]}>Coordinates: {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}</Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.metaChip, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}>Area {item.scaleCalibration?.boundaryAreaSqM ? `${item.scaleCalibration.boundaryAreaSqM.toFixed(1)} sqm` : "not set"}</Text>
                  <Text style={[styles.metaChip, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}>Beds {summaries[item.id]?.bedCount ?? 0}</Text>
                  <Text style={[styles.metaChip, { backgroundColor: theme.secondaryActionBackground, color: theme.secondaryActionText }]}>Features {summaries[item.id]?.featureCount ?? 0}</Text>
                </View>
                <Text style={[styles.statusText, { color: theme.textMuted }]}>
                  {item.scaleCalibration
                    ? (summaries[item.id]?.bedCount ?? 0) > 0 || (summaries[item.id]?.featureCount ?? 0) > 0
                      ? "Designed and in progress"
                      : "Setup done, ready to design"
                    : "Needs setup"}
                </Text>
              </Pressable>
            </Link>
            <Pressable
              style={[styles.cloneButton, { borderColor: theme.borderColor, backgroundColor: theme.secondaryActionBackground }]}
              onPress={() => confirmClone(item.id, item.name)}
              disabled={cloneMutation.isPending || deleteMutation.isPending || exportBackupMutation.isPending}
            >
              <Text style={[styles.cloneButtonText, { color: theme.secondaryActionText }]}>Copy</Text>
            </Pressable>
            <Pressable
              style={[styles.backupButton, { borderColor: theme.borderColor, backgroundColor: theme.secondaryActionBackground }]}
              onPress={() => exportBackupMutation.mutate({ id: item.id, name: item.name })}
              disabled={cloneMutation.isPending || deleteMutation.isPending || exportBackupMutation.isPending}
            >
              <Text style={[styles.cloneButtonText, { color: theme.secondaryActionText }]}>
                {exportBackupMutation.isPending ? "..." : "Backup"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.deleteButton, { borderColor: theme.borderColor, backgroundColor: theme.dangerActionBackground }]}
              onPress={() => confirmDelete(item.id, item.name)}
              disabled={cloneMutation.isPending || deleteMutation.isPending || exportBackupMutation.isPending}
            >
              <Text style={[styles.deleteButtonText, { color: theme.dangerActionText }]}>x</Text>
            </Pressable>
          </View>
        )}
      />

      <Modal visible={Boolean(cloneDraft)} transparent animationType="fade" onRequestClose={() => setCloneDraft(null)}>
        <View style={[styles.modalBackdrop, { backgroundColor: theme.modalBackdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.modalSurfaceBackground, borderColor: theme.modalSurfaceBorder }]}>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Clone Garden</Text>
            <Text style={[styles.modalText, { color: theme.textMuted }]}>
              {cloneDraft ? `Create a full copy of "${cloneDraft.sourceName}".` : ""}
            </Text>
            <TextInput
              value={cloneDraft?.name ?? ""}
              onChangeText={(value) => setCloneDraft((prev) => (prev ? { ...prev, name: value } : prev))}
              placeholder="New garden name"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="words"
              editable={!cloneMutation.isPending}
              style={[
                styles.modalInput,
                {
                  backgroundColor: theme.appBackground,
                  borderColor: theme.borderColor,
                  color: theme.textPrimary,
                },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButtonSecondary, { backgroundColor: theme.secondaryActionBackground }]}
                onPress={() => setCloneDraft(null)}
                disabled={cloneMutation.isPending}
              >
                <Text style={[styles.modalButtonText, { color: theme.secondaryActionText }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButtonPrimary, { backgroundColor: theme.primaryActionBackground }]}
                onPress={submitClone}
                disabled={cloneMutation.isPending}
              >
                <Text style={[styles.modalButtonText, { color: theme.primaryActionText }]}>
                  {cloneMutation.isPending ? "Cloning..." : "Clone"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={Boolean(importDraft)} transparent animationType="fade" onRequestClose={() => setImportDraft(null)}>
        <View style={[styles.modalBackdrop, { backgroundColor: theme.modalBackdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.modalSurfaceBackground, borderColor: theme.modalSurfaceBorder }]}>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Import Garden Backup</Text>
            <Text style={[styles.modalText, { color: theme.textMuted }]}>
              {importDraft ? `Import full data from "${importDraft.bundle.garden.name}".` : ""}
            </Text>
            <TextInput
              value={importDraft?.name ?? ""}
              onChangeText={(value) => setImportDraft((prev) => (prev ? { ...prev, name: value } : prev))}
              placeholder="Imported garden name"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="words"
              editable={!importBackupMutation.isPending}
              style={[
                styles.modalInput,
                {
                  backgroundColor: theme.appBackground,
                  borderColor: theme.borderColor,
                  color: theme.textPrimary,
                },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButtonSecondary, { backgroundColor: theme.secondaryActionBackground }]}
                onPress={() => setImportDraft(null)}
                disabled={importBackupMutation.isPending}
              >
                <Text style={[styles.modalButtonText, { color: theme.secondaryActionText }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButtonPrimary, { backgroundColor: theme.primaryActionBackground }]}
                onPress={submitImport}
                disabled={importBackupMutation.isPending}
              >
                <Text style={[styles.modalButtonText, { color: theme.primaryActionText }]}>
                  {importBackupMutation.isPending ? "Importing..." : "Import"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  topActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  addLink: { marginBottom: 12, fontWeight: "700" },
  noteText: { fontSize: 12, marginTop: -8, marginBottom: 8 },
  importButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  importButtonText: { fontWeight: "700", fontSize: 12 },
  card: {
    position: "relative",
    borderRadius: 12,
    marginBottom: 10,
    overflow: "hidden",
    borderWidth: 1,
  },
  cardActive: { borderWidth: 2 },
  cardMain: { padding: 14, paddingRight: 164, gap: 7 },
  name: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  locationText: { fontWeight: "600" },
  coordsText: { fontSize: 12, marginTop: -1 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 8, marginTop: 3 },
  metaChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "700",
    alignSelf: "flex-start",
  },
  statusText: { fontWeight: "700", marginTop: 2 },
  cloneButton: {
    position: "absolute",
    right: 124,
    top: 10,
    width: 66,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cloneButtonText: { fontWeight: "800", fontSize: 11, lineHeight: 14 },
  backupButton: {
    position: "absolute",
    right: 48,
    top: 10,
    width: 74,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButton: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonText: { fontWeight: "800", fontSize: 16, lineHeight: 18 },
  state: { padding: 20 },
  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  modalCard: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: "800" },
  modalText: { fontSize: 13 },
  modalInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontWeight: "600" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  modalButtonPrimary: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  modalButtonSecondary: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  modalButtonText: { fontWeight: "700", fontSize: 12 },
});

