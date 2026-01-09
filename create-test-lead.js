import { query } from './db/index.js';

const USER_ID = 'a51bc49d-b875-43d6-b024-60664ee9dc30'; // Your user ID

const testLead = {
    person_name: 'Roelof van Heeren',
    company_name: 'Elvison Foundations',
    job_title: 'CEO',
    email: 'roelof@elvison.com',
    linkedin_url: 'https://www.linkedin.com/in/roelof-van-heeren-013a73230/',
    status: 'NEW',
    source: 'Test Lead',
    user_id: USER_ID,
    custom_data: {
        company_website: 'https://www.elvison.com/',
        company_profile: 'Elvison Foundations is an innovative company focused on building AI-powered solutions for business automation and lead generation. Based in Singapore, they specialize in creating intelligent systems that streamline sales and marketing workflows.',
        connection_request: 'Hi Roelof, I came across Elvison Foundations and was impressed by your work in AI automation. Would love to connect and exchange ideas on how technology is reshaping business development.',
        email_message: 'Hi Roelof,\n\nI noticed Elvison Foundations is making waves in the AI automation space. Your approach to streamlining lead generation caught my attention.\n\nWe have been helping similar companies scale their outreach without adding headcount. Would you be open to a quick 15-minute chat to see if there is a fit?\n\nLooking forward to connecting.\n\nBest regards'
    }
};

async function createTestLead() {
    console.log('🔄 Connecting to database...');

    try {
        const result = await query(
            `INSERT INTO leads (person_name, company_name, job_title, email, linkedin_url, status, source, custom_data, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, person_name, email`,
            [
                testLead.person_name,
                testLead.company_name,
                testLead.job_title,
                testLead.email,
                testLead.linkedin_url,
                testLead.status,
                testLead.source,
                JSON.stringify(testLead.custom_data),
                testLead.user_id
            ]
        );
        console.log('✅ Test lead created successfully!');
        console.log('   ID:', result.rows[0].id);
        console.log('   Name:', result.rows[0].person_name);
        console.log('   Email:', result.rows[0].email);
        console.log('\n📋 Custom Data Preview:');
        console.log('   Connection Request:', testLead.custom_data.connection_request.substring(0, 80) + '...');
        console.log('   Email Message:', testLead.custom_data.email_message.substring(0, 80) + '...');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error creating lead:');
        console.error('   Name:', err.name);
        console.error('   Message:', err.message);
        console.error('   Code:', err.code);
        if (err.detail) console.error('   Detail:', err.detail);
        process.exit(1);
    }
}

createTestLead();
