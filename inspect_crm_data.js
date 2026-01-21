import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectMessages() {
    console.log('🔍 Inspecting message columns and skipped status...\n');

    try {
        // 1. Check columns in leads vs companies
        const leadCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'leads' 
            AND column_name IN ('linkedin_message', 'email_subject', 'email_body', 'website', 'company_website')
        `);
        console.log('📋 Leads columns:', leadCols.rows.map(r => r.column_name));

        const compCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'companies' 
            AND column_name IN ('linkedin_message', 'email_subject', 'email_body', 'website', 'company_website')
        `);
        console.log('📋 Companies columns:', compCols.rows.map(r => r.column_name));

        // 2. Check for "SKIPPED" messages
        const skippedMsgs = await pool.query(`
            SELECT COUNT(*) as count, status,
                   substring(linkedin_message, 1, 50) as linkedin_preview
            FROM leads
            WHERE linkedin_message ILIKE '%[SKIPPED]%'
            GROUP BY status, linkedin_preview
        `);
        console.log('\n📋 Leads with [SKIPPED] in linkedin_message:');
        skippedMsgs.rows.forEach(r => console.log(`   - Count: ${r.count}, Status: ${r.status}, Preview: ${r.linkedin_preview}`));

        // 3. Check for specific company "TPP" or "CPP"
        const specificComp = await pool.query(`
            SELECT id, company_name, fit_score, status, icp_type, 
                   cleanup_status, linkedin_message
            FROM companies 
            WHERE company_name ILIKE '%TPP%' OR company_name ILIKE '%CPP%'
        `);
        console.log('\n📋 Specific Company Check (TPP/CPP):');
        specificComp.rows.forEach(r => {
            console.log(`   - ${r.company_name}`);
            console.log(`     Score: ${r.fit_score}, Status: ${r.status}`);
            console.log(`     Message: ${r.linkedin_message ? r.linkedin_message.substring(0, 50) : 'NULL'}`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

inspectMessages();
