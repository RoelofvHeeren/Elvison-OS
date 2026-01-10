import { query } from './db/index.js';
import fs from 'fs';
import path from 'path';

async function listIcps() {
    try {
        // Log .env existence (safely)
        if (fs.existsSync('.env')) {
            console.log('.env file found');
        } else {
            console.log('.env file NOT found');
        }

        const res = await query('SELECT id, name, search_terms, config FROM icps');
        console.log('--- ICP LIST ---');
        res.rows.forEach(row => {
            console.log(`ID: ${row.id}`);
            console.log(`Name: ${row.name}`);
            console.log(`Search Terms Count: ${Array.isArray(row.search_terms) ? row.search_terms.length : 0}`);
            if (Array.isArray(row.search_terms) && row.search_terms.length > 0) {
                console.log(`First Term: ${row.search_terms[0].term}`);
            }
            console.log('---');
        });
        process.exit(0);
    } catch (err) {
        console.error('Error querying DB:', err);
        process.exit(1);
    }
}

listIcps();
