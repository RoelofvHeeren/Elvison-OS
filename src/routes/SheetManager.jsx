import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react'
import { appendSheetRows, fetchSheetRows } from '../utils/api'

// Hardcoded configuration - no user input needed
const SHEET_ID = '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'
const SHEET_NAME = 'AI Lead Sheet'

const SheetManager = () => {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [draftRow, setDraftRow] = useState(['', '', '', '', ''])
  const [appendStatus, setAppendStatus] = useState({ loading: false, error: null, success: null })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSheetRows(SHEET_ID)
      setRows(data?.rows || [])
    } catch (err) {
      console.error('Load error:', err)
      const detail = err?.response?.data?.error || err?.response?.data?.detail || err?.message
      setError({
        message: 'Connection Failed',
        detail: detail || 'Unable to load sheet data',
        raw: err
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAppend = async () => {
    if (draftRow.every(cell => !cell.trim())) {
      setAppendStatus({ loading: false, error: 'Please fill in at least one column', success: null })
      return
    }

    setAppendStatus({ loading: true, error: null, success: null })
    try {
      await appendSheetRows([draftRow], SHEET_ID)
      setAppendStatus({ loading: false, error: null, success: 'Row appended successfully!' })
      setDraftRow(['', '', '', '', ''])
      // Reload data after append
      setTimeout(() => loadData(), 500)
    } catch (err) {
      console.error('Append error:', err)
      const detail = err?.response?.data?.error || err?.response?.data?.detail || err?.message
      setAppendStatus({ loading: false, error: detail || 'Failed to append row', success: null })
    }
  }

  const updateDraftCell = (index, value) => {
    const updated = [...draftRow]
    updated[index] = value
    setDraftRow(updated)
  }

  const columns = rows[0] || ['Column A', 'Column B', 'Column C', 'Column D', 'Column E']
  const dataRows = rows.slice(1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-panel px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Database className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold text-primary">Sheet Manager Protocol</h1>
            <p className="text-sm text-muted">Direct Uplink to Google Sheets MCP</p>
          </div>
        </div>
      </div>

      {/* Live Preview */}
      <div className="glass-panel px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <h2 className="text-lg font-semibold text-ink">LIVE PREVIEW</h2>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-outline/80 bg-white/80 px-4 py-2 text-sm font-semibold text-primary transition hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            REFRESH DATA
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-800">
              <AlertCircle className="h-4 w-4" />
              {error.message}
            </div>
            <p className="mt-1 text-xs text-rose-700">{error.detail}</p>
          </div>
        )}

        {loading && !error && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {!loading && !error && (
          <div className="overflow-x-auto rounded-xl border border-glass-border bg-white/40 shadow-sm scrollbar-hide">
            <table className="min-w-full divide-y divide-glass-border text-left">
              <thead className="bg-surface/50 text-[9px] font-bold uppercase tracking-[0.2em] text-muted">
                <tr>
                  {columns.map((col, i) => (
                    <th key={i} className="px-5 py-4 whitespace-nowrap">
                      {col || `Column ${String.fromCharCode(65 + i)}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border text-xs">
                {dataRows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-5 py-8 text-center text-sm text-muted">
                      No data found.
                    </td>
                  </tr>
                ) : (
                  dataRows.map((row, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-surface/40 transition group">
                      {columns.map((_, colIdx) => (
                        <td key={colIdx} className="px-5 py-3.5 text-ink whitespace-nowrap">
                          {(() => {
                            const params = row[colIdx] || ''
                            const lower = params.toLowerCase()

                            // Email
                            if (lower.includes('@') && lower.includes('.')) {
                              return (
                                <a href={`mailto:${params}`} className="text-primary hover:underline font-medium">
                                  {params}
                                </a>
                              )
                            }

                            // LinkedIn
                            if (lower.includes('linkedin.com')) {
                              return (
                                <a
                                  href={params}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline decoration-mint decoration-2 underline-offset-2 hover:text-primary-dim"
                                >
                                  Profile
                                </a>
                              )
                            }

                            // Website / URL
                            if (lower.startsWith('http')) {
                              return (
                                <a
                                  href={params}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline decoration-mint decoration-2 underline-offset-2 hover:text-primary-dim"
                                >
                                  Visit
                                </a>
                              )
                            }

                            // Default
                            return params || '—'
                          })()}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Data Injection */}
      <div className="glass-panel px-6 py-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-500"></div>
          <h2 className="text-lg font-semibold text-ink">DATA INJECTION</h2>
        </div>

        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted">SINGLE ROW PAYLOAD</p>
          <div className="grid gap-3 sm:grid-cols-5">
            {columns.slice(0, 5).map((col, i) => (
              <input
                key={i}
                type="text"
                placeholder={col || `Column ${String.fromCharCode(65 + i)}`}
                value={draftRow[i] || ''}
                onChange={(e) => updateDraftCell(i, e.target.value)}
                className="rounded-xl border border-outline/80 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
              />
            ))}
          </div>

          {appendStatus.error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <AlertCircle className="h-4 w-4" />
              {appendStatus.error}
            </div>
          )}

          {appendStatus.success && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-mint/70 px-3 py-2 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4" />
              {appendStatus.success}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleAppend}
              disabled={appendStatus.loading}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-70"
            >
              {appendStatus.loading && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" />
              APPEND ROW
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SheetManager
