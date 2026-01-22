-- Migration 40: Add Family Office Type Safety
-- Adds icp_category and entity classification fields for strict FO filtering

-- Step 1: Add icp_category to icps table
ALTER TABLE icps ADD COLUMN IF NOT EXISTS icp_category VARCHAR(50) DEFAULT 'OTHER';
ALTER TABLE icps ADD COLUMN IF NOT EXISTS description TEXT;

-- Step 2: Add entity classification fields to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50) DEFAULT 'UNKNOWN';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_subtype VARCHAR(50) DEFAULT 'UNKNOWN';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_confidence FLOAT DEFAULT 0.0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_reason TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fo_status VARCHAR(50) DEFAULT 'UNKNOWN'; -- APPROVED, REVIEW, REJECTED

-- Step 3: Add entity classification fields to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50) DEFAULT 'UNKNOWN';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_subtype VARCHAR(50) DEFAULT 'UNKNOWN';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_confidence FLOAT DEFAULT 0.0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entity_reason TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fo_status VARCHAR(50) DEFAULT 'UNKNOWN'; -- APPROVED, REVIEW, REJECTED

-- Step 4: Add ICP tracking to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id);

-- Step 5: Backfill existing ICPs based on name patterns
UPDATE icps 
SET icp_category = 'FAMILY_OFFICE'
WHERE name ILIKE '%Family Office%' 
   OR name ILIKE '%Family Capital%'
   OR name ILIKE '%Single Family Office%'
   OR name ILIKE '%Multi Family Office%';

UPDATE icps 
SET icp_category = 'INVESTMENT_FUND'
WHERE name ILIKE '%Fund%'
   OR name ILIKE '%Investment Firm%'
   OR name ILIKE '%Investor%'
   OR name ILIKE '%PE%'
   OR name ILIKE '%Private Equity%'
   AND icp_category = 'OTHER';

-- Step 6: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_icps_category ON icps(icp_category);
CREATE INDEX IF NOT EXISTS idx_companies_entity_type ON companies(entity_type);
CREATE INDEX IF NOT EXISTS idx_companies_fo_status ON companies(fo_status);
CREATE INDEX IF NOT EXISTS idx_leads_entity_type ON leads(entity_type);
CREATE INDEX IF NOT EXISTS idx_leads_fo_status ON leads(fo_status);
CREATE INDEX IF NOT EXISTS idx_leads_icp_id ON leads(icp_id);

-- Step 7: Create type enums for better data integrity (PostgreSQL specific)
CREATE TYPE icp_category_enum AS ENUM('FAMILY_OFFICE', 'INVESTMENT_FUND', 'OPERATOR', 'REIT', 'OTHER');
CREATE TYPE entity_type_enum AS ENUM('FAMILY_OFFICE', 'WEALTH_MANAGER', 'INVESTMENT_FUND', 'OPERATOR', 'REIT', 'UNKNOWN');
CREATE TYPE entity_subtype_enum AS ENUM('SFO', 'MFO', 'FAMILY_CAPITAL', 'RIA', 'PRIVATE_EQUITY', 'PENSION', 'SOVEREIGN', 'UNKNOWN');
CREATE TYPE fo_status_enum AS ENUM('APPROVED', 'REVIEW', 'REJECTED', 'UNKNOWN');

-- Add constraint to companies for icp_link
ALTER TABLE companies ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id);
CREATE INDEX IF NOT EXISTS idx_companies_icp_id ON companies(icp_id);

SELECT 'Migration 40 completed: Type safety columns added!' AS result;
