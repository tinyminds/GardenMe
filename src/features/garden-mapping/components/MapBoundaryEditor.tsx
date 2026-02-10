import { Platform } from "react-native";
import type { ComponentType } from "react";
import type { MapBoundaryEditorProps } from "./MapBoundaryEditor.web";

export type { LatLngPoint, MapBoundaryEditorProps } from "./MapBoundaryEditor.web";

const NativeEditor = Platform.OS === "web"
  ? require("./MapBoundaryEditor.web").default
  : require("./MapBoundaryEditor.native").default;

const MapBoundaryEditor = NativeEditor as ComponentType<MapBoundaryEditorProps>;

export default MapBoundaryEditor;

