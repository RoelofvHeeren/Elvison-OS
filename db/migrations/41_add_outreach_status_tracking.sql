-- Migration 41: Add Outreach Generation Status Tracking
-- Adds strict outreach status fields to leads and companies tables
-- This enables tracking of SKIP, NEEDS_RESEARCH, SUCCESS, and ERROR states

-- Step 1: Create outreach_status enum type
DO $$ BEGIN
    CREATE TYPE outreach_status_enum AS ENUM('SUCCESS', 'SKIP', 'NEEDS_RESEARCH', 'ERROR');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE outreach_reason_enum AS ENUM(
        'no_named_deals_or_projects',
        'no_residential_thesis_found',
        'profile_too_generic',
        'missing_portfolio_pages',
        'icp_type_disqualified',
        'invalid_json',
        'missing_status',
        'generation_failed',
        'qa_failed_banned_phrase',
        'tier_1_missing',
        'tier_2_missing',
        'tier_3_missing'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Add outreach status fields to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_status VARCHAR(20) DEFAULT 'ERROR';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_reason VARCHAR(100);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_reason_enum VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS research_fact TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS research_fact_type VARCHAR(20); -- DEAL, THESIS, SCALE, GENERAL
ALTER TABLE leads ADD COLUMN IF NOT EXISTS research_confidence FLOAT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS message_version VARCHAR(20) DEFAULT 'v5';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS profile_quality_score FLOAT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_generated_at TIMESTAMP WITH TIME ZONE;

-- Step 3: Add outreach status fields to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS outreach_status VARCHAR(20) DEFAULT 'ERROR';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS outreach_reason VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS outreach_reason_enum VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS research_fact TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS research_fact_type VARCHAR(20); -- DEAL, THESIS, SCALE, GENERAL
ALTER TABLE companies ADD COLUMN IF NOT EXISTS research_confidence FLOAT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS message_version VARCHAR(20) DEFAULT 'v5';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS profile_quality_score FLOAT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS outreach_generated_at TIMESTAMP WITH TIME ZONE;

-- Step 4: Alter message columns to be nullable for strict enforcement
ALTER TABLE leads ALTER COLUMN linkedin_message DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN email_subject DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN email_body DROP NOT NULL;

ALTER TABLE companies ALTER COLUMN linkedin_message DROP NOT NULL;
ALTER TABLE companies ALTER COLUMN email_subject DROP NOT NULL;
ALTER TABLE companies ALTER COLUMN email_body DROP NOT NULL;

-- Step 5: Add indexes for performance on status tracking
CREATE INDEX IF NOT EXISTS idx_leads_outreach_status ON leads(outreach_status);
CREATE INDEX IF NOT EXISTS idx_leads_outreach_reason ON leads(outreach_reason_enum);
CREATE INDEX IF NOT EXISTS idx_leads_research_fact_type ON leads(research_fact_type);
CREATE INDEX IF NOT EXISTS idx_companies_outreach_status ON companies(outreach_status);
CREATE INDEX IF NOT EXISTS idx_companies_outreach_reason ON companies(outreach_reason_enum);
CREATE INDEX IF NOT EXISTS idx_companies_research_fact_type ON companies(research_fact_type);

-- Step 6: Add constraint to ensure message integrity
-- If outreach_status != 'SUCCESS', message fields must be null
ALTER TABLE leads ADD CONSTRAINT check_message_null_on_non_success
    CHECK ((outreach_status = 'SUCCESS' AND linkedin_message IS NOT NULL) OR 
           (outreach_status != 'SUCCESS' AND linkedin_message IS NULL AND email_subject IS NULL AND email_body IS NULL));

ALTER TABLE companies ADD CONSTRAINT check_message_null_on_non_success_companies
    CHECK ((outreach_status = 'SUCCESS' AND linkedin_message IS NOT NULL) OR 
           (outreach_status != 'SUCCESS' AND linkedin_message IS NULL AND email_subject IS NULL AND email_body IS NULL));

-- Step 7: Backfill existing records with ERROR status where no message exists
UPDATE leads 
SET outreach_status = 'ERROR', 
    outreach_reason = 'Legacy record - needs regeneration',
    message_version = 'v5'
WHERE outreach_status IS NULL OR outreach_status = 'ERROR';

UPDATE companies 
SET outreach_status = 'ERROR', 
    outreach_reason = 'Legacy record - needs regeneration',
    message_version = 'v5'
WHERE outreach_status IS NULL OR outreach_status = 'ERROR';

SELECT 'Migration 41 completed: Outreach status tracking added!' AS result;
