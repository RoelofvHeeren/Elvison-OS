import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { query } from './db/index.js'
import { runAgentWorkflow } from './src/backend/workflow.js'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const app = express()
const port = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// --- Static Files ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(express.static(path.join(__dirname, 'dist')))

// --- API Endpoints ---

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Get Agent Prompts
app.get('/api/agent-prompts', async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM agent_prompts')
        const prompts = rows.reduce((acc, row) => {
            acc[row.agent_id] = row.system_prompt
            return acc
        }, {})
        res.json(prompts)
    } catch (err) {
        console.error('Failed to fetch prompts:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Save Agent Prompts
app.post('/api/agent-prompts', async (req, res) => {
    const { prompts } = req.body // Expects array of { id, name, prompt }
    if (!Array.isArray(prompts)) return res.status(400).json({ error: 'Invalid data format' })

    try {
        await query('BEGIN')
        for (const p of prompts) {
            // Upsert
            await query(
                `INSERT INTO agent_prompts (agent_id, name, system_prompt, config) 
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (agent_id) 
                 DO UPDATE SET system_prompt = $3, name = $2, config = CASE WHEN $4::jsonb IS NOT NULL THEN $4 ELSE agent_prompts.config END, updated_at = NOW()`,
                [p.id, p.name, p.prompt, p.config || {}]
            )
        }
        await query('COMMIT')
        res.json({ success: true })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to save prompts:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

import OpenAI from 'openai'

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

// --- API Endpoints ---

// Prompt Optimization (LLM)
app.post('/api/optimize-prompt', async (req, res) => {
    const { agentName, inputs, baseTemplate } = req.body
    if (!agentName || !inputs) return res.status(400).json({ error: 'Missing data' })

    try {
        const systemPrompt = `You are an expert AI Engineer.
Your goal is to write a highly effective System Instruction for an AI Agent named "${agentName}".

The user has provided the following configuration inputs:
${JSON.stringify(inputs, null, 2)}

And here is a basic template/intent for the agent:
"${baseTemplate}"

**TASK:**
Rewrite the system instruction to be professional, robust, and optimized for an LLM.
- Use clear sections (GOAL, BEHAVIOR, CONSTRAINTS).
- Ensure specific user inputs are integrated naturally.
- Do NOT include any placeholder brackets like {{value}}. Fill them in.
- Return ONLY the prompt text. No markdown fences.`

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: systemPrompt }],
        })

        const optimizedPrompt = completion.choices[0].message.content.trim()
        res.json({ prompt: optimizedPrompt })
    } catch (err) {
        console.error('Prompt Optimization Failed:', err)
        res.status(500).json({ error: 'Optimization failed' })
    }
})

// 2. Get Agent Configs (For UI)
app.get('/api/agents/config', async (req, res) => {
    try {
        const { rows } = await query("SELECT * FROM agent_prompts")
        const configs = {}

        rows.forEach(row => {
            configs[row.agent_id] = {
                instructions: row.system_prompt,
                enabledToolIds: row.config?.enabledToolIds || [],
                linkedFileIds: row.config?.linkedFileIds || []
            }
        })

        res.json({ configs })
    } catch (err) {
        console.error('Failed to fetching agent configs:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// 3. Save Agent Config (From UI)
app.post('/api/agents/config', async (req, res) => {
    const { agentKey, instructions, enabledToolIds, linkedFileIds } = req.body

    try {
        // We need to fetch existing config first to merge, or use jsonb_set, 
        // but simpler here: fetch current row to get name/desc if we need to insert new.
        // Actually, onboarding creates the row. If it doesn't exist, we might fail 
        // or need default name.

        // Let's assume row exists from onboarding, or use generic name.
        const name = agentKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

        const configObj = {
            enabledToolIds: enabledToolIds || [],
            linkedFileIds: linkedFileIds || []
        }

        await query(
            `INSERT INTO agent_prompts (agent_id, name, system_prompt, config) 
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (agent_id) DO UPDATE SET 
                system_prompt = EXCLUDED.system_prompt,
                config = agent_prompts.config || EXCLUDED.config,
                updated_at = NOW()`,
            [agentKey, name, instructions, configObj]
        )

        res.json({ success: true })
    } catch (err) {
        console.error('Failed to save agent config:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// --- Knowledge Base & Files ---

// 1. Create Internal Strategy Guide & Vector Store
app.post('/api/knowledge/create-internal', async (req, res) => {
    const { answers, agentConfigs } = req.body

    try {
        // 1. Compile Strategy Guide Content
        let content = `# Internal Strategy Guide & Agent Protocols\nGenerated: ${new Date().toISOString()}\n\n`

        // Add Research Framework
        if (answers.research_framework) {
            content += `## Research Framework\n${JSON.stringify(answers.research_framework, null, 2)}\n\n`
        }

        // Add Outreach Strategy
        if (answers.outreach_creator) {
            content += `## Outreach Strategy\n${JSON.stringify(answers.outreach_creator, null, 2)}\n\n`
        }

        // 2. Get or Create Vector Store 
        let vectorStoreId = null
        const { rows } = await query("SELECT value FROM system_config WHERE key = 'default_vector_store'")

        if (rows.length > 0 && rows[0].value?.id) {
            vectorStoreId = rows[0].value.id
        } else {
            // Create new
            const vsResponse = await fetch('https://api.openai.com/v1/vector_stores', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                    'OpenAI-Beta': 'assistants=v2'
                },
                body: JSON.stringify({
                    name: "Elvison OS - Knowledge Base"
                })
            })

            if (!vsResponse.ok) {
                const errText = await vsResponse.text()
                throw new Error(`OpenAI VS Creation Failed: ${vsResponse.status} - ${errText}`)
            }
            const vsData = await vsResponse.json()
            vectorStoreId = vsData.id

            // Save to DB
            await query(
                `INSERT INTO system_config (key, value) VALUES ($1, $2)
                 ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
                ['default_vector_store', { id: vectorStoreId }]
            )
        }

        // 3. CLEANUP: Delete old versions of the guide from VS
        try {
            // List files in VS
            const vsFilesRes = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'assistants=v2'
                }
            })

            if (vsFilesRes.ok) {
                const vsFilesData = await vsFilesRes.json()
                const fileIds = vsFilesData.data.map(f => f.id)

                // We need file details (names) to identifying duplicates.
                // Since we can't get name from VS-File object directly efficiently without listing all files or storing map,
                // And listing ALL files is heavy...
                // Strategy: We only want to delete files named "INTERNAL_STRATEGY_GUIDE.md".
                // We can't query by name easily.
                // Alternative: Save the current 'internal_guide_file_id' in system_config.

                // Let's try fetching the file object for each VS file to check name.
                // Proceed with system_config approach for future, but to fix current mess, iteration is needed.
                // Given the user likely only has a few files, listing ALL files is acceptable for now.

                const allFilesRes = await fetch('https://api.openai.com/v1/files', {
                    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                })

                if (allFilesRes.ok) {
                    const allFilesData = await allFilesRes.json()
                    const filesToDelete = allFilesData.data.filter(f =>
                        fileIds.includes(f.id) && f.filename === 'INTERNAL_STRATEGY_GUIDE.md'
                    )

                    for (const f of filesToDelete) {
                        // Remove from VS
                        await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${f.id}`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                                'OpenAI-Beta': 'assistants=v2'
                            }
                        })
                        // Delete File Object
                        await fetch(`https://api.openai.com/v1/files/${f.id}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                        })
                    }
                }
            }
        } catch (cleanupErr) {
            console.warn("Cleanup of old guides failed, continuing:", cleanupErr)
        }


        // 4. Upload NEW File to OpenAI (Direct Fetch)
        const tempFilePath = path.join(__dirname, 'INTERNAL_STRATEGY_GUIDE.md')
        const fs = await import('fs/promises')
        await fs.writeFile(tempFilePath, content)

        const fileFormData = new FormData()
        fileFormData.append('purpose', 'assistants')
        const fileBlob = new Blob([await fs.readFile(tempFilePath)])
        fileFormData.append('file', fileBlob, 'INTERNAL_STRATEGY_GUIDE.md')

        const fileResponse = await fetch('https://api.openai.com/v1/files', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: fileFormData
        })

        if (!fileResponse.ok) {
            const errText = await fileResponse.text()
            throw new Error(`OpenAI File Upload Failed: ${fileResponse.status} - ${errText}`)
        }
        const fileData = await fileResponse.json()
        const fileId = fileData.id

        // Cleanup temp file
        await fs.unlink(tempFilePath)

        // 4. Add File to Vector Store (Direct Fetch)
        const vsFileResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                file_id: fileId
            })
        })

        if (!vsFileResponse.ok) {
            const errText = await vsFileResponse.text()
            throw new Error(`OpenAI VS File Attach Failed: ${vsFileResponse.status} - ${errText}`)
        }

        res.json({ success: true, vectorStoreId, fileId: fileId })

    } catch (err) {
        console.error('KB Creation Failed:', err)
        res.status(500).json({ error: err.message })
    }
})



// 5. List Knowledge Base Files
app.get('/api/knowledge/files', async (req, res) => {
    try {
        // Get Default Vector Store ID
        const { rows } = await query("SELECT value FROM system_config WHERE key = 'default_vector_store'")
        if (rows.length === 0 || !rows[0].value?.id) {
            return res.json({ files: [] })
        }
        const vectorStoreId = rows[0].value.id

        // Fetch Files from OpenAI Vector Store
        // 1. List VS Files to get File IDs
        const vsFilesRes = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'OpenAI-Beta': 'assistants=v2'
            }
        })

        if (!vsFilesRes.ok) {
            throw new Error("Failed to fetch VS files")
        }
        const vsFilesData = await vsFilesRes.json()
        const fileIds = vsFilesData.data.map(f => f.id)

        if (fileIds.length === 0) {
            return res.json({ files: [] })
        }

        // 2. Fetch File Details (names) for each ID
        // Note: OpenAI doesn't have a bulk get files endpoint, so we might need to list all files
        // or fetch individually. Listing all files is safer.
        const allFilesRes = await fetch(`https://api.openai.com/v1/files`, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            }
        })
        const allFilesData = await allFilesRes.json()

        // Filter to only those in our VS
        const relevantFiles = allFilesData.data
            .filter(f => fileIds.includes(f.id))
            .map(f => ({
                id: f.id,
                name: f.filename,
                size: f.bytes,
                created_at: f.created_at
            }))

        res.json({ files: relevantFiles })
    } catch (err) {
        console.error('Failed to list KB files:', err)
        // Return empty on error to not break UI
        res.json({ files: [] })
    }
})

// Get CRM Columns
app.get('/api/crm-columns', async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM crm_columns ORDER BY created_at ASC')
        res.json(rows)
    } catch (err) {
        console.error('Failed to fetch columns:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Save CRM Columns
app.post('/api/crm-columns', async (req, res) => {
    const { columns } = req.body
    if (!Array.isArray(columns)) return res.status(400).json({ error: 'Invalid data' })
    try {
        await query('BEGIN')
        await query('DELETE FROM crm_columns')
        for (const col of columns) {
            await query(
                `INSERT INTO crm_columns (column_name, column_type, is_required) VALUES ($1, $2, $3)`,
                [col.name, col.type, col.required]
            )
        }
        await query('COMMIT')
        res.json({ success: true })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to save columns:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// --- LEADS & CRM ---

// Get Leads
app.get('/api/leads', async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 100')
        res.json(rows)
    } catch (err) {
        console.error('Failed to fetch leads:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Create/Update Lead
app.post('/api/leads', async (req, res) => {
    const { leads } = req.body // Array of leads
    if (!Array.isArray(leads)) return res.status(400).json({ error: 'Invalid data' })

    try {
        await query('BEGIN')
        for (const lead of leads) {
            await query(
                `INSERT INTO leads (company_name, person_name, email, job_title, linkedin_url, status, custom_data, source)
                 VALUES ($1, $2, $3, $4, $5, 'NEW', $6, $7)`,
                [
                    lead.company_name,
                    lead.first_name ? `${lead.first_name} ${lead.last_name}` : lead.person_name,
                    lead.email,
                    lead.title,
                    lead.linkedin_url,
                    JSON.stringify(lead.custom_data || {}),
                    'Automation'
                ]
            )
        }
        await query('COMMIT')
        res.json({ success: true, count: leads.length })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to save leads:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Delete Lead
app.delete('/api/leads/:id', async (req, res) => {
    const { id } = req.params
    try {
        await query('DELETE FROM leads WHERE id = $1', [id])
        res.json({ success: true })
    } catch (err) {
        console.error('Failed to delete lead:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Clear All Leads
app.post('/api/leads/clear', async (req, res) => {
    try {
        await query('DELETE FROM leads')
        res.json({ success: true })
    } catch (err) {
        console.error('Failed to clear leads:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// --- WORKFLOW LOGGING ---

// Get Workflow Runs
app.get('/api/runs', async (req, res) => {
    try {
        // Fetch runs with their latest result (if any)
        const { rows } = await query(`
            SELECT 
                wr.*, 
                ar.output_data 
            FROM workflow_runs wr
            LEFT JOIN agent_results ar ON wr.id = ar.run_id
            ORDER BY wr.started_at DESC
            LIMIT 50
        `)
        res.json(rows)
    } catch (err) {
        console.error('Failed to fetch runs:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Start Run
app.post('/api/runs/start', async (req, res) => {
    const { agent_id, metadata } = req.body
    try {
        const { rows } = await query(
            `INSERT INTO workflow_runs (agent_id, status, started_at, metadata) VALUES ($1, 'RUNNING', NOW(), $2) RETURNING id`,
            [agent_id, metadata]
        )
        res.json({ run_id: rows[0].id })
    } catch (err) {
        console.error('Failed to start run:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Complete Run (with results)
app.post('/api/runs/complete', async (req, res) => {
    const { run_id, output_data } = req.body
    try {
        await query('BEGIN')
        await query(
            `UPDATE workflow_runs SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1`,
            [run_id]
        )
        // Store results if any
        if (output_data) {
            await query(
                `INSERT INTO agent_results (run_id, output_data) VALUES ($1, $2)`,
                [run_id, output_data] // Storing full JSON blob
            )
        }
        await query('COMMIT')
        res.json({ success: true })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to complete run:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Fail Run
app.post('/api/runs/fail', async (req, res) => {
    const { run_id, error } = req.body
    try {
        await query(
            `UPDATE workflow_runs SET status = 'FAILED', completed_at = NOW(), error_log = $2 WHERE id = $1`,
            [run_id, error]
        )
        res.json({ success: true })
    } catch (err) {
        console.error('Failed to fail run:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Trigger Analysis Run (The Long Running Process)
// --- APIFY INTEGRATION ---
import { startApifyScrape, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';

// Auto-run Credit Migration on Startup (Safe idempotency)
(async () => {
    try {
        await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 500000;`);
        // Ensure admin user exists for testing
        await query(`
            INSERT INTO users (email, name, role, credits)
            VALUES ('admin@elvison.ai', 'Admin', 'admin', 500000)
            ON CONFLICT (email) DO UPDATE SET credits = 500000 WHERE users.credits IS NULL; 
        `);
        console.log("System: Credits system initialized.");
    } catch (e) {
        // console.error("System: Credit init informative", e); // Valid table exists
    }
})();

app.post('/api/integrations/apify/run', async (req, res) => {
    const { token, domains, filters } = req.body;

    // Allow system token fallback
    const effectiveToken = token || process.env.APIFY_API_TOKEN;

    if (!effectiveToken || !domains || !Array.isArray(domains)) {
        return res.status(400).json({ error: 'Valid Token (or System Env) and domains array required' });
    }

    // CREDIT CHECK
    try {
        const userRes = await query(`SELECT credits, id FROM users LIMIT 1`);
        const user = userRes.rows[0];
        if (user && user.credits <= 0) {
            return res.status(403).json({ error: 'Insufficient credits. Please upgrade.' });
        }
    } catch (e) {
        console.error("Credit check skipped due to DB error", e);
    }

    try {
        const runId = await startApifyScrape(effectiveToken, domains, filters);
        res.json({ runId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/integrations/apify/status/:runId', async (req, res) => {
    const { runId } = req.params;
    const { token } = req.query; // Pass token in query for GET

    const effectiveToken = token || process.env.APIFY_API_TOKEN;

    if (!effectiveToken) return res.status(400).json({ error: 'Token required (User or System)' });

    try {
        const { status, datasetId } = await checkApifyRun(effectiveToken, runId);

        if (status === 'SUCCEEDED') {
            const items = await getApifyResults(effectiveToken, datasetId);

            // Auto-insert into DB
            let importedCount = 0;
            for (const item of items) {
                // Map fields based on PIPELINELABS output mapping
                // Output Schema: fullName, email, position, city, linkedinUrl, orgName

                // Parse Name
                let firstName = item.firstName || item.first_name;
                let lastName = item.lastName || item.last_name;
                if (!firstName && item.fullName) {
                    const parts = item.fullName.split(' ');
                    firstName = parts[0];
                    lastName = parts.slice(1).join(' ');
                }

                // Parse Email
                const email = item.email || item.workEmail || item.personalEmail;
                if (!email) continue;

                // Parse Company
                const companyName = item.orgName || item.companyName || item.company_name;

                try {
                    await query(
                        `INSERT INTO leads (
                            first_name, last_name, title, company_name, 
                            email, linkedin_url, location, source, status
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'APIFY_IMPORT', 'NEW')
                        ON CONFLICT (email) DO NOTHING`,
                        [
                            firstName,
                            lastName,
                            item.position || item.title || item.jobTitle,
                            companyName,
                            email,
                            item.linkedinUrl || item.linkedin_url || item.profileUrl,
                            item.city || item.location,
                        ]
                    );
                    importedCount++;
                } catch (err) {
                    console.error('Insert error:', err);
                }
            }

            // DEDUCT CREDITS
            if (importedCount > 0) {
                try {
                    // deduct from the first user found (admin)
                    await query(`UPDATE users SET credits = credits - $1 WHERE id = (SELECT id FROM users LIMIT 1)`, [importedCount]);
                    console.log(`Deducted ${importedCount} credits.`);
                } catch (e) {
                    console.error("Credit deduction failed", e);
                }
            }

            return res.json({ status, importedCount, results: items });
        }

        res.json({ status });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trigger Analysis Run (SSE Streaming)
app.post('/api/agents/run', async (req, res) => {
    const { prompt, vectorStoreId, agentConfigs, mode } = req.body
    console.log(`Starting live workflow (Mode: ${mode || 'default'}) with prompt:`, prompt)

    // 1. Setup SSE Headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    })

    // 2. Create Run Record
    let runId = null
    try {
        const { rows } = await query(
            `INSERT INTO workflow_runs (agent_id, status, started_at, metadata) VALUES ('main_workflow', 'RUNNING', NOW(), $1) RETURNING id`,
            [JSON.stringify({ prompt, vectorStoreId, mode: mode || 'default' })]
        )
        runId = rows[0].id
        // Send initial connection confirmation
        res.write(`event: log\ndata: {"step": "System", "detail": "Workflow initialized. Run ID: ${runId}", "timestamp": "${new Date().toISOString()}"}\n\n`)
    } catch (err) {
        console.error('Failed to init run:', err)
        res.write(`event: error\ndata: {"message": "Database initialization failed"}\n\n`)
        return res.end()
    }

    // 3. Execute Workflow with Streaming Listeners
    try {
        const result = await runAgentWorkflow({ input_as_text: prompt }, {
            vectorStoreId: vectorStoreId, // Pass VS ID from request
            agentConfigs: agentConfigs || {},
            mode: mode, // Pass mode to workflow
            listeners: {
                onLog: async (logParams) => {
                    const eventData = JSON.stringify({
                        step: logParams.step,
                        detail: logParams.detail,
                        timestamp: new Date().toISOString()
                    })
                    res.write(`event: log\ndata: ${eventData}\n\n`)
                }
            }
        })

        // 4. Success Completion
        await query(
            `UPDATE workflow_runs SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1`,
            [runId]
        )
        await query(
            `INSERT INTO agent_results (run_id, output_data) VALUES ($1, $2)`,
            [runId, JSON.stringify(result)]
        )

        res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`)
        res.write(`event: done\ndata: {}\n\n`)
    } catch (error) {
        console.error('Workflow failed:', error)
        try {
            await query(
                `UPDATE workflow_runs SET status = 'FAILED', completed_at = NOW(), error_log = $2 WHERE id = $1`,
                [runId, error.message || String(error)]
            )
        } catch (dbErr) { console.error("DB update failed during error handling", dbErr) }

        res.write(`event: error\ndata: {"message": "${error.message || 'Workflow execution failed'}"}\n\n`)
    } finally {
        res.end()
    }
})

// Helper to format agent ID to Name
function formatAgentName(id) {
    return id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

// --- Catch-All for Frontend ---
// Express 5 requires regex for global wildcard since '*' string is reserved
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// --- Database Initialization ---
const initDB = async () => {
    try {
        console.log('Initializing Database Schema...')

        // System Config
        await query(`
            CREATE TABLE IF NOT EXISTS system_config (
                key VARCHAR(50) PRIMARY KEY,
                value JSONB,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `)

        // Agent Prompts
        await query(`
            CREATE TABLE IF NOT EXISTS agent_prompts (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                agent_id VARCHAR(50) NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
                system_prompt TEXT NOT NULL,
                config JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `)

        // CRM Columns
        await query(`
            CREATE TABLE IF NOT EXISTS crm_columns (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                column_name VARCHAR(100) NOT NULL,
                column_type VARCHAR(50) NOT NULL,
                is_required BOOLEAN DEFAULT FALSE,
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `)

        // Migration: Add phone_numbers if not exists
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_numbers JSONB DEFAULT '[]'::jsonb;`)

        console.log('Database Schema Verified.')
    } catch (err) {
        console.error('Failed to initialize DB:', err)
    }
}

// Enrich Lead (Phone)
import { enrichLeadWithPhone } from './src/backend/workflow.js'

app.post('/api/leads/:id/enrich-phone', async (req, res) => {
    const { id } = req.params
    try {
        // 1. Get Lead
        const { rows } = await query('SELECT * FROM leads WHERE id = $1', [id])
        if (rows.length === 0) return res.status(404).json({ error: 'Lead not found' })

        const lead = rows[0]
        // Parse name
        const nameParts = (lead.person_name || '').split(' ')
        const leadData = {
            first_name: nameParts[0],
            last_name: nameParts.slice(1).join(' '),
            company_name: lead.company_name,
            email: lead.email,
            linkedin_url: lead.linkedin_url
        }

        // 2. Call Agent
        console.log(`Enriching lead ${id} (${leadData.email})...`)
        const phoneNumbers = await enrichLeadWithPhone(leadData)
        console.log('Enrichment result:', phoneNumbers)

        // 3. Update DB
        const { rows: updatedRows } = await query(
            `UPDATE leads SET phone_numbers = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [JSON.stringify(phoneNumbers), id]
        )

        res.json({ success: true, lead: updatedRows[0] })
    } catch (err) {
        console.error('Enrichment failed:', err)
        res.status(500).json({ error: 'Enrichment failed' })
    }
})

// CSV Import Dependencies
import multer from 'multer'
import { parse } from 'csv-parse/sync'

const upload = multer({ storage: multer.memoryStorage() })

app.post('/api/leads/import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    try {
        const fileContent = req.file.buffer.toString('utf-8')
        const records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            relax_quotes: true
        })

        if (records.length === 0) return res.json({ success: true, count: 0 })

        // Map CSV fields to DB fields
        // Apollo exports usually have: "First Name", "Last Name", "Title", "Company", "Email", "LinkedIn Url", "Website"
        const leads = records.map(r => ({
            company_name: r['Company'] || r['Company Name for Emails'] || r['Organization'] || '',
            person_name: `${r['First Name'] || ''} ${r['Last Name'] || ''}`.trim(),
            email: r['Email'] || r['Email Address'] || '',
            title: r['Title'] || r['Job Title'] || '',
            linkedin_url: r['Person Linkedin Url'] || r['Linkedin Url'] || '',
            custom_data: {
                company_website: r['Website'] || r['Company Website'] || '',
                imported_at: new Date().toISOString(),
                source_file: req.file.originalname
            },
            source: 'Import'
        })).filter(l => l.email || l.linkedin_url) // Only keep valid leads

        await query('BEGIN')
        for (const lead of leads) {
            await query(
                `INSERT INTO leads (company_name, person_name, email, job_title, linkedin_url, status, custom_data, source)
                 VALUES ($1, $2, $3, $4, $5, 'NEW', $6, $7)
                 ON CONFLICT (email) DO NOTHING`, // Avoid duplicates by email if unique constraint exists (or just insert)
                [
                    lead.company_name,
                    lead.person_name,
                    lead.email,
                    lead.title,
                    lead.linkedin_url,
                    JSON.stringify(lead.custom_data),
                    lead.source
                ]
            )
        }
        await query('COMMIT')

        res.json({ success: true, count: leads.length })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Import failed:', err)
        res.status(500).json({ error: 'Failed to process CSV file' })
    }
})

// Start Server
initDB().then(() => {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`)
    })
})

