import dotenv from 'dotenv';
dotenv.config();
console.log('DB_URL:', process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL);
