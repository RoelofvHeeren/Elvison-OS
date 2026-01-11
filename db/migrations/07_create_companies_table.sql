-- Migration 07: Separating Companies from Leads
-- Creates a dedicated companies table for storing profiles, outreach configs, etc.

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    website VARCHAR(255),
    
    -- Profile / Enrichment Data
    company_profile TEXT,
    market_intelligence TEXT, -- Full-site research report from Deep Research
    industry VARCHAR(100),
    size_range VARCHAR(50),
    headquarters VARCHAR(100),
    
    -- Outreach Configuration (from Research)
    linkedin_message TEXT,
    email_subject TEXT, 
    email_body TEXT,
    
    -- Metadata
    fit_score INTEGER,
    status VARCHAR(50) DEFAULT 'active', -- active, disqualified
    last_researched_at TIMESTAMP WITH TIME ZONE, -- Track when Deep Research was last run
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, company_name)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_companies_user_name ON companies(user_id, company_name);
CREATE INDEX IF NOT EXISTS idx_companies_website ON companies(website);

-- Backfill from existing leads
-- We extract unique company names + websites from leads and insert them
INSERT INTO companies (user_id, company_name, website, fit_score, company_profile)
SELECT DISTINCT ON (user_id, company_name)
    user_id,
    company_name,
    NULLIF(custom_data->>'company_website', ''),
    CAST(NULLIF(custom_data->>'fit_score', '') AS INTEGER),
    custom_data->>'company_profile'
FROM leads
WHERE company_name IS NOT NULL
ON CONFLICT (user_id, company_name) DO NOTHING;

SELECT 'Companies table created and backfilled successfully!' AS result;
