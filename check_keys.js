
import { query } from './db/index.js';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
    const res = await query('SELECT * FROM users');
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
}
check();
