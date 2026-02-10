import { getDatabase } from "@/core/db/sqlite";
import type { GardenFeature } from "@/domain/entities/GardenFeature";
import { GardenFeatureType } from "@/domain/entities/GardenFeature";
import type { GardenFeatureRepository } from "@/domain/repositories/GardenFeatureRepository";

type GardenFeatureRow = {
  id: string;
  garden_id: string;
  type: GardenFeatureType;
  name: string;
  polygon_json: string;
  created_at: string;
  updated_at: string;
};

export class SqliteGardenFeatureRepository implements GardenFeatureRepository {
  async listByGarden(gardenId: string): Promise<GardenFeature[]> {
    const rows = await getDatabase().getAllAsync<GardenFeatureRow>(
      "SELECT * FROM garden_features WHERE garden_id = ? ORDER BY created_at DESC",
      [gardenId]
    );

    return rows.map((row) => ({
      id: row.id,
      gardenId: row.garden_id,
      type: row.type,
      name: row.name,
      polygon: JSON.parse(row.polygon_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async create(feature: GardenFeature): Promise<void> {
    await getDatabase().runAsync(
      `INSERT INTO garden_features (id, garden_id, type, name, polygon_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        feature.id,
        feature.gardenId,
        feature.type,
        feature.name,
        JSON.stringify(feature.polygon),
        feature.createdAt,
        feature.updatedAt,
      ]
    );
  }

  async update(feature: GardenFeature): Promise<void> {
    await getDatabase().runAsync(
      `UPDATE garden_features
       SET type = ?, name = ?, polygon_json = ?, updated_at = ?
       WHERE id = ? AND garden_id = ?`,
      [
        feature.type,
        feature.name,
        JSON.stringify(feature.polygon),
        feature.updatedAt,
        feature.id,
        feature.gardenId,
      ]
    );
  }

  async delete(id: string, gardenId: string): Promise<void> {
    await getDatabase().runAsync("DELETE FROM garden_features WHERE id = ? AND garden_id = ?", [id, gardenId]);
  }
}
