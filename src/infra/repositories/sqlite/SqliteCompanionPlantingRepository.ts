import { getDatabase } from "@/core/db/sqlite";
import type { CompanionPlantingRelation, CompanionRelationType } from "@/domain/entities/CompanionPlanting";
import type { CompanionPlantingRepository } from "@/domain/repositories/CompanionPlantingRepository";

type CompanionRow = {
  id: string;
  plant_name: string;
  companion_name: string;
  relation: CompanionRelationType;
  reason: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
};

export class SqliteCompanionPlantingRepository implements CompanionPlantingRepository {
  async listAll(): Promise<CompanionPlantingRelation[]> {
    const rows = await getDatabase().getAllAsync<CompanionRow>(
      `SELECT id, plant_name, companion_name, relation, reason, source_url, created_at, updated_at
       FROM companion_relationships
       ORDER BY plant_name COLLATE NOCASE ASC, companion_name COLLATE NOCASE ASC`
    );

    return rows.map((row) => ({
      id: row.id,
      plantName: row.plant_name,
      companionName: row.companion_name,
      relation: row.relation,
      ...(row.reason ? { reason: row.reason } : {}),
      ...(row.source_url ? { sourceUrl: row.source_url } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
