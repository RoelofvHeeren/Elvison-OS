import { query } from './db/index.js';
import fs from 'fs';

async function clearExclusionLists() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    console.log("🚀 Starting Tracking Data Reset...");

    try {
        // 1. Backup researched_companies
        const researched = await query("SELECT * FROM researched_companies");
        const researchedFile = `./researched_companies_backup_${timestamp}.json`;
        fs.writeFileSync(researchedFile, JSON.stringify(researched.rows, null, 2));
        console.log(`✅ Backed up ${researched.rows.length} researched companies to ${researchedFile}`);

        // 2. Backup companies
        const companies = await query("SELECT * FROM companies");
        const companiesFile = `./companies_backup_${timestamp}.json`;
        fs.writeFileSync(companiesFile, JSON.stringify(companies.rows, null, 2));
        console.log(`✅ Backed up ${companies.rows.length} profiled companies to ${companiesFile}`);

        // 3. Truncate tables
        console.log("🧹 Truncating researched_companies and companies...");
        await query("TRUNCATE TABLE researched_companies CASCADE");
        await query("TRUNCATE TABLE companies CASCADE");

        console.log("✨ All discovery tracking data has been cleared.");

        // 4. Verification Check
        const check1 = await query("SELECT count(*) FROM researched_companies");
        const check2 = await query("SELECT count(*) FROM companies");
        console.log(`Verification: researched_companies=${check1.rows[0].count}, companies=${check2.rows[0].count}`);

    } catch (error) {
        console.error("❌ Reset failed:", error);
    }
}

clearExclusionLists().catch(console.error);
