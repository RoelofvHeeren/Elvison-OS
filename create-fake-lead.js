import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL });

async function createFakeLead() {
    console.log('🚀 Creating fake lead for testing...');

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
        source: 'Manual Test'
    };

    try {
        const query = `
            INSERT INTO leads (person_name, company_name, email, job_title, linkedin_url, status, custom_data, source, user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id;
        `;

        const values = [
            leadData.person_name,
            leadData.company_name,
            leadData.email,
            leadData.job_title,
            leadData.linkedin_url,
            leadData.status,
            leadData.custom_data,
            leadData.source,
            'a51bc49d-b875-43d6-b024-60664ee9dc30'
        ];

        const res = await pool.query(query, values);
        console.log(`✅ Success! Fake lead created with ID: ${res.rows[0].id}`);

    } catch (err) {
        console.error('❌ Error creating fake lead:', err);
    } finally {
        await pool.end();
    }
}

createFakeLead();
