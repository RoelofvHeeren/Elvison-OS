import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

if (!process.env.DATABASE_URL && !process.env.DATABASE_PUBLIC_URL) {
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:51214/postgres";
}

async function main() {
    console.log('📊 Auditing Company Data (v2)...\n');

    try {
        const { query } = await import('./db/index.js');

        const { rows } = await query(`
            SELECT 
                company_name, 
                (custom_data->>'company_website') as website,
                (custom_data->>'fit_score') as fit_score,
                (custom_data->>'score') as score,
                (custom_data->>'match_score') as match_score,
                length(custom_data->>'company_profile') as profile_len,
                (custom_data->>'company_profile') as profile_preview
            FROM leads
            WHERE status != 'DISQUALIFIED'
            ORDER BY company_name
        `);

        console.log(`Found ${rows.length} active lead/company records.`);
        console.log('--------------------------------------------------');

        rows.forEach(r => {
            const finalScore = r.fit_score || r.score || r.match_score || 'MISSING';
            const profileText = r.profile_preview || '';
            const hasHeaders = profileText.includes('# ');
            const profileSample = profileText ? profileText.substring(0, 100).replace(/\n/g, ' ') + '...' : 'NONE';

            console.log(`Company: ${r.company_name}`);
            console.log(`  Score: ${finalScore}`);
            console.log(`  Profile Length: ${r.profile_len || 0}`);
            console.log(`  Has Markdown Headers: ${hasHeaders}`);
            console.log(`  Profile Sample: ${profileSample}`);
            console.log('--------------------------------------------------');
        });

    } catch (e) {
        console.error('❌ Error:', e);
    } finally {
        process.exit();
    }
}

main();
