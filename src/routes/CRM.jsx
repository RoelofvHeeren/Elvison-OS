import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Building2, RefreshCw, Trash2, Upload, Filter, Target, Loader, Check, Search, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import SheetTable from '../components/SheetTable'
import ImportModal from '../components/ImportModal'
import { fetchLeads, deleteLead, approveLead } from '../utils/api'
import { useIcp } from '../context/IcpContext'

function CRM() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filters, setFilters] = useState({ date: '', company: '', icpId: '' })
  const [health, setHealth] = useState({ sheet: 'pending', agent: 'pending' })
  const [isImportOpen, setIsImportOpen] = useState(false)

  // Selection state
  const [selectedLeads, setSelectedLeads] = useState(new Set())
  const [selectAll, setSelectAll] = useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(100) // Fixed page size for now
  const [pagination, setPagination] = useState({
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false
  })

  const { icps, fetchIcps } = useIcp()

  const fetchRows = async (page = currentPage) => {
    try {
      setLoading(true)
      setError('')

      // Call paginated API
      const response = await fetchLeads({ page, pageSize })

      // Handle both old (array) and new (paginated) response formats
      let leadsData = [];
      let paginationData = { total: 0, totalPages: 0, hasNext: false, hasPrevious: false };

      if (Array.isArray(response)) {
        // Old format (backward compatibility)
        leadsData = response;
      } else if (response.data) {
        // New paginated format
        leadsData = response.data;
        paginationData = response.pagination;
      }

      // Data is an array of objects: { person_name, company_name, job_title, email, linkedin_url, custom_data, ... }

      const normalized = (leadsData || []).map((lead, idx) => {
        // Parse complex custom_data if it exists
        let details = {}
        if (typeof lead.custom_data === 'string') {
          try { details = JSON.parse(lead.custom_data) } catch (e) { }
        } else {
          details = lead.custom_data || {}
        }

        let dateStr = new Date(lead.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

        return {
          originalIndex: (page - 1) * pageSize + idx + 1, // Global index across pages
          id: lead.id,
          date: dateStr,
          name: lead.person_name || '',
          title: lead.job_title || '',
          company: lead.company_name || '',
          email: lead.email || '',
          linkedin: lead.linkedin_url || '',
          website: details.company_website || '',
          connectionRequest: details.connection_request || '',
          emailMessage: details.email_message || '',
          companyProfile: details.company_profile || '',
          phoneNumbers: lead.phone_numbers || [],
          icpId: lead.icp_id || '', // NEW: ICP ID
        };
      })

      setRows(normalized)
      setPagination(paginationData)
      setCurrentPage(page)
    } catch (err) {
      console.error(err)
      setError('Unable to fetch sheet rows. Check the MCP connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteRow = async (id) => {
    if (!window.confirm('Are you sure you want to delete this lead?')) return
    try {
      setLoading(true)
      await deleteLead(id)
      await fetchRows()
    } catch (err) {
      console.error(err)
      setError('Failed to delete row')
      setLoading(false)
    }
  }

  const handleEnrichRow = async (id) => {
    try {
      // Optimistic update or just spinner could be handled in table, but here we reload
      setLoading(true)
      await import('../utils/api').then(mod => mod.enrichLead(id))
      await fetchRows()
    } catch (err) {
      console.error(err)
      setError('Failed to enrich row')
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
    await Promise.allSettled([fetchRows(), fetchStatus(), fetchIcps()])
  }

  // Selection handlers
  const toggleLeadSelection = (leadId) => {
    const newSelection = new Set(selectedLeads)
    if (newSelection.has(leadId)) {
      newSelection.delete(leadId)
    } else {
      newSelection.add(leadId)
    }
    setSelectedLeads(newSelection)
    setSelectAll(newSelection.size === filteredRows.length && filteredRows.length > 0)
  }

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedLeads(new Set())
      setSelectAll(false)
    } else {
      const allIds = new Set(filteredRows.map(row => row.id))
      setSelectedLeads(allIds)
      setSelectAll(true)
    }
  }

  // CSV Export Function - Updated to export only selected leads
  const exportToCSV = () => {
    if (selectedLeads.size === 0) {
      alert('Please select at least one lead to export.')
      return
    }

    // Filter to only selected leads
    const leadsToExport = filteredRows.filter(row => selectedLeads.has(row.id))

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `leads_export_${timestamp}.csv`;

    // Define CSV headers
    const headers = ['Name', 'Email', 'Title', 'Company', 'LinkedIn', 'Phone Numbers', 'Connection Request', 'Date Added'];

    // Convert rows to CSV format
    const csvRows = leadsToExport.map(row => [
      row.name,
      row.email,
      row.title,
      row.company,
      row.linkedin,
      Array.isArray(row.phoneNumbers) ? row.phoneNumbers.join('; ') : '',
      row.connectionRequest,
      row.date
    ]);

    // Escape and quote CSV fields
    const escapeCsvField = (field) => {
      const str = String(field || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Build CSV content
    const csvContent = [
      headers.map(escapeCsvField).join(','),
      ...csvRows.map(row => row.map(escapeCsvField).join(','))
    ].join('\n');

    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clear selection after export
    setSelectedLeads(new Set())
    setSelectAll(false)
  }

  useEffect(() => {
    refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredRows = useMemo(() => {
    return (rows || []).filter((row) => {
      const matchesDate = filters.date ? row.date?.startsWith(filters.date) : true
      const matchesCompany = filters.company
        ? row.company?.toLowerCase().includes(filters.company.toLowerCase())
        : true
      const matchesIcp = filters.icpId ? row.icpId === filters.icpId : true
      return matchesDate && matchesCompany && matchesIcp
    })
  }, [rows, filters])

  return (
    <div className="space-y-6 p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
      <div className="glass-panel flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] font-bold text-primary">LeadFlow</p>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-accent">Operations Console</h1>
          <p className="text-sm text-muted">Live sync from your AI Lead Sheet.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Status Chips */}
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
            onClick={exportToCSV}
            className="chip text-sm font-semibold text-teal-600 hover:text-teal-700 hover:bg-teal-50 border-teal-200"
          >
            <Download className="h-4 w-4" />
            Export CSV
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
            to="/runner"
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
              {new Set((rows || []).map((r) => r.company).filter(Boolean)).size}
            </p>
          </div>
        </div>
        <div className="glass-panel flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] font-bold text-primary">Leads tracked</p>
            <p className="font-serif text-2xl font-bold text-accent">{pagination.total || rows.length}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white font-serif text-lg font-bold shadow-lg shadow-primary/30">
            {pagination.total || rows.length}
          </div>
        </div>
      </div>

      <div className="glass-panel grid gap-3 px-5 py-5 md:grid-cols-3">
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
        {/* NEW ICP FILTER */}
        <div className="flex flex-1 flex-col gap-1">
          <label
            htmlFor="icp"
            className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted flex items-center gap-2"
          >
            <Target className="w-3 h-3" /> Filter by Strategy
          </label>
          <select
            id="icp"
            value={filters.icpId}
            onChange={(e) => setFilters((prev) => ({ ...prev, icpId: e.target.value }))}
            className="w-full rounded-2xl border border-outline/80 bg-white/80 px-3 py-2.5 text-sm text-ink outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/10"
          >
            <option value="">All Strategies</option>
            {icps.map(icp => (
              <option key={icp.id} value={icp.id}>{icp.name}</option>
            ))}
          </select>
        </div>
      </div>

      <SheetTable
        rows={filteredRows}
        loading={loading}
        error={error}
        onDeleteRow={handleDeleteRow}
        onEnrichRow={handleEnrichRow}
        selectedLeads={selectedLeads}
        onToggleSelection={toggleLeadSelection}
        onToggleSelectAll={toggleSelectAll}
        selectAll={selectAll}
      />

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div className="glass-panel flex items-center justify-between px-6 py-4">
          <div className="text-sm text-muted">
            Showing page <span className="font-semibold text-accent">{currentPage}</span> of{' '}
            <span className="font-semibold text-accent">{pagination.totalPages}</span>
            {' '}({pagination.total} total leads)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchRows(currentPage - 1)}
              disabled={!pagination.hasPrevious || loading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-2xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/5 border-primary/20 text-primary"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <span className="px-4 py-2 text-sm font-semibold text-accent">
              Page {currentPage}
            </span>
            <button
              onClick={() => fetchRows(currentPage + 1)}
              disabled={!pagination.hasNext || loading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-2xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/5 border-primary/20 text-primary"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportSuccess={() => {
          refreshAll()
        }}
      />
    </div >
  )
}

export default CRM
