export type PlantSource = "trefle" | "manual";

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
  bedId?: string;
  isPerennial: boolean;
  varietyName?: string;
  supportNeeded: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GardenCropWishlistItemView extends GardenCropWishlistItem {
  plant: PlantCatalogEntry;
  bedName?: string;
}
