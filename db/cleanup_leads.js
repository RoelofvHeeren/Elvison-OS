
import { query, pool } from './index.js';

const cleanupSkippedLeads = async () => {
    try {
        console.log('🧹 Starting cleanup of SKIPPED leads...');

        // 1. Get IDs of bad leads
        const result = await query(`
            SELECT id FROM leads 
            WHERE linkedin_message LIKE '[SKIPPED%' 
               OR email_body LIKE '[SKIPPED%'
               OR email_message LIKE '[SKIPPED%'
        `);

        const leadIds = result.rows.map(r => r.id);
        console.log(`Found ${leadIds.length} skipped leads to delete.`);

        if (leadIds.length > 0) {
            // 2. Delete links first (if cascading isn't set up perfectly)
            await query('DELETE FROM leads_link WHERE lead_id = ANY($1)', [leadIds]);
            await query('DELETE FROM leads_link WHERE lead_id = ANY($1)', [leadIds]).catch(() => { });

            // 3. Delete from feedback
            const fbResult = await query('SELECT id FROM lead_feedback WHERE lead_id = ANY($1)', [leadIds]);
            const fbIds = fbResult.rows.map(r => r.id);
            if (fbIds.length > 0) {
                await query('DELETE FROM lead_feedback_link_table WHERE lead_feedback_id = ANY($1)', [fbIds]);
                await query('DELETE FROM lead_feedback WHERE id = ANY($1)', [fbIds]);
            }

            // 4. Delete Leads
            await query('DELETE FROM leads WHERE id = ANY($1)', [leadIds]);
            console.log('✅ Successfully deleted bad leads.');
        } else {
            console.log('✅ No skipped leads found in DB.');
        }

    } catch (err) {
        console.error('❌ Cleanup failed:', err);
    } finally {
        await pool.end();
    }
};

cleanupSkippedLeads();
