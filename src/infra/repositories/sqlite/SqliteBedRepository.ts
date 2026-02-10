import { getDatabase } from "@/core/db/sqlite";
import type { Bed } from "@/domain/entities/Bed";
import { Drainage, SunExposure } from "@/domain/entities/Bed";
import type { BedRepository } from "@/domain/repositories/BedRepository";

type BedRow = {
  id: string;
  garden_id: string;
  name: string;
  polygon_json: string;
  sun_exposure: SunExposure;
  drainage: Drainage;
  soil_notes: string | null;
  created_at: string;
  updated_at: string;
};

export class SqliteBedRepository implements BedRepository {
  async listByGarden(gardenId: string): Promise<Bed[]> {
    const rows = await getDatabase().getAllAsync<BedRow>(
      "SELECT * FROM beds WHERE garden_id = ? ORDER BY created_at DESC",
      [gardenId]
    );

    return rows.map((row) => {
      const bed: Bed = {
        id: row.id,
        gardenId: row.garden_id,
        name: row.name,
        polygon: JSON.parse(row.polygon_json),
        sunExposure: row.sun_exposure,
        drainage: row.drainage,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      if (row.soil_notes) {
        bed.soilNotes = row.soil_notes;
      }

      return bed;
    });
  }

  async create(bed: Bed): Promise<void> {
    await getDatabase().runAsync(
      `INSERT INTO beds (id, garden_id, name, polygon_json, sun_exposure, drainage, soil_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bed.id,
        bed.gardenId,
        bed.name,
        JSON.stringify(bed.polygon),
        bed.sunExposure,
        bed.drainage,
        bed.soilNotes ?? null,
        bed.createdAt,
        bed.updatedAt,
      ]
    );
  }

  async update(bed: Bed): Promise<void> {
    await getDatabase().runAsync(
      `UPDATE beds
       SET name = ?, polygon_json = ?, sun_exposure = ?, drainage = ?, soil_notes = ?, updated_at = ?
       WHERE id = ? AND garden_id = ?`,
      [
        bed.name,
        JSON.stringify(bed.polygon),
        bed.sunExposure,
        bed.drainage,
        bed.soilNotes ?? null,
        bed.updatedAt,
        bed.id,
        bed.gardenId,
      ]
    );
  }

  async delete(id: string, gardenId: string): Promise<void> {
    await getDatabase().runAsync("DELETE FROM beds WHERE id = ? AND garden_id = ?", [id, gardenId]);
  }
}
