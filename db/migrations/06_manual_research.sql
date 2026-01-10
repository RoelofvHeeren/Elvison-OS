-- Migration 06: Manual Company Research
-- Enables storing discovered team members from website scraping

-- Create company_team_members table
CREATE TABLE IF NOT EXISTS company_team_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    company_domain VARCHAR(255),
    person_name VARCHAR(255) NOT NULL,
    job_title VARCHAR(255),
    source_url TEXT,                      -- Where we found this person (e.g., /team page)
    linkedin_url TEXT,                    -- Enriched via Google search
    email TEXT,                           -- Enriched via Google search
    status VARCHAR(50) DEFAULT 'discovered', -- discovered, enriching, enriched, converted
    enrichment_data JSONB DEFAULT '{}',   -- Raw Google search results, etc.
    is_decision_maker BOOLEAN DEFAULT FALSE, -- AI recommendation
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_team_members_user ON company_team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_domain ON company_team_members(company_domain);
CREATE INDEX IF NOT EXISTS idx_team_members_status ON company_team_members(status);
CREATE INDEX IF NOT EXISTS idx_team_members_user_domain ON company_team_members(user_id, company_domain);

-- Comments
COMMENT ON TABLE company_team_members IS 'Stores team members discovered from manual company research via website scraping';
COMMENT ON COLUMN company_team_members.status IS 'discovered (just found), enriching (Google search in progress), enriched (LinkedIn/email found), converted (saved as lead)';
COMMENT ON COLUMN company_team_members.is_decision_maker IS 'AI-determined if this person is likely a decision-maker based on job title';

SELECT 'Company team members table created successfully!' AS result;
