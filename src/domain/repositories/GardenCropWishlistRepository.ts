import type { GardenCropWishlistItemView } from "@/domain/entities/Plant";

export interface AddGardenCropItemInput {
  gardenId: string;
  plantCatalogId: string;
  status: "wanted" | "already_growing";
  bedId?: string;
  isPerennial?: boolean;
  varietyName?: string;
  supportNeeded?: boolean;
}

export interface UpdateGardenCropItemInput {
  id: string;
  status: "wanted" | "already_growing";
  bedId?: string;
  isPerennial?: boolean;
  varietyName?: string;
  supportNeeded?: boolean;
}

export interface GardenCropWishlistRepository {
  listByGarden(gardenId: string): Promise<GardenCropWishlistItemView[]>;
  add(input: AddGardenCropItemInput): Promise<void>;
  update(input: UpdateGardenCropItemInput): Promise<void>;
  remove(id: string): Promise<void>;
}
