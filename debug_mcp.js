import { EventSource } from 'eventsource';
import axios from 'axios';

// MCP URL from user request variables or file
const MCP_BASE = 'https://final-sheet-mcp-production.up.railway.app';
const SHEET_ID = '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI';
const SHEET_NAME = 'AI Lead Sheet';

const createMcpSseSession = (base) =>
    new Promise((resolve, reject) => {
        console.log(`Connecting to SSE at ${base}/sse...`);
        const es = new EventSource(`${base}/sse`);
        let resolved = false;

        es.addEventListener('endpoint', (event) => {
            try {
                const endpointUrl = new URL(event.data, base).toString();
                resolved = true;
                resolve({ es, endpointUrl });
            } catch (err) {
                es.close();
                reject(err);
            }
        });

        es.onerror = (err) => {
            if (!resolved) {
                reject(err);
            }
            es.close();
        };
    });

const waitForMcpResponse = (es, messageId) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            es.close();
            reject(new Error('Timed out waiting for MCP response'));
        }, 10000);

        es.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.id === messageId) {
                    clearTimeout(timer);
                    es.close();
                    resolve(parsed);
                }
            } catch (err) {
                console.error('Failed to parse MCP message', err);
            }
        };
    });

const callMcpTool = async (toolName, args) => {
    const session = await createMcpSseSession(MCP_BASE);
    console.log('Session created. Endpoint:', session.endpointUrl);

    const messageId = `mcp-${Date.now()}`;
    const payload = {
        jsonrpc: '2.0',
        id: messageId,
        method: 'tools/call',
        params: {
            name: toolName,
            arguments: args,
        },
    };

    const responsePromise = waitForMcpResponse(session.es, messageId);
    await axios.post(session.endpointUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
    });
    return responsePromise;
};

const run = async () => {
    try {
        console.log(`Calling methods: list_tools`);
        const payload = {
            jsonrpc: '2.0',
            id: `mcp-${Date.now()}`,
            method: 'tools/list'
        };

        // Manual AXIOS call because callMcpTool wraps tools/call
        const session = await createMcpSseSession(MCP_BASE);
        const responsePromise = waitForMcpResponse(session.es, payload.id);
        await axios.post(session.endpointUrl, payload, { headers: { 'Content-Type': 'application/json' } });
        const response = await responsePromise;

        console.log('--- TOOLS LIST ---');
        console.log(JSON.stringify(response, null, 2));

    } catch (err) {
        console.error('Script Error:', err.message);
        if (err.response) {
            console.error('Axios Status:', err.response.status);
            console.error('Axios Data:', err.response.data);
        }
    }
};

run();
