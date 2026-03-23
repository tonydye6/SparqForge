-- GIN index on campaigns.selected_assets for fast JSONB containment queries
-- The column is stored as json but cast to jsonb for the index
CREATE INDEX IF NOT EXISTS campaigns_selected_assets_gin_idx
  ON campaigns USING gin ((selected_assets::jsonb) jsonb_path_ops);
