import pg from 'pg';
import dotenv from 'dotenv';
import { URL } from 'url';

dotenv.config();

const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;

if (!dbUrl) {
    console.log('❌ DATABASE_URL or DATABASE_PUBLIC_URL is not set.');
} else {
    try {
        const parsed = new URL(dbUrl);
        console.log(`✅ Connection Details:`);
        console.log(`   Host: ${parsed.hostname}`);
        console.log(`   Database Name: ${parsed.pathname.substring(1)}`);
        console.log(`   Port: ${parsed.port}`);
        console.log(`   Protocol: ${parsed.protocol}`);
        // Mask password
        console.log(`   Full URL (Masked): ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);
    } catch (e) {
        console.log('❌ Could not parse URL:', e.message);
    }
}
