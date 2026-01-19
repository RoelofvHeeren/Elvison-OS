-- Migration: Add missing columns to leads table for workflow.js compatibility

DO $$ 
BEGIN
    -- company_profile
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'company_profile') THEN
        ALTER TABLE leads ADD COLUMN company_profile TEXT;
    END IF;

    -- company_website
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'company_website') THEN
        ALTER TABLE leads ADD COLUMN company_website TEXT;
    END IF;

    -- company_domain
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'company_domain') THEN
        ALTER TABLE leads ADD COLUMN company_domain TEXT;
    END IF;

    -- match_score (Assuming numeric/int)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'match_score') THEN
        ALTER TABLE leads ADD COLUMN match_score INTEGER;
    END IF;

    -- email_message
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'email_message') THEN
        ALTER TABLE leads ADD COLUMN email_message TEXT;
    END IF;

    -- connection_request
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'connection_request') THEN
        ALTER TABLE leads ADD COLUMN connection_request TEXT;
    END IF;

    -- disqualification_reason
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'disqualification_reason') THEN
        ALTER TABLE leads ADD COLUMN disqualification_reason TEXT;
    END IF;

END $$;
