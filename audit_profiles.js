import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

console.log('DATABASE_URL present:', !!process.env.DATABASE_URL);
console.log('DATABASE_PUBLIC_URL present:', !!process.env.DATABASE_PUBLIC_URL);

// Force use of remote connection string and SSL
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

// Regex to find headers roughly matching the required sections
const PATTERNS = {
    'Summary': /(?:#|\*\*)\s*(?:Executive )?Summary/i,
    'Investment Strategy': /(?:#|\*\*)\s*Investment Strategy/i,
    'Scale & Geographic Focus': /(?:#|\*\*)\s*(?:Scale|Geo|Location)/i,
    'Portfolio Observations': /(?:#|\*\*)\s*(?:Portfolio|Deal History|Investments)/i,
    'Key Highlights': /(?:#|\*\*)\s*(?:Key )?Highlights/i,
    'Fit Analysis': /(?:#|\*\*)\s*(?:Fit Analysis|Strategic Fit|Fit)/i
};

async function auditProfiles() {
    try {
        // Select ALL columns to see where the data is hiding
        const { rows } = await pool.query('SELECT * FROM companies ORDER BY website ASC');

        console.log(`Auditing ${rows.length} companies...\n`);
        console.log(`| Company (Website) | Missing Sections |`);
        console.log(`|---|---|`);

        let missingCount = 0;
        let diffCount = 0;

        for (const company of rows) {
            if (diffCount < 3) {
                console.log(`\n--- DEBUG: ${company.website} ---`);
                console.log('Row Keys:', Object.keys(company));
                console.log('MI Length:', company.market_intelligence ? company.market_intelligence.length : 0);
                console.log('CP Length:', company.company_profile ? company.company_profile.length : 0);
                diffCount++;
            }

            // Primary source: market_intelligence, Fallback: company_profile
            // The user wants to audit whichever one has data.
            const profile = company.market_intelligence || company.company_profile || '';
            const source = company.market_intelligence ? 'Market Intel' : (company.company_profile ? 'Company Profile' : 'NONE');
            const missing = [];

            if (!profile) {
                console.log(`| ${company.website} | NO DATA (Empty) |`);
                missingCount++;
                continue;
            }

            for (const section of REQUIRED_SECTIONS) {
                // Relaxed check for legacy profiles which might be less structured
                if (!PATTERNS[section].test(profile)) {
                    missing.push(section);
                }
            }

            if (missing.length > 0) {
                console.log(`| ${company.website} (${source}) | ${missing.join(', ')} |`);
                missingCount++;
            }
        }

        console.log(`\nFound ${missingCount} companies with missing sections out of ${rows.length}.`);

    } catch (e) {
        console.error('Audit failed:', e);
    } finally {
        await pool.end();
    }
}

auditProfiles();
