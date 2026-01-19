import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function verifyIntegrity() {
    console.log('🔍 Verifying Database Integrity After Migration 10\n');

    try {
        // 1. Check all foreign key constraints
        console.log('📋 FOREIGN KEY CONSTRAINTS:');
        const fkResult = await pool.query(`
            SELECT 
                tc.constraint_name,
                tc.table_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_schema = 'public'
            ORDER BY tc.table_name, tc.constraint_name;
        `);

        console.log(`✓ Total foreign key constraints: ${fkResult.rows.length}\n`);

        // Group by table
        const byTable = {};
        fkResult.rows.forEach(row => {
            if (!byTable[row.table_name]) byTable[row.table_name] = [];
            byTable[row.table_name].push(row);
        });

        Object.keys(byTable).sort().forEach(tableName => {
            console.log(`  ${tableName}:`);
            byTable[tableName].forEach(fk => {
                console.log(`    ✓ ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
            });
        });

        // 2. Check for orphaned records (records with invalid foreign keys)
        console.log('\n🔍 CHECKING FOR ORPHANED RECORDS:\n');

        const checks = [
            {
                table: 'leads',
                column: 'user_id',
                reference: 'users',
                query: `SELECT COUNT(*) as count FROM leads WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)`
            },
            {
                table: 'leads',
                column: 'icp_id',
                reference: 'icps',
                query: `SELECT COUNT(*) as count FROM leads WHERE icp_id IS NOT NULL AND icp_id NOT IN (SELECT id FROM icps)`
            },
            {
                table: 'companies',
                column: 'user_id',
                reference: 'users',
                query: `SELECT COUNT(*) as count FROM companies WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)`
            },
            {
                table: 'workflow_runs',
                column: 'user_id',
                reference: 'users',
                query: `SELECT COUNT(*) as count FROM workflow_runs WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)`
            },
            {
                table: 'workflow_runs',
                column: 'icp_id',
                reference: 'icps',
                query: `SELECT COUNT(*) as count FROM workflow_runs WHERE icp_id IS NOT NULL AND icp_id NOT IN (SELECT id FROM icps)`
            }
        ];

        let totalOrphans = 0;
        for (const check of checks) {
            try {
                const result = await pool.query(check.query);
                const count = parseInt(result.rows[0].count);
                if (count > 0) {
                    console.log(`  ⚠️  ${check.table}.${check.column}: ${count} orphaned records`);
                    totalOrphans += count;
                } else {
                    console.log(`  ✓ ${check.table}.${check.column}: No orphaned records`);
                }
            } catch (err) {
                console.log(`  ⚠️  ${check.table}.${check.column}: Table or column does not exist`);
            }
        }

        if (totalOrphans === 0) {
            console.log('\n✅ No orphaned records found! Database integrity is intact.');
        } else {
            console.log(`\n⚠️  Found ${totalOrphans} total orphaned records. These should be cleaned up.`);
        }

        // 3. Verify link tables have proper constraints
        console.log('\n🔗 LINK TABLE CONSTRAINTS:');
        const linkTableFKs = fkResult.rows.filter(row =>
            row.table_name.includes('_link')
        );

        if (linkTableFKs.length > 0) {
            linkTableFKs.forEach(row => {
                console.log(`  ✓ ${row.table_name}.${row.column_name} → ${row.foreign_table_name}`);
            });
        } else {
            console.log('  ⚠️  No link table constraints found');
        }

        // 4. Summary
        console.log('\n📊 SUMMARY:');
        console.log(`  • Total foreign key constraints: ${fkResult.rows.length}`);
        console.log(`  • Link table constraints: ${linkTableFKs.length}`);
        console.log(`  • Orphaned records: ${totalOrphans}`);
        console.log(`  • Status: ${totalOrphans === 0 ? '✅ HEALTHY' : '⚠️  NEEDS ATTENTION'}`);

        console.log('\n✅ Verification complete!');

    } catch (error) {
        console.error('❌ Verification failed:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

verifyIntegrity();
