-- Repopulate leads.icp_id by matching company_name to companies, then looking up ICP by name

-- First, update leads that match companies with icp_type = 'Family Office Strategy'
UPDATE leads l
SET icp_id = (SELECT id FROM icps WHERE name = 'Family Office Strategy' LIMIT 1)
FROM companies c
WHERE l.company_name = c.company_name
  AND c.icp_type = 'Family Office Strategy'
  AND l.icp_id IS NULL;

-- Then, update leads that match companies with icp_type = 'Investment Fund Strategy'
UPDATE leads l
SET icp_id = (SELECT id FROM icps WHERE name = 'Investment Fund Strategy' LIMIT 1)
FROM companies c
WHERE l.company_name = c.company_name
  AND c.icp_type = 'Investment Fund Strategy'
  AND l.icp_id IS NULL;
