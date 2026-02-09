import { query } from '../db/index.js';

async function backfillOutreach() {
    console.log("Starting backfill of outreach data from agent_results...");

    try {
        // 1. Fetch all agent results
        const res = await query(`SELECT id, output_data, created_at FROM agent_results ORDER BY created_at DESC`);
        console.log(`Found ${res.rows.length} agent result records.`);

        let totalUpdated = 0;

        for (const row of res.rows) {
            const data = row.output_data;
            let leads = [];

            if (data.leads) leads = data.leads;
            else if (data.finalOutput && data.finalOutput.leads) leads = data.finalOutput.leads;
            else if (Array.isArray(data)) leads = data;

            if (!leads || leads.length === 0) continue;

            console.log(`Processing result ${row.id} (${row.created_at}) with ${leads.length} leads...`);

            for (const lead of leads) {
                if (!lead.email) continue;

                // Normalize outreach data from the AGENT RESULT
                const connReq = lead.connection_request || lead.linkedin_message;
                const emailMsg = lead.email_message || lead.email_body;

                if (!connReq && !emailMsg) continue;

                // Update the lead in the database
                // We update BOTH columns and custom_data to ensure frontend visibility
                try {
                    const updateRes = await query(`
                        UPDATE leads 
                        SET 
                            connection_request = COALESCE($2, connection_request),
                            linkedin_message = COALESCE($2, linkedin_message),
                            email_message = COALESCE($3, email_message),
                            email_body = COALESCE($3, email_body),
                            custom_data = jsonb_set(
                                jsonb_set(
                                    COALESCE(custom_data, '{}'::jsonb), 
                                    '{connection_request}', 
                                    to_jsonb(COALESCE($2, custom_data->>'connection_request', ''))
                                ), 
                                '{email_message}', 
                                to_jsonb(COALESCE($3, custom_data->>'email_message', ''))
                            )
                        WHERE email = $1
                        AND (
                            (connection_request IS NULL OR connection_request = '') OR
                            (email_message IS NULL OR email_message = '')
                        )
                        RETURNING id
                    `, [lead.email, connReq || null, emailMsg || null]);

                    if (updateRes.rowCount > 0) {
                        // console.log(`Updated lead ${lead.email}`);
                        totalUpdated++;
                    }
                } catch (err) {
                    console.error(`Failed to update lead ${lead.email}:`, err.message);
                }
            }
        }

        console.log(`✅ Backfill complete. Updated ${totalUpdated} leads with missing outreach data.`);

    } catch (e) {
        console.error("Backfill failed:", e);
    }
}

backfillOutreach();
