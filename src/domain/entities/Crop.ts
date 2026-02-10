export enum CropFamily {
  NIGHTSHADE = "nightshade",
  BRASSICA = "brassica",
  LEGUME = "legume",
  ALLIUM = "allium",
}

export interface Crop {
  id: string;
  commonName: string;
  family: CropFamily;
  preferredSun: string[];
  drainageTolerance: string[];
  minTempC: number;
  maxTempC: number;
  sowMonths: number[];
  transplantMonths: number[];
}
