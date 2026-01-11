import { query } from './db/index.js';
import dotenv from 'dotenv';
dotenv.config();

const fetchData = async () => {
    try {
        // 1. Fetch Prompt
        const promptRes = await query("SELECT system_prompt FROM agent_prompts WHERE agent_id = 'outreach_creator' LIMIT 1;");
        const systemPrompt = promptRes.rows[0]?.system_prompt || "DEFAULT PROMPT NOT FOUND IN DB";

        // 2. Fetch Examples
        const examplesRes = await query(`
            SELECT 
                company_name, 
                person_name, 
                job_title, 
                custom_data->>'connection_request' as linkedin_msg, 
                custom_data->>'email_message' as email_msg,
                custom_data->>'company_profile' as company_profile
            FROM leads 
            WHERE status != 'DISQUALIFIED' 
            AND custom_data->>'connection_request' IS NOT NULL 
            ORDER BY created_at DESC 
            LIMIT 5;
        `);

        console.log("--- SYSTEM PROMPT ---");
        console.log(systemPrompt);
        console.log("--- END SYSTEM PROMPT ---");

        console.log("--- EXAMPLES ---");
        console.log(JSON.stringify(examplesRes.rows, null, 2));
        console.log("--- END EXAMPLES ---");

        process.exit(0);
    } catch (err) {
        console.error("Error fetching data:", err);
        process.exit(1);
    }
};

fetchData();
