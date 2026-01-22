import { query } from '../db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigration() {
    console.log('Running Outreach V5 Column Migration...');
    const migrationPath = path.join(__dirname, '../db/migrations/04_add_outreach_v5_columns.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    try {
        await query(sql);
        console.log('Migration 04_add_outreach_v5_columns applied successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

runMigration();
