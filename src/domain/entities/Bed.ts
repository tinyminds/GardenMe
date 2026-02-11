export enum SunExposure {
  FULL_SUN = "full_sun",
  PART_SUN = "part_sun",
  SHADE = "shade",
}

export enum Drainage {
  GOOD = "good",
  MEDIUM = "medium",
  POOR = "poor",
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Bed {
  id: string;
  gardenId: string;
  name: string;
  polygon: Point2D[];
  sunExposure: SunExposure;
  drainage: Drainage;
  containsPerennials: boolean;
  perennialPlantsCsv?: string;
  isRaisedBed: boolean;
  hasIrrigation: boolean;
  soilNotes?: string;
  createdAt: string;
  updatedAt: string;
}
