
import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env from root
dotenv.config({ path: path.join(__dirname, '.env') });

const FALLBACK_URL = "postgresql://postgres:postgres@localhost:51214/postgres";
const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || FALLBACK_URL;

console.log(`Connecting to database using: ${connectionString === FALLBACK_URL ? 'Fallback URL (Local)' : 'Environment Variable'}`);

const pool = new pg.Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function query(text, params) {
    return pool.query(text, params);
}

async function runMigration() {
    try {
        console.log('Running migration 07...');

        const sqlPath = path.join(__dirname, 'db', 'migrations', '07_create_companies_table.sql');
        const sql = await fs.readFile(sqlPath, 'utf8');

        // Execute the entire SQL file
        await query(sql);

        console.log('✅ Migration 07 applied successfully!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
