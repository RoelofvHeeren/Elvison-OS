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
    const { prompts } = req.body
    if (!prompts) return res.status(400).json({ error: 'Missing prompts data' })
    try {
        for (const [agentId, promptText] of Object.entries(prompts)) {
            await query(
                `INSERT INTO agent_prompts (agent_id, name, system_prompt) VALUES ($1, $2, $3)
         ON CONFLICT (agent_id) DO UPDATE SET system_prompt = $3, updated_at = NOW()`,
                [agentId, formatAgentName(agentId), promptText]
            )
        }
        res.json({ success: true })
    } catch (err) {
        console.error('Failed to save prompts:', err)
        res.status(500).json({ error: 'Database error' })
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
app.post('/api/runs/start-workflow', async (req, res) => {
    const { prompt, agentConfigs } = req.body
    console.log('Starting workflow with prompt:', prompt)

    // Run asynchronously to not block the request
    // In a real production app, this should go to a job queue (Redis/Bull)
    // For now, we just start it and let it run in background.

    // Create initial run record
    let runId = null
    try {
        const { rows } = await query(
            `INSERT INTO workflow_runs (agent_id, status, started_at, metadata) VALUES ('main_workflow', 'RUNNING', NOW(), $1) RETURNING id`,
            [JSON.stringify({ prompt })]
        )
        runId = rows[0].id
        res.json({ success: true, run_id: runId, message: "Workflow started in background" })
    } catch (err) {
        console.error('Failed to start workflow run DB entry:', err)
        return res.status(500).json({ error: 'Database error starting run' })
    }

    // Execute Workflow
    (async () => {
        try {
            const result = await runAgentWorkflow({ input_as_text: prompt }, {
                agentConfigs: agentConfigs || {},
                listeners: {
                    onLog: async (logParams) => {
                        console.log(`[Workflow Step] ${logParams.step}: ${logParams.detail}`)
                        // Optional: Append to a logs table or update run metadata
                    }
                }
            })

            // On Success
            await query(
                `UPDATE workflow_runs SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1`,
                [runId]
            )
            await query(
                `INSERT INTO agent_results (run_id, output_data) VALUES ($1, $2)`,
                [runId, JSON.stringify(result)]
            )
            console.log('Workflow completed successfully:', runId)

        } catch (error) {
            console.error('Workflow failed:', error)
            await query(
                `UPDATE workflow_runs SET status = 'FAILED', completed_at = NOW(), error_log = $2 WHERE id = $1`,
                [runId, error.message || String(error)]
            )
        }
    })()
})

// Helper to format agent ID to Name
function formatAgentName(id) {
    return id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

// --- Catch-All for Frontend ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// Start Server
app.listen(port, () => {
    console.log(`Server running on port ${port}`)
})
