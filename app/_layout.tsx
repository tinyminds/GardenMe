import { Stack } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import { initDatabase } from "@/core/db/sqlite";
import { runMigrations } from "@/core/db/migrate";
import { loadAppPreferences, saveAppPreferences } from "@/core/settings/appPreferences";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import { queryClient } from "@/state/queryClient";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { AppTopBar } from "@/ui/components/AppTopBar";
import { PersistentNav } from "@/ui/components/PersistentNav";
import { ThemeProvider, useTheme } from "@/ui/theme/ThemeProvider";
import { DEFAULT_THEME_TOKENS } from "@/ui/theme/themeTokens";

const gardenRepository = new SqliteGardenRepository();

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await initDatabase();
      await runMigrations(db);
      setReady(true);
    })().catch((err) => {
      console.error("Database init failed", err);
    });
  }, []);

  useEffect(() => {
    if (Constants.appOwnership === "expo") return;
    void (async () => {
      try {
        const Notifications = await import("expo-notifications");
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        });
      } catch {
        // Ignore notification setup errors in unsupported runtimes.
      }
    })();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={DEFAULT_THEME_TOKENS.primaryActionBackground} />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ThemedShell />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function ThemedShell() {
  const { theme } = useTheme();
  return (
    <View style={[styles.shell, { backgroundColor: theme.appBackground }]}>
      <SelectedGardenBootstrap />
      <AppTopBar />
      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
      <PersistentNav />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: DEFAULT_THEME_TOKENS.appBackground },
  content: { flex: 1 },
});

function SelectedGardenBootstrap() {
  const selectedGardenId = useSelectedGardenStore((state) => state.selectedGardenId);
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [preferences, gardens] = await Promise.all([loadAppPreferences(), gardenRepository.list()]);
      const preferred = preferences.activeGardenId;
      const exists = preferred ? gardens.some((garden) => garden.id === preferred) : false;
      const next = exists ? preferred : gardens[0]?.id ?? null;
      if (!active) return;
      if (next !== selectedGardenId) setSelectedGardenId(next);
      setHydrated(true);
    })().catch(() => {
      if (active) setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      const existing = await loadAppPreferences();
      if (existing.activeGardenId === selectedGardenId) return;
      await saveAppPreferences({
        ...existing,
        activeGardenId: selectedGardenId,
      });
    })().catch(() => undefined);
  }, [hydrated, selectedGardenId]);

  return null;
}
