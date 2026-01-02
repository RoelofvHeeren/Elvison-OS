
import { getClient } from './db/index.js';

async function checkUser() {
    const client = await getClient();
    try {
        const res = await client.query("SELECT id, email, password_hash FROM users WHERE email = 'roelof@elvison.com'");
        if (res.rows.length === 0) {
            console.log("User NOT found.");
        } else {
            console.log("User FOUND:", res.rows[0]);
        }
    } catch (e) {
        console.error("Error:", e);
    } finally {
        client.release();
        process.exit();
    }
}

checkUser();
