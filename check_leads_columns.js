import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkLeadsColumns() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'leads'
            ORDER BY column_name;
        `);
        console.log('📋 Leads Columns:');
        res.rows.forEach(row => console.log(` - ${row.column_name}: ${row.data_type}`));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkLeadsColumns();
