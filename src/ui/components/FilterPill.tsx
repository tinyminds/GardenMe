import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";

type FilterPillProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
};

export function FilterPill(props: FilterPillProps) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[
        styles.pill,
        {
          backgroundColor: props.selected ? theme.filterControlActiveBackground : theme.filterControlBackground,
          borderColor: props.selected ? theme.filterControlActiveBorder : theme.filterControlBorder,
          opacity: props.disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: props.selected ? theme.filterControlActiveText : theme.filterControlText,
          },
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  text: { fontWeight: "700" },
});

