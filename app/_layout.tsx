import { Stack } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { initDatabase } from "@/core/db/sqlite";
import { runMigrations } from "@/core/db/migrate";
import { queryClient } from "@/state/queryClient";
import { AppTopBar } from "@/ui/components/AppTopBar";
import { PersistentNav } from "@/ui/components/PersistentNav";
import { ThemeProvider, useTheme } from "@/ui/theme/ThemeProvider";
import { DEFAULT_THEME_TOKENS } from "@/ui/theme/themeTokens";

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
