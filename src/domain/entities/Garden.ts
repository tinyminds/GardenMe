export type UUID = string;

export interface GardenScaleCalibration {
  method: "map_zoom" | "reference_line" | "map_polygon";
  p1?: { x: number; y: number };
  p2?: { x: number; y: number };
  referenceMeters?: number;
  metersPerPixel: number;
  baseWidth: number;
  baseHeight: number;
  latitude?: number;
  zoomLevel?: number;
  boundaryPolygon?: { x: number; y: number }[];
  boundaryGeoPolygon?: { latitude: number; longitude: number }[];
  boundaryAreaSqM?: number;
  manualLengthM?: number;
  manualWidthM?: number;
  orientationDegrees?: number;
  showBaseImage?: boolean;
  showGridOverlay?: boolean;
}

export interface Garden {
  id: UUID;
  name: string;
  latitude: number;
  longitude: number;
  locationLabel?: string;
  photoUri?: string;
  imageSourceType?: "photo" | "satellite";
  scaleCalibration?: GardenScaleCalibration;
  createdAt: string;
  updatedAt: string;
}
