-- Repopulate workflow_runs.user_id from workflow_runs_link_table
UPDATE workflow_runs wr
SET user_id = link.parent_id
FROM workflow_runs_link_table link
WHERE wr.id = link.workflow_run_id
  AND link.parent_type = 'user'
  AND wr.user_id IS NULL;
