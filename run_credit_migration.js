import { query, getClient } from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigration() {
    console.log('Running Credit Migration...');
    const migrationPath = path.join(__dirname, 'db/migrations/03_add_credits.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    try {
        await query(sql);
        console.log('Migration 03_add_credits applied successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

runMigration();
