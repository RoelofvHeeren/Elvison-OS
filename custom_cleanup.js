
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    try {
        console.log('🗑️ DELETING Consolidated Mechanical...');
        const res = await pool.query(`DELETE FROM leads WHERE company_name ILIKE '%Consolidated Mechanical%' RETURNING *`);
        console.log(`✅ Deleted ${res.rowCount} records:`);
        res.rows.forEach(r => console.log(`   - ${r.company_name} (Score: ${r.custom_data?.fit_score})`));
    } catch (e) {
        console.error('Error:', e);
    } finally {
        pool.end();
    }
}
main();
