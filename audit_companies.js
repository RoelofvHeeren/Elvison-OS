import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

// Residential keywords (Tier 2 - MANDATORY)
const RESIDENTIAL_KEYWORDS = [
    'residential', 'multifamily', 'multi-family', 'multi family', 'multi-suite',
    'apartment', 'apartments', 'purpose built rental', 'purpose-built rental',
    'rental housing', 'housing', 'condo', 'condominium', 'condo development',
    'student housing', 'senior living', 'sfr', 'single family rental',
    'apartment community', 'residential community', 'residential development'
];

// Investor keywords (Tier 1)
const INVESTOR_KEYWORDS = [
    'invests', 'investment', 'acquires', 'acquisition', 'fund', 'strategy',
    'co invest', 'co-invest', 'joint venture', 'portfolio', 'asset management',
    'private equity', 'real estate equity', 'lp', 'gp', 'partner capital',
    'investing', 'capital deployment', 'deploy capital'
];

async function auditCompanies() {
    console.log('🔍 Auditing all 92 companies...\n');

    try {
        // Get all companies with their profiles and lead counts
        const { rows: companies } = await pool.query(`
            SELECT 
                c.company_name,
                c.website,
                c.company_profile,
                c.icp_type,
                c.fit_score,
                COUNT(l.id) as lead_count
            FROM companies c
            LEFT JOIN leads l ON c.company_name = l.company_name
            WHERE EXISTS (
                SELECT 1 FROM leads WHERE company_name = c.company_name
            )
            GROUP BY c.company_name, c.website, c.company_profile, c.icp_type, c.fit_score
            ORDER BY COUNT(l.id) DESC, c.company_name
        `);

        console.log(`📊 Found ${companies.length} companies\n`);

        const issues = {
            no_profile: [],
            no_residential_keywords: [],
            no_investor_keywords: [],
            low_fit_score: [],
            missing_website: [],
            good: []
        };

        for (const company of companies) {
            const profile = (company.company_profile || '').toLowerCase();
            const hasProfile = company.company_profile && company.company_profile.length > 100;
            const hasResidential = RESIDENTIAL_KEYWORDS.some(kw => profile.includes(kw.toLowerCase()));
            const hasInvestor = INVESTOR_KEYWORDS.some(kw => profile.includes(kw.toLowerCase()));
            const hasWebsite = company.website && company.website.length > 0;
            const fitScore = company.fit_score || 0;

            const companyData = {
                name: company.company_name,
                lead_count: parseInt(company.lead_count),
                fit_score: fitScore,
                icp_type: company.icp_type,
                website: company.website
            };

            // Categorize issues
            if (!hasProfile) {
                issues.no_profile.push(companyData);
            } else if (!hasResidential) {
                issues.no_residential_keywords.push(companyData);
            } else if (!hasInvestor) {
                issues.no_investor_keywords.push(companyData);
            } else if (fitScore < 70) {
                issues.low_fit_score.push(companyData);
            } else if (!hasWebsite) {
                issues.missing_website.push(companyData);
            } else {
                issues.good.push(companyData);
            }
        }

        // Report
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📋 AUDIT RESULTS');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log(`✅ GOOD COMPANIES (${issues.good.length}):`);
        console.log('   - Have complete profiles with residential + investor keywords');
        console.log('   - Fit score >= 70');
        console.log('   - Have website\n');

        if (issues.no_profile.length > 0) {
            console.log(`❌ NO PROFILE (${issues.no_profile.length}):`);
            issues.no_profile.forEach(c => {
                console.log(`   - ${c.name} (${c.lead_count} leads)`);
            });
            console.log('');
        }

        if (issues.no_residential_keywords.length > 0) {
            console.log(`⚠️  NO RESIDENTIAL KEYWORDS (${issues.no_residential_keywords.length}):`);
            issues.no_residential_keywords.forEach(c => {
                console.log(`   - ${c.name} (${c.lead_count} leads, fit: ${c.fit_score})`);
            });
            console.log('');
        }

        if (issues.no_investor_keywords.length > 0) {
            console.log(`⚠️  NO INVESTOR KEYWORDS (${issues.no_investor_keywords.length}):`);
            issues.no_investor_keywords.forEach(c => {
                console.log(`   - ${c.name} (${c.lead_count} leads, fit: ${c.fit_score})`);
            });
            console.log('');
        }

        if (issues.low_fit_score.length > 0) {
            console.log(`⚠️  LOW FIT SCORE (<70) (${issues.low_fit_score.length}):`);
            issues.low_fit_score.forEach(c => {
                console.log(`   - ${c.name} (${c.lead_count} leads, fit: ${c.fit_score})`);
            });
            console.log('');
        }

        if (issues.missing_website.length > 0) {
            console.log(`⚠️  MISSING WEBSITE (${issues.missing_website.length}):`);
            issues.missing_website.forEach(c => {
                console.log(`   - ${c.name} (${c.lead_count} leads)`);
            });
            console.log('');
        }

        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 SUMMARY');
        console.log('═══════════════════════════════════════════════════════════\n');

        const totalIssues = issues.no_profile.length + issues.no_residential_keywords.length +
            issues.no_investor_keywords.length + issues.low_fit_score.length +
            issues.missing_website.length;

        console.log(`Total Companies: ${companies.length}`);
        console.log(`✅ Good: ${issues.good.length} (${(issues.good.length / companies.length * 100).toFixed(1)}%)`);
        console.log(`⚠️  Issues: ${totalIssues} (${(totalIssues / companies.length * 100).toFixed(1)}%)\n`);

        if (totalIssues > 0) {
            console.log('💡 RECOMMENDATION:');
            console.log('   Consider removing companies with critical issues before backfilling.');
            console.log('   This will ensure you only add leads for high-quality companies.\n');
        }

        // Export detailed list for review
        console.log('📄 Exporting detailed company list...');
        const fs = await import('fs');
        const report = {
            audit_date: new Date().toISOString(),
            total_companies: companies.length,
            summary: {
                good: issues.good.length,
                no_profile: issues.no_profile.length,
                no_residential: issues.no_residential_keywords.length,
                no_investor: issues.no_investor_keywords.length,
                low_fit: issues.low_fit_score.length,
                missing_website: issues.missing_website.length
            },
            companies: {
                good: issues.good,
                issues: {
                    no_profile: issues.no_profile,
                    no_residential_keywords: issues.no_residential_keywords,
                    no_investor_keywords: issues.no_investor_keywords,
                    low_fit_score: issues.low_fit_score,
                    missing_website: issues.missing_website
                }
            }
        };

        fs.default.writeFileSync('company_audit_report.json', JSON.stringify(report, null, 2));
        console.log('✅ Report saved to: company_audit_report.json\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

auditCompanies();
