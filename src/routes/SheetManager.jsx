import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, FileUp, Loader2, RefreshCw, Table } from 'lucide-react'
import { appendSheetRows, fetchConnection, fetchSheetRows } from '../utils/api'

const SHEET_ID = import.meta.env.VITE_SHEET_ID || '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'

const parseCsv = async (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const rows = text
        .trim()
        .split(/\r?\n/)
        .map((line) => line.split(',').map((cell) => cell.trim()))
      resolve(rows)
    }
    reader.onerror = reject
    reader.readAsText(file)
  })

const SheetManager = () => {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sheetInfo, setSheetInfo] = useState({ name: '', id: '' })
  const [appendLoading, setAppendLoading] = useState(false)
  const [appendError, setAppendError] = useState('')
  const [appendSuccess, setAppendSuccess] = useState('')
  const [draftRow, setDraftRow] = useState(['', '', '', '', ''])

  const loadRows = async () => {
    setLoading(true)
    setError('')
    try {
      // Use saved ID or fallback
      const targetId = sheetInfo.id || SHEET_ID
      const data = await fetchSheetRows(targetId)
      setRows(data?.rows || [])
      setSheetInfo({ name: data?.sheetName, id: data?.sheetId || targetId })
    } catch (err) {
      console.error(err)
      const detail = err?.response?.data?.error || err?.response?.data?.detail || err?.message
      setError(`Unable to load sheet rows. ${detail || 'Check connection and try again.'}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const init = async () => {
      try {
        const saved = await fetchConnection()
        if (saved?.connection) {
          setSheetInfo({
            name: saved.connection.sheetName || 'AI Lead Sheet',
            id: saved.connection.sheetId || '',
          })
        }
      } catch (err) {
        console.error('Failed to load saved connection', err)
      }
      // Call loadRows after checking saved connection
      // We need to call it effectively, so we'll rely on the next render or call it explicitly
      // But loadRows closes over stale sheetInfo here.
      // So let's just use the ID we found or fallback directly.
      const savedId = (await fetchConnection().catch(() => { }))?.connection?.sheetId
      const targetId = savedId || SHEET_ID

      try {
        setLoading(true)
        const data = await fetchSheetRows(targetId)
        setRows(data?.rows || [])
        setSheetInfo({ name: data?.sheetName, id: data?.sheetId || targetId })
      } catch (err) {
        console.error(err)
        const detail = err?.response?.data?.error || err?.response?.data?.detail || err?.message
        setError(`Unable to load sheet rows. ${detail || 'Check connection and try again.'}`)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const headers = useMemo(() => {
    const first = rows?.[0] || []
    return first.length ? first : ['Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5']
  }, [rows])

  const handleAppend = async (newRows) => {
    setAppendLoading(true)
    setAppendError('')
    setAppendSuccess('')
    try {
      const targetId = sheetInfo.id || SHEET_ID
      await appendSheetRows(newRows, targetId)
      setAppendSuccess(`Appended ${newRows.length} row(s). Refreshing…`)
      await loadRows()
    } catch (err) {
      console.error(err)
      const detail = err?.response?.data?.detail || err?.message
      setAppendError(`Unable to append rows. ${detail || 'Check Sheets API access and try again.'}`)
    } finally {
      setAppendLoading(false)
    }
  }

  const handleAddRow = () => {
    const trimmed = draftRow.map((c) => c?.trim?.() || '')
    if (!trimmed.some(Boolean)) {
      setAppendError('Enter at least one value to append.')
      return
    }
    handleAppend([trimmed])
    setDraftRow(['', '', '', '', ''])
  }

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const parsed = await parseCsv(file)
      if (!parsed.length) {
        setAppendError('CSV appears empty.')
        return
      }
      handleAppend(parsed)
    } catch (err) {
      console.error(err)
      setAppendError('Could not parse CSV file.')
    } finally {
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass-panel px-5 py-5">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">Sheet</p>
        <h1 className="text-3xl font-semibold text-primary">Manage Google Sheet</h1>
        <p className="text-sm text-muted">
          View and append rows directly. Uses the saved connection (Sheet ID/Name) via Google Sheets API.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="rounded-full border border-outline/80 bg-white/70 px-3 py-1 font-semibold text-ink">
            Sheet: {sheetInfo.name || 'AI Lead Sheet'}
          </span>
          <span className="rounded-full border border-outline/80 bg-white/70 px-3 py-1 font-semibold text-muted">
            ID: {sheetInfo.id || '—'}
          </span>
          <button
            type="button"
            onClick={loadRows}
            className="inline-flex items-center gap-2 rounded-2xl border border-outline/80 bg-white/70 px-3 py-1 font-semibold text-primary"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr,1fr]">
        <div className="glass-panel px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Live sheet data</p>
              <h2 className="text-xl font-semibold text-ink">Preview</h2>
            </div>
            {loading && <Loader2 className="h-5 w-5 animate-spin text-muted" />}
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="mt-4 overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-outline/80 bg-panel">
                  {headers.map((h, idx) => (
                    <th key={idx} className="whitespace-nowrap px-3 py-2 font-semibold text-muted">
                      {h || `Col ${idx + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1, 50).map((row, rIdx) => (
                  <tr key={rIdx} className="border-b border-outline/60 hover:bg-mint/30">
                    {headers.map((_, cIdx) => (
                      <td key={cIdx} className="whitespace-nowrap px-3 py-2 text-ink">
                        {row?.[cIdx] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && rows.length <= 1 && (
                  <tr>
                    <td className="px-3 py-3 text-sm text-muted" colSpan={headers.length}>
                      No data yet. Append a row to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-panel space-y-4 px-5 py-5">
          <div className="flex items-center gap-2">
            <Table className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-ink">Append rows</p>
              <p className="text-xs text-muted">Add a single row or upload CSV to append.</p>
            </div>
          </div>

          {appendError && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <AlertCircle className="h-4 w-4" />
              {appendError}
            </div>
          )}
          {appendSuccess && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-mint/70 px-3 py-2 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4" />
              {appendSuccess}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Add one row</p>
            <div className="flex flex-col gap-2">
              {draftRow.map((val, idx) => (
                <input
                  key={idx}
                  type="text"
                  value={val}
                  onChange={(e) => {
                    const next = [...draftRow]
                    next[idx] = e.target.value
                    setDraftRow(next)
                  }}
                  placeholder={`Column ${idx + 1}`}
                  className="rounded-2xl border border-outline/80 bg-white/80 px-3 py-2 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-mint"
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleAddRow}
              disabled={appendLoading}
              className="btn-primary mt-1 w-full justify-center disabled:cursor-not-allowed disabled:opacity-70"
            >
              {appendLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Append Row
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Upload CSV</p>
            <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-outline/70 bg-panel px-3 py-3 text-sm text-muted hover:border-primary/50">
              <FileUp className="h-4 w-4 text-primary" />
              <span>Choose CSV file to append rows</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SheetManager
