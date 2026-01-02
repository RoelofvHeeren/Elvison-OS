
const filters = {
    job_titles: ["CEO", "Founder", "Vice President", "Director"],
    excluded_functions: ["HR / People", "Marketing", "Legal", "IT / Technology", "Support"]
};

const items = [
    { position: "CEO" }, // Should KEEP
    { position: "Vice President of Sales" }, // Should KEEP
    { position: "Vice President of HR" }, // Should DROP (HR)
    { position: "Director of Marketing" }, // Should DROP (Marketing)
    { position: "IT Director" }, // Should DROP (IT)
    { position: "Legal Counsel" }, // Should DROP (Legal)
    { position: "Founder" }, // Should KEEP
    { position: "Customer Support Manager" }, // Should DROP (Support)
    { position: "Head of People" }, // Should DROP (People)
    { position: "Technology Lead" }, // Should DROP (Technology)
    { position: null }, // Should DROP (No title)
    { position: "Managing Director" }, // Should KEEP (Generic but valid)
];

console.log("--- START DEBUG ---");
console.log(`Filters: ${JSON.stringify(filters, null, 2)}`);

const validItems = items.filter(item => {
    const title = (item.position || "").toLowerCase();
    if (!title) {
        console.log(`[DROP] No Title: ${JSON.stringify(item)}`);
        return false;
    }

    // Check Exclusions
    if (filters.excluded_functions && Array.isArray(filters.excluded_functions)) {
        for (const exclusion of filters.excluded_functions) {
            // "HR / People" -> ["hr", "people"]
            const keywords = exclusion.toLowerCase().split('/').map(s => s.trim());

            for (const kw of keywords) {
                if (kw.length < 3) {
                    // Strict word check for short acronyms
                    const regex = new RegExp(`\\b${kw}\\b`, 'i');
                    if (regex.test(title)) {
                        console.log(`[DROP] Excluded (Strict Regex '${kw}'): "${title}"`);
                        return false;
                    }
                } else {
                    if (title.includes(kw)) {
                        console.log(`[DROP] Excluded (Includes '${kw}'): "${title}"`);
                        return false;
                    }
                }
            }
        }
    }
    console.log(`[KEEP] Valid: "${title}"`);
    return true;
});

console.log(`\nResult: Kept ${validItems.length} of ${items.length}`);
