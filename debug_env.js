
import dotenv from 'dotenv';
const result = dotenv.config();
if (result.error) {
    console.log('Error loading .env', result.error);
} else {
    console.log('Defined Keys:', Object.keys(result.parsed));
    console.log('DATABASE_URL starts with:', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 10) : 'UNDEFINED');
    console.log('DATABASE_PUBLIC_URL starts with:', process.env.DATABASE_PUBLIC_URL ? process.env.DATABASE_PUBLIC_URL.substring(0, 10) : 'UNDEFINED');
}
