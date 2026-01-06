/**
 * FINAL Deduplicate & Normalize Companies Script
 * 
 * 1. Groups by normalized domain AND fuzzy name.
 * 2. Merges metadata (score, profile) to the best version.
 * 3. Standardizes company names.
 * 4. Merges disparate but identical companies (e.g. Fiera Capital vs Fiera Capital Inc).
 */

import { query } from './db/index.js';

const normalizeDomain = (url) => {
    if (!url) return null;
    try {
        let domain = url.toLowerCase().trim();
        if (domain.includes('://')) domain = domain.split('://')[1];
        domain = domain.split('/')[0];
        domain = domain.replace(/^www\./, '');
        return domain;
    } catch (e) {
        return url.toLowerCase().trim();
    }
};

const normalizeName = (name) => {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/[,.]?\s*(inc|llc|ltd|corp|corporation|group|asia|pacific|canada|usa|holdings|organization|communities|management)\.?$/gi, '')
        .trim();
};

async function main() {
    console.log('🚀 Starting Final Database Merging & Deduplication...\n');

    try {
        // 1. Fetch all leads
        const { rows: leads } = await query(`
            SELECT id, company_name, custom_data
            FROM leads
            WHERE status != 'DISQUALIFIED'
        `);

        console.log(`📊 Processing ${leads.length} active records...`);

        const groups = {};

        leads.forEach(lead => {
            const domain = normalizeDomain(lead.custom_data?.company_website || lead.custom_data?.company_domain);
            const nameNorm = normalizeName(lead.company_name);

            // Find an existing group that matches either domain or normalized name
            let groupKey = domain || `NAME_${nameNorm}`;

            // If we have a domain, try to see if it already exists as a name-group or vice-versa
            if (groups[domain]) groupKey = domain;
            else if (groups[`NAME_${nameNorm}`]) groupKey = `NAME_${nameNorm}`;

            if (!groups[groupKey]) {
                groups[groupKey] = {
                    leads: [],
                    names: [],
                    profiles: [],
                    scores: [],
                    websites: []
                };
            }

            groups[groupKey].leads.push(lead);
            if (lead.company_name) groups[groupKey].names.push(lead.company_name);
            if (domain) groups[groupKey].websites.push(domain);

            const profile = lead.custom_data?.company_profile || '';
            if (profile) groups[groupKey].profiles.push(profile);

            const score = lead.custom_data?.score || lead.custom_data?.fit_score || lead.custom_data?.match_score;
            if (score !== undefined && score !== null) {
                let s = parseFloat(score);
                if (s <= 1 && s > 0) s = s * 10;
                groups[groupKey].scores.push(Math.round(s));
            }
        });

        console.log(`🔍 Identified ${Object.keys(groups).length} canonical companies.`);

        let updatedCount = 0;

        for (const [key, group] of Object.entries(groups)) {
            // Pick the "Best" values
            const validNames = group.names.filter(n => n.length > 3);
            let canonicalName = validNames.length > 0
                ? validNames.sort((a, b) => a.length - b.length)[0]
                : group.names[0];

            const canonicalProfile = group.profiles.sort((a, b) => b.length - a.length)[0] || '';
            const canonicalScore = group.scores.length > 0 ? Math.max(...group.scores) : null;
            const canonicalWebsite = group.websites[0] || '';

            for (const lead of group.leads) {
                const currentProfile = lead.custom_data?.company_profile || '';
                const currentScore = lead.custom_data?.fit_score;

                const needsUpdate = lead.company_name !== canonicalName ||
                    currentProfile !== canonicalProfile ||
                    (canonicalScore !== null && currentScore != canonicalScore);

                if (needsUpdate) {
                    const newCustomData = {
                        ...(lead.custom_data || {}),
                        company_profile: canonicalProfile,
                        fit_score: canonicalScore,
                        company_domain: canonicalWebsite
                    };

                    await query(
                        'UPDATE leads SET company_name = $1, custom_data = $2, updated_at = NOW() WHERE id = $3',
                        [canonicalName, JSON.stringify(newCustomData), lead.id]
                    );
                    updatedCount++;
                }
            }
        }

        console.log(`\n✨ Success! Merged/Updated ${updatedCount} records.`);

    } catch (e) {
        console.error('❌ Error during deduplication:', e);
    } finally {
        process.exit();
    }
}

main();
