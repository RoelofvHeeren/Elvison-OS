-- Map companies.icp_type codes to actual ICP ids
-- Family Office types: FAMILY_OFFICE_SINGLE, FAMILY_OFFICE_MULTI
-- Investment Fund types: Everything else (PENSION, REIT_PUBLIC, ASSET_MANAGER_MULTI_STRATEGY, etc.)

-- Family Office Strategy
UPDATE leads l
SET icp_id = (SELECT id FROM icps WHERE name = 'Family Office Strategy' LIMIT 1)
FROM companies c
WHERE l.company_name = c.company_name
  AND c.icp_type IN ('FAMILY_OFFICE_SINGLE', 'FAMILY_OFFICE_MULTI')
  AND l.icp_id IS NULL;

-- Investment Fund Strategy (all other types)
UPDATE leads l
SET icp_id = (SELECT id FROM icps WHERE name = 'Investment Fund Strategy' LIMIT 1)
FROM companies c
WHERE l.company_name = c.company_name
  AND c.icp_type NOT IN ('FAMILY_OFFICE_SINGLE', 'FAMILY_OFFICE_MULTI')
  AND c.icp_type IS NOT NULL
  AND l.icp_id IS NULL;
