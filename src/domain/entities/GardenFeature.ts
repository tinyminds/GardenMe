export enum GardenFeatureType {
  BED = "bed",
  LAWN = "lawn",
  TREE = "tree",
  SHRUB = "shrub",
  HEDGE = "hedge",
  PATH = "path",
  WALL = "wall",
  FENCE = "fence",
  TRELLIS = "trellis",
  PATIO = "patio",
  DECK = "deck",
}

export interface Point2D {
  x: number;
  y: number;
}

export interface GardenFeature {
  id: string;
  gardenId: string;
  type: GardenFeatureType;
  name: string;
  polygon: Point2D[];
  createdAt: string;
  updatedAt: string;
}
