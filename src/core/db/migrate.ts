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

