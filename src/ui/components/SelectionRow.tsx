import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { getControlShape } from "@/ui/theme/controlTokens";

type SelectionRowProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

export function SelectionRow(props: SelectionRowProps) {
  const { theme } = useTheme();
  const shape = getControlShape(theme);
  return (
    <Pressable
      onPress={props.onPress}
      style={[
        styles.row,
        {
          borderWidth: shape.borderWidth,
          borderRadius: shape.buttonRadius,
          borderColor: props.selected ? theme.primaryActionBackground : theme.borderColor,
          backgroundColor: props.selected ? theme.secondaryActionBackground : theme.appBackground,
        },
      ]}
    >
      <Text style={[styles.text, { color: props.selected ? theme.textPrimary : theme.textPrimary }]}>{props.label}</Text>
      <View
        style={[
          styles.indicator,
          {
            borderColor: props.selected ? theme.primaryActionBackground : theme.borderColor,
            backgroundColor: props.selected ? theme.primaryActionBackground : theme.appBackground,
          },
        ]}
      >
        <Text style={[styles.indicatorText, { color: props.selected ? theme.primaryActionText : theme.textMuted }]}>
          {props.selected ? "x" : ""}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  text: {
    fontWeight: "700",
    flex: 1,
  },
  indicator: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  indicatorText: {
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
  },
});
