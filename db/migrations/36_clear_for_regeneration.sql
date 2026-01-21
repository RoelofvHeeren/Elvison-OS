-- Clear messages for forced regeneration of the 282 elite leads
UPDATE leads 
SET connection_request = NULL,
    linkedin_message = NULL,
    email_message = NULL,
    email_subject = NULL
WHERE id IN (SELECT lead_id FROM leads_link WHERE parent_type = 'user');
