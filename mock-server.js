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
import os from 'os'
import path from 'path'
import { EventSource } from 'eventsource'
import { execSync, spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { runAgentWorkflow } from './src/backend/workflow.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const HOME_CONFIG_DIR = process.env.GSHEETS_CONFIG_DIR || path.join(os.homedir(), '.config', 'google-sheets-mcp')
const DEFAULT_GSHEETS_OAUTH_PATH =
  process.env.GSHEETS_OAUTH_PATH || path.join(HOME_CONFIG_DIR, 'gcp-oauth.keys.json')
const DEFAULT_GSHEETS_CREDENTIALS_PATH =
  process.env.GSHEETS_CREDENTIALS_PATH || path.join(HOME_CONFIG_DIR, 'credentials.json')
const LOCAL_SHEET_MCP_HOST = '127.0.0.1'
const LOCAL_SHEET_MCP_PORT = 3325
const LOCAL_SHEET_MCP_BASE = `http://${LOCAL_SHEET_MCP_HOST}:${LOCAL_SHEET_MCP_PORT}`
const SHEET_MCP_SSE = `${LOCAL_SHEET_MCP_BASE}/sse`
const HOSTED_SHEET_MCP_BASE = null // Force Local MCP to ensure shared authentication state

const app = express()
app.use(cors())
app.use(express.json())

const WORKFLOW_ID = process.env.WORKFLOW_ID
const WORKFLOW_VERSION = process.env.WORKFLOW_VERSION
const CHATKIT_WORKFLOW_ID = process.env.WORKFLOW_ID
const CHATKIT_WORKFLOW_VERSION = process.env.WORKFLOW_VERSION
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const CONNECTION_STORE = new Map()
const TOKEN_STORE = new Map()
const client = new OpenAI({ apiKey: OPENAI_API_KEY })
console.log('Available client keys:', Object.keys(client))

let sheetMcpProcess = null
let sheetMcpAuthNotified = false
const sheetMcpLogs = []

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

const logSheetMcpOutput = (source) => (data) => {
  const text = data?.toString?.() || ''
  if (!text.trim()) return
  if (text.includes('Launching auth flow')) {
    sheetMcpAuthNotified = true
  }
  const line = `[sheets-mcp:${source}] ${text.trim()}`
  console.log(line)
  sheetMcpLogs.push(line)
  if (sheetMcpLogs.length > 200) {
    sheetMcpLogs.shift()
  }
}

const ensureDirExists = (dirPath) => {
  if (!dirPath) return
  fs.mkdirSync(dirPath, { recursive: true })
}

const decodeJsonMaybeBase64 = (value = '') => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{')) return trimmed
  try {
    return Buffer.from(trimmed, 'base64').toString('utf-8')
  } catch (err) {
    console.error('Failed to decode base64 JSON; falling back to raw value', err?.message)
    return trimmed
  }
}

const writeJsonEnvToPath = (envKey, targetPath) => {
  const value = process.env[envKey]
  if (!value) return false
  ensureDirExists(path.dirname(targetPath))
  const decoded = decodeJsonMaybeBase64(value)
  fs.writeFileSync(targetPath, decoded)
  return true
}

const synthesizeOauthJson = () => {
  const clientId = process.env.GSHEETS_CLIENT_ID
  const clientSecret = process.env.GSHEETS_CLIENT_SECRET
  const redirectUri = process.env.GSHEETS_REDIRECT_URI || 'http://localhost:3000/oauth2callback'
  if (!clientId || !clientSecret) return null
  return JSON.stringify(
    {
      installed: {
        client_id: clientId,
        client_secret: clientSecret,
        project_id: 'elvison-local',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        redirect_uris: [redirectUri],
      },
    },
    null,
    2,
  )
}

const ensureRedirectUris = (oauthPath) => {
  try {
    const raw = fs.readFileSync(oauthPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const installed = parsed.installed || parsed.web
    if (!installed) return
    const defaults = [
      'http://localhost:3000/oauth2callback',
      'http://127.0.0.1:3000/oauth2callback',
      process.env.GSHEETS_REDIRECT_URI,
    ].filter(Boolean)
    const redirects = new Set([...(installed.redirect_uris || []), ...defaults])
    installed.redirect_uris = Array.from(redirects)
    if (!parsed.installed && parsed.web) {
      parsed.web.redirect_uris = installed.redirect_uris
    } else {
      parsed.installed = installed
    }
    fs.writeFileSync(oauthPath, JSON.stringify(parsed, null, 2))
  } catch (err) {
    console.warn('Unable to normalize redirect URIs in OAuth file', err?.message)
  }
}

const migrateLegacyCredentials = (targetPath) => {
  const legacyPath = path.join(__dirname, 'dist', '.gsheets-server-credentials.json')
  if (fs.existsSync(legacyPath) && !fs.existsSync(targetPath)) {
    ensureDirExists(path.dirname(targetPath))
    fs.copyFileSync(legacyPath, targetPath)
    try {
      fs.unlinkSync(legacyPath)
    } catch (err) {
      console.warn('Unable to remove legacy credential file', err?.message)
    }
    console.log('Migrated legacy Google Sheets credentials to', targetPath)
  }
}

const ensureGoogleSheetsFiles = () => {
  ensureDirExists(HOME_CONFIG_DIR)
  migrateLegacyCredentials(DEFAULT_GSHEETS_CREDENTIALS_PATH)
  const oauthPath = process.env.GSHEETS_OAUTH_PATH || DEFAULT_GSHEETS_OAUTH_PATH
  const credentialsPath = process.env.GSHEETS_CREDENTIALS_PATH || DEFAULT_GSHEETS_CREDENTIALS_PATH
  writeJsonEnvToPath('GSHEETS_OAUTH_JSON', oauthPath)
  writeJsonEnvToPath('GSHEETS_CREDENTIALS_JSON', credentialsPath)
  if (!fs.existsSync(oauthPath)) {
    const synthesized = synthesizeOauthJson()
    if (synthesized) {
      ensureDirExists(path.dirname(oauthPath))
      fs.writeFileSync(oauthPath, synthesized)
    }
  }
  if (fs.existsSync(oauthPath)) {
    ensureRedirectUris(oauthPath)
  }
  if (!fs.existsSync(oauthPath)) {
    const err = new Error(
      `Missing Google OAuth client JSON at ${oauthPath}. Add gcp-oauth.keys.json or set GSHEETS_OAUTH_JSON/GSHEETS_OAUTH_PATH.`,
    )
    err.code = 'MISSING_OAUTH'
    err.meta = { oauthPath }
    throw err
  }
  const oauthJson = fs.readFileSync(oauthPath, 'utf-8')
  return { oauthPath, credentialsPath, configDir: HOME_CONFIG_DIR, oauthJson }
}

const detectAuthErrorFromResponse = (payload) => {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload || {})
  return /invalid_grant|unauthorized|401/i.test(text)
}

const ensureFinalSheetBinary = () => {
  const moduleDir = path.join(__dirname, 'node_modules', 'final-sheet-mcp')
  const distEntry = path.join(moduleDir, 'dist', 'index.js')
  const vendorDist = path.join(__dirname, 'vendor', 'final-sheet-mcp', 'index.js')
  const binDir = path.join(__dirname, 'node_modules', '.bin')
  const binPath = path.join(binDir, 'final-sheet-mcp')
  const googleBinPath = path.join(binDir, 'google-sheets-mcp')
  const cacheDir = path.join(HOME_CONFIG_DIR, 'final-sheet-mcp')
  const cacheDist = path.join(cacheDir, 'dist', 'index.js')

  const makeBinScript = (targetDist) => {
    ensureDirExists(binDir)
    const script = [
      '#!/usr/bin/env bash',
      'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
      `node "${targetDist}" "$@"`,
    ].join('\n')
    fs.writeFileSync(binPath, script)
    fs.writeFileSync(googleBinPath, script)
    fs.chmodSync(binPath, 0o755)
    fs.chmodSync(googleBinPath, 0o755)
    return { binPath, distPath: targetDist }
  }

  const usableDist = [distEntry, vendorDist, cacheDist].find((p) => fs.existsSync(p))
  if (usableDist && fs.existsSync(binPath)) {
    return { binPath, distPath: usableDist }
  }

  const bootstrap = () => {
    try {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'final-sheet-mcp-'))
      const repoDir = path.join(tempRoot, 'repo')
      execSync(`git clone https://github.com/RoelofvHeeren/Final-Sheet-MCP.git ${repoDir}`, {
        stdio: 'inherit',
      })
      execSync('npm install', { cwd: repoDir, stdio: 'inherit' })
      execSync('npm run build', { cwd: repoDir, stdio: 'inherit' })

      ensureDirExists(path.dirname(distEntry))
      ensureDirExists(path.dirname(cacheDist))
      fs.copyFileSync(path.join(repoDir, 'dist', 'index.js'), distEntry)
      fs.copyFileSync(path.join(repoDir, 'dist', 'index.js'), cacheDist)
      return distEntry
    } catch (err) {
      console.error('Failed to bootstrap final-sheet-mcp binary', err)
      if (fs.existsSync(cacheDist)) {
        console.warn('Falling back to cached MCP build at', cacheDist)
        return cacheDist
      }
      err.code = 'MCP_BOOTSTRAP_FAILED'
      throw err
    }
  }

  const dist = usableDist || bootstrap()
  return makeBinScript(dist)
}

async function workflowHealthCheck() {
  try {
    if (!client.beta?.workflows) {
      console.log('Health check OK (Mocked: client.beta.workflows missing)')
      return
    }
    const run = await client.beta.workflows.runs.create({
      workflow_id: 'wf_69257604d1c081908d6258389947f9de0365b387e2a1c674',
      version: '21',
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
  return {
    sheetId: process.env.SHEET_ID || '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI',
    sheetName: process.env.SHEET_NAME || 'AI Lead Sheet',
  }
}

const sheetMcpHealthUrl = `${LOCAL_SHEET_MCP_BASE}/health`

const checkSheetMcpHealth = async () => {
  if (HOSTED_SHEET_MCP_BASE) {
    try {
      const resp = await axios.get(`${HOSTED_SHEET_MCP_BASE.replace(/\/$/, '')}/health`, { timeout: 2000 })
      return resp.status === 200
    } catch (err) {
      return false
    }
  }
  try {
    const response = await axios.get(sheetMcpHealthUrl, { timeout: 2000 })
    return response.status === 200
  } catch (err) {
    return false
  }
}

const startSheetMcpServer = async () => {
  if (sheetMcpProcess?.pid && !sheetMcpProcess.killed) {
    return sheetMcpProcess
  }

  const { binPath: binaryPath, distPath: binaryDistPath } = ensureFinalSheetBinary()
  const { oauthPath, credentialsPath, configDir, oauthJson } = ensureGoogleSheetsFiles()

  if (oauthPath && fs.existsSync(oauthPath)) {
    try {
      const rawInfo = fs.readFileSync(oauthPath, 'utf-8')
      const parsed = JSON.parse(rawInfo)
      const type = parsed.installed ? 'installed' : parsed.web ? 'web' : 'installed'
      const config = parsed[type] || {}

      const currentRedirects = config.redirect_uris || []
      const requiredRedirects = [
        'http://localhost:3000/oauth2callback',
        'http://127.0.0.1:3000/oauth2callback',
        process.env.GSHEETS_REDIRECT_URI,
        'https://elvison-os-production.up.railway.app/api/auth/google/callback' // Added production URL guess just in case
      ].filter(Boolean)

      config.redirect_uris = Array.from(new Set([...currentRedirects, ...requiredRedirects]))
      parsed[type] = config

      // Write back to the configuration file used by the process
      fs.writeFileSync(oauthPath, JSON.stringify(parsed, null, 2))

      // Also ensure it is copied/updated in the binary location if needed
      if (binaryDistPath) {
        const distAuthPath = path.join(path.dirname(binaryDistPath), 'gcp-oauth.keys.json')
        fs.writeFileSync(distAuthPath, JSON.stringify(parsed, null, 2))
      }
    } catch (err) {
      console.error('Critical: Failed to patch OAuth file', err)
    }
  }

  sheetMcpAuthNotified = false
  const credsJson = fs.existsSync(credentialsPath) ? fs.readFileSync(credentialsPath, 'utf-8') : ''
  const env = {
    ...process.env,
    MCP_TRANSPORT: 'sse',
    PORT: `${LOCAL_SHEET_MCP_PORT}`,
    HOST: LOCAL_SHEET_MCP_HOST,
    GSHEETS_CONFIG_DIR: configDir,
    GSHEETS_OAUTH_PATH: oauthPath,
    GSHEETS_CREDENTIALS_PATH: credentialsPath,
    ...(oauthJson && { GSHEETS_OAUTH_JSON: oauthJson }),
    ...(credsJson && { GSHEETS_CREDENTIALS_JSON: credsJson }),
    PATH: `${path.join(__dirname, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`,
  }

  console.log('Starting Google Sheets MCP server with env:', {
    MCP_TRANSPORT: env.MCP_TRANSPORT,
    PORT: env.PORT,
    HOST: env.HOST,
    GSHEETS_CONFIG_DIR: env.GSHEETS_CONFIG_DIR,
    GSHEETS_OAUTH_PATH: env.GSHEETS_OAUTH_PATH,
    GSHEETS_CREDENTIALS_PATH: env.GSHEETS_CREDENTIALS_PATH,
    BIN: binaryPath,
    DIST: binaryDistPath,
  })

  sheetMcpProcess = spawn('npx', ['final-sheet-mcp'], {
    env,
    cwd: __dirname,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  sheetMcpProcess.stdout?.on('data', logSheetMcpOutput('stdout'))
  sheetMcpProcess.stderr?.on('data', logSheetMcpOutput('stderr'))
  sheetMcpProcess.on('exit', (code, signal) => {
    console.log(`Sheets MCP server exited (code ${code}, signal ${signal})`)
    sheetMcpProcess = null
  })
  sheetMcpProcess.unref()
  return sheetMcpProcess
}

const getMcpBase = () => HOSTED_SHEET_MCP_BASE || LOCAL_SHEET_MCP_BASE

const createMcpSseSession = (base = getMcpBase()) =>
  new Promise((resolve, reject) => {
    const es = new EventSource(`${base}/sse`)
    let resolved = false

    es.addEventListener('endpoint', (event) => {
      try {
        const endpointUrl = new URL(event.data, base).toString()
        resolved = true
        resolve({ es, endpointUrl })
      } catch (err) {
        es.close()
        reject(err)
      }
    })

    es.onerror = (err) => {
      if (!resolved) {
        reject(err)
      }
      es.close()
    }
  })

const waitForMcpResponse = (es, messageId, timeoutMs = 12000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      es.close()
      reject(new Error('Timed out waiting for MCP response'))
    }, timeoutMs)

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data)
        if (!messageId || parsed.id === messageId) {
          clearTimeout(timer)
          es.close()
          resolve(parsed)
        }
      } catch (err) {
        console.error('Failed to parse MCP message', err)
      }
    }

    es.onerror = (err) => {
      clearTimeout(timer)
      es.close()
      reject(err)
    }
  })

const callMcpTool = async (toolName, args = {}, base = getMcpBase()) => {
  const session = await createMcpSseSession(base)
  const messageId = `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const payload = {
    jsonrpc: '2.0',
    id: messageId,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  }

  const responsePromise = waitForMcpResponse(session.es, messageId)
  await axios.post(session.endpointUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
  })
  return responsePromise
}

const runMcpReadinessProbe = async () => {
  const connection = getActiveConnection()
  if (!connection?.sheetId) {
    return { status: 'skipped', reason: 'missing_sheet_id' }
  }
  const base = getMcpBase()

  const result = { status: 'pending', detail: '' }
  try {
    const response = await callMcpTool('list_sheets', { spreadsheetId: connection.sheetId }, base)
    if (detectAuthErrorFromResponse(response)) {
      const refresh = await callMcpTool('refresh_auth', {}, base)
      if (detectAuthErrorFromResponse(refresh)) {
        result.status = 'reauth'
        result.detail = 'refresh_auth failed; user re-login required'
        return result
      }
      const retry = await callMcpTool('list_sheets', { spreadsheetId: connection.sheetId }, base)
      if (detectAuthErrorFromResponse(retry)) {
        result.status = 'reauth'
        result.detail = 'Auth still invalid after refresh.'
        return result
      }
      result.status = 'ok'
      result.detail = 'list_sheets succeeded after refresh.'
      return result
    }
    result.status = 'ok'
    result.detail = 'list_sheets succeeded.'
    return result
  } catch (err) {
    result.status = 'error'
    result.detail = err?.message || 'MCP tool call failed'
    return result
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
    if (!client.beta?.workflows) {
      console.log('Starting job (Mocked: client.beta.workflows missing)')
      return { id: `mock_run_${Date.now()}` }
    }
    const run = await client.beta.workflows.runs.create({
      workflow_id: 'wf_69257604d1c081908d6258389947f9de0365b387e2a1c674',
      version: '21',
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
  let sheet = 'unknown'
  let mcpProbe = null
  try {
    await workflowHealthCheck()
    const sheetOk = await checkSheetMcpHealth()
    sheet = sheetOk ? 'ok' : HOSTED_SHEET_MCP_BASE ? 'hosted' : 'stopped'
    if (sheetOk && !HOSTED_SHEET_MCP_BASE) {
      mcpProbe = await runMcpReadinessProbe()
      if (mcpProbe?.status === 'reauth' || mcpProbe?.status === 'error') {
        sheet = mcpProbe.status
      }
    }
    res.json({ agent: 'ok', sheet, mcpProbe })
  } catch (err) {
    console.error('Health check error:', err?.response?.data || err?.message)
    res.json({ agent: 'error', sheet })
  }
})

// POST /api/mcp/google-sheets/activate - start local MCP server via SSE
app.post('/api/mcp/google-sheets/activate', async (req, res) => {
  if (HOSTED_SHEET_MCP_BASE) {
    const healthUrl = `${HOSTED_SHEET_MCP_BASE}/health`
    try {
      const resp = await axios.get(healthUrl, { timeout: 3000 })
      if (resp.status === 200) {
        return res.json({
          status: 'ok',
          hosted: true,
          running: true,
          sse: `${HOSTED_SHEET_MCP_BASE}/sse`,
          messages: `${HOSTED_SHEET_MCP_BASE}/messages`,
        })
      }
    } catch (err) {
      // continue and return hosted endpoints anyway
    }
    return res.status(202).json({
      status: 'pending',
      hosted: true,
      running: false,
      sse: `${HOSTED_SHEET_MCP_BASE}/sse`,
      messages: `${HOSTED_SHEET_MCP_BASE}/messages`,
    })
  }

  const alreadyHealthy = await checkSheetMcpHealth()
  if (alreadyHealthy) {
    const probe = await runMcpReadinessProbe()
    const status = probe?.status === 'reauth' ? 'reauth' : probe?.status === 'error' ? 'error' : 'ok'
    return res.status(status === 'error' ? 502 : 200).json({ status, message: 'OK', running: true, probe })
  }

  try {
    await startSheetMcpServer()
  } catch (err) {
    const status = err?.code === 'MISSING_OAUTH' ? 400 : 500
    return res.status(status).json({
      error: 'Failed to start Google Sheets MCP server',
      detail: err?.message || err,
      code: err?.code,
      meta: err?.meta,
    })
  }

  const startTime = Date.now()
  const timeoutMs = 45000
  let authNotified = false

  while (Date.now() - startTime < timeoutMs) {
    if (!authNotified && sheetMcpAuthNotified) {
      authNotified = true
      return res.status(202).json({
        status: 'auth',
        message: 'Launching Google auth flow... complete login in your browser.',
        authPopup: true,
      })
    }

    const healthy = await checkSheetMcpHealth()
    if (healthy) {
      const probe = await runMcpReadinessProbe()
      const status = probe?.status === 'reauth' ? 'reauth' : probe?.status === 'error' ? 'error' : 'ok'
      return res.json({
        status,
        message: 'Sheets MCP server is healthy',
        running: true,
        probe,
        authPopup: sheetMcpAuthNotified,
      })
    }

    await sleep(2000)
  }

  res.status(504).json({
    error: 'Timed out waiting for Sheets MCP health check',
    running: false,
    authPopup: sheetMcpAuthNotified,
  })
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
    if (!client.beta?.workflows) {
      console.log('Job status fetch (Mocked: client.beta.workflows missing)')
      res.json({ id: jobId, status: 'completed' })
      return
    }
    const statusRes = await client.beta.workflows.runs.retrieve(jobId)
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
  // Always use hardcoded values - ignore request params
  const sheetId = '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'
  const sheetName = 'AI Lead Sheet'
  if (!sheetId) {
    return res.status(400).json({ error: 'sheetId is required for MCP sheet read' })
  }
  try {
    const response = await callMcpTool(
      'read_all_from_sheet',
      { spreadsheetId: sheetId, sheetName },
      getMcpBase(),
    )
    const content = response?.result?.content || response?.content || []
    const text = content[0]?.text || content[0]?.data || ''
    let values = []
    if (text) {
      try {
        values = JSON.parse(text)
      } catch (parseErr) {
        console.error('Sheet rows parse error:', parseErr?.message, text.slice(0, 200))
        return res.status(400).json({ error: 'MCP Error: ' + text.slice(0, 200), detail: text })
      }
    }
    res.json({ rows: values, sheetName, sheetId })
  } catch (err) {
    console.error('Sheet rows exception:', err)
    res.status(500).json({ error: 'Unable to load sheet rows' })
  }
})

// POST /api/sheet/append
app.post('/api/sheet/append', async (req, res) => {
  // Always use hardcoded values - ignore request params
  const sheetId = '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'
  const sheetName = 'AI Lead Sheet'
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
  if (!sheetId) {
    return res.status(400).json({ error: 'sheetId is required for MCP sheet append' })
  }
  if (!rows.length) {
    return res.status(400).json({ error: 'rows array is required' })
  }

  try {
    const base = getMcpBase()
    const existing = await callMcpTool(
      'read_all_from_sheet',
      { spreadsheetId: sheetId, sheetName },
      base,
    )
    const content = existing?.result?.content || existing?.content || []
    const text = content[0]?.text || content[0]?.data || '[]'
    let currentRows = []
    try {
      currentRows = JSON.parse(text || '[]')
    } catch (parseErr) {
      console.error('Sheet append parse error:', parseErr?.message, text.slice(0, 200))
      // If we can't parse existing rows, we can't determine next index safely, or maybe we assume empty?
      // Better to fail than corrupt data? Or proceed?
      // For now, let's treat as empty if it looks like an error string?
      if (text.startsWith('Error')) {
        return res.status(400).json({ error: 'MCP Error', detail: text })
      }
      currentRows = []
    }
    let nextIndex = currentRows.length + 1

    for (const row of rows) {
      await callMcpTool(
        'insert_row',
        { spreadsheetId: sheetId, sheetName, rowIndex: nextIndex, values: row },
        base,
      )
      nextIndex += 1
    }
    res.json({ ok: true, appended: rows.length })
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
  const tokenData = { ...tokens, createdAt: Date.now() }
  TOKEN_STORE.set('defaultUserTokens', tokenData)
  TOKEN_STORE.delete(`oauth_state:${state}`)

  // Persist to file so MCP process sees it
  try {
    const credentialsPath = process.env.GSHEETS_CREDENTIALS_PATH || path.join(HOME_CONFIG_DIR, 'credentials.json')
    ensureDirExists(path.dirname(credentialsPath))

    // Construct valid 'authorized_user' format for google-auth-library
    if (!tokens.refresh_token) {
      console.warn('WARNING: No refresh_token received from Google. Offline access will fail.')
    }

    const credentialsPayload = {
      type: 'authorized_user',
      client_id: process.env.GSHEETS_CLIENT_ID,
      client_secret: process.env.GSHEETS_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      // Storing the access token too, though library might ignore it in favor of refreshing
      token: tokens.access_token,
      expiry_date: Date.now() + ((tokens.expires_in || 3600) * 1000)
    }

    fs.writeFileSync(credentialsPath, JSON.stringify(credentialsPayload, null, 2))
    console.log('Updated credentials.json with new OAuth tokens (authorized_user format)')
  } catch (err) {
    console.error('Failed to persist tokens to disk:', err)
  }

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
  try {
    const credentialsPath = process.env.GSHEETS_CREDENTIALS_PATH || path.join(HOME_CONFIG_DIR, 'credentials.json')
    if (fs.existsSync(credentialsPath)) {
      fs.unlinkSync(credentialsPath)
      console.log('Deleted credentials.json')
    }
  } catch (err) {
    console.warn('Failed to delete credentials file:', err)
  }
  res.json({ ok: true, disconnected: true })
}

app.post('/api/auth/disconnect', handleDisconnect)
app.get('/api/auth/disconnect', handleDisconnect)
app.all('/api/auth/disconnect', handleDisconnect)

// POST /api/chatkit/session - create a ChatKit session and return client_secret
app.post('/api/chatkit/session', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' })
  }
  if (!CHATKIT_WORKFLOW_ID || !CHATKIT_WORKFLOW_VERSION) {
    return res.status(500).json({ error: 'ChatKit workflow id/version not configured' })
  }

  const deviceId =
    req.body?.deviceId ||
    crypto.randomUUID?.() ||
    `device-${Math.random().toString(36).slice(2, 10)}`

  try {
    const payload = {
      workflow: { id: CHATKIT_WORKFLOW_ID, version: CHATKIT_WORKFLOW_VERSION },
      user: deviceId,
    }
    const response = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'chatkit_beta=v1',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return res
        .status(response.status)
        .json({ error: 'ChatKit session request failed', detail: detail?.slice(0, 4000) })
    }

    const data = await response.json()
    return res.json({ client_secret: data?.client_secret, deviceId })
  } catch (err) {
    console.error('ChatKit session error', err)
    res.status(500).json({ error: 'ChatKit session error', detail: err?.message })
  }
})

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
    if (!client.beta?.workflows) {
      console.log('Connection test (Mocked: client.beta.workflows missing)')
      const testRun = { id: `mock_run_${Date.now()}` }
      // Mocking successful run response structure
      const response = {
        success: true,
        workflowStatus: 'ok',
        sheetStatus: 'skipped',
        sheetRange: `${normalized.sheetName || 'AI Lead Sheet'}!A1:Z1`,
        workflowDetail: `Run ${testRun.id}`,
        errors: {},
        columns: 0
      }
      return res.status(200).json(response)
    }
    const testRun = await client.beta.workflows.runs.create({
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
app.get('/sheet-mcp/sse', proxyMcp(LOCAL_SHEET_MCP_BASE))
app.all(/^\/sheet-mcp\/.*$/, proxyMcp(LOCAL_SHEET_MCP_BASE))

// Workflow proxy routes (passthrough to OpenAI)
app.post('/v1/workflows/runs', proxyOpenAI)
app.get('/v1/workflows/runs/:run_id', proxyOpenAI)

// Agent Configuration Store
const AGENT_CONFIGS = {
  company_finder: { instructions: '', linkedFileIds: [], enabledToolIds: [] },
  company_profiler: { instructions: '', linkedFileIds: [], enabledToolIds: [] },
  apollo_lead_finder: { instructions: '', linkedFileIds: [], enabledToolIds: [] },
  outreach_creator: { instructions: '', linkedFileIds: [], enabledToolIds: [] },
  sheet_builder: { instructions: '', linkedFileIds: [], enabledToolIds: [] }
}

// GET /api/agents/config
app.get('/api/agents/config', (req, res) => {
  res.json({ configs: AGENT_CONFIGS })
})

// POST /api/agents/config
app.post('/api/agents/config', (req, res) => {
  const { agentKey, instructions, linkedFileIds, enabledToolIds } = req.body
  if (!agentKey || !AGENT_CONFIGS[agentKey]) { // Allow empty instructions/files
    return res.status(400).json({ error: 'Invalid agent key' })
  }

  if (typeof instructions === 'string') {
    AGENT_CONFIGS[agentKey].instructions = instructions
  }
  if (Array.isArray(linkedFileIds)) {
    AGENT_CONFIGS[agentKey].linkedFileIds = linkedFileIds
  }
  if (Array.isArray(enabledToolIds)) {
    AGENT_CONFIGS[agentKey].enabledToolIds = enabledToolIds
  }

  res.json({ success: true, config: AGENT_CONFIGS[agentKey] })
})

// POST /api/agents/run - Run the in-house agent workflow
app.post('/api/agents/run', async (req, res) => {
  const { prompt, vectorStoreId } = req.body

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' })
  }

  // Use a default Vector Store ID if none provided (mock or env var)
  // In a real scenario, this would come from the user selecting a "Knowledge Base" document
  const effectiveVectorStoreId = vectorStoreId || "vs_69003f222fa08191834fdf89585b93e0"

  try {
    console.log('Starting In-House Agent Workflow...', {
      prompt,
      vectorStoreId: effectiveVectorStoreId,
      agentConfigs: AGENT_CONFIGS
    })

    // Run the agent with stored configs
    const result = await runAgentWorkflow(
      { input_as_text: prompt },
      {
        vectorStoreId: effectiveVectorStoreId,
        agentConfigs: AGENT_CONFIGS // Pass the dynamic configs
      }
    )

    res.json({ success: true, result })
  } catch (err) {
    console.error('In-House Agent Error:', err)
    res.status(500).json({
      error: 'Agent execution failed',
      detail: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    })
  }
})

// Knowledge Base Mock Data
const KNOWLEDGE_BASE_FILES = []

// GET /api/knowledge/files
app.get('/api/knowledge/files', (req, res) => {
  res.json({ files: KNOWLEDGE_BASE_FILES })
})

// POST /api/knowledge/upload
app.post('/api/knowledge/upload', (req, res) => {
  // Mock file upload - since we don't have multer, we just assume success
  // In a real app, you'd handle multipart/form-data here
  const newFile = {
    id: `file_${Date.now()}`,
    name: `Uploaded_Document_${Date.now()}.pdf`, // Mock name since we're not parsing multipart
    status: 'processing',
    uploadedAt: Date.now()
  }
  KNOWLEDGE_BASE_FILES.push(newFile)

  // Simulate processing delay
  setTimeout(() => {
    newFile.status = 'ready'
  }, 3000)

  res.json({ ok: true, file: newFile })
})

// DELETE /api/knowledge/files/:id
app.delete('/api/knowledge/files/:id', (req, res) => {
  const { id } = req.params
  const index = KNOWLEDGE_BASE_FILES.findIndex(f => f.id === id)
  if (index !== -1) {
    KNOWLEDGE_BASE_FILES.splice(index, 1)
  }
  res.json({ ok: true })
})

// Serve built frontend when running in production (Railway)
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, 'dist')
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath))
    // Wildcard route for SPA; Express 5 needs a named splat
    app.get(/.*/, (req, res) => {
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
