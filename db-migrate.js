
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
    console.log('🔄 Running migration: Adding outreach_status column...');
    try {
        await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_status VARCHAR(50) DEFAULT 'pending';");
        console.log('✅ Migration successful: outreach_status column added.');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
    } finally {
        await pool.end();
    }
}

migrate();
