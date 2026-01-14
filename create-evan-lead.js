import { query } from './db/index.js';

const createEvanLead = async () => {
    try {
        const userId = '40ac42ec-48bc-4069-864b-c47a02ed9b40'; // roelof@elvison.com

        console.log('Creating Evan Klijn lead...');

        const leadData = {
            person_name: 'Evan Klijn',
            company_name: 'Klijn Enterprises', // Made up
            email: 'evan@klijn.com', // Made up
            job_title: 'Director', // Made up
            linkedin_url: 'https://www.linkedin.com/in/evan-klijn-463a121a9/',
            status: 'NEW',
            custom_data: {
                company_website: 'https://klijn.com',
                company_profile: 'Klijn Enterprises focuses on sustainable tech.',
                connection_request: 'Hi Evan, wanted to connect.',
                email_message: 'Hi Evan, reaching out regarding your work.'
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

        console.log(`✅ Evan Klijn lead created with ID: ${leadRes.rows[0].id}`);
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
};

createEvanLead();
