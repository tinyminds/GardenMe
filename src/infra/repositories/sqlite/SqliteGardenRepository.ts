import { getDatabase } from "@/core/db/sqlite";
import type { Garden, GardenScaleCalibration } from "@/domain/entities/Garden";
import type { GardenRepository } from "@/domain/repositories/GardenRepository";

type GardenRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  location_label: string | null;
  photo_uri: string | null;
  image_source_type: "photo" | "satellite" | null;
  scale_calibration_json: string | null;
  created_at: string;
  updated_at: string;
};

export class SqliteGardenRepository implements GardenRepository {
  async list(): Promise<Garden[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<GardenRow>("SELECT * FROM gardens ORDER BY created_at DESC");
    return rows.map((row) => this.toEntity(row));
  }

  async getById(id: string): Promise<Garden | null> {
    const db = getDatabase();
    const row = await db.getFirstAsync<GardenRow>("SELECT * FROM gardens WHERE id = ?", [id]);
    return row ? this.toEntity(row) : null;
  }

  async create(garden: Garden): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `INSERT INTO gardens (
        id, name, latitude, longitude, location_label, photo_uri, image_source_type, scale_calibration_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        garden.id,
        garden.name,
        garden.latitude,
        garden.longitude,
        garden.locationLabel ?? null,
        garden.photoUri ?? null,
        garden.imageSourceType ?? null,
        garden.scaleCalibration ? JSON.stringify(garden.scaleCalibration) : null,
        garden.createdAt,
        garden.updatedAt,
      ]
    );
  }

  async delete(id: string): Promise<void> {
    await getDatabase().runAsync("DELETE FROM gardens WHERE id = ?", [id]);
  }

  async updatePhoto(id: string, photoUri: string, sourceType: "photo" | "satellite" = "photo"): Promise<void> {
    await getDatabase().runAsync(
      "UPDATE gardens SET photo_uri = ?, image_source_type = ?, updated_at = ? WHERE id = ?",
      [photoUri, sourceType, new Date().toISOString(), id]
    );
  }

  async clearPhoto(id: string): Promise<void> {
    await getDatabase().runAsync(
      "UPDATE gardens SET photo_uri = NULL, image_source_type = NULL, updated_at = ? WHERE id = ?",
      [new Date().toISOString(), id]
    );
  }

  async updateScaleCalibration(id: string, calibration: GardenScaleCalibration): Promise<void> {
    await getDatabase().runAsync(
      "UPDATE gardens SET scale_calibration_json = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(calibration), new Date().toISOString(), id]
    );
  }

  async updateLocation(
    id: string,
    latitude: number,
    longitude: number,
    locationLabel?: string
  ): Promise<void> {
    await getDatabase().runAsync(
      "UPDATE gardens SET latitude = ?, longitude = ?, location_label = ?, updated_at = ? WHERE id = ?",
      [latitude, longitude, locationLabel ?? null, new Date().toISOString(), id]
    );
  }

  private toEntity(row: GardenRow): Garden {
    const garden: Garden = {
      id: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.location_label) garden.locationLabel = row.location_label;
    if (row.photo_uri) garden.photoUri = row.photo_uri;
    if (row.image_source_type) garden.imageSourceType = row.image_source_type;
    if (row.scale_calibration_json) {
      garden.scaleCalibration = JSON.parse(row.scale_calibration_json) as GardenScaleCalibration;
    }

    return garden;
  }
}
