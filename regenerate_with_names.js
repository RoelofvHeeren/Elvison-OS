import dotenv from 'dotenv';
dotenv.config();
import { query } from './db/index.js';
import { OutreachService } from './src/backend/services/outreach-service.js';

async function regenerateAllMessages() {
    console.log("🔄 Regenerating all lead messages with actual first names...\n");

    try {
        // Fetch all leads that need regeneration (non-skipped ones)
        const result = await query(`
            SELECT 
                l.id,
                l.person_name,
                l.company_name,
                c.company_profile,
                c.fit_score,
                c.icp_type,
                c.website
            FROM leads l
            LEFT JOIN companies c ON LOWER(l.company_name) = LOWER(c.company_name)
            WHERE l.linkedin_message NOT LIKE '[SKIPPED%'
               OR l.linkedin_message IS NULL
            ORDER BY l.created_at DESC
        `);

        const leads = result.rows;
        console.log(`Found ${leads.length} leads to regenerate\n`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const lead of leads) {
            try {
                const firstName = lead.person_name ? lead.person_name.split(' ')[0] : null;

                console.log(`Processing: ${lead.person_name} @ ${lead.company_name}...`);

                const messages = await OutreachService.createLeadMessages({
                    company_name: lead.company_name,
                    website: lead.website,
                    company_profile: lead.company_profile,
                    fit_score: lead.fit_score,
                    icp_type: lead.icp_type,
                    person_name: lead.person_name,
                    first_name: firstName
                });

                if (messages.status === 'SKIP') {
                    await query(`
                        UPDATE leads 
                        SET linkedin_message = $1,
                            email_body = $2,
                            last_outreach_generated_at = NOW()
                        WHERE id = $3
                    `, [
                        `[SKIPPED: ${messages.skip_reason}]`,
                        `[SKIPPED: ${messages.skip_reason}]`,
                        lead.id
                    ]);
                    console.log(`  ⏭️  Skipped: ${messages.skip_reason}\n`);
                    skipped++;
                } else {
                    await query(`
                        UPDATE leads 
                        SET linkedin_message = $1,
                            email_subject = $2,
                            email_body = $3,
                            last_outreach_generated_at = NOW()
                        WHERE id = $4
                    `, [
                        messages.linkedin_message,
                        messages.email_subject,
                        messages.email_body,
                        lead.id
                    ]);
                    console.log(`  ✅ Updated with first name: ${firstName}\n`);
                    updated++;
                }

            } catch (e) {
                console.error(`  ❌ Error: ${e.message}\n`);
                errors++;
            }
        }

        console.log("\n" + "=".repeat(50));
        console.log(`✅ Updated: ${updated}`);
        console.log(`⏭️  Skipped: ${skipped}`);
        console.log(`❌ Errors: ${errors}`);
        console.log(`📊 Total: ${leads.length}`);
        console.log("=".repeat(50));

    } catch (e) {
        console.error("Fatal error:", e);
    }
}

regenerateAllMessages();
