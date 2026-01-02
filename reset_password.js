
import { getClient } from './db/index.js';
import bcrypt from 'bcryptjs';

async function resetPassword() {
    const client = await getClient();
    try {
        const hashedPassword = await bcrypt.hash('password123', 10);
        await client.query("UPDATE users SET password_hash = $1 WHERE email = 'roelof@elvison.com'", [hashedPassword]);
        console.log("Password reset to 'password123'");
    } catch (e) {
        console.error("Reset failed:", e);
    } finally {
        client.release();
        process.exit();
    }
}

resetPassword();
