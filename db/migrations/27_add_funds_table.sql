
-- Table: funds (SEC Filings)
CREATE TABLE IF NOT EXISTS funds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    cik VARCHAR(20),
    offering_amount VARCHAR(50),
    industry VARCHAR(100),
    filing_date DATE,
    sec_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link Leads to Funds
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS fund_id UUID REFERENCES funds(id);
