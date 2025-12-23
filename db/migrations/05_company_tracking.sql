-- Migration 05: Company Tracking for Lead Generation
-- Enables tracking of researched/contacted companies to prevent reuse across runs

-- Create researched_companies table
CREATE TABLE IF NOT EXISTS researched_companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    status VARCHAR(50) DEFAULT 'researched', -- 'researched', 'contacted'
    lead_count INTEGER DEFAULT 0, -- Number of leads extracted from this company
    metadata JSONB DEFAULT '{}'::jsonb, -- Store workflow_run_id, discovery details, etc.
    researched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    contacted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, domain) -- Prevent duplicate tracking per user
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_researched_companies_user_id ON researched_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_researched_companies_status ON researched_companies(user_id, status);
CREATE INDEX IF NOT EXISTS idx_researched_companies_domain ON researched_companies(domain);
CREATE INDEX IF NOT EXISTS idx_researched_companies_user_domain ON researched_companies(user_id, domain);

-- Add helpful comment
COMMENT ON TABLE researched_companies IS 'Tracks companies that have been researched or contacted to prevent reuse in lead generation workflows';
COMMENT ON COLUMN researched_companies.status IS 'Current status: researched (leads extracted), contacted (outreach sent)';
COMMENT ON COLUMN researched_companies.lead_count IS 'Number of leads successfully extracted from this company';
COMMENT ON COLUMN researched_companies.metadata IS 'Additional context: workflow_run_id, capital_role, discovery_round, etc.';

SELECT 'Company tracking table created successfully!' AS result;
