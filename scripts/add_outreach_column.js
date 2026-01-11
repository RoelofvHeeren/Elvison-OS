
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const FALLBACK_URL = "postgresql://postgres:postgres@localhost:51213/postgres";
const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || FALLBACK_URL;

const pool = new pg.Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
    console.log('🔄 Running migration: Adding pushed_to_outreach column...');
    const maskUrl = (url) => url ? url.replace(/:([^:@]+)@/, ':****@') : 'N/A';
    console.log('📡 Using Connection String:', maskUrl(connectionString));

    try {
        const res = await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS pushed_to_outreach BOOLEAN DEFAULT FALSE;");
        console.log('✅ Migration successful: pushed_to_outreach column added.', res.command);
    } catch (err) {
        console.error('❌ Migration failed!');
        console.error('Error Name:', err.name);
        console.error('Error Message:', err.message);
        console.error('Error Stack:', err.stack);
    } finally {
        await pool.end();
    }
}

migrate();
