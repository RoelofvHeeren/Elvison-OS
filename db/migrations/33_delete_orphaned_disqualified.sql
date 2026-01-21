-- Delete orphaned leads (not linked to any user)
DELETE FROM leads 
WHERE id NOT IN (SELECT lead_id FROM leads_link);

-- Delete all disqualified leads
DELETE FROM leads_link 
WHERE lead_id IN (
    SELECT id FROM leads WHERE status = 'DISQUALIFIED'
);

DELETE FROM leads 
WHERE status = 'DISQUALIFIED';

-- Clean up orphaned companies again
DELETE FROM companies 
WHERE NOT EXISTS (
    SELECT 1 FROM leads 
    WHERE leads.company_name = companies.company_name
);
