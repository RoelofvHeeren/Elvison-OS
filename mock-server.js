// Simple Express stub to simulate backend routes during local development.
// Run with: `node mock-server.js` (env vars from .env)
/* eslint-env node */

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import axios from 'axios'
import OpenAI from "openai"
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json())

const WORKFLOW_ID = process.env.WORKFLOW_ID
const WORKFLOW_VERSION = process.env.WORKFLOW_VERSION
const SHEET_MCP_BASE = 'https://final-sheet-mcp-production.up.railway.app'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const CONNECTION_STORE = new Map()
const TOKEN_STORE = new Map()
const client = new OpenAI({ apiKey: OPENAI_API_KEY })
console.log('Available client keys:', Object.keys(client))

async function workflowHealthCheck() {
  try {
    const run = await client.workflows.runs.create({
      workflow_id: 'wf_69257604d1c081908d6258389947f9de0365b387e2a1c674',
      version: '20',
      input: { input_as_text: 'health check' },
    })
    console.log('Health check OK', run.id)
  } catch (err) {
    console.error('Health check error:', err.response?.data || err.message)
  }
}

const normalizeSheetId = (sheetUrlOrId = '') => {
  if (!sheetUrlOrId) return ''
  const match = sheetUrlOrId.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return match?.[1] || sheetUrlOrId
}

const generateState = () => crypto.randomBytes(16).toString('hex')

const validateConnectionPayload = (payload) => {
  const {
    sheetUrlOrId,
    sheetName,
    agentWorkflowId,
    agentWorkflowVersion,
    openaiApiKey,
    sheetMcpUrl,
  } = payload || {}

  const missing = [
    !sheetUrlOrId && 'Google Sheet URL or ID',
    !agentWorkflowId && 'Agent Workflow ID',
    !agentWorkflowVersion && 'Agent Workflow Version',
    !openaiApiKey && 'OpenAI API Key',
    // sheetMcpUrl optional when using Google Sheets API
  ].filter(Boolean)

  return {
    missing,
    normalized: {
      sheetId: normalizeSheetId(sheetUrlOrId),
      sheetName: sheetName || 'AI Lead Sheet',
      agentWorkflowId,
      agentWorkflowVersion,
      openaiApiKey,
      sheetMcpUrl: sheetMcpUrl?.replace(/\/$/, '') || '',
      mcpApiKey: payload?.mcpApiKey,
    },
  }
}

const getActiveConnection = () => {
  const saved = CONNECTION_STORE.get('defaultUser')
  if (saved?.sheetId && saved?.sheetName && saved?.sheetMcpUrl) {
    return saved
  }
  return {
    sheetId: process.env.SHEET_ID,
    sheetName: 'AI Lead Sheet',
    sheetMcpUrl: process.env.SHEET_MCP_URL,
    mcpApiKey: process.env.MCP_API_KEY,
  }
}

const ensureGoogleAccessToken = async () => {
  const tokens = TOKEN_STORE.get('defaultUserTokens')
  if (!tokens?.access_token) return null
  if (!tokens.refresh_token) return tokens.access_token

  // Simple refresh check (always refresh to be safe)
  try {
    const refreshed = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GSHEETS_CLIENT_ID,
        client_secret: process.env.GSHEETS_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    if (refreshed.ok) {
      const data = await refreshed.json()
      const merged = { ...tokens, ...data, createdAt: Date.now() }
      TOKEN_STORE.set('defaultUserTokens', merged)
      return merged.access_token
    }
  } catch (err) {
    console.error('Token refresh failed:', err)
  }
  return tokens.access_token
}

const proxyOpenAI = async (req, res) => {
  try {
    const url = `https://api.openai.com${req.originalUrl}`
    const response = await axios({
      url,
      method: req.method,
      headers: {
        ...req.headers,
        authorization: `Bearer ${OPENAI_API_KEY}`,
        'content-type': 'application/json',
        'OpenAI-Beta': req.headers['OpenAI-Beta'] || 'workflows=v1',
      },
      data: req.body,
      responseType: 'stream',
    })
    res.status(response.status)
    Object.entries(response.headers || {}).forEach(([k, v]) => res.setHeader(k, v))
    response.data.pipe(res)
  } catch (err) {
    const status = err.response?.status || 500
    const data = err.response?.data || err.message
    console.error('OpenAI error:', data)
    res.status(status).send(data)
  }
}

async function startJob(input_as_text) {
  try {
    const run = await client.workflows.runs.create({
      workflow_id: 'wf_69257604d1c081908d6258389947f9de0365b387e2a1c674',
      version: '20',
      input: { input_as_text },
    })
    return run
  } catch (err) {
    console.error('Start job exception:', err.response?.data || err.message)
    throw err
  }
}

const proxyMcp = (baseUrl) => async (req, res) => {
  try {
    const forwardPath = req.originalUrl.replace(/^\/sheet-mcp/, '')
    const url = `${baseUrl}${forwardPath}`
    const response = await axios({
      url,
      method: req.method,
      headers: {
        ...req.headers,
      },
      data: req.body,
      responseType: 'stream',
    })
    res.status(response.status)
    Object.entries(response.headers || {}).forEach(([k, v]) => res.setHeader(k, v))
    response.data.pipe(res)
  } catch (err) {
    const status = err.response?.status || 500
    const data = err.response?.data || err.message
    console.error('Proxy MCP error:', status, data)
    res.status(status).send(data)
  }
}

// GET /api/health - lightweight workflow ping (run creation with test input)
app.get('/api/health', async (req, res) => {
  try {
    await workflowHealthCheck()
    res.json({ agent: 'ok' })
  } catch (err) {
    console.error('Health check error:', err?.response?.data || err?.message)
    res.json({ agent: 'error' })
  }
})

// GET /api/leads using Google Sheets API
app.get('/api/leads', async (req, res) => {
  const active = getActiveConnection()
  try {
    const accessToken = await ensureGoogleAccessToken()
    if (!accessToken) {
      return res.status(401).json({ error: 'Not connected to Google' })
    }
    const range = `${active.sheetName || 'AI Lead Sheet'}!A1:Z`
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${active.sheetId}/values/${encodeURIComponent(
      range,
    )}`
    const leadsRes = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!leadsRes.ok) {
      const text = await leadsRes.text()
      console.error('Sheets API error:', leadsRes.status, text)
      return res.status(502).json({ error: 'Failed to load leads', detail: text })
    }

    const data = await leadsRes.json()
    res.json({ rows: data.values || [] })
  } catch (err) {
    console.error('Error reading leads:', err)
    res.status(500).json({ error: 'Failed to load leads' })
  }
})

// POST /api/start-job (uses saved connection workflow + key)
app.post('/api/start-job', async (req, res) => {
  const prompt = req.body?.prompt
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' })
  }
  try {
    const run = await startJob(prompt)
    res.json({ job_id: run?.id })
  } catch (err) {
    console.error('Start job exception:', err?.response?.data || err?.message)
    res.status(500).json({ error: 'Failed to start job', detail: err?.response?.data || err?.message })
  }
})

// GET /api/job-status/:jobId
app.get('/api/job-status/:jobId', async (req, res) => {
  const jobId = req.params.jobId

  try {
    const statusRes = await client.workflows.runs.retrieve(jobId)
    res.json(statusRes || {})
  } catch (err) {
    console.error('Job status fetch error:', err?.response?.data || err?.message)
    res.status(500).json({ error: 'Could not fetch job status' })
  }
})

// POST /api/run-leadgen
app.post('/api/run-leadgen', async (req, res) => {
  try {
    const inputText = req.body?.input_as_text || req.body?.prompt
    if (!inputText) {
      return res.status(400).json({ error: 'input_as_text (prompt) is required' })
    }
    const run = await startJob(inputText)
    res.json({ run })
  } catch (err) {
    console.error('Start job error:', err?.response?.data || err?.message)
    res.status(500).json({ error: err?.message || 'Failed to start job' })
  }
})

// Optional: write leads passthrough stub
app.post('/api/write-leads', (req, res) => {
  res.json({ ok: true, received: req.body?.rows ?? [] })
})

// GET /api/sheet/rows
app.get('/api/sheet/rows', async (req, res) => {
  const active = getActiveConnection()
  try {
    const accessToken = await ensureGoogleAccessToken()
    if (!accessToken) {
      return res.status(401).json({ error: 'Not connected to Google' })
    }
    const range = `${active.sheetName || 'AI Lead Sheet'}!A1:Z`
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${active.sheetId}/values/${encodeURIComponent(range)}`
    const rowsRes = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!rowsRes.ok) {
      const text = await rowsRes.text()
      console.error('Sheet rows fetch error:', rowsRes.status, text)
      return res.status(502).json({ error: 'Unable to load sheet rows', detail: text })
    }
    const data = await rowsRes.json()
    const values = data?.values || []
    res.json({ rows: values, sheetName: active.sheetName, sheetId: active.sheetId })
  } catch (err) {
    console.error('Sheet rows exception:', err)
    res.status(500).json({ error: 'Unable to load sheet rows' })
  }
})

// POST /api/sheet/append
app.post('/api/sheet/append', async (req, res) => {
  const active = getActiveConnection()
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
  if (!rows.length) {
    return res.status(400).json({ error: 'rows array is required' })
  }

  try {
    const accessToken = await ensureGoogleAccessToken()
    if (!accessToken) {
      return res.status(401).json({ error: 'Not connected to Google' })
    }
    const range = `${active.sheetName || 'AI Lead Sheet'}!A1`
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${active.sheetId}/values/${encodeURIComponent(
      range,
    )}:append?valueInputOption=RAW`
    const writeRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ values: rows }),
    })

    if (!writeRes.ok) {
      const text = await writeRes.text()
      console.error('Sheet append error:', writeRes.status, text)
      return res.status(502).json({ error: 'Unable to append rows', detail: text })
    }

    const data = await writeRes.json().catch(() => ({}))
    res.json({ ok: true, result: data })
  } catch (err) {
    console.error('Sheet append exception:', err)
    res.status(500).json({ error: 'Unable to append rows' })
  }
})

// Google OAuth: build consent URL
app.get('/api/auth/google', (req, res) => {
  const clientId = process.env.GSHEETS_CLIENT_ID
  const redirectUri = process.env.GSHEETS_REDIRECT_URI
  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: 'GSHEETS_CLIENT_ID and GSHEETS_REDIRECT_URI are required' })
  }
  const state = generateState()
  const codeVerifier = generateState()
  const codeChallenge = codeVerifier // simple; for production use PKCE sha256
  TOKEN_STORE.set(`oauth_state:${state}`, { codeVerifier, createdAt: Date.now() })
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly',
    access_type: 'offline',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'plain',
    prompt: 'consent',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

// OAuth callback exchange
app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state } = req.query
  const stored = TOKEN_STORE.get(`oauth_state:${state}`)
  if (!code || !state || !stored) {
    return res.status(400).send('Invalid OAuth state. Please retry connect.')
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GSHEETS_CLIENT_ID,
      client_secret: process.env.GSHEETS_CLIENT_SECRET,
      redirect_uri: process.env.GSHEETS_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: stored.codeVerifier,
    }),
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    console.error('OAuth exchange failed:', tokenRes.status, text)
    return res.status(502).send('OAuth exchange failed')
  }

  const tokens = await tokenRes.json()
  TOKEN_STORE.set('defaultUserTokens', { ...tokens, createdAt: Date.now() })
  TOKEN_STORE.delete(`oauth_state:${state}`)

  // Redirect back to app
  res.redirect(process.env.POST_AUTH_REDIRECT || 'http://localhost:5173/connections?google=connected')
})

// List sheets using stored token
app.get('/api/sheets', async (req, res) => {
  const tokens = TOKEN_STORE.get('defaultUserTokens')
  if (!tokens?.access_token) {
    return res.status(401).json({ error: 'Not connected to Google' })
  }

  // Refresh if needed
  const ensureAccess = async () => {
    if (!tokens.refresh_token) return tokens.access_token
    const refreshed = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GSHEETS_CLIENT_ID,
        client_secret: process.env.GSHEETS_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    if (refreshed.ok) {
      const data = await refreshed.json()
      const merged = { ...tokens, ...data, createdAt: Date.now() }
      TOKEN_STORE.set('defaultUserTokens', merged)
      return merged.access_token
    }
    return tokens.access_token
  }

  const accessToken = await ensureAccess()

  // Simple Drive files list limited to spreadsheets
  const driveRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?q=mimeType=%27application/vnd.google-apps.spreadsheet%27&fields=files(id,name)',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )

  if (!driveRes.ok) {
    const text = await driveRes.text()
    console.error('Drive list failed:', driveRes.status, text)
    return res.status(502).json({ error: 'Unable to list sheets' })
  }

  const data = await driveRes.json()
  res.json({ sheets: data.files || [], connected: true })
})

// Check connection status
app.get('/api/auth/status', (req, res) => {
  const tokens = TOKEN_STORE.get('defaultUserTokens')
  res.json({ connected: !!tokens?.access_token })
})

// Disconnect Google (clear tokens)
const handleDisconnect = (req, res) => {
  TOKEN_STORE.delete('defaultUserTokens')
  res.json({ ok: true, disconnected: true })
}

app.post('/api/auth/disconnect', handleDisconnect)
app.get('/api/auth/disconnect', handleDisconnect)
app.all('/api/auth/disconnect', handleDisconnect)

// POST /api/connections/test using Google Sheets API + workflow ping
app.post('/api/connections/test', async (req, res) => {
  const { missing, normalized } = validateConnectionPayload(req.body)
  if (missing.length) {
    return res.status(400).json({ success: false, error: `Missing fields: ${missing.join(', ')}` })
  }

  const response = {
    success: false,
    sheetStatus: 'skipped',
    workflowStatus: 'unknown',
    sheetRange: `${normalized.sheetName || 'AI Lead Sheet'}!A1:Z1`,
    errors: {},
    columns: 0,
  }

  try {
    const testRun = await client.workflows.runs.create({
      workflow_id: normalized.agentWorkflowId,
      version: normalized.agentWorkflowVersion,
      input: { input_as_text: 'connection test' },
    })
    const runId = testRun?.id
    response.workflowStatus = runId ? 'ok' : 'error'
    if (runId) {
      response.workflowDetail = `Run ${runId}`
    } else {
      response.errors.workflow = 'No run id returned'
    }
  } catch (err) {
    response.workflowStatus = 'error'
    response.errors.workflow = err?.response?.data || err?.message || 'Workflow request failed'
  }

  response.success = response.workflowStatus === 'ok'
  return res.status(response.success ? 200 : 400).json(response)
})

// POST /api/connections
app.post('/api/connections', (req, res) => {
  const { missing, normalized } = validateConnectionPayload(req.body)
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` })
  }

  const connection = {
    sheetId: normalized.sheetId,
    sheetName: normalized.sheetName,
    agentWorkflowId: normalized.agentWorkflowId,
    agentWorkflowVersion: normalized.agentWorkflowVersion,
    sheetMcpUrl: normalized.sheetMcpUrl,
    ...(normalized.mcpApiKey && { mcpApiKey: normalized.mcpApiKey }),
    ...(normalized.openaiApiKey && { openaiApiKey: normalized.openaiApiKey }),
  }

  CONNECTION_STORE.set('defaultUser', connection)
  res.json({ ok: true, connection })
})

// GET /api/connections
app.get('/api/connections', (req, res) => {
  const saved = CONNECTION_STORE.get('defaultUser')
  if (!saved) {
    return res.status(404).json({ error: 'No connection saved' })
  }
  res.json({ connection: saved })
})

// Sheet MCP proxy routes (used by workflow)
app.get('/sheet-mcp/sse', proxyMcp(SHEET_MCP_BASE))
app.all(/^\/sheet-mcp\/.*$/, proxyMcp(SHEET_MCP_BASE))

// Workflow proxy routes (passthrough to OpenAI)
app.post('/v1/workflows/runs', proxyOpenAI)
app.get('/v1/workflows/runs/:run_id', proxyOpenAI)

// Serve built frontend when running in production (Railway)
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, 'dist')
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath))
    // Wildcard route for SPA; Express 5 needs a named splat
    app.get('/:path*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  } else {
    console.warn('Dist folder not found; frontend assets will not be served')
  }
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`)
})
