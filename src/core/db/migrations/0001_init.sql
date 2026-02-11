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
