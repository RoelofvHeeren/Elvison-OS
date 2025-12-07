import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FileUp,
  Loader2,
  RefreshCw,
  Save,
  Settings,
  Table,
  Terminal,
} from 'lucide-react'
import { appendSheetRows, fetchConnection, fetchSheetRows } from '../utils/api'

// Fallback ID if not provided by env
const ENV_SHEET_ID = import.meta.env.VITE_SHEET_ID || ''

const SheetManager = () => {
  // Configuration State
  const [config, setConfig] = useState({
    sheetId: ENV_SHEET_ID,
    sheetName: 'AI Lead Sheet',
  })
  const [configOpen, setConfigOpen] = useState(false)
  const [isSavingConfig, setIsSavingConfig] = useState(false)

  // Data State
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Append State
  const [draftRow, setDraftRow] = useState(['', '', '', '', ''])
  const [appendStatus, setAppendStatus] = useState({ loading: false, error: null, success: null })

  // Initialize
  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        // Try to fetch saved connection from backend
        const saved = await fetchConnection().catch(() => null)
        const savedId = saved?.connection?.sheetId
        const savedName = saved?.connection?.sheetName

        // Determine best ID to use: Saved DB > Env Var > Default
        const finalId = savedId || ENV_SHEET_ID
        const finalName = savedName || 'AI Lead Sheet'

        setConfig({ sheetId: finalId, sheetName: finalName })
        if (finalId) {
          await loadData(finalId, finalName)
        } else {
          setConfigOpen(true) // Prompt user to enter ID if missing
          setLoading(false)
        }
      } catch (err) {
        console.error('Init error', err)
        setLoading(false)
      }
    }
    init()
  }, [])

  const loadData = async (id, name) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      // Pass ID explicitly to backend
      const data = await fetchSheetRows(id)
      setRows(data?.rows || [])
      // If successful, ensure name is synced (though backend might return what it used)
    } catch (err) {
      console.error(err)
      const detail = err?.response?.data?.error || err?.response?.data?.detail || err?.message || JSON.stringify(err)
      setError({
        message: 'Connection Failed',
        detail: detail.includes('404') ? 'Sheet ID not found or permission denied.' : detail,
        raw: err
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => loadData(config.sheetId, config.sheetName)

  const handleSaveConfig = () => {
    // Just reload with new config for now. 
    // Ideally we would save this to the backend /api/connections too, 
    // but for now let's just make it work in-session.
    setConfigOpen(false)
    loadData(config.sheetId, config.sheetName)
  }

  const handleAppend = async (newRows) => {
    setAppendStatus({ loading: true, error: null, success: null })
    try {
      await appendSheetRows(newRows, config.sheetId)
      setAppendStatus({ loading: false, error: null, success: `Successfully appended ${newRows.length} row(s)` })
      setDraftRow(['', '', '', '', ''])
      handleRefresh()
      // Clear success message after 3s
      setTimeout(() => setAppendStatus(prev => ({ ...prev, success: null })), 3000)
    } catch (err) {
      const detail = err?.response?.data?.error || err?.response?.data?.detail || err?.message
      setAppendStatus({ loading: false, error: detail, success: null })
    }
  }

  const headers = useMemo(() => {
    return rows?.[0]?.length ? rows[0] : ['Column A', 'Column B', 'Column C', 'Column D', 'Column E']
  }, [rows])

  const safeRows = useMemo(() => rows.slice(1, 51), [rows]) // Skip header, show first 50

  return (
    <div className="min-h-screen bg-transparent p-6 font-sans text-accent">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-accent">Sheet Manager <span className="text-primary">Protocol</span></h1>
              <p className="text-sm text-muted">Direct Uplink to Google Sheets MCP</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setConfigOpen(!configOpen)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${configOpen
              ? 'border-primary/50 bg-primary/5 text-primary'
              : 'border-glass-border bg-white hover:border-primary/30 hover:shadow-sharp'
              }`}
          >
            <Settings className="h-4 w-4" />
            {configOpen ? 'Hide Config' : 'Configure Connection'}
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading || !config.sheetId}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-luxury transition-all hover:bg-primary-dim hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'SYNCING...' : 'REFRESH DATA'}
          </button>
        </div>
      </div>

      {/* Configuration Panel */}
      {configOpen && (
        <div className="glass-panel mb-6 p-6 animate-in fade-in slide-in-from-top-4">
          <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
            <Database className="h-4 w-4" />
            Connection Parameters
          </h3>
          <div className="grid gap-4 md:grid-cols-[2fr,1fr,auto]">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted">Google Sheet ID</label>
              <input
                value={config.sheetId}
                onChange={(e) => setConfig((prev) => ({ ...prev, sheetId: e.target.value }))}
                placeholder="1T50..."
                className="w-full rounded-lg border border-glass-border bg-white px-3 py-2 text-sm text-accent placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary shadow-sharp transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted">Sheet Name (Tab)</label>
              <input
                value={config.sheetName}
                onChange={(e) => setConfig((prev) => ({ ...prev, sheetName: e.target.value }))}
                placeholder="AI Lead Sheet"
                className="w-full rounded-lg border border-glass-border bg-white px-3 py-2 text-sm text-accent placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary shadow-sharp transition-all"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSaveConfig}
                className="flex h-[38px] items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-md hover:bg-primary-dim transition-all"
              >
                <Save className="h-4 w-4" />
                Update
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            * The Sheet ID is the string between "/d/" and "/edit" in your browser URL.
            <br />* The Sheet Name must match the tab name at the bottom exactly.
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-950/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-rose-400" />
            <div className="space-y-1">
              <h4 className="font-bold text-rose-400">{error.message}</h4>
              <p className="text-sm text-rose-200/80">{error.detail}</p>
              {error.raw && (
                <details className="mt-2 text-xs text-rose-400/50">
                  <summary className="cursor-pointer hover:text-rose-400">View Raw Error</summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono">
                    {JSON.stringify(error.raw, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-[1.5fr,1fr]">

        {/* Live Data Panel */}
        <div className="glass-panel p-1">
          <div className="flex items-center justify-between border-b border-glass-border px-5 py-4">
            <div className="flex items-center gap-2">
              <Table className="h-4 w-4 text-primary" />
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Live Preview</h2>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-primary">
              <span
                className={`h-2 w-2 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : error ? 'bg-rose-500' : 'bg-emerald-500'
                  }`}
              ></span>
              {loading ? 'FETCHING' : error ? 'OFFLINE' : 'LIVE'}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-b-xl bg-surface/50 min-h-[400px]">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {!loading && !error && rows.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-slate-500">
                <Database className="mb-2 h-10 w-10 opacity-20" />
                <p>No data found.</p>
              </div>
            )}

            <div className="overflow-auto max-h-[500px]">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface text-[10px] font-bold uppercase tracking-wider text-muted sticky top-0 z-10">
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-4 py-3 border-b border-slate-800">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {safeRows.map((row, rIdx) => (
                    <tr key={rIdx} className="group hover:bg-white transition-colors border-b border-glass-border last:border-0">
                      {headers.map((_, cIdx) => (
                        <td key={cIdx} className="whitespace-nowrap px-4 py-3 text-accent group-hover:text-primary-dim font-medium text-xs">
                          {row[cIdx] || ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Append Control Panel */}
        <div className="space-y-6">
          <div className="glass-panel p-6">
            <div className="mb-6 flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Data Injection</h2>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-glass-border bg-surface/50 p-4">
                <label className="mb-3 block text-[10px] font-bold uppercase tracking-wider text-muted">Single Row Payload</label>
                <div className="flex flex-col gap-2.5">
                  {draftRow.map((val, idx) => (
                    <input
                      key={idx}
                      value={val}
                      onChange={(e) => {
                        const next = [...draftRow]
                        next[idx] = e.target.value
                        setDraftRow(next)
                      }}
                      placeholder={headers[idx] || `Column ${idx + 1}`}
                      className="rounded-lg border border-glass-border bg-white px-3 py-2 text-sm text-accent placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all shadow-sharp"
                    />
                  ))}
                </div>
                <button
                  onClick={() => handleAppend([draftRow])}
                  disabled={appendStatus.loading}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-surface border border-glass-border py-2.5 text-sm font-bold text-muted hover:bg-primary hover:text-white hover:border-primary hover:shadow-lg transition-all disabled:opacity-50"
                >
                  {appendStatus.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                  APPEND ROW
                </button>
              </div>

              {/* Status Messages */}
              {appendStatus.error && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {appendStatus.error}
                </div>
              )}
              {appendStatus.success && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {appendStatus.success}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SheetManager
