import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { getControlShape } from "@/ui/theme/controlTokens";

export function StatusChip(props: { label: string }) {
  const { theme } = useTheme();
  const shape = getControlShape(theme);
  return (
    <View
      style={[
        styles.chip,
        {
          borderTopLeftRadius: shape.chipLeftRadius,
          borderBottomLeftRadius: shape.chipLeftRadius,
          borderTopRightRadius: shape.chipRightRadius,
          borderBottomRightRadius: shape.chipRightRadius,
          backgroundColor: theme.statusChipBackground,
          borderWidth: 1,
          borderColor: theme.statusChipBorder,
        },
      ]}
    >
      <Text style={[styles.text, { color: theme.statusChipText }]}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: "700",
  },
});
