import { query } from './db/index.js';

const restoreLead = async () => {
    try {
        const userId = '40ac42ec-48bc-4069-864b-c47a02ed9b40'; // roelof@elvison.com

        console.log('Restoring Roelof van Heeren lead...');

        const leadData = {
            person_name: 'Roelof van Heeren',
            company_name: 'Elvison Foundations',
            email: 'Roelof@elvison.com',
            job_title: 'Founder',
            linkedin_url: 'https://www.linkedin.com/in/roelof-van-heeren-013a73230/',
            status: 'NEW',
            custom_data: {
                company_website: 'https://rulofvonheeren.com',
                company_profile: 'Elvison Foundations is a leader in AI-driven societal impact and strategic philanthropy.',
                connection_request: 'Hi Roelof, I noticed your work at Elvison Foundations and would love to connect and discuss your vision for AI-driven foundations.',
                email_message: 'Hi Roelof, following up on our LinkedIn connection regarding foundations and AI strategy. I would love to hear more about your upcoming plans.'
            },
            source: 'Manual Restore'
        };

        const leadRes = await query(`
            INSERT INTO leads (person_name, company_name, email, job_title, linkedin_url, status, custom_data, source, user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `, [
            leadData.person_name, leadData.company_name, leadData.email, leadData.job_title,
            leadData.linkedin_url, leadData.status, leadData.custom_data, leadData.source, userId
        ]);

        console.log(`✅ Lead restored with ID: ${leadRes.rows[0].id}`);

        console.log('Restoring Elvison Foundations company...');
        await query(`
            INSERT INTO companies (company_name, website, company_profile, user_id, last_updated)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (company_name, user_id) DO UPDATE SET 
                company_profile = EXCLUDED.company_profile,
                last_updated = NOW()
        `, [
            leadData.company_name, 'https://rulofvonheeren.com', leadData.custom_data.company_profile, userId
        ]);

        console.log('✅ Company restored.');

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
};

restoreLead();
