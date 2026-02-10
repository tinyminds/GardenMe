import type { Bed } from "@/domain/entities/Bed";

export interface BedRepository {
  listByGarden(gardenId: string): Promise<Bed[]>;
  create(bed: Bed): Promise<void>;
  update(bed: Bed): Promise<void>;
  delete(id: string, gardenId: string): Promise<void>;
}
