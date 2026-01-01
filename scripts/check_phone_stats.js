import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

if (!process.env.DATABASE_URL && !process.env.DATABASE_PUBLIC_URL) {
    // Fallback to likely local Prisma Postgres port
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:51213/postgres";
    console.log("DEBUG: Force-setting fallback URL:", process.env.DATABASE_URL);
} else {
    console.log("DEBUG: DATABASE_URL present:", !!process.env.DATABASE_URL);
    console.log("DEBUG: DATABASE_PUBLIC_URL present:", !!process.env.DATABASE_PUBLIC_URL);
    // Mask URL for debug safety
    const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
    console.log("DEBUG: URL:", url ? url.replace(/:[^:@]*@/, ':****@') : "UNDEFINED");
}

// Dynamic import AFTER setting env vars
const { query } = await import('../db/index.js');

async function run() {
    try {
        console.log("--- Phone Number Analysis ---");

        // 1. Total Leads
        const totalRes = await query('SELECT COUNT(*) FROM leads');
        const total = parseInt(totalRes.rows[0].count);
        console.log(`Total Leads in DB: ${total}`);

        if (total === 0) return;

        // 2. Leads with Phone Numbers (normalized column)
        const phoneRes = await query(`
            SELECT COUNT(*) 
            FROM leads 
            WHERE phone_numbers IS NOT NULL 
            AND jsonb_array_length(phone_numbers) > 0
        `);
        const withPhone = parseInt(phoneRes.rows[0].count);
        console.log(`Leads with Phone Numbers (in 'phone_numbers' col): ${withPhone} (${((withPhone / total) * 100).toFixed(1)}%)`);

        // 3. Breakdown by Source
        const sourceRes = await query(`
            SELECT 
                source, 
                COUNT(*) as total_in_source,
                SUM(CASE WHEN phone_numbers IS NOT NULL AND jsonb_array_length(phone_numbers) > 0 THEN 1 ELSE 0 END) as with_phone
            FROM leads 
            GROUP BY source
            ORDER BY total_in_source DESC
        `);

        console.log("\n--- Breakdown by Source ---");
        sourceRes.rows.forEach(r => {
            const t = parseInt(r.total_in_source);
            const p = parseInt(r.with_phone);
            console.log(`Source: ${r.source || 'N/A'} | Total: ${t} | With Phone: ${p} (${((p / t) * 100).toFixed(1)}%)`);
        });

        // 4. Check Raw Data for Hidden Phones (Apify/Amplify)
        const rawCheckRes = await query(`
            SELECT COUNT(*) 
            FROM leads 
            WHERE (phone_numbers IS NULL OR jsonb_array_length(phone_numbers) = 0)
            AND (
                raw_data::text ILIKE '%phone%' OR 
                raw_data::text ILIKE '%mobile%' OR
                raw_data::text ILIKE '%cell%'
            )
        `);
        console.log(`\nPotential leads with phone hidden in raw_data: ${rawCheckRes.rows[0].count}`);


    } catch (e) {
        console.error("Error running analysis:", e);
    } finally {
        process.exit();
    }
}

run();
