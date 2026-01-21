
import dotenv from 'dotenv';
import { query } from './db/index.js';

dotenv.config();

const USER_EMAIL = 'roelof@elvison.com';

async function restoreLeads() {
    try {
        console.log('🚑 Starting Lead Restoration (Corrected)...');

        const userRes = await query(`SELECT id FROM users WHERE email = $1`, [USER_EMAIL]);
        const userId = userRes.rows[0].id;

        // --- PHASE 1: RE-QUALIFY LEADS (Using leads_link) ---
        console.log('\n🔄 Phase 1: Re-qualifying leads for High-Fit companies...');

        // We use a looser join condition for company names to catch small variations
        const requalifyRes = await query(`
            UPDATE leads l
            SET status = 'NEW', 
                custom_data = jsonb_set(COALESCE(custom_data, '{}'), '{disqualification_reason}', 'null')
            FROM leads_link link, companies c
            WHERE l.id = link.lead_id
            AND link.parent_id = $1
            AND c.user_id = $1
            AND c.fit_score >= 7
            AND (l.company_name ILIKE c.company_name OR c.company_name ILIKE l.company_name)
            AND l.status = 'DISQUALIFIED'
            RETURNING l.company_name;
        `, [userId]);

        console.log(`✅ Restored ${requalifyRes.rowCount} disqualified leads.`);

        const restoredCounts = {};
        requalifyRes.rows.forEach(r => {
            restoredCounts[r.company_name] = (restoredCounts[r.company_name] || 0) + 1;
        });
        Object.entries(restoredCounts).slice(0, 10).forEach(([name, count]) => {
            console.log(`   - ${name}: ${count} leads restored`);
        });
        if (Object.keys(restoredCounts).length > 10) console.log(`   ...and ${Object.keys(restoredCounts).length - 10} more companies.`);


        // --- PHASE 2: NORMALIZE NAMES ---
        console.log('\n🛠️  Phase 2: Normalizing Mismatched Names...');

        const fixes = [
            { target: 'Middlefield', pattern: 'MIDDLEFIELD' },
            { target: 'Canada Lands Company', pattern: '%Societe Immobiliere du Canada%' },
            { target: 'Lone Star Funds', pattern: '%Lone Star%' } // Ensure capitalization consistency
        ];

        for (const fix of fixes) {
            const updateRes = await query(`
                UPDATE leads l
                SET company_name = $1
                FROM leads_link link
                WHERE l.id = link.lead_id
                AND link.parent_id = $2
                AND l.company_name ILIKE $3
                AND l.company_name != $1
            `, [fix.target, userId, fix.pattern]);

            if (updateRes.rowCount > 0) {
                console.log(`✅ Normalized ${updateRes.rowCount} leads for ${fix.target}`);
            }
        }

        // --- PHASE 3: FINAL CHECK ---
        console.log('\n📊 Final Verification (Zero-Lead High-Fit Companies):');
        const finalCheck = await query(`
             SELECT c.company_name, c.fit_score, 
                (SELECT COUNT(*) FROM leads l JOIN leads_link link ON l.id = link.lead_id 
                 WHERE l.company_name = c.company_name AND link.parent_id = c.user_id 
                 AND l.status != 'DISQUALIFIED') as active_leads 
             FROM companies c 
             WHERE c.user_id = $1 
             AND c.fit_score >= 7
             AND (SELECT COUNT(*) FROM leads l JOIN leads_link link ON l.id = link.lead_id 
                  WHERE l.company_name = c.company_name AND link.parent_id = c.user_id 
                  AND l.status != 'DISQUALIFIED') = 0
             ORDER BY c.fit_score DESC
        `, [userId]);

        if (finalCheck.rowCount === 0) {
            console.log('✨ SUCCESS: All High-Fit companies now have active leads!');
        } else {
            console.log(`⚠️  Still found ${finalCheck.rowCount} companies with 0 leads:`);
            finalCheck.rows.forEach(r => console.log(`   - ${r.company_name} (Score: ${r.fit_score})`));
        }

        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

restoreLeads();
