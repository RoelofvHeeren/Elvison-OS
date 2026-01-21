import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkPage1Data() {
    console.log('🔍 Checking Page 1 Data (What API Should Return)...\n');

    try {
        // Simulate the exact query from /api/leads endpoint
        const { rows } = await pool.query(`
            SELECT l.*,
                c.company_profile as company_profile_text,
                c.fit_score as company_fit_score
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            ORDER BY l.created_at DESC
            LIMIT 10
        `);

        console.log(`📋 Found ${rows.length} leads for page 1\n`);

        rows.forEach((lead, i) => {
            console.log(`\n--- Lead ${i + 1}: ${lead.person_name} (${lead.company_name}) ---`);
            console.log(`  Email: ${lead.email || 'MISSING'}`);
            console.log(`  Company Website: ${lead.company_website || 'MISSING'}`);
            console.log(`  Connection Request: ${lead.connection_request ? lead.connection_request.substring(0, 50) + '...' : 'MISSING'}`);
            console.log(`  Email Message: ${lead.email_message ? lead.email_message.substring(0, 50) + '...' : 'MISSING'}`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkPage1Data();
