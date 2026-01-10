-- Deep Cleanup v2 Schema Migration
-- Adds new fields for comprehensive investor database cleanup

-- Company table additions
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_name_raw TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_name_clean TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_name_canonical TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website_raw TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website_root_domain TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS icp_type TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS capital_role TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS canada_relevance TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS data_quality_flags JSONB DEFAULT '[]';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 50;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fit_score_breakdown JSONB;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_company_id UUID;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS division_label TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cleanup_status TEXT DEFAULT 'PENDING';

-- Lead table additions
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_role_group TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_seniority TEXT;

-- Create index for faster duplicate detection
CREATE INDEX IF NOT EXISTS idx_companies_root_domain ON companies(website_root_domain);
CREATE INDEX IF NOT EXISTS idx_companies_cleanup_status ON companies(cleanup_status);
CREATE INDEX IF NOT EXISTS idx_companies_icp_type ON companies(icp_type);

-- Update existing fit_score to ensure it's always 0-10 (fix any broken scores)
UPDATE companies 
SET fit_score = LEAST(10, GREATEST(0, COALESCE(fit_score, 5)))
WHERE fit_score IS NULL OR fit_score < 0 OR fit_score > 10;
