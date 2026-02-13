import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/ui/theme/ThemeProvider";

export function AppTopBar() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [logoFailed, setLogoFailed] = useState(false);

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
      {logoFailed ? (
        <Text style={[styles.title, { color: theme.textPrimary }]}>GardenMe</Text>
      ) : (
        <Image
          source={require("../../../assets/logo-wordmark.png")}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="GardenMe"
          onError={() => setLogoFailed(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    paddingBottom: 10,
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
  },
  logo: {
    width: 120,
    height: 24,
  },
});
