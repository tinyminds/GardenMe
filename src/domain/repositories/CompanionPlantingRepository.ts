import type { CompanionPlantingRelation } from "@/domain/entities/CompanionPlanting";

export interface CompanionPlantingRepository {
  listAll(): Promise<CompanionPlantingRelation[]>;
}
