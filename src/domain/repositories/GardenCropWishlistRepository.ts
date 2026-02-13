import type {
  GardenCropPlantingHistoryItem,
  GardenCropWishlistItemView,
  PlantingEndState,
} from "@/domain/entities/Plant";

export interface AddGardenCropItemInput {
  gardenId: string;
  plantCatalogId: string;
  status: "wanted" | "already_growing";
  startedIndoorsAt?: string | null;
  bedId?: string;
  isPerennial?: boolean;
  varietyName?: string;
  supportNeeded?: boolean;
  quantity?: number;
}

export interface UpdateGardenCropItemInput {
  id: string;
  status: "wanted" | "already_growing";
  startedIndoorsAt?: string | null;
  bedId?: string;
  isPerennial?: boolean;
  varietyName?: string;
  supportNeeded?: boolean;
  quantity?: number;
}

export interface GardenCropWishlistRepository {
  listByGarden(gardenId: string): Promise<GardenCropWishlistItemView[]>;
  listPlantingsByGarden(gardenId: string): Promise<GardenCropPlantingHistoryItem[]>;
  add(input: AddGardenCropItemInput): Promise<void>;
  update(input: UpdateGardenCropItemInput): Promise<void>;
  markPlanted(input: { entryId: string; bedId: string; plantedAt?: string }): Promise<void>;
  finishPlanting(input: { entryId: string; endState: PlantingEndState; endedAt?: string; notes?: string }): Promise<void>;
  removePlantingHistory(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}
