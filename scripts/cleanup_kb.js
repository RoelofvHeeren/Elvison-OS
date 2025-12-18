import 'dotenv/config';
import { query } from '../db/index.js';
// Native fetch is global in Node 18+

const clean = async () => {
    console.log("Starting KB Cleanup...");

    // 1. Get Vector Store ID
    const { rows } = await query("SELECT value FROM system_config WHERE key = 'default_vector_store'");
    if (rows.length === 0 || !rows[0].value?.id) {
        console.error("No default vector store found.");
        process.exit(1);
    }
    const vsId = rows[0].value.id;
    console.log(`Target Vector Store: ${vsId}`);

    // 2. List Files in VS
    const vsFilesUrl = `https://api.openai.com/v1/vector_stores/${vsId}/files`;
    const headers = {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2',
        'Content-Type': 'application/json'
    };

    const res = await fetch(vsFilesUrl, { headers });
    if (!res.ok) {
        console.error("Failed to list VS files:", await res.text());
        process.exit(1);
    }
    const data = await res.json();
    const vsFileIds = data.data.map(f => f.id);
    console.log(`Found ${vsFileIds.length} files in Vector Store.`);

    // 3. Find Duplicates (Need to check names via Files API)
    // We'll just delete ALL files named "INTERNAL_STRATEGY_GUIDE.md"
    const filesRes = await fetch('https://api.openai.com/v1/files', {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    const allFiles = await filesRes.json();

    // Filter for our target
    const duplicates = allFiles.data.filter(f =>
        f.filename === 'INTERNAL_STRATEGY_GUIDE.md' && vsFileIds.includes(f.id)
    );

    console.log(`Found ${duplicates.length} duplicate 'INTERNAL_STRATEGY_GUIDE.md' files.`);

    // 4. Delete
    for (const file of duplicates) {
        console.log(`Deleting file ${file.id}...`);

        // Remove from VS
        await fetch(`${vsFilesUrl}/${file.id}`, { method: 'DELETE', headers });

        // Delete actual file
        await fetch(`https://api.openai.com/v1/files/${file.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
        });
    }

    console.log("Cleanup Complete!");
    process.exit(0);
};

clean();
