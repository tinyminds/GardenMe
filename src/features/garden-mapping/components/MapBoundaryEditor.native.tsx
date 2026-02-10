import { memo, useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polygon } from "react-native-maps";

export type LatLngPoint = { latitude: number; longitude: number };

export type MapBoundaryEditorProps = {
  center: LatLngPoint;
  points: LatLngPoint[];
  mapType?: "standard" | "satellite" | "hybrid";
  selectedPointIndex: number | null;
  onMapPress: (point: LatLngPoint) => void;
  onSelectPoint: (index: number) => void;
  onDragPoint: (index: number, point: LatLngPoint) => void;
  onRequestSnapshot?: (capture: () => Promise<string>) => void;
};

function MapBoundaryEditor(props: MapBoundaryEditorProps) {
  const mapRef = useRef<MapView | null>(null);

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

  const captureSnapshot = useCallback(async () => {
    const map = mapRef.current;
    if (!map) {
      throw new Error("Map is not ready");
    }

    if (props.points.length >= 3) {
      map.fitToCoordinates(props.points, {
        edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
        animated: false,
      });
      await wait(220);
    }

    const uri = await map.takeSnapshot({
      width: 1000,
      height: 700,
      format: "jpg",
      quality: 0.92,
      result: "file",
    });
    return uri;
  }, [props.points]);

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
      >
        {props.points.length >= 2 && (
          <Polygon
            coordinates={props.points}
            strokeColor="#2D6A49"
            fillColor="rgba(53,130,82,0.25)"
            strokeWidth={3}
          />
        )}

        {props.points.map((point, index) => (
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

const styles = StyleSheet.create({
  wrap: { height: 340, borderRadius: 12, overflow: "hidden" },
  map: { flex: 1 },
});
