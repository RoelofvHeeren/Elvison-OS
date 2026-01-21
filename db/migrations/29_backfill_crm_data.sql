-- 1. Backfill leads.company_website from companies.website where missing
UPDATE leads l
SET company_website = c.website
FROM companies c
WHERE l.company_name = c.company_name
  AND (l.company_website IS NULL OR l.company_website = '')
  AND c.website IS NOT NULL;

-- 2. Backfill leads.connection_request from custom_data
UPDATE leads
SET connection_request = custom_data->>'connection_request'
WHERE (connection_request IS NULL OR connection_request = '')
  AND custom_data->>'connection_request' IS NOT NULL
  AND custom_data->>'connection_request' != '';

-- 3. Backfill leads.email_message from custom_data
UPDATE leads
SET email_message = custom_data->>'email_message'
WHERE (email_message IS NULL OR email_message = '')
  AND custom_data->>'email_message' IS NOT NULL
  AND custom_data->>'email_message' != '';

-- 4. Backfill leads.linkedin_message from custom_data if different
UPDATE leads
SET linkedin_message = custom_data->>'linkedin_message'
WHERE (linkedin_message IS NULL OR linkedin_message = '')
  AND custom_data->>'linkedin_message' IS NOT NULL
  AND custom_data->>'linkedin_message' != '';

-- 5. Backfill leads.email_subject from custom_data
UPDATE leads
SET email_subject = custom_data->>'email_subject'
WHERE (email_subject IS NULL OR email_subject = '')
  AND custom_data->>'email_subject' IS NOT NULL
  AND custom_data->>'email_subject' != '';
