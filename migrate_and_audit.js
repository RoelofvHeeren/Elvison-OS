
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

const REQUIRED_SECTIONS = [
    'Summary',
    'Investment Strategy',
    'Scale & Geographic Focus',
    'Portfolio Observations',
    'Key Highlights',
    'Fit Analysis'
];

const PATTERNS = {
    'Summary': /(?:#|\*\*)\s*(?:Executive )?Summary/i,
    'Investment Strategy': /(?:#|\*\*)\s*Investment Strategy/i,
    'Scale & Geographic Focus': /(?:#|\*\*)\s*(?:Scale|Geo|Location)/i,
    'Portfolio Observations': /(?:#|\*\*)\s*(?:Portfolio|Deal History|Investments)/i,
    'Key Highlights': /(?:#|\*\*)\s*(?:Key )?Highlights/i,
    'Fit Analysis': /(?:#|\*\*)\s*(?:Fit Analysis|Strategic Fit|Fit)/i
};

async function migrateAndAudit() {
    try {
        console.log('🔄 STARTING DATA MIGRATION...');

        // 1. UPDATE company_profile with market_intelligence wherever valid
        const updateRes = await pool.query(`
            UPDATE companies 
            SET 
                company_profile = market_intelligence,
                last_updated = NOW()
            WHERE 
                market_intelligence IS NOT NULL 
                AND LENGTH(market_intelligence) > 100
        `);

        console.log(`✅ MIGRATION COMPLETE: Updated ${updateRes.rowCount} companies with new profile data.`);
        console.log('----------------------------------------------------');
        console.log('🔍 STARTING FINAL AUDIT...');

        const { rows } = await pool.query('SELECT * FROM companies ORDER BY company_name ASC');
        console.log(`Checking ${rows.length} total companies...\n`);

        let perfectCount = 0;
        let missingCount = 0;

        for (const company of rows) {
            // Check ONLY company_profile now, as it should be the source of truth
            const profile = company.company_profile || '';
            const missing = [];

            if (!profile) {
                console.log(`❌ [${company.company_name}] (${company.website}) - EMPTY PROFILE`);
                missingCount++;
                continue;
            }

            for (const section of REQUIRED_SECTIONS) {
                if (!PATTERNS[section].test(profile)) {
                    missing.push(section);
                }
            }

            if (missing.length > 0) {
                console.log(`⚠️ [${company.company_name}] Missing: ${missing.join(', ')}`);
                missingCount++;
            } else {
                perfectCount++;
            }
        }

        const health = ((perfectCount / rows.length) * 100).toFixed(1);
        console.log(`\n----------------------------------------------------`);
        console.log(`🎉 AUDIT COMPLETE`);
        console.log(`✅ Perfect Profiles: ${perfectCount}`);
        console.log(`❌ Incomplete Profiles: ${missingCount}`);
        console.log(`📊 Database Health: ${health}%`);

    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await pool.end();
    }
}

migrateAndAudit();
