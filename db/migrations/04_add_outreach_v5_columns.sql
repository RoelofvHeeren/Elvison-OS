-- Migration to add V5 Outreach columns to leads table

ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS outreach_reason TEXT,
ADD COLUMN IF NOT EXISTS research_fact TEXT,
ADD COLUMN IF NOT EXISTS research_fact_type TEXT,
ADD COLUMN IF NOT EXISTS profile_quality_score INTEGER,
ADD COLUMN IF NOT EXISTS message_version TEXT;
