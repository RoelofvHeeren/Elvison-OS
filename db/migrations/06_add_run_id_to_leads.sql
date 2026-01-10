-- Add run_id to leads table to link leads to specific workflow runs
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES workflow_runs(id);

-- Create an index for faster lookups by run_id
CREATE INDEX IF NOT EXISTS idx_leads_run_id ON leads(run_id);
