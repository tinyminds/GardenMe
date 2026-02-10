import type { GardenFeature } from "@/domain/entities/GardenFeature";

export interface GardenFeatureRepository {
  listByGarden(gardenId: string): Promise<GardenFeature[]>;
  create(feature: GardenFeature): Promise<void>;
  update(feature: GardenFeature): Promise<void>;
  delete(id: string, gardenId: string): Promise<void>;
}
