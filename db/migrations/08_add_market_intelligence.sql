-- Migration 08: Add market_intelligence and last_researched_at columns
-- These columns support the Deep Research full-site scraping feature

ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS market_intelligence TEXT;

ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS last_researched_at TIMESTAMP WITH TIME ZONE;

SELECT 'market_intelligence and last_researched_at columns added successfully!' AS result;
