import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { useTheme } from "@/ui/theme/ThemeProvider";

type CheckItem = {
  id: string;
  label: string;
};

const CHECKS: CheckItem[] = [
  { id: "primary_button", label: "Primary button state" },
  { id: "secondary_button", label: "Secondary button state" },
  { id: "disabled_button", label: "Disabled button state" },
  { id: "danger_button", label: "Danger/delete button state" },
  { id: "toggle_states", label: "Toggle on/off visibility" },
  { id: "chips", label: "Chip contrast and spacing" },
  { id: "map_bed", label: "Map bed fill + outline" },
  { id: "map_lawn", label: "Map lawn stripes + outline" },
  { id: "map_deck", label: "Map deck stripes + outline" },
  { id: "modal", label: "Modal backdrop + surface contrast" },
];

export default function ThemeQAScreen() {
  const { theme } = useTheme();
  const [doneById, setDoneById] = useState<Record<string, boolean>>({});

  const doneCount = useMemo(
    () => CHECKS.filter((item) => doneById[item.id]).length,
    [doneById]
  );

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Theme QA</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          Quick visual checklist for token coverage.
        </Text>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.metric, { color: theme.textPrimary }]}>
            {doneCount}/{CHECKS.length} checks done
          </Text>

          <View style={styles.row}>
            <View style={[styles.pill, { backgroundColor: theme.primaryActionBackground }]}>
              <Text style={[styles.pillText, { color: theme.primaryActionText }]}>Primary</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: theme.secondaryActionBackground }]}>
              <Text style={[styles.pillText, { color: theme.secondaryActionText }]}>Secondary</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: theme.dangerActionBackground }]}>
              <Text style={[styles.pillText, { color: theme.dangerActionText }]}>Delete</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: theme.disabledActionBackground }]}>
              <Text style={[styles.pillText, { color: theme.disabledActionText }]}>Disabled</Text>
            </View>
          </View>

          <View style={styles.row}>
            <TogglePreview on={true} theme={theme} />
            <TogglePreview on={false} theme={theme} />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Map Preview</Text>
          <Svg width={280} height={140}>
            <Rect x={2} y={2} width={276} height={136} rx={12} fill={theme.mapBoundaryFill} stroke={theme.mapBoundaryStroke} strokeWidth={2} />
            {[40, 80, 120, 160, 200, 240].map((x) => (
              <Line key={`v-${x}`} x1={x} y1={4} x2={x} y2={136} stroke={theme.gridLineColor} strokeWidth={1} />
            ))}
            {[36, 68, 100].map((y) => (
              <Line key={`h-${y}`} x1={4} y1={y} x2={276} y2={y} stroke={theme.gridLineColor} strokeWidth={1} />
            ))}
            <Rect x={16} y={16} width={74} height={46} rx={8} fill={theme.mapBedFill} stroke={theme.mapBedStroke} strokeWidth={2} />
            <Rect x={104} y={16} width={74} height={46} rx={8} fill={theme.mapLawnFill} stroke={theme.mapLawnStroke} strokeWidth={2} />
            {[-8, 4, 16, 28, 40, 52, 64, 76].map((offset) => (
              <Line key={`l-${offset}`} x1={112 + offset} y1={14} x2={138 + offset} y2={66} stroke={theme.mapLawnStroke} strokeWidth={1.4} opacity={0.7} />
            ))}
            <Rect x={192} y={16} width={74} height={46} rx={8} fill={theme.mapDeckFill} stroke={theme.mapDeckStroke} strokeWidth={2} />
            {[-8, 0, 8, 16, 24, 32, 40, 48, 56, 64, 72].map((offset) => (
              <Line key={`d-${offset}`} x1={200 + offset} y1={14} x2={226 + offset} y2={66} stroke={theme.mapDeckStroke} strokeWidth={1.1} opacity={0.75} />
            ))}
          </Svg>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Checklist</Text>
          {CHECKS.map((item) => {
            const checked = Boolean(doneById[item.id]);
            return (
              <Pressable
                key={item.id}
                onPress={() => setDoneById((prev) => ({ ...prev, [item.id]: !checked }))}
                style={[styles.checkRow, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}
              >
                <Text style={[styles.checkLabel, { color: theme.textPrimary }]}>{item.label}</Text>
                <View
                  style={[
                    styles.checkBadge,
                    { backgroundColor: checked ? theme.primaryActionBackground : theme.secondaryActionBackground },
                  ]}
                >
                  <Text style={[styles.checkBadgeText, { color: checked ? theme.primaryActionText : theme.secondaryActionText }]}>
                    {checked ? "Done" : "Todo"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function TogglePreview(props: { on: boolean; theme: ReturnType<typeof useTheme>["theme"] }) {
  return (
    <View
      style={[
        styles.toggleTrack,
        { backgroundColor: props.on ? props.theme.toggleOnBackground : props.theme.toggleOffBackground },
      ]}
    >
      <View
        style={[
          styles.toggleThumb,
          { backgroundColor: props.theme.toggleThumbColor, marginLeft: props.on ? 20 : 2 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  container: { padding: 16, paddingBottom: 120, gap: 12 },
  title: { fontSize: 26, fontWeight: "800" },
  subtitle: { fontSize: 13, marginTop: -2 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  metric: { fontWeight: "800" },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  pillText: { fontSize: 12, fontWeight: "700" },
  toggleTrack: { width: 42, height: 24, borderRadius: 999, paddingHorizontal: 2, justifyContent: "center" },
  toggleThumb: { width: 18, height: 18, borderRadius: 999 },
  checkRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  checkLabel: { fontWeight: "600", flex: 1 },
  checkBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  checkBadgeText: { fontWeight: "700", fontSize: 11 },
});
