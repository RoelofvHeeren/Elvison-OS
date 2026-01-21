import pg from 'pg';
import dotenv from 'dotenv';
import { OutreachService } from './src/backend/services/outreach-service.js';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function regenerateMissingMessages() {
    console.log('🔄 Regenerating missing connection requests...\n');

    try {
        // Find leads with email but no connection request
        const { rows: leads } = await pool.query(`
            SELECT 
                l.id, 
                l.company_name, 
                l.person_name, 
                l.company_website, 
                c.company_profile,
                c.fit_score,
                c.icp_type
            FROM leads l
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE (l.email_message IS NOT NULL AND l.email_message != '')
            AND (l.connection_request IS NULL OR l.connection_request = '')
        `);

        console.log(`📋 Found ${leads.length} leads to regenerate.`);

        let updated = 0;
        let failed = 0;

        for (const lead of leads) {
            try {
                console.log(`Processing: ${lead.company_name}`);

                const result = await OutreachService.createLeadMessages({
                    company_name: lead.company_name,
                    website: lead.company_website,
                    company_profile: lead.company_profile || '',
                    fit_score: lead.fit_score,
                    icp_type: lead.icp_type,
                    first_name: lead.person_name ? lead.person_name.split(' ')[0] : 'there',
                    person_name: lead.person_name
                });

                if (result && result.linkedin_message) {
                    await pool.query(`
                        UPDATE leads 
                        SET connection_request = $1,
                            linkedin_message = $1 -- Sync both just in case
                        WHERE id = $2
                    `, [result.linkedin_message, lead.id]);
                    updated++;
                    console.log(`   ✅ Generated: "${result.linkedin_message.substring(0, 50)}..."`);
                } else {
                    console.log(`   ⚠️ No message generated (Result empty)`);
                    failed++;
                }

            } catch (e) {
                console.error(`   ❌ Failed for ${lead.company_name}:`, e.message);
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

regenerateMissingMessages();
