
import { query } from './db/index.js';
import fs from 'fs';

async function runMigration() {
    try {
        console.log("Reading migration file...");
        const sql = fs.readFileSync('./db/migrations/05_company_tracking.sql', 'utf8');
        console.log("Executing migration...");
        await query(sql);
        console.log("Migration 05_company_tracking.sql applied successfully!");
    } catch (e) {
        console.error("Migration failed:", e);
    }
}

runMigration();
