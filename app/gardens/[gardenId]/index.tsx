import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSelectedGardenStore } from "@/state/selectedGardenStore";
import { useTheme } from "@/ui/theme/ThemeProvider";

export default function GardenWorkspaceRedirectScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ gardenId?: string | string[] }>();
  const gardenId = Array.isArray(params.gardenId) ? params.gardenId[0] : params.gardenId;
  const setSelectedGardenId = useSelectedGardenStore((state) => state.setSelectedGardenId);

  useEffect(() => {
    if (gardenId) setSelectedGardenId(gardenId);
    router.replace("/(tabs)/plan");
  }, [gardenId, setSelectedGardenId]);

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <ActivityIndicator size="large" color={theme.primaryActionBackground} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center", justifyContent: "center" },
});
