import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
console.log('DB_URL:', process.env.DATABASE_URL);
console.log('PUBLIC_DB_URL:', process.env.DATABASE_PUBLIC_URL);
