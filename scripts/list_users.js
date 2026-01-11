import { query } from '../db/index.js';

const listUsers = async () => {
    try {
        const res = await query("SELECT id, email, created_at FROM users");
        console.log("Users:", res.rows);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

listUsers();
