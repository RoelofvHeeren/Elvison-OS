import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  KeyRound,
  Link2,
  Loader2,
  Plug,
  ShieldCheck,
} from 'lucide-react'
import {
  disconnectGoogle,
  fetchAuthStatus,
  fetchConnection,
  fetchHealth,
  fetchSheets,
  saveConnection,
  startJob,
  activateGoogleSheetsMcp,
  GOOGLE_SHEETS_MCP_ENDPOINTS,
} from '../utils/api'

const defaultForm = {
  sheetUrlOrId: '',
  sheetName: 'AI Lead Sheet',
  agentWorkflowId: '',
  agentWorkflowVersion: '',
  openaiApiKey: '',
  sheetMcpUrl: '',
  mcpApiKey: '',
}

const Connections = () => {
  const [form, setForm] = useState(defaultForm)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [sheets, setSheets] = useState([])
  const [googleConnected, setGoogleConnected] = useState(false)
  const [mcpStatus, setMcpStatus] = useState({ state: 'idle', message: '' })
  const [activatingMcp, setActivatingMcp] = useState(false)
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
  const [disconnectMessage, setDisconnectMessage] = useState('')
  const [jobPrompt, setJobPrompt] = useState('')
  const [jobStatus, setJobStatus] = useState({ loading: false, error: '', success: '' })

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  useEffect(() => {
    const loadSaved = async () => {
      try {
        const data = await fetchConnection()
        const saved = data?.connection
        if (saved) {
          setForm((prev) => ({
            ...prev,
            sheetUrlOrId: saved.sheetId || prev.sheetUrlOrId,
            sheetName: saved.sheetName || prev.sheetName,
            agentWorkflowId: saved.agentWorkflowId || prev.agentWorkflowId,
            agentWorkflowVersion: saved.agentWorkflowVersion || prev.agentWorkflowVersion,
            openaiApiKey: saved.openaiApiKey || prev.openaiApiKey,
            sheetMcpUrl: saved.sheetMcpUrl || prev.sheetMcpUrl,
            mcpApiKey: saved.mcpApiKey || prev.mcpApiKey,
          }))
          setSaveMessage('Loaded saved connection.')
        }
      } catch (err) {
        console.info('[connections] No saved connection found', err?.response?.status || err?.message)
      } finally {
        setLoadingSaved(false)
      }
    }
    loadSaved()
  }, [])

  useEffect(() => {
    const loadGoogleStatus = async () => {
      try {
        const status = await fetchAuthStatus()
        setGoogleConnected(!!status?.connected)
        if (status?.connected) {
          const sheetData = await fetchSheets()
          setSheets(sheetData?.sheets || [])
        }
      } catch (err) {
        console.error('Auth status fetch failed', err)
      }
    }
    loadGoogleStatus()
  }, [])

  useEffect(() => {
    const loadMcpHealth = async () => {
      try {
        const health = await fetchHealth()
        const sheetStatus = health?.sheet
        if (sheetStatus === 'ok') {
          setMcpStatus({ state: 'connected', message: 'Google Sheets MCP Connected' })
        } else if (sheetStatus === 'reauth') {
          setMcpStatus({ state: 'reauth', message: 'Re-authenticate Google Sheets MCP' })
        } else if (sheetStatus === 'stopped') {
          setMcpStatus({ state: 'stopped', message: 'Google Sheets MCP is offline' })
        }
      } catch (err) {
        setMcpStatus((prev) => ({
          ...prev,
          state: prev.state === 'connected' ? 'connected' : 'error',
          message: prev.state === 'connected' ? prev.message : 'Unable to read MCP health',
        }))
      }
    }
    loadMcpHealth()
  }, [])

  const validate = () => {
    const required = ['sheetUrlOrId', 'agentWorkflowId', 'agentWorkflowVersion', 'openaiApiKey']
    const nextErrors = required.reduce((acc, key) => {
      if (!form[key]?.trim()) acc[key] = 'Required'
      return acc
    }, {})
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    setSaveMessage('')
    try {
      await saveConnection(form)
      setSaveMessage('Connection saved to backend.')
    } catch (err) {
      const message =
        err?.response?.data?.error || err?.message || 'Unable to save the connection right now.'
      setSaveMessage(message)
    } finally {
      setSaving(false)
    }
  }

  const pollMcpHealth = async () => {
    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      try {
        const health = await fetchHealth()
        if (health?.sheet === 'ok') {
          setMcpStatus({ state: 'connected', message: 'Google Sheets MCP Connected' })
          return
        }
        if (health?.sheet === 'reauth') {
          setMcpStatus({ state: 'reauth', message: 'Re-authenticate Google Sheets MCP' })
          return
        }
      } catch (err) {
        // keep polling silently
      }
    }
  }

  const handleActivateMcp = async () => {
    setActivatingMcp(true)
    setMcpStatus({ state: 'activating', message: 'Starting Google Sheets MCP...' })
    try {
      const result = await activateGoogleSheetsMcp()
      if (result?.status === 'auth') {
        setMcpStatus({
          state: 'auth',
          message: 'Google auth popup opened. Complete login to finish activation.',
        })
        await pollMcpHealth()
      } else if (result?.status === 'reauth') {
        setMcpStatus({
          state: 'reauth',
          message: 'Re-authentication required. Click activate again after signing in.',
        })
      } else if (result?.status === 'ok') {
        if (result?.probe?.status === 'reauth') {
          setMcpStatus({
            state: 'reauth',
            message: 'Re-authentication required. Click activate again after signing in.',
          })
        } else {
          setMcpStatus({ state: 'connected', message: 'Google Sheets MCP Connected' })
        }
      } else {
        setMcpStatus({
          state: 'error',
          message: result?.error || 'Unable to start the Sheets MCP server.',
        })
      }
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Unable to start the Sheets MCP server.'
      setMcpStatus({ state: 'error', message })
    } finally {
      setActivatingMcp(false)
    }
  }

  const StatusPill = ({ label, ok }) => (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
        ok
          ? 'border-emerald-200 bg-mint/70 text-primary'
          : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      {label}
    </div>
  )

  const handleStartJob = async () => {
    if (!jobPrompt.trim()) {
      setJobStatus({ loading: false, error: 'Enter a prompt to start the workflow.', success: '' })
      return
    }
    setJobStatus({ loading: true, error: '', success: '' })
    try {
      const data = await startJob(jobPrompt)
      if (data?.job_id || data?.jobId) {
        setJobStatus({
          loading: false,
          error: '',
          success: `Workflow started. Job ID: ${data.job_id || data.jobId}`,
        })
      } else {
        setJobStatus({ loading: false, error: 'No job ID returned from workflow.', success: '' })
      }
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Unable to start workflow.'
      setJobStatus({ loading: false, error: message, success: '' })
    }
  }

  const mcpStatusLabel =
    mcpStatus.message ||
    (mcpStatus.state === 'connected'
      ? 'Google Sheets MCP Connected'
      : 'Google Sheets MCP not started yet.')
  const mcpStatusOk = mcpStatus.state === 'connected'

  return (
    <div className="space-y-6">
      <div className="glass-panel px-6 py-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">Connections</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-primary">Connect sheet + agent</h1>
            <p className="text-sm text-muted">
              Configure the Google Sheet MCP endpoint and the Agent Workflow used across this
              dashboard.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-outline/80 bg-white/60 px-4 py-3 text-xs font-semibold text-muted">
            <Plug className="h-4 w-4 text-primary" />
            Workflow test via /api/connections
          </div>
        </div>
      </div>

      <div className="glass-panel space-y-4 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Plug className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-ink">Activate Google Sheets MCP</p>
              <p className="text-xs text-muted">
                Boots the Final-Sheet-MCP server locally via SSE on 127.0.0.1:3325.
              </p>
            </div>
          </div>
          <StatusPill
            label={
              mcpStatusOk
                ? 'Google Sheets MCP Connected'
                : mcpStatus.state === 'auth'
                  ? 'Waiting for Google login'
                  : mcpStatus.state === 'reauth'
                    ? 'Re-auth needed'
                    : 'MCP inactive'
            }
            ok={mcpStatusOk}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleActivateMcp}
            disabled={activatingMcp}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-70"
          >
            {activatingMcp && <Loader2 className="h-4 w-4 animate-spin" />}
            Activate Google Sheets MCP
          </button>
          <div className="rounded-2xl border border-outline/80 bg-white/70 px-4 py-3 text-sm text-muted">
            {mcpStatusLabel}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-outline/80 bg-white/80 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">SSE Stream</p>
            <p className="font-mono text-sm text-ink">{GOOGLE_SHEETS_MCP_ENDPOINTS.sse}</p>
          </div>
          <div className="rounded-2xl border border-outline/80 bg-white/80 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">POST /messages</p>
            <p className="font-mono text-sm text-ink">{GOOGLE_SHEETS_MCP_ENDPOINTS.messages}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr,1fr]">
        <form onSubmit={handleSave} className="glass-panel space-y-5 px-6 py-6">
          {loadingSaved && (
            <div className="rounded-2xl border border-dashed border-outline/80 bg-white/70 px-4 py-3 text-xs text-muted">
              Loading saved connection...
            </div>
          )}
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-ink">Google Sheet</p>
              <p className="text-xs text-muted">Provide a sheet URL or ID plus the target tab name.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                Google Sheet URL or ID<span className="text-rose-500"> *</span>
              </label>
              <input
                type="text"
                value={form.sheetUrlOrId}
                onChange={(e) => updateField('sheetUrlOrId', e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className={`rounded-2xl border bg-white/80 px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-mint ${
                  errors.sheetUrlOrId ? 'border-rose-300' : 'border-outline/80'
                }`}
              />
              {errors.sheetUrlOrId && (
                <span className="text-xs text-rose-500">{errors.sheetUrlOrId}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                Sheet Name
              </label>
              <input
                type="text"
                value={form.sheetName}
                onChange={(e) => updateField('sheetName', e.target.value)}
                placeholder="AI Lead Sheet"
                className="rounded-2xl border border-outline/80 bg-white/80 px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-mint"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <GitBranch className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-ink">Agent workflow</p>
              <p className="text-xs text-muted">Workflow ID + version used to trigger LeadFlow.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                Agent Workflow ID<span className="text-rose-500"> *</span>
              </label>
              <input
                type="text"
                value={form.agentWorkflowId}
                onChange={(e) => updateField('agentWorkflowId', e.target.value)}
                placeholder="wf_xxx"
                className={`rounded-2xl border bg-white/80 px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-mint ${
                  errors.agentWorkflowId ? 'border-rose-300' : 'border-outline/80'
                }`}
              />
              {errors.agentWorkflowId && (
                <span className="text-xs text-rose-500">{errors.agentWorkflowId}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                Agent Workflow Version<span className="text-rose-500"> *</span>
              </label>
              <input
                type="text"
                value={form.agentWorkflowVersion}
                onChange={(e) => updateField('agentWorkflowVersion', e.target.value)}
                placeholder="1"
                className={`rounded-2xl border bg-white/80 px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-mint ${
                  errors.agentWorkflowVersion ? 'border-rose-300' : 'border-outline/80'
                }`}
              />
              {errors.agentWorkflowVersion && (
                <span className="text-xs text-rose-500">{errors.agentWorkflowVersion}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-ink">Credentials</p>
              <p className="text-xs text-muted">
                Keys are only used to run the test and persist to the backend API.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                OpenAI API Key<span className="text-rose-500"> *</span>
              </label>
              <input
                type="password"
                value={form.openaiApiKey}
                onChange={(e) => updateField('openaiApiKey', e.target.value)}
                placeholder="sk-..."
                className={`rounded-2xl border bg-white/80 px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-mint ${
                  errors.openaiApiKey ? 'border-rose-300' : 'border-outline/80'
                }`}
              />
              {errors.openaiApiKey && (
                <span className="text-xs text-rose-500">{errors.openaiApiKey}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                Sheet MCP URL <span className="text-muted">(optional)</span>
              </label>
              <input
                type="text"
                value={form.sheetMcpUrl}
                onChange={(e) => updateField('sheetMcpUrl', e.target.value)}
                placeholder="https://sheet-mcp.example.com/mcp"
                className={`rounded-2xl border bg-white/80 px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-mint ${
                  errors.sheetMcpUrl ? 'border-rose-300' : 'border-outline/80'
                }`}
              />
              {errors.sheetMcpUrl && (
                <span className="text-xs text-rose-500">{errors.sheetMcpUrl}</span>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                MCP API Key (optional)
              </label>
              <input
                type="password"
                value={form.mcpApiKey}
                onChange={(e) => updateField('mcpApiKey', e.target.value)}
                placeholder="Bearer token for Sheet MCP"
                className="rounded-2xl border border-outline/80 bg-white/80 px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-mint"
              />
            </div>
            <div className="flex flex-col justify-end gap-3 rounded-2xl border border-dashed border-outline/70 bg-panel px-4 py-4 text-xs text-muted">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <KeyRound className="h-4 w-4 text-primary" />
                Secure handling
              </div>
              <p>Credentials stay local to this backend stub for development.</p>
              <p>Use the Test Connection button before saving the config.</p>
              <div className="mt-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Google</p>
                {googleConnected ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-emerald-700">Connected to Google.</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          setDisconnectMessage('')
                          await disconnectGoogle()
                          setGoogleConnected(false)
                          setSheets([])
                          setDisconnectMessage('Disconnected Google.')
                        } catch (err) {
                          setDisconnectMessage(err?.message || 'Unable to disconnect.')
                        }
                      }}
                      className="rounded-xl border border-outline/80 bg-white/70 px-2 py-1 text-[11px] font-semibold text-primary"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => (window.location.href = `${apiBase}/api/auth/google`)}
                    className="mt-1 inline-flex items-center gap-2 rounded-2xl border border-outline/80 bg-white/70 px-3 py-2 text-xs font-semibold text-primary"
                  >
                    Sign in with Google
                  </button>
                )}
                {disconnectMessage && (
                  <p className="text-[11px] text-muted">{disconnectMessage}</p>
                )}
              </div>
            </div>
          </div>

          {googleConnected && sheets.length > 0 && (
            <div className="rounded-2xl border border-outline/80 bg-white/70 px-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Pick a sheet</p>
                  <p className="text-xs text-muted">Select to auto-fill Sheet URL/ID and Name.</p>
                </div>
                <span className="text-xs font-semibold text-emerald-700">Google connected</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {sheets.map((sheet) => {
                  const isSelected = form.sheetUrlOrId === sheet.id
                  return (
                    <button
                      key={sheet.id}
                      type="button"
                      onClick={() => {
                        updateField('sheetUrlOrId', sheet.id)
                        updateField('sheetName', sheet.name || form.sheetName)
                      }}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                        isSelected
                          ? 'border-primary bg-mint/60 shadow-soft'
                          : 'border-outline/80 bg-white/80 hover:border-primary/50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{sheet.name || 'Untitled sheet'}</p>
                        <p className="truncate text-[11px] text-muted">{sheet.id}</p>
                      </div>
                      <span className="text-xs font-semibold text-primary">{isSelected ? 'Selected' : 'Use'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Connection
            </button>
          </div>

          {saveMessage && (
            <div className="flex items-center gap-2 rounded-2xl border border-outline/80 bg-white/70 px-4 py-3 text-sm text-ink">
              {saveMessage.toLowerCase().includes('unable') ? (
                <AlertCircle className="h-4 w-4 text-rose-500" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
              {saveMessage}
            </div>
          )}
        </form>

                <div className="glass-panel space-y-4 px-6 py-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-ink">Trigger workflow</p>
              <p className="text-xs text-muted">Send a prompt to the saved Agent Workflow.</p>
            </div>
          </div>
          <textarea
            value={jobPrompt}
            onChange={(e) => setJobPrompt(e.target.value)}
            rows={4}
            placeholder="Describe what to run..."
            className="w-full rounded-2xl border border-outline/80 bg-white/70 px-3 py-2 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-mint"
          />
          {jobStatus.error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <AlertCircle className="h-4 w-4" />
              {jobStatus.error}
            </div>
          )}
          {jobStatus.success && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-mint/70 px-3 py-2 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4" />
              {jobStatus.success}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleStartJob}
              disabled={jobStatus.loading}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-70"
            >
              {jobStatus.loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Send to workflow
            </button>
          </div>
        </div>
</div>
    </div>
  )
}

export default Connections
