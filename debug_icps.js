import { query } from './db/index.js';

async function listIcps() {
    try {
        const res = await query('SELECT id, name, search_terms, config FROM icps');
        console.log(JSON.stringify(res.rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

listIcps();
