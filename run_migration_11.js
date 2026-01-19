import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function runMigration() {
    console.log('🚀 Applying Migration 11 (Missing Lead Columns)...\n');
    let client;

    try {
        client = await pool.connect();
        const sql = fs.readFileSync(path.join(__dirname, 'db/migrations/11_add_missing_lead_columns.sql'), 'utf8');
        await client.query(sql);
        console.log('✅ Migration 11 applied successfully!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

runMigration();
