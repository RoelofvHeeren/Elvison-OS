import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkCounts() {
    try {
        const userId = 1; // Assuming user ID is 1

        console.log('🔍 Analyzing Company Count Discrepancies\n');

        // 1. Total companies in database
        const total = await pool.query('SELECT COUNT(*) FROM companies WHERE user_id = $1', [userId]);
        console.log(`📊 Total companies in DB: ${total.rows[0].count}`);

        // 2. Companies with fit_score > 5 (Companies page filter when "Show Rejected" is OFF)
        const filtered = await pool.query(
            'SELECT COUNT(*) FROM companies WHERE user_id = $1 AND (fit_score > 5 OR fit_score IS NULL OR cleanup_status = \'KEPT\')',
            [userId]
        );
        console.log(`✅ Companies with fit_score > 5 (or NULL/KEPT): ${filtered.rows[0].count}`);

        // 3. Companies with leads (what CRM might be counting)
        const withLeads = await pool.query(`
            SELECT COUNT(DISTINCT c.company_name) 
            FROM companies c
            INNER JOIN leads l ON c.company_name = l.company_name AND c.user_id = l.user_id
            WHERE c.user_id = $1
            AND l.status != 'DISQUALIFIED'
            AND (l.linkedin_message NOT LIKE '[SKIPPED%' OR l.linkedin_message IS NULL)
        `, [userId]);
        console.log(`👥 Companies with active leads: ${withLeads.rows[0].count}`);

        // 4. Companies with fit_score > 5 AND have leads
        const filteredWithLeads = await pool.query(`
            SELECT COUNT(DISTINCT c.company_name) 
            FROM companies c
            INNER JOIN leads l ON c.company_name = l.company_name AND c.user_id = l.user_id
            WHERE c.user_id = $1
            AND (c.fit_score > 5 OR c.fit_score IS NULL OR c.cleanup_status = 'KEPT')
            AND l.status != 'DISQUALIFIED'
            AND (l.linkedin_message NOT LIKE '[SKIPPED%' OR l.linkedin_message IS NULL)
        `, [userId]);
        console.log(`✅👥 Companies with fit_score > 5 AND active leads: ${filteredWithLeads.rows[0].count}`);

        // 5. Breakdown by fit_score
        console.log('\n📈 Breakdown by fit_score:');
        const breakdown = await pool.query(`
            SELECT 
                CASE 
                    WHEN fit_score IS NULL THEN 'NULL'
                    WHEN fit_score <= 5 THEN '≤ 5 (Low Fit)'
                    WHEN fit_score <= 7 THEN '6-7 (Medium)'
                    ELSE '8-10 (High Fit)'
                END as score_range,
                COUNT(*) as count
            FROM companies
            WHERE user_id = $1
            GROUP BY score_range
            ORDER BY score_range
        `, [userId]);
        breakdown.rows.forEach(row => {
            console.log(`  ${row.score_range}: ${row.count}`);
        });

        // 6. Companies without any leads
        const noLeads = await pool.query(`
            SELECT COUNT(*) 
            FROM companies c
            WHERE c.user_id = $1
            AND NOT EXISTS (
                SELECT 1 FROM leads l 
                WHERE l.company_name = c.company_name 
                AND l.user_id = c.user_id
            )
        `, [userId]);
        console.log(`\n🚫 Companies with NO leads: ${noLeads.rows[0].count}`);

        console.log('\n💡 Analysis:');
        console.log(`- Deep Cleanup sees: ${total.rows[0].count} companies (ALL companies)`);
        console.log(`- Companies page shows: ${filtered.rows[0].count} companies (fit_score > 5 filter)`);
        console.log(`- CRM might show: ${withLeads.rows[0].count} companies (only those with leads)`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await pool.end();
    }
}

checkCounts();
