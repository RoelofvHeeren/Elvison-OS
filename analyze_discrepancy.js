import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function analyzeMessageDiscrepancy() {
    console.log('🔍 Analyzing Message Discrepancy...\n');

    try {
        // 1. Leads with Email but NO Connection Request
        const emailNoConn = await pool.query(`
            SELECT id, company_name, custom_data
            FROM leads 
            WHERE (email_message IS NOT NULL AND email_message != '')
            AND (connection_request IS NULL OR connection_request = '')
            LIMIT 5
        `);

        const countEmailNoConn = await pool.query(`
            SELECT COUNT(*) 
            FROM leads 
            WHERE (email_message IS NOT NULL AND email_message != '')
            AND (connection_request IS NULL OR connection_request = '')
        `);

        console.log(`📉 Leads with Email but MISSING Connection Request: ${countEmailNoConn.rows[0].count}`);

        if (emailNoConn.rows.length > 0) {
            console.log('\nSample Leads (Email OK, Conn Req Missing):');
            emailNoConn.rows.forEach(r => {
                console.log(`- ${r.company_name}`);
                console.log(`  Custom Data Keys: ${r.custom_data ? Object.keys(r.custom_data).join(', ') : 'null'}`);
                if (r.custom_data && r.custom_data.linkedin_message) {
                    console.log(`  Found 'linkedin_message' in custom_data: ${r.custom_data.linkedin_message.substring(0, 30)}...`);
                }
            });
        }

        // 2. Leads with Connection Request but NO Email
        const connNoEmail = await pool.query(`
             SELECT COUNT(*) 
             FROM leads 
             WHERE (connection_request IS NOT NULL AND connection_request != '')
             AND (email_message IS NULL OR email_message = '')
        `);
        console.log(`\n📈 Leads with Connection Request but MISSING Email: ${connNoEmail.rows[0].count}`);

        // 3. Check if 'linkedin_message' column is populated where 'connection_request' is empty
        const linkedinColumnCheck = await pool.query(`
            SELECT COUNT(*) 
            FROM leads
            WHERE (connection_request IS NULL OR connection_request = '')
            AND (linkedin_message IS NOT NULL AND linkedin_message != '')
        `);
        console.log(`\n📝 Leads where 'connection_request' is NULL but 'linkedin_message' column HAS data: ${linkedinColumnCheck.rows[0].count}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

analyzeMessageDiscrepancy();
