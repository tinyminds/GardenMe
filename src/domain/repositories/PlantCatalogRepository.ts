import type { PlantCatalogEntry, PlantSource } from "@/domain/entities/Plant";

export interface PlantCatalogUpsertInput {
  source: PlantSource;
  externalId?: string;
  commonName: string;
  scientificName?: string;
  familyName?: string;
  imageUrl?: string;
  metaJson?: string;
}

export interface PlantCatalogRepository {
  searchByName(query: string, limit?: number): Promise<PlantCatalogEntry[]>;
  getBySourceExternalId(source: PlantSource, externalId: string): Promise<PlantCatalogEntry | null>;
  listAll(): Promise<PlantCatalogEntry[]>;
  upsert(input: PlantCatalogUpsertInput): Promise<PlantCatalogEntry>;
  clearAll(): Promise<void>;
}
