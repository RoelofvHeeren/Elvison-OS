import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkCompaniesSchema() {
    console.log('🔍 Checking companies table schema and ICP links...\n');

    try {
        // Get companies columns
        const columns = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'companies'
            ORDER BY ordinal_position
        `);
        console.log('📋 Companies table columns:');
        columns.rows.forEach(r => console.log(`   - ${r.column_name}: ${r.data_type}`));

        // Check for ICP-related columns or relationships
        const icpColumns = columns.rows.filter(r => r.column_name.includes('icp'));
        if (icpColumns.length > 0) {
            console.log('\n✅ Found ICP-related columns in companies:', icpColumns.map(c => c.column_name));
        } else {
            console.log('\n❌ No ICP-related columns in companies table');
        }

        // Check for icp_company_link table
        const icpCompanyLink = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'icp_company_link'
            );
        `);
        console.log(`\n📋 icp_company_link table exists: ${icpCompanyLink.rows[0].exists}`);

        if (icpCompanyLink.rows[0].exists) {
            const linkData = await pool.query(`SELECT COUNT(*) as count FROM icp_company_link`);
            console.log(`   Rows in icp_company_link: ${linkData.rows[0].count}`);

            const sample = await pool.query(`SELECT * FROM icp_company_link LIMIT 5`);
            console.log('   Sample:', sample.rows);
        }

        // Check companies sample
        const companiesSample = await pool.query(`
            SELECT id, company_name, user_id 
            FROM companies 
            LIMIT 5
        `);
        console.log('\n📋 Companies sample:');
        companiesSample.rows.forEach(r => console.log(`   - ${r.company_name} (user: ${r.user_id})`));

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkCompaniesSchema();
