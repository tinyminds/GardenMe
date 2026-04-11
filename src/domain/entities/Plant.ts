export type PlantSource = "growstuff" | "manual" | "gbif" | "wikidata";

export interface PlantCatalogEntry {
  id: string;
  source: PlantSource;
  externalId?: string;
  commonName: string;
  scientificName?: string;
  familyName?: string;
  imageUrl?: string;
  metaJson?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GardenCropWishlistItem {
  id: string;
  gardenId: string;
  plantCatalogId: string;
  status: "wanted" | "already_growing";
  startedIndoorsAt?: string;
  bedId?: string;
  isPerennial: boolean;
  varietyName?: string;
  supportNeeded: boolean;
  quantity: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GardenCropWishlistItemView extends GardenCropWishlistItem {
  plant: PlantCatalogEntry;
  bedName?: string;
}

export type PlantingEndState = "harvested" | "done" | "dead";

export interface GardenCropPlantingHistoryItem {
  id: string;
  entryId: string;
  gardenId: string;
  bedId?: string;
  bedName?: string;
  plantedAt: string;
  endedAt?: string;
  endState?: PlantingEndState;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  plant: PlantCatalogEntry;
  varietyName?: string;
}
