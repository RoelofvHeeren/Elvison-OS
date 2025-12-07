import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME_CONFIG_DIR = path.join(os.homedir(), '.config', 'google-sheets-mcp');
const credentialsPath = process.env.GSHEETS_CREDENTIALS_PATH || path.join(HOME_CONFIG_DIR, 'credentials.json');

console.log('--- DEBUG AUTH ---');
console.log('Credentials Path:', credentialsPath);

// 1. Check Env Var Override
if (process.env.GSHEETS_CREDENTIALS_JSON) {
    console.log('[ENV] GSHEETS_CREDENTIALS_JSON is SET.');
    console.log('[ENV] Length:', process.env.GSHEETS_CREDENTIALS_JSON.length);
    try {
        const json = JSON.parse(process.env.GSHEETS_CREDENTIALS_JSON);
        console.log('[ENV] Keys:', Object.keys(json));
        console.log('[ENV] Type:', json.type);
    } catch (e) {
        console.log('[ENV] Invalid JSON');
    }
} else {
    console.log('[ENV] GSHEETS_CREDENTIALS_JSON is NOT set.');
}

// 2. Check Disk File
if (fs.existsSync(credentialsPath)) {
    console.log('[DISK] credentials.json exists.');
    try {
        const content = fs.readFileSync(credentialsPath, 'utf-8');
        const json = JSON.parse(content);
        console.log('[DISK] Keys:', Object.keys(json));
        console.log('[DISK] Type:', json.type);
        console.log('[DISK] Client ID Present:', !!json.client_id);
        console.log('[DISK] Client Secret Present:', !!json.client_secret);
        console.log('[DISK] Refresh Token Present:', !!json.refresh_token);
        if (json.refresh_token) {
            console.log('[DISK] Refresh Token Length:', json.refresh_token.length);
        }
    } catch (e) {
        console.log('[DISK] Error reading/parsing file:', e.message);
    }
} else {
    console.log('[DISK] credentials.json does NOT exist.');
}

console.log('--- END DEBUG ---');
