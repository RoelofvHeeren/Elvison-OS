import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

// Companies that are TOO BIG (mega-funds with $100M+ minimum deals)
const TOO_BIG = [
    'BlackRock',
    'Brookfield Asset Management',
    'Apollo Global Management, Inc',
    'Bain Capital',
    'KKR',
    'The Carlyle Group',
    'TPG',
    'Oaktree Capital Management, L.P',
    'Blue Owl Capital',
    'Fortress Investment Group',
    'Blackstone',
    'Ares Management Corporation',
    'Lone Star Funds',
    'Starwood Capital',
    'J.P. Morgan',
    'Goldman Sachs',
    'Invesco Ltd',
    'DWS Asset Management',
    'Partners Group',
    'Neuberger Berman',
    'Nuveen Real Estate',
    'PIMCO Prime Real Estate',
    'Aviva Investors',
    'Schroders',
    'Pictet'
];

// Pension funds / Sovereign wealth (institutional only, not accessible)
const INSTITUTIONAL_ONLY = [
    'CPP Investments | Investissements RPC',
    'Ontario Teachers Pension Plan',
    'HOOPP (Healthcare of Ontario Pension Plan)',
    'Alberta Investment Management Corporation (AIMCo)',
    'PSP Investments',
    'BCI',
    'GIC',
    'Mubadala'
];

// Asset managers that are too broad/diversified
const TOO_DIVERSIFIED = [
    'RBC Global Asset Management',
    'SLC Management',
    'IG Wealth Management',
    'CBRE Investment Management',
    'CBRE'
];

// WORTH RE-PROFILING (likely have residential divisions, deal in $10-100M range)
const WORTH_REPROFILING = [
    'Harrison Street',              // Known for student housing & senior living
    'Sagard Real Estate',           // Mid-market real estate PE
    'Canderel',                     // Canadian developer/investor
    'Triovest',                     // Canadian property manager with investments
    'Nicola Institutional Realty Advisors (NIRA)', // Residential-focused
    'Starlight Capital',            // Canadian REIT operator
    'Osmington Inc',                // Canadian real estate investor
    'Thor Equities Group',          // Real estate investor/developer
    'Wealhouse Capital Management', // Smaller capital manager
    'Adams Street Partners',        // PE firm with real estate exposure
    'Gordon Brothers'               // Distressed real estate
];

async function triageCompanies() {
    console.log('🔍 Triaging 40 non-residential companies...\n');

    try {
        const { rows: companies } = await pool.query(`
            SELECT c.company_name, COUNT(l.id) as lead_count
            FROM companies c
            LEFT JOIN leads l ON c.company_name = l.company_name
            WHERE c.company_name IN (
                'Apollo Global Management, Inc', 'Aviva Investors', 'Bain Capital', 'BlackRock',
                'Blue Owl Capital', 'Brookfield Asset Management', 'Claridge Inc',
                'CPP Investments | Investissements RPC', 'DWS Asset Management', 'GIC',
                'Harrison Street', 'IG Wealth Management', 'Invesco Ltd', 'J.P. Morgan',
                'KKR', 'KKR Real Estate Select Trust', 'Neuberger Berman', 'Nuveen Real Estate',
                'Oaktree Capital Management, L.P', 'Ontario Teachers Pension Plan', 'Partners Group',
                'Pictet', 'Prologis', 'Schroders', 'SLC Management', 'The Carlyle Group', 'TPG',
                'Canderel', 'Nicola Institutional Realty Advisors (NIRA)', 'Sagard Real Estate',
                'Adams Street Partners', 'Alberta Investment Management Corporation (AIMCo)',
                'Fortress Investment Group', 'Gordon Brothers',
                'HOOPP (Healthcare of Ontario Pension Plan)', 'Osmington Inc', 'Starlight Capital',
                'Thor Equities Group', 'Triovest', 'Wealhouse Capital Management'
            )
            GROUP BY c.company_name
            ORDER BY c.company_name
        `);

        const categorized = {
            too_big: [],
            institutional: [],
            too_diversified: [],
            worth_reprofiling: [],
            uncategorized: []
        };

        let totalLeadsToDelete = 0;
        let totalLeadsToKeep = 0;

        for (const company of companies) {
            const name = company.company_name;
            const count = parseInt(company.lead_count);

            if (TOO_BIG.includes(name)) {
                categorized.too_big.push({ name, count });
                totalLeadsToDelete += count;
            } else if (INSTITUTIONAL_ONLY.includes(name)) {
                categorized.institutional.push({ name, count });
                totalLeadsToDelete += count;
            } else if (TOO_DIVERSIFIED.includes(name)) {
                categorized.too_diversified.push({ name, count });
                totalLeadsToDelete += count;
            } else if (WORTH_REPROFILING.includes(name)) {
                categorized.worth_reprofiling.push({ name, count });
                totalLeadsToKeep += count;
            } else {
                categorized.uncategorized.push({ name, count });
            }
        }

        console.log('═══════════════════════════════════════════════════════════');
        console.log('📋 TRIAGE RESULTS');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log(`❌ TOO BIG (${categorized.too_big.length} companies, ${categorized.too_big.reduce((sum, c) => sum + c.count, 0)} leads):`);
        console.log('   Mega-funds with $100M+ minimum deals - not accessible for boutique developers\n');
        categorized.too_big.forEach(c => console.log(`   - ${c.name} (${c.count} leads)`));

        console.log(`\n❌ INSTITUTIONAL ONLY (${categorized.institutional.length} companies, ${categorized.institutional.reduce((sum, c) => sum + c.count, 0)} leads):`);
        console.log('   Pension funds / sovereign wealth - only invest through fund managers\n');
        categorized.institutional.forEach(c => console.log(`   - ${c.name} (${c.count} leads)`));

        console.log(`\n❌ TOO DIVERSIFIED (${categorized.too_diversified.length} companies, ${categorized.too_diversified.reduce((sum, c) => sum + c.count, 0)} leads):`);
        console.log('   Broad asset managers without clear residential focus\n');
        categorized.too_diversified.forEach(c => console.log(`   - ${c.name} (${c.count} leads)`));

        console.log(`\n✅ WORTH RE-PROFILING (${categorized.worth_reprofiling.length} companies, ${categorized.worth_reprofiling.reduce((sum, c) => sum + c.count, 0)} leads):`);
        console.log('   Mid-market firms likely to have residential divisions in $10-100M range\n');
        categorized.worth_reprofiling.forEach(c => console.log(`   - ${c.name} (${c.count} leads)`));

        if (categorized.uncategorized.length > 0) {
            console.log(`\n⚠️  UNCATEGORIZED (${categorized.uncategorized.length} companies):`);
            categorized.uncategorized.forEach(c => console.log(`   - ${c.name} (${c.count} leads)`));
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('📊 SUMMARY');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log(`Total companies analyzed: ${companies.length}`);
        console.log(`❌ To DELETE: ${categorized.too_big.length + categorized.institutional.length + categorized.too_diversified.length} companies (${totalLeadsToDelete} leads)`);
        console.log(`✅ To RE-PROFILE: ${categorized.worth_reprofiling.length} companies (${totalLeadsToKeep} leads)\n`);

        // Export for script execution
        const fs = await import('fs');
        const result = {
            to_delete: [
                ...categorized.too_big.map(c => c.name),
                ...categorized.institutional.map(c => c.name),
                ...categorized.too_diversified.map(c => c.name)
            ],
            to_reprofile: categorized.worth_reprofiling.map(c => c.name),
            stats: {
                delete_count: categorized.too_big.length + categorized.institutional.length + categorized.too_diversified.length,
                delete_leads: totalLeadsToDelete,
                reprofile_count: categorized.worth_reprofiling.length,
                reprofile_leads: totalLeadsToKeep
            }
        };

        fs.default.writeFileSync('triage_results.json', JSON.stringify(result, null, 2));
        console.log('✅ Results saved to: triage_results.json\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

triageCompanies();
