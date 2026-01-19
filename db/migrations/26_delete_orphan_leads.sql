-- Delete leads that have no ICP assigned (these are from companies that don't fit either ICP)
-- First delete from link tables to avoid FK violations

-- Delete from leads_link for leads without ICP
DELETE FROM leads_link WHERE lead_id IN (SELECT id FROM leads WHERE icp_id IS NULL);

-- Now delete the leads themselves
DELETE FROM leads WHERE icp_id IS NULL;
