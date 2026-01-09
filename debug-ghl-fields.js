
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ghlService } from './src/backend/services/gohighlevel.js';

// Load env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

async function test() {
    console.log('🔍 Testing GHL Custom Fields Resolution...');

    // Ensure we have key
    if (!process.env.GHL_API_KEY) {
        console.error('❌ GHL_API_KEY missing in .env');
        process.exit(1);
    }
    console.log('Using API Key:', process.env.GHL_API_KEY.substring(0, 10) + '...');

    try {
        console.log('\n--- 1. Fetching & Mapping Fields ---');
        const fields = await ghlService.ensureElvisonFields();
        console.log('Resolved IDs:', fields);

        const required = ['emailFieldId', 'linkedinFieldId', 'companyProfileId'];
        const missing = required.filter(k => !fields[k]);

        if (missing.length > 0) {
            console.error('❌ Failed to resolve fields:', missing);
            console.log('Ensure these fields exist in GHL with names: "Email Copy", "Linkedin Message", "Company Profile"');
        } else {
            console.log('✅ All custom fields resolved successfully!');
        }

    } catch (err) {
        console.error('❌ Test failed with error:', err.message);
        if (err.response) {
            console.error('Response data:', err.response.data);
        }
    }
}

test();
