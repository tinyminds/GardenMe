import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function AppTopBar() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 8) }]}>
      <Text style={styles.title}>GardenMe</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#D7E2D5",
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#23412E",
  },
});
