-- Delete leads without email addresses (they're useless for outreach)

-- First, delete from link table
DELETE FROM leads_link 
WHERE lead_id IN (
    SELECT id FROM leads 
    WHERE email IS NULL OR email = ''
);

-- Then delete the leads themselves
DELETE FROM leads 
WHERE email IS NULL OR email = '';

-- Finally, clean up companies that now have no leads
DELETE FROM companies 
WHERE NOT EXISTS (
    SELECT 1 FROM leads 
    WHERE leads.company_name = companies.company_name
);
