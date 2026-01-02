
import 'dotenv/config'; // Load env vars
import { query } from './db/index.js';

const checkConfig = async () => {
    try {
        console.log("Checking ICP config for roelof@elvison.com...");
        const userRes = await query("SELECT id FROM users WHERE email = $1", ['roelof@elvison.com']);
        if (userRes.rows.length === 0) {
            console.log("User not found.");
            return;
        }
        const userId = userRes.rows[0].id;

        const icpRes = await query("SELECT * FROM icps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [userId]);
        if (icpRes.rows.length === 0) {
            console.log("No ICP found for user.");
            return;
        }

        const icp = icpRes.rows[0];
        console.log(`Found ICP: ${icp.name}`);

        const config = icp.config || {};
        const agentConfig = icp.agent_config || {};

        console.log("\n--- USER ONBOARDING ANSWERS (icp.config) ---");
        console.log(JSON.stringify(config, null, 2));

        console.log("\n--- AGENT OPTIMIZED CONFIG (icp.agent_config) ---");
        console.log(JSON.stringify(agentConfig, null, 2));

        // specific checks
        const titles = agentConfig.apollo_lead_finder?.job_titles || config.job_titles;
        const excluded = agentConfig.apollo_lead_finder?.excluded_functions || config.excluded_functions;

        console.log("\n--- EFFECTIVE RULES ---");
        console.log("Job Titles:", titles);
        console.log("Excluded Functions:", excluded);

    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
};

checkConfig();
