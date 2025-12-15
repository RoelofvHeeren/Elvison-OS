import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { query } from './db/index.js'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const app = express()
const port = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// --- API Endpoints ---

// Get Agent Prompts
app.get('/api/agent-prompts', async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM agent_prompts')
        // Convert rows array to object keyed by agent_id for frontend compatibility
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
    const { prompts } = req.body // { agentId: promptText }
    if (!prompts) return res.status(400).json({ error: 'Missing prompts data' })

    try {
        // Upsert each prompt
        for (const [agentId, promptText] of Object.entries(prompts)) {
            await query(
                `INSERT INTO agent_prompts (agent_id, name, system_prompt)
         VALUES ($1, $2, $3)
         ON CONFLICT (agent_id) 
         DO UPDATE SET system_prompt = $3, updated_at = NOW()`,
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

// Save CRM Columns (Bulk replace for simplicity in prototype)
app.post('/api/crm-columns', async (req, res) => {
    const { columns } = req.body // Array of columns
    if (!Array.isArray(columns)) return res.status(400).json({ error: 'Invalid data' })

    try {
        await query('BEGIN')
        await query('DELETE FROM crm_columns') // Clear existing for full sync

        for (const col of columns) {
            await query(
                `INSERT INTO crm_columns (column_name, column_type, is_required)
                 VALUES ($1, $2, $3)`,
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

// Helper to format agent ID to Name
function formatAgentName(id) {
    return id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

// Start Server
app.listen(port, () => {
    console.log(`Server running on port ${port}`)
})
