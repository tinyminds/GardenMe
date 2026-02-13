import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { useTheme } from "@/ui/theme/ThemeProvider";

export type LatLngPoint = { latitude: number; longitude: number };
export type SnapshotBoundaryPoint = { x: number; y: number };
export type MapSnapshotResult = {
  uri: string;
  width: number;
  height: number;
  boundary: SnapshotBoundaryPoint[];
};

export type MapBoundaryEditorProps = {
  center: LatLngPoint;
  points: LatLngPoint[];
  mapType?: "standard" | "satellite" | "hybrid";
  selectedPointIndex: number | null;
  onMapPress: (point: LatLngPoint) => void;
  onSelectPoint: (index: number) => void;
  onDragPoint: (index: number, point: LatLngPoint) => void;
  onRequestSnapshot?: (capture: () => Promise<MapSnapshotResult>) => void;
};

export default function MapBoundaryEditor(_props: MapBoundaryEditorProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.wrap, { borderColor: theme.borderColor, backgroundColor: theme.surfaceBackground }]}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Map draw is native-only right now.</Text>
      <Text style={[styles.body, { color: theme.textMuted }]}>
        Use Android/iOS for map boundary mode, or use image/manual setup on web.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    minHeight: 120,
    gap: 6,
  },
  title: { fontWeight: "700" },
  body: {},
});
