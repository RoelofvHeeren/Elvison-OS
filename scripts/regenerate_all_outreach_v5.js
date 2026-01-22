import { query } from '../db/index.js';
import { OutreachService } from '../src/backend/services/outreach-service.js';

/**
 * REGENERATE OUTREACH V5.1 MIGRATION SCRIPT
 * 
 * Applies all V5.1 patches (Family Office fix, Deal Name rejection, etc.)
 * to ALL existing leads in the database.
 */

async function regenerateAllLeads() {
    console.log('\n==================================================');
    console.log('🚀 STARTING OUTREACH V5.1 MASS REGENERATION');
    console.log('==================================================\n');

    try {
        // 1. Fetch all leads with ICP info
        console.log('Fetching all leads from database...');
        const { rows: leads } = await query(`
            SELECT 
                l.id, 
                l.person_name, 
                l.company_name, 
                l.company_profile, 
                l.job_title, 
                l.linkedin_url,
                l.email,
                l.match_score as fit_score,
                l.icp_id,
                l.custom_data,
                i.name as icp_type
            FROM leads l
            LEFT JOIN icps i ON l.icp_id = i.id
            ORDER BY l.id ASC
        `);

        console.log(`Found ${leads.length} leads to process.\n`);

        let stats = {
            total: leads.length,
            processed: 0,
            success: 0,
            skip: 0,
            needs_research: 0,
            error: 0,
            changed_status: 0
        };

        // 2. Process each lead
        for (const lead of leads) {
            process.stdout.write(`Processing lead ${stats.processed + 1}/${stats.total}: ${lead.company_name}... `);

            try {
                // Parse custom data for website and profile if needed
                let website = '';
                let customProfile = '';
                try {
                    const cd = typeof lead.custom_data === 'string'
                        ? JSON.parse(lead.custom_data)
                        : (lead.custom_data || {});
                    website = cd.company_website || '';
                    customProfile = cd.company_profile || '';
                } catch (e) { }

                // Extract first name
                const firstName = lead.person_name ? lead.person_name.split(' ')[0] : '';

                // Ensure fit_score is a number
                const fitScore = typeof lead.fit_score === 'number' ? lead.fit_score : 0;

                // REGENERATE MESSAGE
                const result = await OutreachService.createLeadMessages({
                    company_name: lead.company_name,
                    company_profile: lead.company_profile || customProfile || '',
                    website: website,
                    fit_score: fitScore,
                    icp_type: lead.icp_type || '',
                    first_name: firstName,
                    person_name: lead.person_name
                });

                // 3. Update Database
                // We update EVERYTHING related to outreach to ensure consistency
                await query(`
                    UPDATE leads 
                    SET 
                        outreach_status = $1,
                        outreach_reason = $2,
                        linkedin_message = $3,
                        email_body = $4,
                        research_fact = $5,
                        research_fact_type = $6,
                        profile_quality_score = $7,
                        message_version = $8
                    WHERE id = $9
                `, [
                    result.outreach_status,
                    result.outreach_reason,
                    result.linkedin_message,
                    result.email_body,
                    result.research_fact,
                    result.research_fact_type,
                    Math.round(result.profile_quality_score || 0), // Ensure integer
                    'v5.1', // Mark version explicitly
                    lead.id
                ]);

                // Update stats
                const status = (result.outreach_status || 'ERROR').toLowerCase();
                if (stats[status] !== undefined) {
                    stats[status]++;
                } else {
                    stats.error++;
                }

                // Color coded output
                let icon = '❓';
                if (result.outreach_status === 'SUCCESS') icon = '✅';
                if (result.outreach_status === 'SKIP') icon = '⏭️ ';
                if (result.outreach_status === 'NEEDS_RESEARCH') icon = '🔬';
                if (result.outreach_status === 'ERROR') icon = '❌';

                const reason = result.outreach_reason ? ` (${result.outreach_reason})` : '';
                console.log(`${icon} ${result.outreach_status}${reason}`);

            } catch (err) {
                console.log(`❌ ERROR: ${err.message}`);
                stats.error++;
            }

            stats.processed++;
        }

        // 4. Final Summary
        console.log('\n==================================================');
        console.log('🎉 REGENERATION COMPLETE');
        console.log('==================================================');
        console.log(`Total Leads:       ${stats.total}`);
        console.log(`✅ SUCCESS:        ${stats.success} (${Math.round(stats.success / stats.total * 100)}%)`);
        console.log(`⏭️  SKIP:           ${stats.skip} (${Math.round(stats.skip / stats.total * 100)}%)`);
        console.log(`🔬 NEEDS_RESEARCH: ${stats.needs_research} (${Math.round(stats.needs_research / stats.total * 100)}%)`);
        console.log(`❌ ERROR:          ${stats.error}`);
        console.log('==================================================\n');

    } catch (err) {
        console.error('Fatal error in regeneration script:', err);
    } finally {
        process.exit();
    }
}

regenerateAllLeads();
