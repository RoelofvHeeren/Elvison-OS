import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import { query } from './db/index.js'
import { runAgentWorkflow } from './src/backend/workflow.js'
import { generateToken } from './src/backend/session-utils.js'
import { requireAuth, optionalAuth } from './src/backend/auth-middleware.js'
import path from 'path'
import { fileURLToPath } from 'url'
import { OptimizationService } from './src/backend/optimizer.js'
import { enrichLeadWithPhone } from './src/backend/workflow.js'
import multer from 'multer'
import { parse } from 'csv-parse/sync'

dotenv.config()

const app = express()
const port = process.env.PORT || 3001

// CORS configuration to allow credentials
app.use(cors({
    origin: process.env.VITE_API_BASE_URL || 'http://localhost:5173',
    credentials: true
}))
app.use(express.json())
app.use(cookieParser())

// --- Static Files ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(express.static(path.join(__dirname, 'dist')))

// --- API Endpoints ---

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// --- AUTHENTICATION ENDPOINTS ---

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
    const { email, password, name } = req.body

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' })
    }

    try {
        // Check if user already exists
        const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email])
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' })
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10)

        // Create user
        const { rows } = await query(
            `INSERT INTO users (email, name, password_hash, role, onboarding_completed, credits)
             VALUES ($1, $2, $3, 'user', FALSE, 500000)
             RETURNING id, email, name, role, onboarding_completed`,
            [email.toLowerCase(), name || email.split('@')[0], passwordHash]
        )

        const user = rows[0]

        // Generate JWT token
        const token = generateToken(user)

        // Set httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        })

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                onboardingCompleted: user.onboarding_completed
            }
        })
    } catch (err) {
        console.error('Signup error:', err)
        res.status(500).json({ error: 'Failed to create account' })
    }
})

// Log In
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' })
    }

    try {
        // Find user
        const { rows } = await query(
            'SELECT id, email, name, role, password_hash, onboarding_completed FROM users WHERE LOWER(email) = LOWER($1)',
            [email]
        )

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' })
        }

        const user = rows[0]

        // Check if password_hash is null (owner account before password set)
        if (!user.password_hash) {
            return res.status(403).json({
                error: 'Account requires password setup',
                code: 'PASSWORD_SETUP_REQUIRED',
                message: 'Please contact administrator to set up your password'
            })
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash)
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid email or password' })
        }

        // Generate JWT token
        const token = generateToken(user)

        // Set httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        })

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                onboardingCompleted: user.onboarding_completed
            }
        })
    } catch (err) {
        console.error('Login error:', err)
        res.status(500).json({ error: 'Failed to log in' })
    }
})

// Log Out
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token')
    res.json({ success: true })
})

// Get Current User
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT id, email, name, role, onboarding_completed, onboarding_state, credits FROM users WHERE id = $1',
            [req.userId]
        )

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' })
        }

        const user = rows[0]
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            onboardingCompleted: user.onboarding_completed,
            onboardingState: user.onboarding_state || {},
            credits: user.credits
        })
    } catch (err) {
        console.error('Get user error:', err)
        res.status(500).json({ error: 'Failed to fetch user data' })
    }
})

// Complete Onboarding
app.post('/api/auth/complete-onboarding', requireAuth, async (req, res) => {
    try {
        await query(
            'UPDATE users SET onboarding_completed = TRUE, updated_at = NOW() WHERE id = $1',
            [req.userId]
        )

        // Return updated user
        const { rows } = await query(
            'SELECT id, email, name, role, onboarding_completed, onboarding_state, credits FROM users WHERE id = $1',
            [req.userId]
        )

        const user = rows[0]
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                onboardingCompleted: user.onboarding_completed,
                onboardingState: user.onboarding_state || {},
                credits: user.credits
            }
        })
    } catch (err) {
        console.error('Complete onboarding error:', err)
        res.status(500).json({ error: 'Failed to complete onboarding' })
    }
})


// Get Agent Prompts
app.get('/api/agent-prompts', requireAuth, async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM agent_prompts WHERE user_id = $1', [req.userId])
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
app.post('/api/agent-prompts', requireAuth, async (req, res) => {
    const { prompts } = req.body // Expects array of { id, name, prompt }
    if (!Array.isArray(prompts)) return res.status(400).json({ error: 'Invalid data format' })

    try {
        await query('BEGIN')
        for (const p of prompts) {
            // Upsert with user_id
            await query(
                `INSERT INTO agent_prompts (agent_id, name, system_prompt, config, user_id) 
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (agent_id, user_id) 
                 DO UPDATE SET system_prompt = $3, name = $2, config = CASE WHEN $4::jsonb IS NOT NULL THEN $4 ELSE agent_prompts.config END, updated_at = NOW()`,
                [p.id, p.name, p.prompt, p.config || {}, req.userId]
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
app.get('/api/agents/config', requireAuth, async (req, res) => {
    try {
        const { rows } = await query("SELECT * FROM agent_prompts WHERE user_id = $1", [req.userId])
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
app.post('/api/agents/config', requireAuth, async (req, res) => {
    const { agentKey, instructions, enabledToolIds, linkedFileIds } = req.body

    try {
        const name = agentKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

        const configObj = {
            enabledToolIds: enabledToolIds || [],
            linkedFileIds: linkedFileIds || []
        }

        await query(
            `INSERT INTO agent_prompts (agent_id, name, system_prompt, config, user_id) 
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (agent_id, user_id) DO UPDATE SET 
                system_prompt = EXCLUDED.system_prompt,
                config = agent_prompts.config || EXCLUDED.config,
                updated_at = NOW()`,
            [agentKey, name, instructions, configObj, req.userId]
        )

        res.json({ success: true })
    } catch (err) {
        console.error('Failed to save agent config:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// --- Knowledge Base & Files ---

// 1. Create Internal Strategy Guide & Vector Store
app.post('/api/knowledge/create-internal', requireAuth, async (req, res) => {
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
        const { rows } = await query("SELECT value FROM system_config WHERE user_id = $1 AND key = 'default_vector_store'", [req.userId])

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
                `INSERT INTO system_config (key, value, user_id) VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = NOW()`,
                ['default_vector_store', { id: vectorStoreId }, req.userId]
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
app.get('/api/knowledge/files', requireAuth, async (req, res) => {
    try {
        // Get Default Vector Store ID for this user
        const { rows } = await query("SELECT value FROM system_config WHERE user_id = $1 AND key = 'default_vector_store'", [req.userId])
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
app.get('/api/crm-columns', requireAuth, async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM crm_columns WHERE user_id = $1 ORDER BY created_at ASC', [req.userId])
        res.json(rows)
    } catch (err) {
        console.error('Failed to fetch columns:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Save CRM Columns
app.post('/api/crm-columns', requireAuth, async (req, res) => {
    const { columns } = req.body
    if (!Array.isArray(columns)) return res.status(400).json({ error: 'Invalid data' })
    try {
        await query('BEGIN')
        await query('DELETE FROM crm_columns WHERE user_id = $1', [req.userId])
        for (const col of columns) {
            await query(
                `INSERT INTO crm_columns (column_name, column_type, is_required, user_id) VALUES ($1, $2, $3, $4)`,
                [col.name, col.type, col.required, req.userId]
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
app.get('/api/leads', requireAuth, async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM leads WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.userId])
        res.json(rows)
    } catch (err) {
        console.error('Failed to fetch leads:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Create/Update Lead
app.post('/api/leads', requireAuth, async (req, res) => {
    const { leads } = req.body // Array of leads
    if (!Array.isArray(leads)) return res.status(400).json({ error: 'Invalid data' })

    try {
        await query('BEGIN')
        for (const lead of leads) {
            await query(
                `INSERT INTO leads (company_name, person_name, email, job_title, linkedin_url, status, custom_data, source, user_id)
                 VALUES ($1, $2, $3, $4, $5, 'NEW', $6, $7, $8)`,
                [
                    lead.company_name,
                    lead.first_name ? `${lead.first_name} ${lead.last_name}` : lead.person_name,
                    lead.email,
                    lead.title,
                    lead.linkedin_url,
                    JSON.stringify(lead.custom_data || {}),
                    'Automation',
                    req.userId
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
app.delete('/api/leads/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    try {
        await query('DELETE FROM leads WHERE id = $1 AND user_id = $2', [id, req.userId])
        res.json({ success: true })
    } catch (err) {
        console.error('Failed to delete lead:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Clear All Leads
app.post('/api/leads/clear', requireAuth, async (req, res) => {
    try {
        await query('DELETE FROM leads WHERE user_id = $1', [req.userId])
        res.json({ success: true })
    } catch (err) {
        console.error('Failed to clear leads:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// --- WORKFLOW LOGGING ---

// Get Workflow Runs
app.get('/api/runs', requireAuth, async (req, res) => {
    try {
        // Fetch runs with their latest result (if any)
        const { rows } = await query(`
            SELECT 
                wr.*, 
                ar.output_data 
            FROM workflow_runs wr
            LEFT JOIN agent_results ar ON wr.id = ar.run_id
            WHERE wr.user_id = $1
            ORDER BY wr.started_at DESC
            LIMIT 50
        `, [req.userId])
        res.json(rows)
    } catch (err) {
        console.error('Failed to fetch runs:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Start Run
app.post('/api/runs/start', requireAuth, async (req, res) => {
    const { agent_id, metadata } = req.body
    try {
        const { rows } = await query(
            `INSERT INTO workflow_runs (agent_id, status, started_at, metadata, user_id) VALUES ($1, 'RUNNING', NOW(), $2, $3) RETURNING id`,
            [agent_id, metadata, req.userId]
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

// --- ICP MANAGEMENT ENDPOINTS ---

// Get all ICPs for logged-in user
app.get('/api/icps', requireAuth, async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT * FROM icps WHERE user_id = $1 ORDER BY created_at DESC',
            [req.userId]
        )
        res.json({ icps: rows })
    } catch (err) {
        console.error('Failed to fetch ICPs:', err)
        res.status(500).json({ error: 'Failed to fetch ICPs' })
    }
})

// Create new ICP
app.post('/api/icps', requireAuth, async (req, res) => {
    const { name, config, agent_config } = req.body

    // Check limit
    try {
        const countRes = await query('SELECT COUNT(*) FROM icps WHERE user_id = $1', [req.userId])
        if (parseInt(countRes.rows[0].count) >= 3) {
            return res.status(403).json({ error: 'ICP limit reached (Max 3).' })
        }

        const { rows } = await query(
            `INSERT INTO icps (user_id, name, config, agent_config)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [req.userId, name, config || {}, agent_config || {}]
        )
        res.json({ success: true, icp: rows[0] })
    } catch (err) {
        console.error('Failed to create ICP:', err)
        res.status(500).json({ error: 'Failed to create ICP' })
    }
})

// Update ICP
app.put('/api/icps/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const { name, config, agent_config } = req.body

    try {
        // Verify ownership
        const verify = await query('SELECT id FROM icps WHERE id = $1 AND user_id = $2', [id, req.userId])
        if (verify.rows.length === 0) return res.status(404).json({ error: 'ICP not found' })

        // Build dynamic update
        // Simplify: just update provided fields
        const updates = []
        const values = []
        let idx = 1

        if (name) { updates.push(`name = $${idx++}`); values.push(name) }
        if (config) { updates.push(`config = $${idx++}`); values.push(config) }
        if (agent_config) { updates.push(`agent_config = $${idx++}`); values.push(agent_config) }

        if (updates.length > 0) {
            values.push(id) // ID is last param
            await query(
                `UPDATE icps SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
                values
            )
            const updatedRow = (await query('SELECT * FROM icps WHERE id = $1', [id])).rows[0]
            res.json({ success: true, icp: updatedRow })
        } else {
            const existing = await query('SELECT * FROM icps WHERE id = $1', [id])
            res.json({ success: true, icp: existing.rows[0] })
        }
    } catch (err) {
        console.error('Failed to update ICP:', err)
        res.status(500).json({ error: 'Failed to update ICP' })
    }
})

// --- FEEDBACK ENDPOINTS ---

app.post('/api/runs/:runId/feedback', requireAuth, async (req, res) => {
    const { runId } = req.params
    const { icpId, feedbacks } = req.body // feedbacks is array of { entity_type, entity_identifier, grade, notes }

    // Validate ownership of run?
    // For MVP, just insert.

    if (!feedbacks || !Array.isArray(feedbacks)) return res.status(400).json({ error: 'Invalid feedback format' });

    try {
        await query('BEGIN')
        for (const fb of feedbacks) {
            await query(
                `INSERT INTO run_feedback (run_id, icp_id, entity_type, entity_identifier, grade, notes)
                  VALUES ($1, $2, $3, $4, $5, $6)`,
                [runId, icpId, fb.entity_type, fb.entity_identifier, fb.grade, fb.notes]
            )
        }
        await query('COMMIT')
        res.json({ success: true })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to save feedback:', err)
        res.status(500).json({ error: 'Failed to save feedback' })
    }
})


// Trigger Optimization Loop
app.post('/api/icps/:id/optimize', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const optimizer = new OptimizationService(req.userId, id);
        const result = await optimizer.optimize();
        res.json(result);
    } catch (err) {
        console.error('Optimization failed:', err);
        res.status(500).json({ error: 'Optimization failed', details: err.message });
    }
});

// Trigger Analysis Run (SSE Streaming)
app.post('/api/agents/run', requireAuth, async (req, res) => {
    let { prompt, vectorStoreId, agentConfigs, mode, filters, idempotencyKey, icpId } = req.body
    console.log(`Starting live workflow (Mode: ${mode || 'default'}) with prompt:`, prompt)
    if (idempotencyKey) console.log(`🔑 Idempotency Key received: ${idempotencyKey}`)
    if (icpId) console.log(`📋 Running for ICP ID: ${icpId}`)

    // NEW: If icpId is provided, fetch latest optimized config from DB
    if (icpId) {
        try {
            const { rows } = await query('SELECT agent_config FROM icps WHERE id = $1', [icpId]);
            if (rows.length > 0) {
                const storedConfig = rows[0].agent_config || {};
                // Merge stored config if it has optimizations
                // Priority: Stored Config (Optimized) > Frontend Config (User Input) > Defaults
                if (storedConfig.optimized_instructions) {
                    // We need to decide where to inject this. 
                    // workflow.js uses agentConfigs['company_finder'] etc.
                    // Let's assume we overwrite the 'company_finder' instructions or pass a global override.

                    // For now, let's inject it into a specific key if defined, or just log it.
                    // workflow.js looks for agentPrompts from DB.
                    // Let's pass it as a special override in agentConfigs.
                    if (!agentConfigs) agentConfigs = {};
                    agentConfigs['company_finder'] = {
                        ...agentConfigs['company_finder'],
                        instructions: storedConfig.optimized_instructions
                    };
                    // Apply exclusions too
                    if (storedConfig.exclusions && Array.isArray(storedConfig.exclusions)) {
                        // We might need to pass this to filters?
                        // filters = { ...filters, exclusions: storedConfig.exclusions };
                        // Or append to prompt?
                        prompt += `\n\n[OPTIMIZATION EXCLUSIONS]:\n${storedConfig.exclusions.join(', ')}`;
                    }
                    console.log("✅ Applied optimized instructions and exclusions from DB.");
                }
            }
        } catch (e) {
            console.warn("Failed to load ICP config", e);
        }
    }

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
            `INSERT INTO workflow_runs (agent_id, status, started_at, metadata, user_id, icp_id) 
             VALUES ('main_workflow', 'RUNNING', NOW(), $1, $2, $3) RETURNING id`,
            [JSON.stringify({ prompt, vectorStoreId, mode: mode || 'default', idempotencyKey }), req.userId, icpId]
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
            userId: req.userId, // NEW: Pass authenticated user ID for company tracking
            icpId: icpId, // NEW: Pass ICP ID for lead tracking
            targetLeads: req.body.targetLeads || 50, // NEW: Total leads target
            maxLeadsPerCompany: req.body.maxLeadsPerCompany || 3, // NEW: Max per company
            agentConfigs: agentConfigs || {},
            mode: mode, // Pass mode to workflow
            filters: filters || {}, // Pass filters from onboarding
            idempotencyKey: idempotencyKey, // NEW: Pass idempotency key
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



        // Multi-ICP Tables
        await query(`
            CREATE TABLE IF NOT EXISTS icps(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    config JSONB DEFAULT '{}':: jsonb,
    agent_config JSONB DEFAULT '{}':: jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`)

        await query(`
            CREATE TABLE IF NOT EXISTS run_feedback(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID REFERENCES workflow_runs(id),
    icp_id UUID REFERENCES icps(id),
    entity_type VARCHAR(50) NOT NULL,
    entity_identifier VARCHAR(255),
    grade VARCHAR(20),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`)

        // Add columns to existing tables if needed
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id); `)
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id); `)
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id); `)
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id); `)

        // Migration: Add phone_numbers if not exists
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_numbers JSONB DEFAULT '[]'::jsonb;`)

        console.log('Database Schema Verified.')
    } catch (err) {
        console.error('Failed to initialize DB:', err)
    }
}

// Enrich Lead (Phone)
app.post('/api/leads/:id/enrich-phone', requireAuth, async (req, res) => {
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

const upload = multer({ storage: multer.memoryStorage() })

app.post('/api/leads/import', requireAuth, upload.single('file'), async (req, res) => {
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
        })).filter(l => l.email || l.linkedin_url)

        await query('BEGIN')
        for (const lead of leads) {
            await query(
                `INSERT INTO leads(company_name, person_name, email, job_title, linkedin_url, status, custom_data, source, user_id)
                     VALUES($1, $2, $3, $4, $5, 'NEW', $6, $7, $8)
                     ON CONFLICT(email) DO NOTHING`,
                [
                    lead.company_name,
                    lead.person_name,
                    lead.email,
                    lead.title,
                    lead.linkedin_url,
                    JSON.stringify(lead.custom_data),
                    lead.source,
                    req.userId
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


