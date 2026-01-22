-- Migration 42: Create Manual Review Queue for Outreach
-- Stores companies/leads that need manual research before outreach generation

-- Step 1: Create outreach_manual_review_queue table
CREATE TABLE IF NOT EXISTS outreach_manual_review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id),
    company_name VARCHAR(255) NOT NULL,
    website VARCHAR(255),
    fit_score FLOAT,
    icp_type VARCHAR(100),
    icp_category VARCHAR(50),
    outreach_reason VARCHAR(255) NOT NULL,
    outreach_reason_enum VARCHAR(50),
    
    -- Company profile info for review
    company_profile TEXT,
    company_profile_excerpt TEXT, -- First 800 chars for quick review
    
    -- Research tracking
    scraped_urls_count INT DEFAULT 0,
    last_profile_generated_at TIMESTAMP WITH TIME ZONE,
    profile_last_updated_at TIMESTAMP WITH TIME ZONE,
    
    -- Suggested next actions
    suggested_next_urls TEXT[], -- Array of URLs to scrape
    research_suggestions TEXT, -- What to look for
    
    -- Queue status
    status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, IN_REVIEW, RESEARCHED, SKIPPED
    reviewer_notes TEXT,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Metadata
    entry_source VARCHAR(50), -- 'outreach_generation', 'manual_add', etc
    priority INT DEFAULT 0 -- Higher = more important
);

-- Step 2: Add columns to leads table for manual review queue tracking
ALTER TABLE leads ADD COLUMN IF NOT EXISTS in_review_queue BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS review_queue_id UUID REFERENCES outreach_manual_review_queue(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS review_queue_date TIMESTAMP WITH TIME ZONE;

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON outreach_manual_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_reason ON outreach_manual_review_queue(outreach_reason_enum);
CREATE INDEX IF NOT EXISTS idx_review_queue_icp_type ON outreach_manual_review_queue(icp_type);
CREATE INDEX IF NOT EXISTS idx_review_queue_fit_score ON outreach_manual_review_queue(fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_review_queue_created_at ON outreach_manual_review_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_in_review_queue ON leads(in_review_queue);
CREATE INDEX IF NOT EXISTS idx_leads_review_queue_id ON leads(review_queue_id);

-- Step 4: Create view for easy review queue access
CREATE OR REPLACE VIEW outreach_review_queue_summary AS
SELECT 
    id,
    company_name,
    website,
    fit_score,
    icp_type,
    outreach_reason,
    status,
    created_at,
    reviewed_at,
    CASE 
        WHEN status = 'PENDING' THEN 'Awaiting Review'
        WHEN status = 'IN_REVIEW' THEN 'Currently Being Reviewed'
        WHEN status = 'RESEARCHED' THEN 'Research Complete'
        WHEN status = 'SKIPPED' THEN 'Marked as Skip'
    END as status_label,
    EXTRACT(DAY FROM NOW() - created_at) as days_in_queue
FROM outreach_manual_review_queue
ORDER BY created_at DESC;

-- Step 5: Create function to add items to review queue
CREATE OR REPLACE FUNCTION add_to_review_queue(
    p_company_id UUID,
    p_company_name VARCHAR,
    p_website VARCHAR,
    p_fit_score FLOAT,
    p_icp_type VARCHAR,
    p_outreach_reason VARCHAR,
    p_company_profile TEXT,
    p_entry_source VARCHAR DEFAULT 'outreach_generation'
) RETURNS UUID AS $$
DECLARE
    v_queue_id UUID;
    v_excerpt TEXT;
BEGIN
    -- Extract first 800 chars of profile as excerpt
    v_excerpt := SUBSTRING(p_company_profile, 1, 800);
    
    -- Insert into queue
    INSERT INTO outreach_manual_review_queue (
        company_id,
        company_name,
        website,
        fit_score,
        icp_type,
        outreach_reason,
        company_profile,
        company_profile_excerpt,
        entry_source,
        status
    ) VALUES (
        p_company_id,
        p_company_name,
        p_website,
        p_fit_score,
        p_icp_type,
        p_outreach_reason,
        p_company_profile,
        v_excerpt,
        p_entry_source,
        'PENDING'
    ) RETURNING id INTO v_queue_id;
    
    RETURN v_queue_id;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create function to mark item as researched
CREATE OR REPLACE FUNCTION mark_review_queue_researched(
    p_queue_id UUID,
    p_new_profile TEXT,
    p_reviewer_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE outreach_manual_review_queue
    SET 
        status = 'RESEARCHED',
        company_profile = p_new_profile,
        company_profile_excerpt = SUBSTRING(p_new_profile, 1, 800),
        profile_last_updated_at = NOW(),
        reviewer_notes = p_reviewer_notes,
        updated_at = NOW()
    WHERE id = p_queue_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create function to regenerate outreach for queue item
CREATE OR REPLACE FUNCTION regenerate_outreach_for_queue(
    p_queue_id UUID,
    p_company_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    -- Update the queue item status
    UPDATE outreach_manual_review_queue
    SET status = 'RESEARCHED', updated_at = NOW()
    WHERE id = p_queue_id;
    
    -- The application should then call OutreachService.createLeadMessages
    -- with the updated company profile and regenerate all associated messages
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Step 8: Backfill research suggestions for common reasons
UPDATE outreach_manual_review_queue
SET research_suggestions = 'Find specific deal names or portfolio company information'
WHERE outreach_reason_enum = 'no_named_deals_or_projects';

UPDATE outreach_manual_review_queue
SET research_suggestions = 'Look for investment thesis, focus areas, and market strategy statements'
WHERE outreach_reason_enum = 'no_residential_thesis_found';

UPDATE outreach_manual_review_queue
SET research_suggestions = 'Profile is too generic. Find concrete examples of investments, deals, or strategic focus'
WHERE outreach_reason_enum = 'profile_too_generic';

UPDATE outreach_manual_review_queue
SET research_suggestions = 'Locate portfolio company pages, deal flow documents, or investment thesis documents'
WHERE outreach_reason_enum = 'missing_portfolio_pages';

-- Step 9: Create audit table for review actions
CREATE TABLE IF NOT EXISTS review_queue_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id UUID REFERENCES outreach_manual_review_queue(id),
    action VARCHAR(50) NOT NULL, -- ADDED, MARKED_RESEARCHED, REGENERATED, SKIPPED
    notes TEXT,
    performed_by VARCHAR(255),
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_audit_queue_id ON review_queue_audit(queue_id);
CREATE INDEX IF NOT EXISTS idx_review_audit_action ON review_queue_audit(action);

SELECT 'Migration 42 completed: Manual review queue created!' AS result;
