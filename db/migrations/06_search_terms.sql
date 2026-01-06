-- Migration: Add search term rotation and tracking
-- Date: 2026-01-06

-- Add search_terms queue to ICPs
-- Structure: [{ "term": "...", "last_used_at": null, "uses": 0, "results_count": 0 }]
ALTER TABLE icps ADD COLUMN IF NOT EXISTS search_terms JSONB DEFAULT '[]'::jsonb;

-- Add search_stats to workflow_runs for per-run tracking
-- Structure: { 
--   "terms_used": ["term1", "term2"], 
--   "results_per_term": { "term1": 87, "term2": 64 },
--   "total_results": 151 
-- }
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS search_stats JSONB DEFAULT '{}'::jsonb;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_icps_search_terms ON icps USING gin(search_terms);
