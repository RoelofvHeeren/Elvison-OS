
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ghlService } from './src/backend/services/gohighlevel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runVerification() {
    console.log('🚀 Starting Verification: DB Column & GHL Push');

    // 1. Verify DB Column
    console.log('\n--- 1. Verifying Database Schema ---');
    try {
        // Try to select the column to see if it exists
        await pool.query("SELECT outreach_status FROM leads LIMIT 1");
        console.log('✅ Success: "outreach_status" column exists in "leads" table.');
    } catch (err) {
        console.error('❌ Database Check Failed:', err.message);
        if (err.message.includes('does not exist')) {
            console.log('⚠️ Column missing. Attempting manual fix via script...');
            try {
                await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_status VARCHAR(50) DEFAULT 'pending';");
                console.log('✅ Manual migration successful.');
            } catch (migErr) {
                console.error('❌ Manual migration failed:', migErr.message);
            }
        }
    }

    // 2. Verify GHL Push
    console.log('\n--- 2. Verifying GHL Contact Creation ---');
    try {
        const testLead = {
            email: `test.verify.${Date.now()}@test.com`,
            phone: '',
            person_name: 'Automated Verifier',
            company_name: 'Verification Inc',
            custom_data: {
                email_message: 'Verification Email Content',
                connection_request: 'Verification LinkedIn Connection',
                company_profile: 'Verification Company Profile'
            }
        };

        console.log('Attempting to create contact in GHL...');
        // We pass null for fieldIds so it resolves them dynamically, verifying that logic too
        const contact = await ghlService.createContact(testLead, null, 'elvison os');

        console.log('✅ Success: Contact created in GHL!');
        console.log(`Created Contact ID: ${contact.id}`);
        console.log(`Contact Name: ${contact.name || contact.contactName}`);

    } catch (err) {
        console.error('❌ GHL Push Failed:', err.message);
        if (err.response) {
            console.error('API Error Data:', JSON.stringify(err.response.data, null, 2));
        }
    } finally {
        await pool.end();
    }
}

runVerification();
