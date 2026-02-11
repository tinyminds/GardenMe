import { memo, useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polygon } from "react-native-maps";

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

function MapBoundaryEditor(props: MapBoundaryEditorProps) {
  const mapRef = useRef<MapView | null>(null);
  const [hideOverlaysForSnapshot, setHideOverlaysForSnapshot] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 1000, height: 700 });

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.animateToRegion(
      {
        latitude: props.center.latitude,
        longitude: props.center.longitude,
        latitudeDelta: 0.004,
        longitudeDelta: 0.004,
      },
      250
    );
  }, [props.center.latitude, props.center.longitude]);

  const captureSnapshot = useCallback(async (): Promise<MapSnapshotResult> => {
    const map = mapRef.current;
    if (!map) {
      throw new Error("Map is not ready");
    }

    if (props.points.length >= 3) {
      setHideOverlaysForSnapshot(true);
      await wait(80);
    }

    const projectedBoundary: SnapshotBoundaryPoint[] = [];
    if (props.points.length >= 3) {
      const points = await Promise.all(
        props.points.map((point) => map.pointForCoordinate(point))
      );
      projectedBoundary.push(
        ...points.map((point) => ({
          x: clamp(point.x / Math.max(mapSize.width, 1), 0, 1),
          y: clamp(point.y / Math.max(mapSize.height, 1), 0, 1),
        }))
      );
    }

    try {
      const uri = await map.takeSnapshot({
        width: Math.max(1, Math.round(mapSize.width)),
        height: Math.max(1, Math.round(mapSize.height)),
        format: "jpg",
        quality: 0.92,
        result: "file",
      });
      return {
        uri,
        width: Math.max(1, Math.round(mapSize.width)),
        height: Math.max(1, Math.round(mapSize.height)),
        boundary: projectedBoundary,
      };
    } finally {
      setHideOverlaysForSnapshot(false);
    }
  }, [mapSize.height, mapSize.width, props.points]);

  useEffect(() => {
    if (!props.onRequestSnapshot) return;
    props.onRequestSnapshot(captureSnapshot);
  }, [captureSnapshot, props.onRequestSnapshot]);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType={props.mapType ?? "standard"}
        initialRegion={{
          latitude: props.center.latitude,
          longitude: props.center.longitude,
          latitudeDelta: 0.004,
          longitudeDelta: 0.004,
        }}
        onPress={(event) => {
          const { latitude, longitude } = event.nativeEvent.coordinate;
          props.onMapPress({ latitude, longitude });
        }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width > 0 && height > 0) {
            setMapSize({ width, height });
          }
        }}
      >
        {props.points.length >= 2 && !hideOverlaysForSnapshot && (
          <Polygon
            coordinates={props.points}
            strokeColor="#2D6A49"
            fillColor="rgba(53,130,82,0.25)"
            strokeWidth={3}
          />
        )}

        {!hideOverlaysForSnapshot && props.points.map((point, index) => (
          <Marker
            key={`map-point-${index.toString()}`}
            coordinate={point}
            draggable
            pinColor={props.selectedPointIndex === index ? "#E85D2A" : "#2F6F4F"}
            onPress={() => props.onSelectPoint(index)}
            onDragEnd={(event) => {
              const { latitude, longitude } = event.nativeEvent.coordinate;
              props.onDragPoint(index, { latitude, longitude });
            }}
          />
        ))}
      </MapView>
    </View>
  );
}

export default memo(MapBoundaryEditor);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  wrap: { height: 340, borderRadius: 12, overflow: "hidden" },
  map: { flex: 1 },
});
