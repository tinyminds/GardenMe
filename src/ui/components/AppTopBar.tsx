import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/ui/theme/ThemeProvider";

export function AppTopBar() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingTop: Math.max(insets.top, 8),
          backgroundColor: theme.surfaceBackground,
          borderBottomColor: theme.borderColor,
        },
      ]}
    >
      <Text style={[styles.title, { color: theme.textPrimary }]}>GardenMe</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
  },
});
