import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { getControlShape } from "@/ui/theme/controlTokens";

type SegmentedChoiceOption = {
  id: string;
  label: string;
};

export function SegmentedChoice(props: {
  options: SegmentedChoiceOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { theme } = useTheme();
  const shape = getControlShape(theme);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <View
        style={[
          styles.group,
          {
            borderWidth: shape.borderWidth,
            borderRadius: shape.segmentRadius,
            backgroundColor: theme.filterControlBackground,
            borderColor: theme.filterControlBorder,
          },
        ]}
      >
        {props.options.map((option) => {
          const selected = option.id === props.selectedId;
          return (
            <Pressable
              key={option.id}
              style={[
                styles.option,
                {
                  borderWidth: shape.borderWidth,
                  borderRadius: shape.segmentOptionRadius,
                  backgroundColor: selected ? theme.filterControlActiveBackground : "transparent",
                  borderColor: selected ? theme.filterControlActiveBorder : "transparent",
                },
              ]}
              onPress={() => props.onSelect(option.id)}
            >
              <Text
                style={[
                  styles.optionText,
                  {
                    color: selected ? theme.filterControlActiveText : theme.filterControlText,
                  },
                ]}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { gap: 8 },
  group: {
    flexDirection: "row",
    alignItems: "center",
    padding: 3,
    gap: 2,
  },
  option: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    maxWidth: 180,
  },
  optionText: {
    fontWeight: "700",
    fontSize: 12,
  },
});
