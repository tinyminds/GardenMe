import type { Garden } from "@/domain/entities/Garden";

export interface GardenRepository {
  list(): Promise<Garden[]>;
  getById(id: string): Promise<Garden | null>;
  create(garden: Garden): Promise<void>;
  delete(id: string): Promise<void>;
  updatePhoto(id: string, photoUri: string, sourceType?: "photo" | "satellite"): Promise<void>;
  updateScaleCalibration(
    id: string,
    calibration: NonNullable<Garden["scaleCalibration"]>
  ): Promise<void>;
}
