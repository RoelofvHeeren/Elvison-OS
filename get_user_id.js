
import { query } from './db/index.js';

async function getUserId() {
    try {
        console.log('Querying database...');
        const res = await query('SELECT id FROM users');
        console.log(`Found ${res.rows.length} users.`);
        if (res.rows.length > 0) {
            res.rows.forEach(u => console.log('USER_ID:', u.id));
        } else {
            console.log('No users found.');
        }
    } catch (err) {
        console.error('Error fetching user ID:', err);
    }
}

getUserId();
