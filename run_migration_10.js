import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

async function runMigration() {
    console.log('🚀 Starting Migration 10: Additional Integrity Fixes\n');

    // Use production DATABASE_URL from .env
    const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;

    if (!databaseUrl) {
        console.error('❌ ERROR: DATABASE_URL not found in environment variables');
        console.log('Please ensure your .env file contains the production DATABASE_URL');
        process.exit(1);
    }

    console.log('✓ Database URL found');
    console.log(`✓ Connecting to: ${databaseUrl.substring(0, 30)}...`);

    const pool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // Test connection
        await pool.query('SELECT NOW()');
        console.log('✓ Database connection successful\n');

        // Read migration file
        const migrationPath = path.join(__dirname, 'db', 'migrations', '10_additional_integrity_fixes.sql');
        console.log(`📄 Reading migration file: ${migrationPath}`);

        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        console.log(`✓ Migration file loaded (${migrationSQL.length} bytes)\n`);

        // Execute migration
        console.log('⚙️  Executing migration...\n');
        const result = await pool.query(migrationSQL);

        console.log('✅ Migration executed successfully!');
        if (result.rows && result.rows.length > 0) {
            console.log(`📊 Result: ${result.rows[0].result}`);
        }

        // Verify constraints were added
        console.log('\n🔍 Verifying foreign key constraints...');
        const fkCheck = await pool.query(`
            SELECT 
                tc.constraint_name,
                tc.table_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_schema = 'public'
                AND tc.constraint_name LIKE 'fk_%'
            ORDER BY tc.table_name, tc.constraint_name;
        `);

        console.log(`✓ Total foreign key constraints: ${fkCheck.rows.length}`);

        // Show link table constraints specifically
        const linkTableConstraints = fkCheck.rows.filter(row =>
            row.table_name.includes('_link')
        );

        if (linkTableConstraints.length > 0) {
            console.log('\n📋 Link table constraints:');
            linkTableConstraints.forEach(row => {
                console.log(`  ✓ ${row.constraint_name}: ${row.table_name}.${row.column_name} → ${row.foreign_table_name}`);
            });
        }

        console.log('\n✅ Migration completed successfully!');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error('\nFull error:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
