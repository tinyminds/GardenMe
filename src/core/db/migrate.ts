import type { AppDatabase } from "./database";

type Migration = { version: string; sql: string };

const migrations: Migration[] = [
  {
    version: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gardens (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        location_label TEXT,
        photo_uri TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS beds (
        id TEXT PRIMARY KEY NOT NULL,
        garden_id TEXT NOT NULL,
        name TEXT NOT NULL,
        polygon_json TEXT NOT NULL,
        sun_exposure TEXT NOT NULL CHECK (sun_exposure IN ('full_sun','part_sun','shade')),
        drainage TEXT NOT NULL CHECK (drainage IN ('good','medium','poor')),
        contains_perennials INTEGER NOT NULL DEFAULT 0,
        perennial_plants_csv TEXT,
        is_raised_bed INTEGER NOT NULL DEFAULT 0,
        has_irrigation INTEGER NOT NULL DEFAULT 0,
        soil_notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (garden_id) REFERENCES gardens(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_beds_garden ON beds(garden_id);
    `,
  },
  {
    version: "0002_garden_features",
    sql: `
      CREATE TABLE IF NOT EXISTS garden_features (
        id TEXT PRIMARY KEY NOT NULL,
        garden_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('bed','lawn','tree','shrub','hedge','path','wall','fence','trellis','patio','deck')),
        name TEXT NOT NULL,
        polygon_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (garden_id) REFERENCES gardens(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_garden_features_garden ON garden_features(garden_id);
      CREATE INDEX IF NOT EXISTS idx_garden_features_type ON garden_features(type);
    `,
  },
  {
    version: "0003_garden_scale",
    sql: `
      ALTER TABLE gardens ADD COLUMN image_source_type TEXT;
      ALTER TABLE gardens ADD COLUMN scale_calibration_json TEXT;
    `,
  },
  {
    version: "0004_bed_details",
    sql: `
      ALTER TABLE beds ADD COLUMN contains_perennials INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE beds ADD COLUMN perennial_plants_csv TEXT;
      ALTER TABLE beds ADD COLUMN is_raised_bed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE beds ADD COLUMN has_irrigation INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: "0005_plants_and_wishlist",
    sql: `
      CREATE TABLE IF NOT EXISTS plant_catalog_cache (
        id TEXT PRIMARY KEY NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('trefle', 'manual')),
        external_id TEXT,
        common_name TEXT NOT NULL,
        scientific_name TEXT,
        family_name TEXT,
        image_url TEXT,
        meta_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_plant_catalog_source_external
        ON plant_catalog_cache(source, external_id);
      CREATE INDEX IF NOT EXISTS idx_plant_catalog_common_name
        ON plant_catalog_cache(common_name);

      CREATE TABLE IF NOT EXISTS garden_crop_wishlist (
        id TEXT PRIMARY KEY NOT NULL,
        garden_id TEXT NOT NULL,
        plant_catalog_id TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (garden_id) REFERENCES gardens(id) ON DELETE CASCADE,
        FOREIGN KEY (plant_catalog_id) REFERENCES plant_catalog_cache(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_wishlist_garden ON garden_crop_wishlist(garden_id);
      CREATE INDEX IF NOT EXISTS idx_wishlist_catalog ON garden_crop_wishlist(plant_catalog_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_garden_catalog
        ON garden_crop_wishlist(garden_id, plant_catalog_id);
    `,
  },
  {
    version: "0006_crop_entries",
    sql: `
      CREATE TABLE IF NOT EXISTS garden_crop_entries (
        id TEXT PRIMARY KEY NOT NULL,
        garden_id TEXT NOT NULL,
        plant_catalog_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('wanted','already_growing')),
        bed_id TEXT,
        is_perennial INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (garden_id) REFERENCES gardens(id) ON DELETE CASCADE,
        FOREIGN KEY (plant_catalog_id) REFERENCES plant_catalog_cache(id) ON DELETE CASCADE,
        FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_crop_entries_garden ON garden_crop_entries(garden_id);
      CREATE INDEX IF NOT EXISTS idx_crop_entries_plant ON garden_crop_entries(plant_catalog_id);
      CREATE INDEX IF NOT EXISTS idx_crop_entries_bed ON garden_crop_entries(bed_id);
      CREATE INDEX IF NOT EXISTS idx_crop_entries_status ON garden_crop_entries(status);

      INSERT INTO garden_crop_entries (
        id, garden_id, plant_catalog_id, status, bed_id, is_perennial, notes, created_at, updated_at
      )
      SELECT
        id, garden_id, plant_catalog_id, 'wanted', NULL, 0, notes, created_at, updated_at
      FROM garden_crop_wishlist
      WHERE NOT EXISTS (
        SELECT 1 FROM garden_crop_entries existing WHERE existing.id = garden_crop_wishlist.id
      );
    `,
  },
  {
    version: "0007_crop_entry_variety_support",
    sql: `
      ALTER TABLE garden_crop_entries ADD COLUMN variety_name TEXT;
      ALTER TABLE garden_crop_entries ADD COLUMN support_needed INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

export async function runMigrations(db: AppDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of migrations) {
    const applied = await db.getFirstAsync<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = ?",
      [migration.version]
    );

    if (applied) {
      continue;
    }

    await db.withTransactionAsync(async () => {
      if (migration.version === "0003_garden_scale") {
        await db.execAsync("ALTER TABLE gardens ADD COLUMN image_source_type TEXT;").catch(() => undefined);
        await db.execAsync("ALTER TABLE gardens ADD COLUMN scale_calibration_json TEXT;").catch(() => undefined);
      } else if (migration.version === "0004_bed_details") {
        await db.execAsync("ALTER TABLE beds ADD COLUMN contains_perennials INTEGER NOT NULL DEFAULT 0;").catch(() => undefined);
        await db.execAsync("ALTER TABLE beds ADD COLUMN perennial_plants_csv TEXT;").catch(() => undefined);
        await db.execAsync("ALTER TABLE beds ADD COLUMN is_raised_bed INTEGER NOT NULL DEFAULT 0;").catch(() => undefined);
        await db.execAsync("ALTER TABLE beds ADD COLUMN has_irrigation INTEGER NOT NULL DEFAULT 0;").catch(() => undefined);
      } else if (migration.version === "0007_crop_entry_variety_support") {
        await db.execAsync("ALTER TABLE garden_crop_entries ADD COLUMN variety_name TEXT;").catch(() => undefined);
        await db.execAsync("ALTER TABLE garden_crop_entries ADD COLUMN support_needed INTEGER NOT NULL DEFAULT 0;").catch(() => undefined);
      } else {
        await db.execAsync(migration.sql);
      }

      await db.runAsync(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        [migration.version, new Date().toISOString()]
      );
    });
  }
}

