import { query } from './db/index.js';

const createEitanLead = async () => {
    try {
        const userId = '40ac42ec-48bc-4069-864b-c47a02ed9b40'; // roelof@elvison.com

        console.log('Creating Eitan Franco lead...');

        const leadData = {
            person_name: 'Eitan Franco',
            company_name: 'Franco Ventures',
            email: 'eitan@franco.com',
            job_title: 'Managing Partner',
            linkedin_url: 'https://www.linkedin.com/in/eitan-franco/',
            status: 'NEW',
            custom_data: {
                company_website: 'https://francoventures.com',
                company_profile: 'Franco Ventures invests in deep tech and AI infrastructure.',
                connection_request: 'Hi Eitan, I saw your work in deep tech and would love to connect.',
                email_message: 'Hi Eitan, reaching out to discuss potential synergies with Elvison OS.'
            },
            source: 'Manual Test'
        };

        const leadRes = await query(`
            INSERT INTO leads (person_name, company_name, email, job_title, linkedin_url, status, custom_data, source, user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `, [
            leadData.person_name, leadData.company_name, leadData.email, leadData.job_title,
            leadData.linkedin_url, leadData.status, leadData.custom_data, leadData.source, userId
        ]);

        console.log(`✅ Eitan Franco lead created with ID: ${leadRes.rows[0].id}`);
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
};

createEitanLead();
