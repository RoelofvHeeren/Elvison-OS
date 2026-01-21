import pg from 'pg';
import dotenv from 'dotenv';
import { OutreachService } from './src/backend/services/outreach-service.js';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function regenerateAllMissingMessages() {
    console.log('🔄 Regenerating ALL missing messages for leads with company profiles...\n');

    try {
        // Find ALL leads with company profile but missing EITHER connection request OR email message
        const { rows: leads } = await pool.query(`
            SELECT 
                l.id, 
                l.company_name, 
                l.person_name, 
                l.company_website, 
                l.connection_request,
                l.email_message,
                c.company_profile,
                c.fit_score,
                c.icp_type
            FROM leads l
            LEFT JOIN companies c ON l.company_name = c.company_name
            LEFT JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            AND (c.company_profile IS NOT NULL AND c.company_profile != '')
            AND (
                (l.connection_request IS NULL OR l.connection_request = '')
                OR (l.email_message IS NULL OR l.email_message = '')
            )
        `);

        console.log(`📋 Found ${leads.length} leads to regenerate.\n`);

        let updated = 0;
        let failed = 0;

        for (const lead of leads) {
            try {
                const firstName = lead.person_name ? lead.person_name.split(' ')[0] : 'there';
                console.log(`Processing: ${lead.person_name} (${lead.company_name})`);

                const result = await OutreachService.createLeadMessages({
                    company_name: lead.company_name,
                    website: lead.company_website,
                    company_profile: lead.company_profile,
                    fit_score: lead.fit_score,
                    icp_type: lead.icp_type,
                    first_name: firstName,
                    person_name: lead.person_name
                });

                // Always update both fields to ensure consistency
                if (result) {
                    await pool.query(`
                        UPDATE leads 
                        SET connection_request = $1,
                            linkedin_message = $1,
                            email_message = $2,
                            email_subject = $3
                        WHERE id = $4
                    `, [
                        result.linkedin_message || lead.connection_request,
                        result.email_body || result.email_message || lead.email_message,
                        result.email_subject,
                        lead.id
                    ]);
                    updated++;
                    console.log(`   ✅ Generated messages`);
                } else {
                    console.log(`   ⚠️ No result from OutreachService`);
                    failed++;
                }

            } catch (e) {
                console.error(`   ❌ Failed for ${lead.person_name}:`, e.message);
                failed++;
            }
        }

        console.log(`\n✨ Complete! Updated: ${updated}, Failed: ${failed}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

regenerateAllMissingMessages();
