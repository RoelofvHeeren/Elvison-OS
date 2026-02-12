-- Migration: Add detailed tracking to workflow_runs
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT '{}'::jsonb;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS current_step_name VARCHAR(100);
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS current_activity TEXT;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id); -- Ensure it exists
