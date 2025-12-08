import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Link2, Plug, RefreshCw, ShieldCheck } from 'lucide-react'
import { fetchHealth, startJob, GOOGLE_SHEETS_MCP_ENDPOINTS, disconnectGoogle, activateGoogleSheetsMcp, fetchAuthStatus } from '../utils/api'

const SHEET_NAME = 'AI Lead Sheet'
const SHEET_ID = import.meta.env.VITE_SHEET_ID || '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'
const WORKFLOW_ID = import.meta.env.VITE_WORKFLOW_ID || 'wf_69257604d1c081908d6258389947f9de0365b387e2a1c674'
const WORKFLOW_VERSION = import.meta.env.VITE_WORKFLOW_VERSION || '20'

const statusMap = {
  ok: { label: 'Hosted MCP ready', variant: 'success' },
  hosted: { label: 'Hosted MCP endpoint configured', variant: 'success' },
  reauth: { label: 'Re-auth needed for hosted MCP', variant: 'warning' },
  stopped: { label: 'Local MCP offline', variant: 'warning' },
  error: { label: 'Health check failed', variant: 'warning' },
  unknown: { label: 'Checking MCP health', variant: 'warning' },
}

const Connections = () => {
  const [health, setHealth] = useState(null)
  const [loadingHealth, setLoadingHealth] = useState(true)
  const [healthError, setHealthError] = useState('')
  const [jobPrompt, setJobPrompt] = useState('')
  const [jobStatus, setJobStatus] = useState({ loading: false, error: '', success: '' })
  const [isConnected, setIsConnected] = useState(false)

  const sheetStatus = health?.sheet || 'unknown'
  const sheetStatusInfo = statusMap[sheetStatus] || statusMap.unknown
  const agentStatus = health?.agent === 'ok' ? 'Agent workflow reachable' : 'Agent workflow not reachable'

  const loadHealth = async () => {
    setLoadingHealth(true)
    setHealthError('')
    try {
      let [healthData, authData] = await Promise.all([
        fetchHealth(),
        fetchAuthStatus()
      ])

      // Auto-activate if local MCP is stopped
      if (healthData?.sheet === 'stopped' || healthData?.sheet === 'error') {
        console.log('Local MCP offline. Attempting activation...')
        try {
          await activateGoogleSheetsMcp()
          // Wait a moment for startup
          await new Promise(r => setTimeout(r, 3000))
          // Retry health check
          healthData = await fetchHealth()
        } catch (activationErr) {
          console.warn('Auto-activation failed', activationErr)
        }
      }

      setHealth(healthData)
      setIsConnected(!!authData?.connected)
    } catch (err) {
      console.error('Health fetch failed', err)
      setHealthError('Unable to resolve MCP health. Check the hosted MCP service and try again.')
    } finally {
      setLoadingHealth(false)
    }
  }

  useEffect(() => {
    loadHealth()
  }, [])

  const StatusPill = ({ label, variant = 'warning' }) => (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${variant === 'success'
        ? 'border-gray-300 bg-gray-100 text-accent'
        : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
    >
      {variant === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
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
      const message =
        err?.response?.data?.error || err?.response?.data?.detail || err?.message || 'Unable to start workflow.'
      setJobStatus({ loading: false, error: message, success: '' })
    }
  }

  const healthDetail = useMemo(() => {
    if (!health?.mcpProbe) return null
    if (health.mcpProbe.status === 'ok') return null
    return health.mcpProbe.detail || `Probe status: ${health.mcpProbe.status || 'unknown'}`
  }, [health])

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] font-bold text-primary">Connections</p>
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-accent">Connect sheet + agent</h1>
          <div className="h-px flex-1 bg-glass-border"></div>
        </div>
        <p className="text-sm text-muted">MCP is already hosted; everything runs through that managed endpoint.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-primary shadow-sharp">
        <Plug className="h-4 w-4" />
        Workflow test via /api/connections
      </div>


      <div className="glass-panel space-y-4 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Plug className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-bold text-accent">Google Sheets MCP</p>
              <p className="text-xs text-muted">
                Hosted MCP at {GOOGLE_SHEETS_MCP_ENDPOINTS.sse.replace(/\/sse$/, '')}. Credentials and
                authentication are managed on the hosted service.
              </p>
            </div>
          </div>
          <StatusPill label={sheetStatusInfo.label} variant={sheetStatusInfo.variant} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={loadHealth}
            disabled={loadingHealth}
            className="inline-flex items-center gap-2 rounded-2xl border border-outline/80 bg-white/80 px-3 py-1 text-xs font-semibold text-primary transition hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            {loadingHealth ? 'Refreshing status…' : 'Refresh status'}
          </button>

          {isConnected ? (
            <button
              type="button"
              onClick={async () => {
                if (confirm('Are you sure you want to disconnect Google? You will need to re-authenticate.')) {
                  await disconnectGoogle();
                  window.location.reload();
                }
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              Reset Connection
            </button>
          ) : (
            <a
              href="/api/auth/google"
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-300 bg-gray-100 px-3 py-1 text-xs font-semibold text-accent transition hover:bg-gray-200"
            >
              <Link2 className="h-4 w-4" />
              Connect Google Sheet
            </a>
          )}

          <span className="text-xs text-muted">{agentStatus}</span>
        </div>

        {healthError && (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4" />
            {healthError}
          </div>
        )}
        {healthDetail && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <strong>Probe detail:</strong> {healthDetail}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/20 bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">SSE Stream</p>
            <p className="font-mono text-sm font-medium text-black break-all">{GOOGLE_SHEETS_MCP_ENDPOINTS.sse}</p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">POST /messages</p>
            <p className="font-mono text-sm font-medium text-black break-all">{GOOGLE_SHEETS_MCP_ENDPOINTS.messages}</p>
          </div>
        </div>
      </div>

      <div className="glass-panel space-y-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <Link2 className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-bold text-accent">Google Sheet</p>
            <p className="text-xs text-muted">AI Lead Sheet is tracked via the hosted MCP connection.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-bold text-gray-400 uppercase tracking-wide">
          <span className="rounded-lg border border-white/20 bg-white px-3 py-1 text-black shadow-sm">
            Sheet: {SHEET_NAME}
          </span>
          <span className="rounded-lg border border-white/20 bg-white px-3 py-1 text-black shadow-sm">
            ID: {SHEET_ID}
          </span>
          <span className="rounded-lg border border-white/20 bg-white px-3 py-1 text-black shadow-sm">
            Workflow: {WORKFLOW_ID} @ v{WORKFLOW_VERSION}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/20 bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Hosted MCP base</p>
            <p className="font-mono text-sm font-medium text-black break-all">
              {GOOGLE_SHEETS_MCP_ENDPOINTS.sse.replace(/\/sse$/, '')}
            </p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Workflow + ChatKit</p>
            <p className="text-xs text-gray-600">
              The workflow runs with the stored OpenAI key and ChatKit session created on the backend—no
              additional configuration is required here.
            </p>
          </div>
        </div>
      </div>

      <div className="glass-panel space-y-4 px-6 py-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-bold text-accent">Trigger workflow</p>
            <p className="text-xs text-muted">Send a prompt to the saved Agent Workflow.</p>
          </div>
        </div>
        <textarea
          value={jobPrompt}
          onChange={(e) => setJobPrompt(e.target.value)}
          rows={4}
          placeholder="Describe what to run..."
          className="w-full rounded-xl border border-glass-border bg-white px-4 py-3 text-sm font-medium text-black outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary shadow-sharp"
        />
        {jobStatus.error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <AlertCircle className="h-4 w-4" />
            {jobStatus.error}
          </div>
        )}
        {jobStatus.success && (
          <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-accent">
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
    </div >
  )
}

export default Connections
