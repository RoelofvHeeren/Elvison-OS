import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Building2, RefreshCw, Trash2 } from 'lucide-react'
import SheetTable from '../components/SheetTable'
import { fetchHealth, fetchLeads, deleteLead, clearLeads } from '../utils/api'

const CRM = () => {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ date: '', company: '' })
  const [health, setHealth] = useState({ sheet: 'pending', agent: 'pending' })

  const fetchRows = async () => {
    try {
      setLoading(true)
      setError('')
      const data = await fetchLeads()
      const normalized = (data?.rows ?? data ?? [])
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => row[0] !== 'Date Added' && (row[1] || row[2] || row[3])) // Filter headers and empty rows
        .map(({ row, idx }) => ({
          originalIndex: idx,
          date: row[0] || '',
          name: row[1] || '',
          title: row[2] || '',
          company: row[3] || '',
          email: row[4] || '',
          linkedin: row[5] || '',
          website: row[6] || '',
          connectionRequest: row[7] || '',
          emailMessage: row[8] || '',
          companyProfile: row[9] || '',
        }))
        .sort((a, b) => new Date(b.date) - new Date(a.date)) // Sort newest first
      setRows(normalized)
    } catch (err) {
      console.error(err)
      setError('Unable to fetch sheet rows. Check the MCP connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteRow = async (idx) => {
    if (!window.confirm('Are you sure you want to delete this lead?')) return
    try {
      setLoading(true)
      await deleteLead(idx)
      await fetchRows()
    } catch (err) {
      console.error(err)
      setError('Failed to delete row')
      setLoading(false)
    }
  }

  const handleClearSheet = async () => {
    if (!window.confirm('WARNING: This will delete ALL leads from the Google Sheet.\n\nAre you sure you want to proceed?')) return
    try {
      setLoading(true)
      await clearLeads()
      await fetchRows()
    } catch (err) {
      console.error(err)
      setError('Failed to clear sheet')
      setLoading(false)
    }
  }

  const fetchStatus = async () => {
    try {
      const data = await fetchHealth()
      setHealth({
        sheet: data?.sheet || 'unknown',
        agent: data?.agent || 'unknown',
      })
    } catch (err) {
      console.error(err)
      setHealth({ sheet: 'error', agent: 'error' })
    }
  }

  const refreshAll = async () => {
    await Promise.allSettled([fetchRows(), fetchStatus()])
  }

  useEffect(() => {
    refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesDate = filters.date ? row.date?.startsWith(filters.date) : true
      const matchesCompany = filters.company
        ? row.company?.toLowerCase().includes(filters.company.toLowerCase())
        : true
      return matchesDate && matchesCompany
    })
  }, [rows, filters])

  return (
    <div className="space-y-6">
      <div className="glass-panel flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] font-bold text-primary">LeadFlow</p>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-accent">Operations Console</h1>
          <p className="text-sm text-muted">Live sync from your AI Lead Sheet.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-bold text-primary">
            <span
              className={`h-2.5 w-2.5 rounded-full ${health.sheet === 'ok' ? 'bg-black shadow-sm shadow-black/30' : 'bg-amber-400'
                }`}
            />
            Sheet
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-bold text-primary">
            <span
              className={`h-2.5 w-2.5 rounded-full ${health.agent === 'ok' ? 'bg-black shadow-sm shadow-black/30' : 'bg-amber-400'
                }`}
            />
            Agent
          </div>
          <button
            type="button"
            onClick={handleClearSheet}
            className="chip text-sm font-semibold text-rose-500 hover:text-rose-600 hover:bg-rose-50 border-rose-200"
          >
            <Trash2 className="h-4 w-4" />
            Clear All
          </button>
          <button
            type="button"
            onClick={refreshAll}
            className="chip text-sm font-semibold text-primary"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <Link
            to="/new-job"
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-brand transition-all duration-200 hover:-translate-y-[1px] hover:bg-primaryDark"
          >
            Start New Job
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr,1.2fr,1fr]">
        <div className="glass-panel flex items-center gap-4 px-5 py-4">
          <CalendarDays className="h-11 w-11 rounded-xl bg-primary/10 p-2.5 text-primary border border-primary/20" />
          <div>
            <p className="text-xs uppercase tracking-[0.25em] font-bold text-primary">Latest entry</p>
            <p className="font-serif text-2xl font-bold text-accent">{rows[0]?.date || 'No data yet'}</p>
          </div>
        </div>
        <div className="glass-panel flex items-center gap-4 px-5 py-4">
          <Building2 className="h-11 w-11 rounded-xl bg-primary/10 p-2.5 text-primary border border-primary/20" />
          <div>
            <p className="text-xs uppercase tracking-[0.25em] font-bold text-primary">Total companies</p>
            <p className="font-serif text-2xl font-bold text-accent">
              {new Set(rows.map((r) => r.company).filter(Boolean)).size}
            </p>
          </div>
        </div>
        <div className="glass-panel flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] font-bold text-primary">Leads tracked</p>
            <p className="font-serif text-2xl font-bold text-accent">{rows.length}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white font-serif text-lg font-bold shadow-lg shadow-primary/30">
            {rows.length}
          </div>
        </div>
      </div>

      <div className="glass-panel grid gap-3 px-5 py-5 md:grid-cols-2">
        <div className="flex flex-1 flex-col gap-1">
          <label
            htmlFor="date"
            className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted"
          >
            Filter by date
          </label>
          <input
            id="date"
            type="date"
            value={filters.date}
            onChange={(e) => setFilters((prev) => ({ ...prev, date: e.target.value }))}
            className="w-full rounded-2xl border border-outline/80 bg-white/80 px-3 py-2.5 text-sm text-ink outline-none transition-all duration-200 focus:border-accent focus:ring-2 focus:ring-black/10"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label
            htmlFor="company"
            className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted"
          >
            Filter by company
          </label>
          <input
            id="company"
            type="text"
            placeholder="Acme Corp"
            value={filters.company}
            onChange={(e) => setFilters((prev) => ({ ...prev, company: e.target.value }))}
            className="w-full rounded-2xl border border-outline/80 bg-white/80 px-3 py-2.5 text-sm text-ink outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>
      </div>

      <SheetTable rows={filteredRows} loading={loading} error={error} onDeleteRow={handleDeleteRow} />
    </div>
  )
}

export default CRM
