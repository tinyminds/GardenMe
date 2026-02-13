import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { getControlShape } from "@/ui/theme/controlTokens";

type ChoiceChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  capitalize?: boolean;
};

export function ChoiceChip(props: ChoiceChipProps) {
  const { theme } = useTheme();
  const shape = getControlShape(theme);
  const selected = Boolean(props.selected);
  
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || !props.onPress}
      style={[
        styles.chip,
        {
          borderTopLeftRadius: shape.chipLeftRadius,
          borderBottomLeftRadius: shape.chipLeftRadius,
          borderTopRightRadius: shape.chipRightRadius,
          borderBottomRightRadius: shape.chipRightRadius,
          backgroundColor: selected ? theme.chipActiveBackground : theme.chipBackground,
          borderWidth: 1,
          borderColor: theme.chipBorder,
          opacity: props.disabled ? 0.55 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: selected ? theme.chipActiveText : theme.chipText,
            textTransform: props.capitalize ? "capitalize" : "none",
          },
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  text: {
    fontWeight: "700",
    fontSize: 12,
  },
});
