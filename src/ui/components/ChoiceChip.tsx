import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";

type ChoiceChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  capitalize?: boolean;
};

export function ChoiceChip(props: ChoiceChipProps) {
  const { theme } = useTheme();
  const selected = Boolean(props.selected);
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || !props.onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.primaryActionBackground : theme.secondaryActionBackground,
          borderColor: theme.borderColor,
          opacity: props.disabled ? 0.55 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: selected ? theme.primaryActionText : theme.secondaryActionText,
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
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  text: {
    fontWeight: "700",
    fontSize: 12,
  },
});

