-- Consolidate linkedin_message into connection_request
-- Issue: Some messages were saved to 'linkedin_message' instead of 'connection_request'

UPDATE leads
SET connection_request = linkedin_message
WHERE (connection_request IS NULL OR connection_request = '')
  AND (linkedin_message IS NOT NULL AND linkedin_message != '');
