import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function debugIcpMatch() {
    console.log('🔍 Debugging ICP match issue...\n');

    try {
        // 1. Check companies icp_type distribution
        const compIcp = await pool.query(`
            SELECT icp_type, COUNT(*) as count
            FROM companies
            GROUP BY icp_type
        `);
        console.log('📋 Companies by icp_type:');
        compIcp.rows.forEach(r => console.log(`   - ${r.icp_type || 'NULL'}: ${r.count}`));

        // 2. Check if company_name matches
        const matchTest = await pool.query(`
            SELECT COUNT(*) as matching_leads
            FROM leads l
            JOIN companies c ON l.company_name = c.company_name
        `);
        console.log(`\n📋 Leads matching companies by company_name: ${matchTest.rows[0].matching_leads}`);

        // 3. Sample companies with icp_type
        const sampleComp = await pool.query(`
            SELECT company_name, icp_type 
            FROM companies 
            WHERE icp_type IS NOT NULL
            LIMIT 5
        `);
        console.log('\n📋 Sample companies with icp_type:');
        sampleComp.rows.forEach(r => console.log(`   - ${r.company_name}: ${r.icp_type}`));

        // 4. Sample leads
        const sampleLeads = await pool.query(`
            SELECT company_name 
            FROM leads 
            LIMIT 5
        `);
        console.log('\n📋 Sample leads company_name:');
        sampleLeads.rows.forEach(r => console.log(`   - ${r.company_name}`));

        // 5. ICPs table
        const icps = await pool.query(`SELECT id, name FROM icps`);
        console.log('\n📋 ICPs:');
        icps.rows.forEach(r => console.log(`   - ${r.name}: ${r.id}`));

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

debugIcpMatch();
