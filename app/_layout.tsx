import { Stack } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { initDatabase } from "@/core/db/sqlite";
import { runMigrations } from "@/core/db/migrate";
import { queryClient } from "@/state/queryClient";

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
        <ActivityIndicator size="large" color="#2F6F4F" />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
