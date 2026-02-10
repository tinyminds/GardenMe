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
