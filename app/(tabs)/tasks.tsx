import { Text, View } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";

export default function TasksTabScreen() {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.appBackground }}>
      <Text style={{ color: theme.textPrimary }}>Tasks screen coming next.</Text>
    </View>
  );
}
