import dotenv from 'dotenv';
dotenv.config();
console.log('ENV KEYS:', Object.keys(process.env).filter(k => k.includes('DB') || k.includes('URL') || k.includes('POSTGRES')));
