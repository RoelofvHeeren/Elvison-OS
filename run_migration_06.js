import { query } from './db/index.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

console.log("DEBUG: DATABASE_URL is " + (process.env.DATABASE_URL ? "SET" : "NOT SET"));
console.log("DEBUG: DATABASE_PUBLIC_URL is " + (process.env.DATABASE_PUBLIC_URL ? "SET" : "NOT SET"));
console.log("DEBUG: Environment Keys Loaded: " + Object.keys(process.env).filter(k => !k.startsWith('npm_') && !k.startsWith('TERM') && !k.startsWith('SHELL')).join(", "));


async function runMigration() {
    try {
        console.log("Reading migration file...");
        const migrationPath = path.join(process.cwd(), 'db', 'migrations', '06_add_run_id_to_leads.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log("Executing migration...");
        await query(sql);

        console.log("✅ Migration 06_add_run_id_to_leads.sql applied successfully!");

        // Verify
        console.log("Verifying schema...");
        const res = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'leads' AND column_name = 'run_id';
        `);

        if (res.rows.length > 0) {
            console.log("✅ Verification passed: 'run_id' column exists.");
        } else {
            console.error("❌ Verification failed: 'run_id' column NOT found.");
        }

    } catch (e) {
        console.error("❌ Migration failed:", e);
    }
}

runMigration();
