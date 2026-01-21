import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function analyzeLeadQuality() {
    console.log('🔍 Comprehensive Lead Quality Analysis...\n');

    try {
        // 1. Leads with [SKIPPED] messages (should be 0 after cleanup)
        const { rows: skipped } = await pool.query(`
            SELECT COUNT(*) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
            AND (
                connection_request LIKE '%[SKIPPED%'
                OR email_message LIKE '%[SKIPPED%'
                OR linkedin_message LIKE '%[SKIPPED%'
            )
        `);
        console.log(`❌ Leads with [SKIPPED] messages: ${skipped[0].count}`);

        // 2. Leads with no job title
        const { rows: noTitle } = await pool.query(`
            SELECT COUNT(*) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            AND (l.job_title IS NULL OR l.job_title = '' OR l.job_title = '—')
        `);
        console.log(`📛 Leads with NO job title: ${noTitle[0].count}`);

        // 3. Leads with company profile but no connection request
        const { rows: noConnReq } = await pool.query(`
            SELECT COUNT(*) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            AND (l.connection_request IS NULL OR l.connection_request = '')
            AND (c.company_profile IS NOT NULL AND c.company_profile != '')
        `);
        console.log(`📝 Leads with company profile but NO connection request: ${noConnReq[0].count}`);

        // 4. Leads with company profile but no email message
        const { rows: noEmail } = await pool.query(`
            SELECT COUNT(*) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            AND (l.email_message IS NULL OR l.email_message = '')
            AND (c.company_profile IS NOT NULL AND c.company_profile != '')
        `);
        console.log(`📧 Leads with company profile but NO email message: ${noEmail[0].count}`);

        // 5. Leads with no company profile at all
        const { rows: noProfile } = await pool.query(`
            SELECT COUNT(*) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            AND (c.company_profile IS NULL OR c.company_profile = '')
        `);
        console.log(`🏢 Leads with NO company profile: ${noProfile[0].count}`);

        // 6. Sample of "bad" companies (like stealth AI, brokers, etc.)
        const { rows: badCompanies } = await pool.query(`
            SELECT DISTINCT l.company_name, COUNT(*) as lead_count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            AND (
                l.company_name ILIKE '%stealth%'
                OR l.company_name ILIKE '%startup%'
                OR l.company_name ILIKE '%consulting%'
                OR l.company_name ILIKE '%advisor%'
            )
            GROUP BY l.company_name
            LIMIT 10
        `);
        console.log(`\n🗑️ Suspicious companies (stealth/startup/consulting):`);
        badCompanies.forEach(r => console.log(`  - ${r.company_name}: ${r.lead_count} leads`));

        // 7. Sample "Boardwalk" leads to see their state
        const { rows: boardwalk } = await pool.query(`
            SELECT l.person_name, l.job_title, l.connection_request, l.email_message, c.company_profile
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE link.parent_type = 'user'
            AND l.company_name ILIKE '%boardwalk%'
            LIMIT 3
        `);
        console.log(`\n🏘️ Sample Boardwalk leads:`);
        boardwalk.forEach(r => {
            console.log(`  - ${r.person_name}`);
            console.log(`    Title: ${r.job_title || 'MISSING'}`);
            console.log(`    Conn Req: ${r.connection_request ? 'HAS' : 'MISSING'}`);
            console.log(`    Email Msg: ${r.email_message ? 'HAS' : 'MISSING'}`);
            console.log(`    Profile: ${r.company_profile ? 'HAS' : 'MISSING'}`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

analyzeLeadQuality();
