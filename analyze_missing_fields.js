import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function analyzeMissingData() {
    console.log('🔍 Analyzing Missing CRM Data...\n');

    try {
        // 1. Snapshot of missing fields
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_leads,
                COUNT(l.company_website) as lead_website_count,
                COUNT(c.website) as company_website_count,
                COUNT(l.connection_request) as lead_connection_req_count,
                COUNT(l.email_message) as lead_email_msg_count,
                COUNT(l.linkedin_message) as lead_linkedin_msg_count
            FROM leads l
            LEFT JOIN companies c ON l.company_name = c.company_name
        `);
        console.log('📊 Overall Stats:');
        console.log(stats.rows[0]);

        // 2. Deep dive into "missing website"
        // Check if leads have missing website but company HAS it
        const websiteMismatch = await pool.query(`
            SELECT COUNT(*) as fixable_websites
            FROM leads l
            JOIN companies c ON l.company_name = c.company_name
            WHERE (l.company_website IS NULL OR l.company_website = '')
            AND (c.website IS NOT NULL AND c.website != '')
        `);
        console.log(`\n🌐 Fixable Websites (Leads missing, Company has): ${websiteMismatch.rows[0].fixable_websites}`);

        // 3. Deep dive into "missing messages"
        // Check if messages are hiding in custom_data
        const customDataCheck = await pool.query(`
            SELECT count(*) 
            FROM leads 
            WHERE connection_request IS NULL 
            AND custom_data::text LIKE '%connection_request%'
        `);
        console.log(`\n📝 Messages in custom_data (but column IS NULL): ${customDataCheck.rows[0].count}`);

        // 4. Sample a "missing everything" lead to see what's going on
        const sample = await pool.query(`
            SELECT l.id, l.company_name, l.company_website, c.website as c_website, 
                   l.connection_request, l.email_message, l.custom_data
            FROM leads l
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE l.company_website IS NULL 
            AND l.connection_request IS NULL
            LIMIT 3
        `);
        console.log('\n❌ Sample "Blank" Leads:');
        sample.rows.forEach(r => {
            console.log(`\nCompany: ${r.company_name}`);
            console.log(`L Website: ${r.company_website}, C Website: ${r.c_website}`);
            console.log(`Conn Req: ${r.connection_request}`);
            console.log(`Custom Data Keys: ${r.custom_data ? Object.keys(r.custom_data).join(', ') : 'null'}`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

analyzeMissingData();
