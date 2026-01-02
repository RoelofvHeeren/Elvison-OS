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

// Connectivity Test
app.get('/api/test/gemini', async (req, res) => {
    try {
        const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!key) return res.status(400).json({ error: "Missing GOOGLE_API_KEY" });

        const sanitizedKey = key.trim().replace(/[\s\r\n\t]/g, '');
        const google = (await import('@ai-sdk/google')).createGoogleGenerativeAI({ apiKey: sanitizedKey });
        const { text } = await (await import('ai')).generateText({
            model: google('gemini-2.0-flash'),
            prompt: 'Say "Gemini is connected!"',
        });
        res.json({ success: true, response: text, keySignature: `${sanitizedKey.substring(0, 7)}...${sanitizedKey.substring(sanitizedKey.length - 4)}` });
    } catch (e) {
        res.status(500).json({ error: e.message, data: e.data });
    }
});

// TEMP: Cleanup Endpoint
app.post('/api/admin/cleanup', async (req, res) => {
    try {
        console.log('Starting cleanup...');

        // 1. Delete Blackstone leads with missing outreach
        const blackstoneRes = await query(`
            DELETE FROM leads 
            WHERE company_name ILIKE '%blackstone%' 
            AND (outreach_status IS NULL OR outreach_status = 'failed_generation')
            RETURNING id;
        `);

        // 2. Delete obvious bad titles created in last 24h
        const badKeywords = [
            'intern', 'student', 'assistant', 'coordinator', 'hr', 'human resources',
            'talent', 'recruiting', 'events', 'operations', 'cybersecurity',
            'technician', 'support', 'administrative', 'admin', 'clerk'
        ];

        const titleConditions = badKeywords.map(k => `title ILIKE '%${k}%'`).join(' OR ');

        const badTitleRes = await query(`
            DELETE FROM leads 
            WHERE created_at > NOW() - INTERVAL '24 hours'
            AND (${titleConditions})
            returning id;
        `);

        res.json({
            success: true,
            deletedBlackstone: blackstoneRes.rowCount,
            deletedBadTitles: badTitleRes.rowCount,
            message: `Cleaned ${blackstoneRes.rowCount} Blackstone leads and ${badTitleRes.rowCount} bad title leads.`
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

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
import { Runner } from "@openai/agents";
import { OutreachService } from "./src/backend/services/outreach-service.js";
import { createOutreachAgent } from "./src/backend/agent-setup.js";

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

// 4. Create New ICP Strategy
app.post('/api/icps', requireAuth, async (req, res) => {
    const { name, config, agent_config } = req.body

    if (!name) return res.status(400).json({ error: 'ICP Name is required' })

    try {
        const { rows } = await query(
            `INSERT INTO icps (user_id, name, config, agent_config) 
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, created_at`,
            [req.userId, name, config || {}, agent_config || {}]
        )
        res.json({ success: true, icp: rows[0] })
    } catch (err) {
        console.error('Failed to create ICP:', err)
        res.status(500).json({ error: 'Database error' })
    }
})


// 5. Enrich Lead (LeadMagic)
app.post('/api/leads/:id/enrich', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Get Lead
        const { rows } = await query('SELECT * FROM leads WHERE id = $1', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Lead not found' });

        const lead = rows[0];

        // 2. Validate
        if (!lead.linkedin_url) {
            return res.status(400).json({ error: 'Lead is missing LinkedIn URL' });
        }

        // 3. Call LeadMagic
        const enrichedData = await leadMagic.enrichByLinkedin(lead.linkedin_url);

        if (!enrichedData) {
            return res.json({ success: false, message: 'No mobile number found' });
        }

        // 4. Update Database
        // Append new numbers to existing phone_numbers JSONB array
        let existingPhones = lead.phone_numbers || [];
        if (!Array.isArray(existingPhones)) existingPhones = [];

        // Check if we already have this number to avoid dupes
        const newNumber = enrichedData.mobile_phone;
        const exists = existingPhones.some(p => p.number === newNumber);

        if (!exists && newNumber) {
            existingPhones.push({
                type: 'mobile',
                number: newNumber,
                source: 'LeadMagic',
                added_at: new Date().toISOString()
            });

            // Also add work phone if present
            if (enrichedData.work_phone) {
                existingPhones.push({ type: 'work', number: enrichedData.work_phone, source: 'LeadMagic' });
            }

            await query(
                `UPDATE leads SET phone_numbers = $1, status = 'ENRICHED', updated_at = NOW() WHERE id = $2`,
                [JSON.stringify(existingPhones), id]
            );

            return res.json({ success: true, phones: existingPhones });
        } else {
            return res.json({ success: true, message: 'Number already exists or invalid', phones: existingPhones });
        }

    } catch (err) {
        console.error('Enrichment failed:', err);
        res.status(500).json({ error: err.message || 'Enrichment failed' });
    }
});
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

// Get Leads with Pagination
app.get('/api/leads', requireAuth, async (req, res) => {
    const { status, page = 1, pageSize = 100 } = req.query;

    try {
        // Parse and validate pagination params
        const pageNum = Math.max(1, parseInt(page) || 1);
        const pageSizeNum = Math.min(500, Math.max(1, parseInt(pageSize) || 100)); // Max 500 per page for performance
        const offset = (pageNum - 1) * pageSizeNum;

        // Build base query
        let queryStr = 'SELECT * FROM leads WHERE user_id = $1';
        const params = [req.userId];
        let countParams = [req.userId];

        if (status) {
            queryStr += ' AND status = $2';
            params.push(status);
            countParams.push(status);
        } else {
            // Default: Hide disqualified
            queryStr += " AND status != 'DISQUALIFIED'";
        }

        // Get total count for pagination metadata
        const countQuery = queryStr.replace('SELECT *', 'SELECT COUNT(*)');
        const { rows: countRows } = await query(countQuery, countParams);
        const totalCount = parseInt(countRows[0].count);
        const totalPages = Math.ceil(totalCount / pageSizeNum);

        // Add pagination
        queryStr += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(pageSizeNum, offset);

        const { rows } = await query(queryStr, params);

        // Return data with pagination metadata
        res.json({
            data: rows,
            pagination: {
                page: pageNum,
                pageSize: pageSizeNum,
                total: totalCount,
                totalPages: totalPages,
                hasNext: pageNum < totalPages,
                hasPrevious: pageNum > 1
            }
        });
    } catch (err) {
        console.error('Failed to fetch leads:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Approve Lead (Restore from Logbook)
app.post('/api/leads/:id/approve', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason required' });
    try {
        // 1. Fetch Lead
        const { rows } = await query('SELECT * FROM leads WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Lead not found' });

        let lead = rows[0];

        await query(
            `INSERT INTO lead_feedback (lead_id, user_id, reason, original_status, new_status) VALUES ($1, $2, $3, $4, 'NEW')`,
            [id, req.userId, reason, lead.status]
        );

        // 2. Generate Outreach
        // Need configs to get custom instructions
        const promptRes = await query('SELECT system_prompt FROM agent_prompts WHERE agent_id = $1 AND user_id = $2', ['outreach_creator', req.userId]);
        const customInstructions = promptRes.rows[0]?.system_prompt;

        const runner = new Runner();
        const agent = createOutreachAgent(customInstructions); // Tools default to empty for now
        const service = new OutreachService(runner);

        // Normalize lead for Agent
        const leadForAgent = {
            date_added: new Date().toISOString(),
            first_name: lead.person_name?.split(' ')[0] || '',
            last_name: lead.person_name?.split(' ').slice(1).join(' ') || '',
            company_name: lead.company_name,
            title: lead.job_title,
            email: lead.email,
            linkedin_url: lead.linkedin_url,
            company_website: lead.custom_data?.company_website || '',
            company_profile: lead.custom_data?.company_profile || ''
        };

        console.log(`Generating outreach for approved lead ${id}...`);
        const enrichedLeads = await service.generateOutreach([leadForAgent], agent, (msg) => console.log(`[Approval] ${msg}`));

        let updates = { status: 'NEW', source_notes: 'Approved from Logbook' };
        if (enrichedLeads.length > 0) {
            const result = enrichedLeads[0];
            if (result.email_message) updates.email_message = result.email_message;
            if (result.connection_request) updates.connection_request = result.connection_request;
        }

        // 3. Update DB
        // Update status
        await query('UPDATE leads SET status = $1 WHERE id = $2', ['NEW', id]);

        // Update custom_data with message
        if (enrichedLeads.length > 0) {
            const r = enrichedLeads[0];
            const newCustomData = {
                ...lead.custom_data,
                email_message: r.email_message,
                connection_request: r.connection_request,
                restored_at: new Date().toISOString()
            };
            await query('UPDATE leads SET custom_data = $1 WHERE id = $2', [newCustomData, id]);
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Approval failed:', err);
        res.status(500).json({ error: 'Approval failed' });
    }
});

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
                ar.output_data,
                i.name as icp_name
            FROM workflow_runs wr
            LEFT JOIN agent_results ar ON wr.id = ar.run_id
            LEFT JOIN icps i ON wr.icp_id = i.id
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

// Get Single Run Status (for resumption)
app.get('/api/runs/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await query(`
            SELECT 
                wr.*, 
                ar.output_data
            FROM workflow_runs wr
            LEFT JOIN agent_results ar ON wr.id = ar.run_id
            WHERE wr.id = $1 AND wr.user_id = $2
        `, [id, req.userId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Run not found' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Failed to fetch run:', err);
        res.status(500).json({ error: 'Database error' });
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
import { startApolloDomainScrape, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';

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
        const runId = await startApolloDomainScrape(effectiveToken, domains, filters);
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
        // Determine Run Name & Number
        let runName = `Run ${new Date().toLocaleTimeString()}`; // Fallback
        let runNumber = 1;

        if (icpId) {
            // Get ICP Name
            const icpRes = await query('SELECT name FROM icps WHERE id = $1', [icpId]);
            const icpName = icpRes.rows[0]?.name || 'Unknown ICP';

            // Get Max Run Number for this ICP
            const countRes = await query('SELECT MAX(run_number) as max_num FROM workflow_runs WHERE icp_id = $1', [icpId]);
            runNumber = (countRes.rows[0]?.max_num || 0) + 1;
            runName = `${icpName} #${runNumber}`;
        } else {
            // Generic runs
            const countRes = await query('SELECT MAX(run_number) as max_num FROM workflow_runs WHERE user_id = $1 AND icp_id IS NULL', [req.userId]);
            runNumber = (countRes.rows[0]?.max_num || 0) + 1;
            runName = `Manual Run #${runNumber}`;
        }

        const { rows } = await query(
            `INSERT INTO workflow_runs (agent_id, status, started_at, metadata, user_id, icp_id, run_name, run_number) 
             VALUES ('main_workflow', 'RUNNING', NOW(), $1, $2, $3, $4, $5) RETURNING id`,
            [JSON.stringify({ prompt, vectorStoreId, mode: mode || 'default', idempotencyKey }), req.userId, icpId, runName, runNumber]
        )
        runId = rows[0].id
        // Send initial connection confirmation
        res.write(`event: run_id\ndata: ${JSON.stringify({ runId })}\n\n`)
        res.write(`event: log\ndata: {"step": "System", "detail": "Workflow initialized. Run ID: ${runId}", "timestamp": "${new Date().toISOString()}"}\n\n`)
    } catch (err) {
        console.error('Failed to init run:', err)
        res.write(`event: error\ndata: {"message": "Database initialization failed"}\n\n`)
        return res.end()
    }

    // 3. Execute Workflow with Streaming Listeners
    const localExecutionLogs = []; // Capture logs for persistence
    try {
        const result = await runAgentWorkflow({ input_as_text: prompt }, {
            vectorStoreId: vectorStoreId,
            userId: req.userId,
            icpId: icpId,
            targetLeads: req.body.targetLeads || 50,
            maxLeadsPerCompany: req.body.maxLeadsPerCompany || 3,
            agentConfigs: agentConfigs || {},
            mode: mode,
            filters: filters || {},
            idempotencyKey: idempotencyKey,
            listeners: {
                onLog: async (logParams) => {
                    const timestamp = new Date().toISOString();
                    const eventData = JSON.stringify({
                        step: logParams.step,
                        detail: logParams.detail,
                        timestamp
                    })
                    res.write(`event: log\ndata: ${eventData}\n\n`)

                    // Capture for DB persistence
                    localExecutionLogs.push({
                        timestamp,
                        stage: logParams.step,
                        message: logParams.detail,
                        status: 'INFO',
                        details: logParams
                    });
                }
            }
        })

        // SUCCESS PATH: Save logs, stats, and output to database
        console.log('Workflow completed successfully, saving results...');

        try {
            // Build stats object from workflow result
            const workflowStats = result.stats || {};
            const costData = workflowStats.cost || {};

            // Build comprehensive stats object for DB storage
            const statsForDB = {
                // Basic counts
                companies_discovered: result.leads?.length || 0,
                leads_returned: result.leads?.length || 0,
                total: workflowStats.total || 0,
                attempts: workflowStats.attempts || 0,

                // Cost data (from CostTracker.getSummary())
                cost: costData.cost || { total: 0, formatted: '$0.00' },
                tokens: costData.tokens || { input: 0, output: 0, total: 0 },
                breakdown: costData.breakdown || { byAgent: {}, byModel: {} },
                calls: costData.calls || [],
                totalCalls: costData.totalCalls || 0,

                // Execution timeline logs
                execution_timeline: localExecutionLogs,
                execution_logs: localExecutionLogs
            };

            console.log(`[Server] Saving stats with ${localExecutionLogs.length} log entries and ${statsForDB.calls?.length || 0} API calls`);

            // Save output to agent_results
            const outputDataForStorage = {
                leads: result.leads || [],
                status: result.status,
                execution_logs: localExecutionLogs,
                execution_timeline: localExecutionLogs
            };

            // Delete existing result if any, then insert (no unique constraint on run_id)
            await query(`DELETE FROM agent_results WHERE run_id = $1`, [runId]);
            await query(
                `INSERT INTO agent_results (run_id, output_data) VALUES ($1, $2)`,
                [runId, JSON.stringify(outputDataForStorage)]
            );

            // Update workflow_runs with stats
            await query(
                `UPDATE workflow_runs SET status = 'COMPLETED', completed_at = NOW(), stats = $2 WHERE id = $1`,
                [runId, JSON.stringify(statsForDB)]
            );

            // Send success event
            res.write(`event: complete\ndata: ${JSON.stringify({
                status: 'success',
                leads: result.leads?.length || 0,
                cost: costData.cost?.formatted || '$0.00'
            })}\n\n`);

        } catch (dbErr) {
            console.error('Failed to save success results:', dbErr);
            res.write(`event: error\ndata: {"message": "Results saved but DB commit failed: ${dbErr.message}"}\n\n`);
        }


    } catch (error) {
        console.error('Workflow failed:', error);

        // CRITICAL: Extract cost data from error.stats (attached by workflow.js catch block)
        const errorStats = error.stats || {};
        const costData = errorStats.cost || {};

        // Build comprehensive stats object for DB storage (same structure as success path)
        const statsForDB = {
            partialStats: true,
            error: error.message,
            // Cost data (from CostTracker.getSummary() attached to error)
            cost: costData.cost || { total: 0, formatted: '$0.00' },
            tokens: costData.tokens || { input: 0, output: 0, total: 0 },
            breakdown: costData.breakdown || { byAgent: {}, byModel: {} },
            calls: costData.calls || [],
            totalCalls: costData.totalCalls || 0,
            // Execution timeline logs
            execution_timeline: localExecutionLogs,
            execution_logs: localExecutionLogs
        };

        console.log(`[Server] Saving FAILURE stats with ${localExecutionLogs.length} log entries and ${statsForDB.calls?.length || 0} API calls`);

        try {
            if (runId) {
                // Save whatever logs we captured before failure
                const outputDataForStorage = {
                    execution_logs: localExecutionLogs,
                    execution_timeline: localExecutionLogs,
                    error: error.message
                };

                // Delete existing result if any, then insert (no unique constraint on run_id)
                await query(`DELETE FROM agent_results WHERE run_id = $1`, [runId]);
                await query(
                    `INSERT INTO agent_results (run_id, output_data) VALUES ($1, $2)`,
                    [runId, JSON.stringify(outputDataForStorage)]
                );

                await query(
                    `UPDATE workflow_runs SET status = 'FAILED', completed_at = NOW(), error_log = $2, stats = $3 WHERE id = $1`,
                    [runId, error.message || String(error), JSON.stringify(statsForDB)]
                );
            }
        } catch (dbErr) {
            console.error("DB update failed during error handling", dbErr);
        }

        res.write(`event: error\ndata: {"message": "${error.message || 'Workflow execution failed'}"}\n\n`);
    } finally {
        res.end();
    }
})

/**
 * Workflow Cancellation Endpoint
 * Updates run status to CANCELLED, which worker polls
 */
app.post('/api/workflow/cancel', requireAuth, async (req, res) => {
    const { runId } = req.body;
    if (!runId) return res.status(400).json({ error: "Missing runId" });

    try {
        await query(`UPDATE workflow_runs SET status = 'CANCELLED' WHERE id = $1`, [runId]);
        res.json({ status: 'success', message: 'Run cancellation signaled.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
})

// 6. Get Run Logs (New)
app.get('/api/runs/:id/logs', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await query(`
            SELECT * FROM workflow_logs 
            WHERE run_id = $1 
            ORDER BY created_at ASC
        `, [id]);
        res.json({ logs: rows });
    } catch (e) {
        console.error("Failed to fetch logs:", e);
        res.status(500).json({ error: e.message });
    }
});

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
`);

        // Company Tracking Table (Migration 05)
        await query(`
            CREATE TABLE IF NOT EXISTS researched_companies (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
                company_name VARCHAR(255) NOT NULL,
                domain VARCHAR(255),
                status VARCHAR(50) DEFAULT 'researched', -- 'researched', 'contacted'
                lead_count INTEGER DEFAULT 0,
                metadata JSONB DEFAULT '{}'::jsonb,
                researched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                contacted_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(user_id, domain)
            );
            CREATE INDEX IF NOT EXISTS idx_researched_companies_user_id ON researched_companies(user_id);
            CREATE INDEX IF NOT EXISTS idx_researched_companies_domain ON researched_companies(domain);
        `);

        // Add columns to existing tables if needed
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id); `)
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id); `)
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id); `)
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id); `)

        // Migration: Add phone_numbers if not exists
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_numbers JSONB DEFAULT '[]'::jsonb;`)

        // Migration: Add stats column to workflow_runs for logbook metrics
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS stats JSONB;`)

        // Migration: Add source_notes column to leads table (used for disqualified leads tracking)
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_notes TEXT;`)


        // Create Lead Feedback Table (Migration 06)
        await query(`
            CREATE TABLE IF NOT EXISTS lead_feedback (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id),
                reason TEXT NOT NULL,
    original_status VARCHAR(50),
                new_status VARCHAR(50),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_lead_feedback_lead_id ON lead_feedback(lead_id);
        `);

        // Migration: "Zombie Lead" Cleanup
        // DISABLED: This migration was TOO aggressive - it marked ALL leads without connection requests as zombies,
        // including high-quality VPs/EVPs that were recently imported and haven't had outreach yet.
        // TODO: Reimplement with proper filters:
        // - Only leads imported >30 days ago
        // - Must also lack email
        // - Skip if title contains VP/President/Director/CEO/CIO/COO
        /*
        const zombieRes = await query(`
            UPDATE leads 
            SET status = 'DISQUALIFIED', source_notes = 'Archived: No connection request sent (Zombie)'
            WHERE status = 'NEW' 
            AND (custom_data->>'connection_request' IS NULL OR custom_data->>'connection_request' = '')
            AND source != 'Import'
        `);
        if ( zombieRes.rowCount > 0) {
            console.log(`🧹 Migrated ${zombieRes.rowCount} zombie leads to DISQUALIFIED.`);
        }
        */

        // Migration 07: Logbook Enhancements (Granular Logs & naming)
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS run_name VARCHAR(255);`);
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS run_number INTEGER;`);

        await query(`
            CREATE TABLE IF NOT EXISTS workflow_logs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                run_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
                agent_name VARCHAR(100),
                model_name VARCHAR(100),
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cost DECIMAL(12, 6) DEFAULT 0,
                duration_seconds DECIMAL(10, 2),
                metadata JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_workflow_logs_run_id ON workflow_logs(run_id);
        `);

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
        console.log("✅ SERVER.JS - LOG PERSISTENCE V2 & CLAUDE FIX ACTIVE");
    })
})
