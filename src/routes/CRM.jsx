import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Building2, RefreshCw, Trash2, Upload, Filter, Target, Loader, Check, Search, ChevronLeft, ChevronRight, Download, Users } from 'lucide-react'
import SheetTable from '../components/SheetTable'
import ImportModal from '../components/ImportModal'
import { fetchLeads, deleteLead, approveLead, fetchAllLeadIds, fetchRuns, fetchHealth, enrichLead, regenerateLead, deepEnrichLead } from '../utils/api'
import OutreachModal from '../components/OutreachModal'
import LeadReviewModal from '../components/LeadReviewModal'
import { useIcp } from '../context/IcpContext'

function CRM() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filters, setFilters] = useState({ date: '', company: '', name: '', icpId: '', runId: '' })
  const [runs, setRuns] = useState([])
  const [health, setHealth] = useState({ sheet: 'pending', agent: 'pending' })
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isOutreachOpen, setIsOutreachOpen] = useState(false)
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [reviewLead, setReviewLead] = useState(null)
  const [activeTab, setActiveTab] = useState('all') // 'all', 'review', 'ready'

  // Selection state
  const [selectedLeads, setSelectedLeads] = useState(new Set())
  const [selectAll, setSelectAll] = useState(false)
  // New: Track if user explicitly selected "All X in DB", not just the loaded IDs
  const [isAllDatabaseSelected, setIsAllDatabaseSelected] = useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(100) // Fixed page size for now
  const [pagination, setPagination] = useState({
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false
  })
  const [totalUniqueCompanies, setTotalUniqueCompanies] = useState(0)

  const { icps, fetchIcps } = useIcp()

  const fetchRows = async (page = currentPage) => {
    try {
      setLoading(true)
      setError('')

      // Call paginated API
      const response = await fetchLeads({
        page,
        pageSize,
        icpId: filters.icpId,
        runId: filters.runId
      })

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
        setTotalUniqueCompanies(response.uniqueCompanies || 0); // Set total companies stats
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
          connectionRequest: lead.linkedin_message || details.connection_request || '',
          emailMessage: lead.email_body || details.email_message || '',
          companyProfile: lead.company_profile_text || details.company_profile || '',
          phoneNumbers: lead.phone_numbers || [],
          icpId: lead.icp_id || '',
          status: lead.outreach_status || 'pending',
          reason: lead.outreach_reason || '',
          researchFact: lead.research_fact || '',
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
      setLoading(true)
      await enrichLead(id)
      await fetchRows()
    } catch (err) {
      console.error(err)
      setError('Failed to enrich row')
      setLoading(false)
    }
  }

  const handleRegenerateRow = async (id) => {
    try {
      setLoading(true)
      await regenerateLead(id)
      await fetchRows()
    } catch (err) {
      console.error(err)
      setError('Failed to regenerate lead')
      setLoading(false)
    }
  }

  const handleReviewRow = (lead) => {
    setReviewLead(lead)
    setIsReviewOpen(true)
  }

  const handleDeepEnrichRow = async (id) => {
    try {
      setLoading(true)
      const data = await deepEnrichLead(id)
      if (data.status === 'success') {
        // Automatically trigger regeneration after deep enrichment
        await regenerateLead(id)
      }
      await fetchRows()
    } catch (err) {
      console.error(err)
      setError('Deep enrichment failed')
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

  const fetchRunsList = async () => {
    try {
      const data = await fetchRuns()
      setRuns(data || [])
    } catch (err) {
      console.error('Failed to fetch runs:', err)
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
    await Promise.allSettled([fetchRows(), fetchStatus(), fetchIcps(), fetchRunsList()])
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
    setIsAllDatabaseSelected(false) // Deselect "All DB" if manually toggling
  }

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedLeads(new Set())
      setSelectAll(false)
      setIsAllDatabaseSelected(false)
    } else {
      // Select only current page first
      const allIds = new Set(filteredRows.map(row => row.id))
      setSelectedLeads(allIds)
      setSelectAll(true)
      setIsAllDatabaseSelected(false)
    }
  }

  const handleSelectReallyAll = async () => {
    try {
      setLoading(true)
      // Fetch ALL IDs matching current filters
      const allIds = await fetchAllLeadIds({
        status: filterStatus,
        icpId: filters.icpId,
        runId: filters.runId
      });
      setSelectedLeads(new Set(allIds))
      setSelectAll(true)
      setIsAllDatabaseSelected(true)
    } catch (err) {
      console.error(err)
      setError('Failed to select all leads')
    } finally {
      setLoading(false)
    }
  }

  // CSV Export Function - Handles both "Selected Only" and "Export All"
  const exportToCSV = async () => {
    // 1. Export All Database (Server-side) -- PRIORITY if flag is set
    if (isAllDatabaseSelected) {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (filters.icpId) params.append('icpId', filters.icpId);
        if (filters.runId) params.append('runId', filters.runId);
        if (filterStatus) params.append('status', filterStatus); // Keep status filter

        // Direct link is easiest for file download
        window.location.href = `/api/leads/export?${params.toString()}`;

        // Reset loading shortly after trigger
        setTimeout(() => setLoading(false), 2000);
        return;
      } catch (err) {
        console.error(err)
        setError('Failed to export leads')
        setLoading(false)
        return;
      }
    }

    // 2. Export Selected (Client-side) -- Only if NOT all database
    if (selectedLeads.size > 0) {
      const leadsToExport = filteredRows.filter(row => selectedLeads.has(row.id))
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `leads_export_selected_${timestamp}.csv`;

      // Define CSV headers
      const headers = ['Name', 'Email', 'Title', 'Company', 'LinkedIn', 'Phone Numbers', 'Connection Request', 'Date Added', 'Company Profile'];

      // Convert rows to CSV format
      const csvRows = leadsToExport.map(row => [
        row.name,
        row.email,
        row.title,
        row.company,
        row.linkedin,
        Array.isArray(row.phoneNumbers) ? row.phoneNumbers.join('; ') : '',
        row.connectionRequest,
        row.date,
        (row.companyProfile || '').replace(/[\n\r]+/g, ' ')
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
      setIsAllDatabaseSelected(false)
      return;
    }

    // 2. Export All (Server-side)
    if (!window.confirm(`Export ALL leads in the system${filters.icpId ? ' matching the current Strategy filter' : ''}?`)) return;

    try {
      setLoading(true);
      // Construct URL with auth is handled by browser cookie if we just window.open? 
      // No, window.open might not handle errors gracefully or might need header if auth uses header (Auth uses Cookie 'token', so window.open works).

      const params = new URLSearchParams();
      if (filters.icpId) params.append('icpId', filters.icpId);
      if (filters.runId) params.append('runId', filters.runId);

      // Use fetch to handle errors better, or just direct link
      // Direct link is easiest for file download
      window.location.href = `/api/leads/export?${params.toString()}`;

      // Since we can't easily detect when window.location download finishes, just reset loading after a short delay
      setTimeout(() => setLoading(false), 2000);

    } catch (err) {
      console.error(err)
      setError('Failed to export leads')
      setLoading(false)
    }
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
      const matchesName = filters.name
        ? row.name?.toLowerCase().includes(filters.name.toLowerCase())
        : true
      const matchesIcp = filters.icpId ? row.icpId === filters.icpId : true
      const matchesRun = filters.runId ? row.runId === filters.runId : true

      // Tab Filtering
      let matchesTab = true;
      if (activeTab === 'review') {
        matchesTab = row.status === 'MANUAL_REVIEW';
      } else if (activeTab === 'ready') {
        matchesTab = ['approved', 'success', 'new'].includes(row.status?.toLowerCase());
        // Also exclude manual review?
        matchesTab = matchesTab && row.status !== 'MANUAL_REVIEW';
      }

      return matchesDate && matchesCompany && matchesName && matchesIcp && matchesRun && matchesTab

      // Server now strictly filters out SKIPPED and low-score leads, so no client-side override needed
      return matchesDate && matchesCompany && matchesName && matchesIcp && matchesRun
    })
  }, [rows, filters])

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] font-bold text-teal-400">LeadFlow</p>
              <h1 className="font-serif text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                <Users className="w-8 h-8 text-teal-500" />
                Operations Console
              </h1>
              <p className="text-sm text-gray-400 mt-1">Live sync from your AI Lead Sheet.</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Status Chips */}
              <div className="flex items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-400">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${health.sheet === 'ok' ? 'bg-teal-400 shadow-sm shadow-teal-400/30' : 'bg-amber-400'
                    }`}
                />
                Sheet
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-400">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${health.agent === 'ok' ? 'bg-teal-400 shadow-sm shadow-teal-400/30' : 'bg-amber-400'
                    }`}
                />
                Agent
              </div>

              <button
                type="button"
                onClick={toggleSelectAll}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-300 hover:text-white hover:bg-white/5 border border-white/10 rounded-xl transition-all"
              >
                <Check className={`h-4 w-4 ${selectAll ? 'text-teal-400' : 'text-gray-500'}`} />
                {selectAll ? 'Deselect All' : 'Select Page'}
              </button>

              <button
                type="button"
                onClick={handleClearSheet}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 rounded-xl transition-all"
              >
                <Trash2 className="h-4 w-4" />
                Clear All
              </button>

              {selectedLeads.size > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-bold text-white animated-pulse">
                  <div className="h-2 w-2 rounded-full bg-teal-400"></div>
                  {selectedLeads.size} selected
                </div>
              )}

              <button
                type="button"
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-teal-400 hover:text-teal-300 hover:bg-teal-500/10 border border-teal-500/20 rounded-xl transition-all"
              >
                <Download className="h-4 w-4" />
                {selectedLeads.size > 0 ? `Export (${selectedLeads.size})` : 'Export CSV'}
              </button>
              {selectedLeads.size > 0 && (
                <button
                  type="button"
                  onClick={() => setIsOutreachOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 border border-blue-500/20 rounded-xl transition-all"
                >
                  <Upload className="h-4 w-4" />
                  Push to Outreach ({selectedLeads.size})
                </button>
              )}
              <button
                type="button"
                onClick={refreshAll}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-300 hover:text-white hover:bg-white/5 border border-white/10 rounded-xl transition-all"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <Link
                to="/runner"
                className="inline-flex items-center gap-2 rounded-2xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-black shadow-lg shadow-teal-500/30 transition-all duration-200 hover:-translate-y-[1px] hover:bg-teal-400"
              >
                Start New Job
              </Link>
            </div>
          </div>
        </div>


        {/* Tabs */}
        <div className="flex items-center gap-1 bg-white/5 backdrop-blur-md p-1 rounded-xl border border-white/10 w-fit">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'all'
                ? 'bg-teal-500 text-black shadow-lg shadow-teal-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
          >
            All Leads
          </button>
          <button
            onClick={() => setActiveTab('review')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${activeTab === 'review'
                ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
          >
            Manual Review
          </button>
          <button
            onClick={() => setActiveTab('ready')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'ready'
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
          >
            Confirmed for Outreach
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 flex items-center gap-4">
            <CalendarDays className="h-11 w-11 rounded-xl bg-teal-500/10 p-2.5 text-teal-400 border border-teal-500/20" />
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-gray-400">Latest entry</p>
              <p className="font-serif text-2xl font-bold text-white">{rows[0]?.date || 'No data yet'}</p>
            </div>
          </div>
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 flex items-center gap-4">
            <Building2 className="h-11 w-11 rounded-xl bg-teal-500/10 p-2.5 text-teal-400 border border-teal-500/20" />
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-gray-400">Total companies</p>
              <p className="font-serif text-2xl font-bold text-white">
                {totalUniqueCompanies || new Set((rows || []).map((r) => r.company).filter(Boolean)).size}
              </p>
            </div>
          </div>
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-gray-400">Leads tracked</p>
              <p className="font-serif text-2xl font-bold text-white">{pagination.total || rows.length}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500 text-black font-serif text-lg font-bold shadow-lg shadow-teal-500/30">
              {pagination.total || rows.length}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="date"
              className="text-[11px] font-semibold uppercase tracking-wider text-gray-400"
            >
              Filter by date
            </label>
            <input
              id="date"
              type="date"
              value={filters.date}
              onChange={(e) => setFilters((prev) => ({ ...prev, date: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-all duration-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="company"
              className="text-[11px] font-semibold uppercase tracking-wider text-gray-400"
            >
              Filter by company
            </label>
            <input
              id="company"
              type="text"
              placeholder="Acme Corp"
              value={filters.company}
              onChange={(e) => setFilters((prev) => ({ ...prev, company: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all duration-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="name"
              className="text-[11px] font-semibold uppercase tracking-wider text-gray-400"
            >
              Filter by Lead Name
            </label>
            <input
              id="name"
              type="text"
              placeholder="Roelof van Heeren"
              value={filters.name}
              onChange={(e) => setFilters((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all duration-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="icp"
              className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2"
            >
              <Target className="w-3 h-3" /> Filter by Strategy
            </label>
            <select
              id="icp"
              value={filters.icpId}
              onChange={(e) => setFilters((prev) => ({ ...prev, icpId: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-all duration-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="">All Strategies</option>
              {icps.map(icp => (
                <option key={icp.id} value={icp.id}>{icp.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="run"
              className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2"
            >
              <RefreshCw className="w-3 h-3" /> Filter by Run (Job)
            </label>
            <select
              id="run"
              value={filters.runId}
              onChange={(e) => setFilters((prev) => ({ ...prev, runId: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-all duration-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="">All Runs</option>
              {runs.map(run => (
                <option key={run.id} value={run.id}>
                  {run.run_name || `Run #${run.run_number}`} ({new Date(run.started_at).toLocaleDateString()})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selection Banner */}
        {selectedLeads.size > 0 && selectedLeads.size < pagination.total && selectAll && (
          <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-3 flex items-center justify-center gap-4 text-sm text-teal-300 animate-in fade-in slide-in-from-top-2">
            <span>
              All <strong>{rows.length}</strong> leads on this page are selected.
            </span>
            <button
              onClick={handleSelectReallyAll}
              className="font-bold underline underline-offset-4 hover:text-white"
            >
              Select all {pagination.total} leads in database
            </button>
          </div>
        )}

        {/* Sheet Table */}
        <SheetTable
          rows={filteredRows}
          loading={loading}
          error={error}
          onDeleteRow={handleDeleteRow}
          onEnrichRow={handleEnrichRow}
          onDeepEnrichRow={handleDeepEnrichRow}
          onRegenerateRow={handleRegenerateRow}
          onReviewRow={handleReviewRow}
          selectedLeads={selectedLeads}
          onToggleSelection={toggleLeadSelection}
          onToggleSelectAll={toggleSelectAll}
          selectAll={selectAll}
        />

        {/* Pagination Controls */}
        {pagination.totalPages > 1 && (
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-4 flex items-center justify-between">
            <div className="text-sm text-gray-400">
              Showing page <span className="font-semibold text-white">{currentPage}</span> of{' '}
              <span className="font-semibold text-white">{pagination.totalPages}</span>
              {' '}({pagination.total} total leads)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchRows(currentPage - 1)}
                disabled={!pagination.hasPrevious || loading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5 border-white/10 text-gray-300 hover:text-white"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <span className="px-4 py-2 text-sm font-semibold text-white">
                Page {currentPage}
              </span>
              <button
                onClick={() => fetchRows(currentPage + 1)}
                disabled={!pagination.hasNext || loading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5 border-white/10 text-gray-300 hover:text-white"
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

        <OutreachModal
          isOpen={isOutreachOpen}
          onClose={() => setIsOutreachOpen(false)}
          selectedLeadsCount={selectedLeads.size}
          selectedLeadIds={selectedLeads}
          onComplete={() => {
            // Optional: Refresh rows to show status update if we tracked it in UI
            // fetchRows()
            setSelectedLeads(new Set())
            setSelectAll(false)
          }}
        />

        <LeadReviewModal
          isOpen={isReviewOpen}
          onClose={() => setIsReviewOpen(false)}
          lead={reviewLead}
          onComplete={async () => {
            await fetchRows()
            setIsReviewOpen(false)
          }}
        />
      </div>
    </div>
  )
}

export default CRM
