import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkNoIcpLeads() {
    console.log('🔍 Checking 147 leads without ICP...\n');

    try {
        // Get leads without ICP and their company info
        const noIcpLeads = await pool.query(`
            SELECT 
                l.id as lead_id,
                l.company_name,
                c.icp_type,
                c.company_profile,
                c.fit_score,
                c.capital_role
            FROM leads l
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE l.icp_id IS NULL
            ORDER BY l.company_name
        `);

        console.log(`📋 Found ${noIcpLeads.rows.length} leads without ICP\n`);

        // Group by company
        const companies = {};
        noIcpLeads.rows.forEach(r => {
            if (!companies[r.company_name]) {
                companies[r.company_name] = {
                    count: 0,
                    icp_type: r.icp_type,
                    fit_score: r.fit_score,
                    capital_role: r.capital_role,
                    profile_preview: r.company_profile ? r.company_profile.substring(0, 200) : 'No profile'
                };
            }
            companies[r.company_name].count++;
        });

        console.log('📊 Breakdown by company:\n');
        Object.keys(companies).forEach(name => {
            const c = companies[name];
            console.log(`${name}:`);
            console.log(`   Leads: ${c.count}`);
            console.log(`   icp_type: ${c.icp_type || 'NULL'}`);
            console.log(`   fit_score: ${c.fit_score || 'NULL'}`);
            console.log(`   capital_role: ${c.capital_role || 'NULL'}`);
            console.log(`   Profile: ${c.profile_preview}...`);
            console.log('');
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkNoIcpLeads();
