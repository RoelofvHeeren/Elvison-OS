-- Delete ghost companies (no leads)
DELETE FROM companies 
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE leads.company_name = companies.company_name);

-- Handle orphan leads (no company record)
-- First delete from link table
DELETE FROM leads_link 
WHERE lead_id IN (
    SELECT l.id FROM leads l
    LEFT JOIN companies c ON l.company_name = c.company_name
    WHERE c.id IS NULL
);

-- Then delete the orphan leads
DELETE FROM leads 
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE companies.company_name = leads.company_name);
