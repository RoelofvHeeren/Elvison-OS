/**
 * Migration: Add market_intelligence column to companies table
 * Run this script to add the missing column for Deep Research reports
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
    try {
        await pool.query(`
            ALTER TABLE companies 
            ADD COLUMN IF NOT EXISTS market_intelligence TEXT;
        `);

        console.log('✅ market_intelligence column added successfully');
        await pool.end();
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        await pool.end();
        process.exit(1);
    }
}

migrate();
