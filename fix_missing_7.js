import pg from 'pg';
import dotenv from 'dotenv';
import { OutreachService } from './src/backend/services/outreach-service.js';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixMissingMessages() {
    console.log('🔧 Fixing the 7 leads with missing messages...\\n');

    try {
        // Get the 7 leads
        const { rows: leads } = await pool.query(`
            SELECT l.id, l.person_name, l.company_name, l.company_website, c.company_profile
            FROM leads l
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE l.email_message IS NULL OR l.connection_request IS NULL
            LIMIT 10
        `);

        console.log(`Found ${leads.length} leads to fix\\n`);

        for (const lead of leads) {
            const firstName = lead.person_name ? lead.person_name.trim().split(' ')[0] : 'there';
            console.log(`Processing: ${lead.person_name} (${lead.company_name})`);

            try {
                const result = await OutreachService.createLeadMessages({
                    company_name: lead.company_name,
                    company_profile: lead.company_profile,
                    person_name: lead.person_name,
                    first_name: firstName
                });

                console.log('  Result:', JSON.stringify(result, null, 2));

                if (result && result.linkedin_message && result.email_body) {
                    await pool.query(`
                        UPDATE leads 
                        SET connection_request = $1,
                            email_message = $2,
                            email_subject = $3
                        WHERE id = $4
                    `, [
                        result.linkedin_message,
                        result.email_body,
                        result.email_subject,
                        lead.id
                    ]);
                    console.log('  ✅ Updated\\n');
                } else {
                    console.log('  ⚠️  No valid messages generated\\n');
                }

            } catch (e) {
                console.error(`  ❌ Error:`, e.message, '\\n');
            }
        }

        console.log('✨ Done!');

    } catch (error) {
        console.error('❌ Fatal error:', error);
    } finally {
        await pool.end();
    }
}

fixMissingMessages();
