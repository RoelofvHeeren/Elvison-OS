-- Restore columns that were incorrectly dropped in migration 20
-- These columns are ACTIVELY USED by the application

-- 1. Leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES workflow_runs(id);

-- 2. Workflow Runs
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id);
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS agent_id VARCHAR(50);
