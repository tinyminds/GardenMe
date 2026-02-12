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
        source TEXT NOT NULL CHECK (source IN ('growstuff', 'manual')),
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
  {
    version: "0008_expand_plant_catalog_sources",
    sql: `
      PRAGMA foreign_keys=OFF;

      CREATE TABLE IF NOT EXISTS plant_catalog_cache_new (
        id TEXT PRIMARY KEY NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('growstuff', 'manual')),
        external_id TEXT,
        common_name TEXT NOT NULL,
        scientific_name TEXT,
        family_name TEXT,
        image_url TEXT,
        meta_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO plant_catalog_cache_new (
        id, source, external_id, common_name, scientific_name, family_name, image_url, meta_json, created_at, updated_at
      )
      SELECT
        id,
        CASE WHEN source = 'growstuff' THEN 'growstuff' ELSE 'manual' END,
        external_id,
        common_name,
        scientific_name,
        family_name,
        image_url,
        meta_json,
        created_at,
        updated_at
      FROM plant_catalog_cache;

      DROP TABLE plant_catalog_cache;
      ALTER TABLE plant_catalog_cache_new RENAME TO plant_catalog_cache;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_plant_catalog_source_external
        ON plant_catalog_cache(source, external_id);
      CREATE INDEX IF NOT EXISTS idx_plant_catalog_common_name
        ON plant_catalog_cache(common_name);

      PRAGMA foreign_keys=ON;
    `,
  },
  {
    version: "0009_restrict_plant_catalog_sources",
    sql: `
      PRAGMA foreign_keys=OFF;

      CREATE TABLE IF NOT EXISTS plant_catalog_cache_new (
        id TEXT PRIMARY KEY NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('growstuff', 'manual')),
        external_id TEXT,
        common_name TEXT NOT NULL,
        scientific_name TEXT,
        family_name TEXT,
        image_url TEXT,
        meta_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO plant_catalog_cache_new (
        id, source, external_id, common_name, scientific_name, family_name, image_url, meta_json, created_at, updated_at
      )
      SELECT
        id,
        CASE WHEN source = 'growstuff' THEN 'growstuff' ELSE 'manual' END,
        external_id,
        common_name,
        scientific_name,
        family_name,
        image_url,
        meta_json,
        created_at,
        updated_at
      FROM plant_catalog_cache;

      DROP TABLE plant_catalog_cache;
      ALTER TABLE plant_catalog_cache_new RENAME TO plant_catalog_cache;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_plant_catalog_source_external
        ON plant_catalog_cache(source, external_id);
      CREATE INDEX IF NOT EXISTS idx_plant_catalog_common_name
        ON plant_catalog_cache(common_name);

      PRAGMA foreign_keys=ON;
    `,
  },
  {
    version: "0010_crop_plantings_history",
    sql: `
      CREATE TABLE IF NOT EXISTS garden_crop_plantings (
        id TEXT PRIMARY KEY NOT NULL,
        entry_id TEXT NOT NULL,
        garden_id TEXT NOT NULL,
        bed_id TEXT,
        planted_at TEXT NOT NULL,
        ended_at TEXT,
        end_state TEXT CHECK (end_state IN ('harvested', 'done', 'dead')),
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES garden_crop_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (garden_id) REFERENCES gardens(id) ON DELETE CASCADE,
        FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_crop_plantings_entry ON garden_crop_plantings(entry_id);
      CREATE INDEX IF NOT EXISTS idx_crop_plantings_garden ON garden_crop_plantings(garden_id);
      CREATE INDEX IF NOT EXISTS idx_crop_plantings_bed ON garden_crop_plantings(bed_id);
      CREATE INDEX IF NOT EXISTS idx_crop_plantings_ended ON garden_crop_plantings(ended_at);
    `,
  },
  {
    version: "0011_companion_relationships",
    sql: `
      CREATE TABLE IF NOT EXISTS companion_relationships (
        id TEXT PRIMARY KEY NOT NULL,
        plant_name TEXT NOT NULL,
        companion_name TEXT NOT NULL,
        relation TEXT NOT NULL CHECK (relation IN ('good', 'avoid')),
        reason TEXT,
        source_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_companion_unique
        ON companion_relationships(plant_name, companion_name, relation);
      CREATE INDEX IF NOT EXISTS idx_companion_plant_name
        ON companion_relationships(plant_name);
      CREATE INDEX IF NOT EXISTS idx_companion_companion_name
        ON companion_relationships(companion_name);

      INSERT OR IGNORE INTO companion_relationships (id, plant_name, companion_name, relation, reason, source_url, created_at, updated_at) VALUES
        ('comp_001', 'tomato', 'basil', 'good', 'Often used together for pest confusion and pollinator draw.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_002', 'tomato', 'marigold', 'good', 'Commonly paired to deter some pests.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_003', 'carrot', 'onion', 'good', 'Classic pairing for reciprocal pest distraction.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_004', 'carrot', 'leek', 'good', 'Often paired for complementary pest pressure reduction.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_005', 'cucumber', 'dill', 'good', 'Can attract beneficial insects around cucurbits.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_006', 'cucumber', 'radish', 'good', 'Often used as a trap/distraction companion.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_007', 'corn', 'bean', 'good', 'Part of the Three Sisters style support pairing.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_008', 'corn', 'squash', 'good', 'Part of the Three Sisters ground-cover pairing.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_009', 'pepper', 'basil', 'good', 'Common aromatic companion for peppers.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_010', 'lettuce', 'radish', 'good', 'Short-cycle pairing with space/time complementarity.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_011', 'cabbage', 'dill', 'good', 'Flowering dill can attract beneficial insects.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_012', 'beet', 'onion', 'good', 'Frequently listed as a compatible pairing.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_013', 'asparagus', 'tomato', 'good', 'Traditional reciprocal companion pairing.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_014', 'spinach', 'strawberry', 'good', 'Often listed as a compatible mixed planting.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_015', 'tomato', 'potato', 'avoid', 'Both are Solanaceae and can share diseases/blight pressure.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_016', 'tomato', 'corn', 'avoid', 'Can share some pest pressure in warm seasons.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_017', 'bean', 'onion', 'avoid', 'Alliums are commonly listed as antagonistic to beans.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_018', 'bean', 'garlic', 'avoid', 'Alliums are commonly listed as antagonistic to beans.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_019', 'cabbage', 'strawberry', 'avoid', 'Often listed as an unfavorable pairing.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_020', 'carrot', 'dill', 'avoid', 'Mature dill can suppress carrot growth in close planting.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_021', 'cucumber', 'potato', 'avoid', 'Frequently listed as an unfavorable pairing.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_022', 'fennel', 'tomato', 'avoid', 'Fennel is frequently considered allelopathic to many crops.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_023', 'fennel', 'bean', 'avoid', 'Fennel is frequently considered allelopathic to many crops.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('comp_024', 'sunflower', 'potato', 'avoid', 'Can be listed as a problematic pairing in some guides.', 'https://en.wikipedia.org/wiki/List_of_companion_plants', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `,
  },
  {
    version: "0012_crop_entry_quantity",
    sql: `
      ALTER TABLE garden_crop_entries ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_crop_entries_quantity ON garden_crop_entries(quantity);
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
      } else if (migration.version === "0012_crop_entry_quantity") {
        await db.execAsync("ALTER TABLE garden_crop_entries ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;").catch(() => undefined);
        await db.execAsync("CREATE INDEX IF NOT EXISTS idx_crop_entries_quantity ON garden_crop_entries(quantity);").catch(() => undefined);
      } else if (
        migration.version === "0008_expand_plant_catalog_sources" ||
        migration.version === "0009_restrict_plant_catalog_sources"
      ) {
        await db.execAsync("PRAGMA foreign_keys=OFF;");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS plant_catalog_cache_new (
            id TEXT PRIMARY KEY NOT NULL,
            source TEXT NOT NULL CHECK (source IN ('growstuff', 'manual')),
            external_id TEXT,
            common_name TEXT NOT NULL,
            scientific_name TEXT,
            family_name TEXT,
            image_url TEXT,
            meta_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        await db.execAsync(`
          INSERT OR IGNORE INTO plant_catalog_cache_new (
            id, source, external_id, common_name, scientific_name, family_name, image_url, meta_json, created_at, updated_at
          )
          SELECT
            id,
            CASE WHEN source = 'growstuff' THEN 'growstuff' ELSE 'manual' END,
            external_id,
            common_name,
            scientific_name,
            family_name,
            image_url,
            meta_json,
            created_at,
            updated_at
          FROM plant_catalog_cache;
        `);
        await db.execAsync("DROP TABLE plant_catalog_cache;");
        await db.execAsync("ALTER TABLE plant_catalog_cache_new RENAME TO plant_catalog_cache;");
        await db.execAsync(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_plant_catalog_source_external
            ON plant_catalog_cache(source, external_id);
        `);
        await db.execAsync(`
          CREATE INDEX IF NOT EXISTS idx_plant_catalog_common_name
            ON plant_catalog_cache(common_name);
        `);
        await db.execAsync("PRAGMA foreign_keys=ON;");
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
