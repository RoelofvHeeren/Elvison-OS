import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

/**
 * Audit specific companies mentioned by the user to see why they fail UI parsing 
 * and identify enrichment needs.
 */

async function main() {
    try {
        const { query } = await import('./db/index.js');

        const targetCompanies = [
            'Sagard', 'TMX Group', 'CAPREIT', 'Artis REIT', 'Clarion Partners',
            'Our Family Office', 'Lankin', 'Wealhouse', 'Spotlight', 'Greybrook',
            'Alberta', 'HOOPP', 'PSP Investments', 'Cameron Stephens', 'Equiton',
            'Tricor', 'Terracap', 'Pivot Real Estate Group'
        ];

        console.log('🔍 Auditing Specific Companies...\n');

        for (const name of targetCompanies) {
            const { rows } = await query(`
                SELECT company_name, count(*) as lead_count, 
                       (custom_data->>'company_profile') as profile,
                       (custom_data->>'fit_score') as score
                FROM leads 
                WHERE company_name ILIKE $1 AND status != 'DISQUALIFIED'
                GROUP BY company_name, custom_data->>'company_profile', custom_data->>'fit_score'
            `, [`%${name}%`]);

            if (rows.length === 0) {
                console.log(`❌ ${name}: NOT FOUND`);
                continue;
            }

            const r = rows[0];
            const profileText = r.profile || '';
            const hasMarkdownHeaders = profileText.includes('# ');
            const hasColonHeaders = !!profileText.match(/^[A-Z][\w\s&]{2,30}:\s*$/m);
            const hasSectionMarkers = !!profileText.match(/^\d+\.\s+[A-Z]/m);

            console.log(`🏢 ${r.company_name} (${r.lead_count} leads, Score: ${r.score || 'N/A'})`);
            console.log(`   Profile length: ${profileText.length}`);
            console.log(`   UI Detection: Markdown(#)=${hasMarkdownHeaders}, ColonHeaders(:)=${hasColonHeaders}, SectionMarkers(1.)=${hasSectionMarkers}`);
            if (profileText) {
                console.log(`   Sample: ${profileText.substring(0, 150).replace(/\n/g, ' ')}...`);
            }
            console.log('--------------------------------------------------');
        }

    } catch (e) {
        console.error('❌ Error during audit:', e);
    } finally {
        process.exit();
    }
}

main();
