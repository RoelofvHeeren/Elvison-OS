import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL });

async function fixLead() {
    try {
        const userId = '40ac42ec-48bc-4069-864b-c47a02ed9b40'; // roelof@elvison.com
        const leadName = 'Roelof van Heeren';
        const companyName = 'Elvison Foundations';

        console.log('🔄 Updating lead user_id...');
        const updateResult = await pool.query(
            'UPDATE leads SET user_id = $1 WHERE person_name = $2 RETURNING id',
            [userId, leadName]
        );
        console.log(`✅ Lead updated: ${updateResult.rows[0]?.id || 'No lead found'}`);

        console.log('🏢 Creating fake company profile...');
        const companyResult = await pool.query(
            `INSERT INTO companies (user_id, company_name, company_profile, fit_score, status, cleanup_status, icp_type, website)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
                userId,
                companyName,
                'Elvison Foundations is a leader in AI-driven societal impact and strategic philanthropy, focusing on leveraging artificial intelligence to create meaningful social change.',
                9,
                'new',
                'KEPT',
                'FAMILY_OFFICE_SINGLE',
                'https://rulofvonheeren.com'
            ]
        );
        console.log(`✅ Company created: ${companyResult.rows[0].id}`);

    } catch (e) {
        console.error('❌ Error:', e.message);
    } finally {
        await pool.end();
    }
}

fixLead();
