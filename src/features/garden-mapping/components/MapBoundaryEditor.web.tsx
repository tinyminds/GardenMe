import { StyleSheet, Text, View } from "react-native";

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
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Map draw is native-only right now.</Text>
      <Text style={styles.body}>
        Use Android/iOS for map boundary mode, or use image/manual setup on web.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C8D7C4",
    padding: 12,
    backgroundColor: "#E8EFE5",
    minHeight: 120,
    gap: 6,
  },
  title: { fontWeight: "700", color: "#2B4637" },
  body: { color: "#5B7164" },
});
