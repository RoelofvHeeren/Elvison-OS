-- Migration: Add updated_at to workflow_runs to fix persistence errors
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_workflow_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_workflow_runs_timestamp
BEFORE UPDATE ON workflow_runs
FOR EACH ROW
EXECUTE FUNCTION update_workflow_runs_updated_at();
