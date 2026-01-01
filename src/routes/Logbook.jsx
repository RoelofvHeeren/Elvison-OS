import React, { useState, useEffect } from 'react'
import { Book, Clock, CheckCircle, AlertCircle, Trash2, ChevronDown, ChevronUp, RefreshCw, ThumbsUp, Building, Users, Filter, Check, DollarSign, Zap, Activity } from 'lucide-react'
import { fetchRuns, fetchLeads, approveLead, deleteLead, enrichLead } from '../utils/api'

const Logbook = () => {
    const [activeTab, setActiveTab] = useState('history') // 'history' | 'disqualified'

    // Job History State
    const [runs, setRuns] = useState([])
    const [loadingRuns, setLoadingRuns] = useState(false)
    const [expandedRunId, setExpandedRunId] = useState(null)

    // Disqualified Leads State
    const [droppedLeads, setDroppedLeads] = useState([])
    const [loadingLeads, setLoadingLeads] = useState(false)
    const [selectedLeads, setSelectedLeads] = useState(new Set())
    const [selectAll, setSelectAll] = useState(false)

    // Approval Modal State
    const [approvalModalOpen, setApprovalModalOpen] = useState(false)
    const [selectedLeadId, setSelectedLeadId] = useState(null)
    const [approvalReason, setApprovalReason] = useState('')
    const [submittingApproval, setSubmittingApproval] = useState(false)
    const [enrichingId, setEnrichingId] = useState(null)

    useEffect(() => {
        if (activeTab === 'history') {
            loadRuns()
        } else {
            loadDroppedLeads()
        }
    }, [activeTab])

    const loadRuns = async () => {
        setLoadingRuns(true)
        try {
            const data = await fetchRuns()
            setRuns(Array.isArray(data) ? data : [])
        } catch (e) {
            console.error("Failed to load runs", e)
            setRuns([])
        } finally {
            setLoadingRuns(false)
        }
    }

    const loadDroppedLeads = async () => {
        setLoadingLeads(true)
        try {
            const data = await fetchLeads({ status: 'DISQUALIFIED' })
            const leadsArray = Array.isArray(data) ? data : (data?.data || [])
            setDroppedLeads(leadsArray)
        } catch (e) {
            console.error("Failed to load disqualified leads", e)
            setDroppedLeads([])
        } finally {
            setLoadingLeads(false)
        }
    }

    const openApprovalModal = (leadId) => {
        setSelectedLeadId(leadId)
        setApprovalReason('')
        setApprovalModalOpen(true)
    }

    const confirmApproval = async () => {
        if (!approvalReason.trim()) {
            alert('Please provide a reason for reinstating this lead')
            return
        }

        setSubmittingApproval(true)
        try {
            await approveLead(selectedLeadId, approvalReason)
            setDroppedLeads(prev => prev.filter(l => l.id !== selectedLeadId))
            setApprovalModalOpen(false)
            setSelectedLeadId(null)
            setApprovalReason('')
        } catch (error) {
            console.error('Failed to approve lead:', error)
            alert('Failed to reinstate lead. Please try again.')
        } finally {
            setSubmittingApproval(false)
        }
    }

    const toggleRunExpand = (runId) => {
        setExpandedRunId(expandedRunId === runId ? null : runId)
    }

    const toggleLeadSelection = (leadId) => {
        const newSelected = new Set(selectedLeads)
        if (newSelected.has(leadId)) {
            newSelected.delete(leadId)
        } else {
            newSelected.add(leadId)
        }
        setSelectedLeads(newSelected)
        setSelectAll(newSelected.size === droppedLeads.length && droppedLeads.length > 0)
    }

    const toggleSelectAll = () => {
        if (selectAll) {
            setSelectedLeads(new Set())
            setSelectAll(false)
        } else {
            setSelectedLeads(new Set(droppedLeads.map(l => l.id)))
            setSelectAll(true)
        }
    }

    const reinstateSelected = async () => {
        if (selectedLeads.size === 0) {
            alert('Please select at least one lead to reinstate')
            return
        }

        const reason = prompt('Why are these leads being reinstated? (This helps train the AI)')
        if (!reason || !reason.trim()) return

        try {
            await Promise.all(
                Array.from(selectedLeads).map(leadId => approveLead(leadId, reason))
            )
            setDroppedLeads(prev => prev.filter(l => !selectedLeads.has(l.id)))
            setSelectedLeads(new Set())
            setSelectAll(false)
            alert(`Successfully reinstated ${selectedLeads.size} leads`)
        } catch (error) {
            console.error('Failed to reinstate leads:', error)
            alert('Failed to reinstate some leads. Please try again.')
        }
    }

    const handleDeleteLead = async (leadId) => {
        if (!confirm('Are you sure you want to permanently delete this disqualified lead?')) return

        try {
            await deleteLead(leadId)
            setDroppedLeads(prev => prev.filter(l => l.id !== leadId))
            selectedLeads.delete(leadId)
            setSelectedLeads(new Set(selectedLeads))
        } catch (error) {
            console.error('Failed to delete lead:', error)
            alert('Failed to delete lead. Please try again.')
        }
    }

    const deleteSelected = async () => {
        if (selectedLeads.size === 0) {
            alert('Please select at least one lead to delete')
            return
        }

        if (!confirm(`Are you sure you want to permanently delete ${selectedLeads.size} disqualified leads? This cannot be undone.`)) return

        try {
            await Promise.all(
                Array.from(selectedLeads).map(leadId => deleteLead(leadId))
            )
            setDroppedLeads(prev => prev.filter(l => !selectedLeads.has(l.id)))
            setSelectedLeads(new Set())
            setSelectAll(false)
            alert(`Successfully deleted ${selectedLeads.size} leads`)
        } catch (error) {
            console.error('Failed to delete leads:', error)
            alert('Failed to delete some leads. Please try again.')
        }
    }

    const handleEnrichLead = async (leadId) => {
        setEnrichingId(leadId)
        try {
            const result = await enrichLead(leadId)
            if (result.success) {
                alert(`Enrichment Successful! Found ${result.phones?.length || 0} numbers.`)
                // Refresh runs or local update could be complex, for now just alert
            } else {
                alert(`Enrichment result: ${result.message}`)
            }
        } catch (err) {
            console.error(err)
            alert('Enrichment failed.')
        } finally {
            setEnrichingId(null)
        }
    }

    const parseRunStats = (run) => {
        // Parse metadata and output_data to extract stats
        const metadata = typeof run.metadata === 'string' ? JSON.parse(run.metadata) : (run.metadata || {})
        const outputData = typeof run.output_data === 'string' ? JSON.parse(run.output_data) : (run.output_data || {})

        // Extract stats from workflow output (stats object) or result object
        const stats = outputData.stats || metadata.stats || outputData || metadata || {}
        const filtering = stats.filtering_breakdown || {}
        const leads = outputData.leads || metadata.leads || []
        const apiCosts = stats.api_costs || {}

        // Extract execution timeline (new format) or execution logs (old format)
        const executionTimeline = outputData.execution_timeline || metadata.execution_timeline || []
        const executionLogs = outputData.execution_logs || metadata.execution_logs || outputData.executionLogs || metadata.executionLogs || []

        return {
            companies: stats.companies_discovered || stats.companiesFound || 0,
            totalLeads: stats.leads_returned || stats.leadsGenerated || 0,
            qualified: filtering.qualified || stats.qualified || stats.leadsQualified || 0,
            disqualified: filtering.dropped || stats.dropped || stats.leadsDisqualified || 0,
            emailYield: stats.email_yield_percentage || stats.emailYield || 0,
            logs: executionLogs.length > 0 ? executionLogs : executionTimeline,
            timeline: executionTimeline,
            leads: leads,
            companies_list: Array.from(new Set(leads.map(l => l.company_name).filter(Boolean))),
            // API Cost tracking
            apiCosts: {
                totalCost: apiCosts.total_cost || '$0.00',
                totalTokens: apiCosts.total_tokens || 0,
                inputTokens: apiCosts.input_tokens || 0,
                outputTokens: apiCosts.output_tokens || 0,
                totalCalls: apiCosts.total_calls || 0,
                byAgent: apiCosts.by_agent || {},
                byModel: apiCosts.by_model || {},
                detailedCalls: apiCosts.detailed_calls || []
            }
        }
    }

    const formatDuration = (startedAt, completedAt) => {
        if (!startedAt || !completedAt) return 'Unknown'
        const start = new Date(startedAt)
        const end = new Date(completedAt)
        const diffMs = end - start
        const minutes = Math.floor(diffMs / 60000)
        const seconds = Math.floor((diffMs % 60000) / 1000)
        return `${minutes}m ${seconds}s`
    }

    return (
        <div className="min-h-screen p-6 lg:p-8">
            <div className="max-w-[1400px] mx-auto space-y-6">
                {/* Header */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                    <h1 className="font-serif text-3xl font-bold text-white flex items-center gap-3">
                        <Book className="w-8 h-8 text-[#139187]" />
                        Workflow Logbook
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">
                        Review workflow runs, execution logs, and disqualified leads
                    </p>
                </div>

                {/* Tabs */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
                    <nav className="flex" aria-label="Tabs">
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`flex-1 py-4 px-6 font-medium text-sm transition-colors ${activeTab === 'history'
                                ? 'bg-teal-500/20 text-teal-400 border-b-2 border-teal-400'
                                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
                                }`}
                        >
                            <span className="flex items-center justify-center gap-2">
                                <Clock className="w-4 h-4" />
                                Workflow Runs
                            </span>
                        </button>
                        <button
                            onClick={() => setActiveTab('disqualified')}
                            className={`flex-1 py-4 px-6 font-medium text-sm transition-colors ${activeTab === 'disqualified'
                                ? 'bg-teal-500/20 text-teal-400 border-b-2 border-teal-400'
                                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
                                }`}
                        >
                            <span className="flex items-center justify-center gap-2">
                                <Trash2 className="w-4 h-4" />
                                Disqualified Leads
                            </span>
                        </button>
                    </nav>
                </div>

                {/* TAB CONTENT: WORKFLOW RUNS */}
                {activeTab === 'history' && (
                    <div className="space-y-4">
                        <div className="flex justify-end">
                            <button
                                onClick={loadRuns}
                                className="flex items-center gap-2 px-4 py-2 bg-black/20 hover:bg-white/5 text-gray-300 rounded-lg transition-colors border border-white/10"
                            >
                                <RefreshCw className={`w-4 h-4 ${loadingRuns ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                        </div>

                        {loadingRuns ? (
                            <div className="text-center py-12 text-gray-400">Loading workflow runs...</div>
                        ) : runs.length === 0 ? (
                            <div className="bg-gray-800/50 backdrop-blur-md border border-gray-700/50 rounded-2xl p-12 text-center">
                                <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                                <p className="text-white font-medium">No workflow runs yet</p>
                                <p className="text-sm text-gray-400 mt-1">Start a workflow to see run history here</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {runs.map((run) => {
                                    const stats = parseRunStats(run)
                                    const isExpanded = expandedRunId === run.id
                                    const statusColor = run.status === 'COMPLETED' ? 'text-green-400'
                                        : run.status === 'PARTIAL' ? 'text-orange-400'
                                            : run.status === 'FAILED' ? 'text-red-400'
                                                : run.status === 'RUNNING' ? 'text-yellow-400'
                                                    : 'text-gray-400'
                                    const statusIcon = run.status === 'COMPLETED' ? '✓'
                                        : run.status === 'PARTIAL' ? '⚠'
                                            : run.status === 'FAILED' ? '✗'
                                                : ''

                                    return (
                                        <div key={run.id} className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
                                            {/* Run Header */}
                                            <div
                                                className="p-6 cursor-pointer hover:bg-white/5 transition-colors"
                                                onClick={() => toggleRunExpand(run.id)}
                                            >
                                                <div className="flex items-start justify-between mb-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-12 h-12 rounded-full bg-[#139187]/10 border border-[#139187]/20 flex items-center justify-center">
                                                            <Clock className="w-6 h-6 text-[#139187]" />
                                                        </div>
                                                        <div>
                                                            <h3 className="font-semibold text-white text-lg">
                                                                Workflow Run
                                                            </h3>
                                                            <p className="text-sm text-gray-400">
                                                                {new Date(run.started_at).toLocaleString()}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className={`text-sm font-medium ${statusColor}`}>
                                                            {statusIcon && `${statusIcon} `}
                                                            {run.status}
                                                            {run.status === 'PARTIAL' && ' (Target Not Met)'}
                                                            {(run.status === 'COMPLETED' || run.status === 'PARTIAL') && run.completed_at && (
                                                                <span className="text-gray-400 ml-2">
                                                                    in {formatDuration(run.started_at, run.completed_at)}
                                                                </span>
                                                            )}
                                                        </span>
                                                        {isExpanded ? (
                                                            <ChevronUp className="w-5 h-5 text-gray-400" />
                                                        ) : (
                                                            <ChevronDown className="w-5 h-5 text-gray-400" />
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Stats Grid */}
                                                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                                                    <div className="bg-black/20 rounded-lg p-4 border border-white/10">
                                                        <Building className="w-5 h-5 text-[#139187] mb-2" />
                                                        <p className="text-2xl font-bold text-white">{stats.companies}</p>
                                                        <p className="text-xs text-gray-400 uppercase tracking-wider">Companies</p>
                                                    </div>
                                                    <div className="bg-black/20 rounded-lg p-4 border border-white/10">
                                                        <Users className="w-5 h-5 text-[#139187] mb-2" />
                                                        <p className="text-2xl font-bold text-white">{stats.totalLeads}</p>
                                                        <p className="text-xs text-gray-400 uppercase tracking-wider">Total Leads</p>
                                                    </div>
                                                    <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
                                                        <CheckCircle className="w-5 h-5 text-green-400 mb-2" />
                                                        <p className="text-2xl font-bold text-white">{stats.qualified}</p>
                                                        <p className="text-xs text-gray-400 uppercase tracking-wider">Qualified</p>
                                                    </div>
                                                    <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
                                                        <Filter className="w-5 h-5 text-[#139187] mb-2" />
                                                        <p className="text-2xl font-bold text-white">{stats.disqualified}</p>
                                                        <p className="text-xs text-gray-400 uppercase tracking-wider">Disqualified</p>
                                                    </div>
                                                    {/* API Cost Card */}
                                                    <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 rounded-lg p-4 border border-yellow-500/20">
                                                        <DollarSign className="w-5 h-5 text-yellow-400 mb-2" />
                                                        <p className="text-2xl font-bold text-yellow-300">{stats.apiCosts.totalCost}</p>
                                                        <p className="text-xs text-gray-400 uppercase tracking-wider">API Cost</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Expanded: Execution Logs */}
                                            {isExpanded && (
                                                <div className="px-6 pb-6 border-t border-gray-700/50 space-y-4">
                                                    {/* Companies Found */}
                                                    {stats.companies_list && stats.companies_list.length > 0 && (
                                                        <div className="bg-black/20 rounded-xl p-6 border border-white/10">
                                                            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Companies Found ({stats.companies_list.length})</h4>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                                                {stats.companies_list.map((company, idx) => (
                                                                    <div key={idx} className="flex items-center gap-2 text-sm bg-white/5 rounded-lg p-2 border border-white/5">
                                                                        <Building className="w-4 h-4 text-[#139187] flex-shrink-0" />
                                                                        <span className="text-white truncate">{company}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Leads Found */}
                                                    {stats.leads && stats.leads.length > 0 && (
                                                        <div className="bg-black/20 rounded-xl p-6 border border-white/10">
                                                            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Leads Found ({stats.leads.length})</h4>
                                                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                                                {stats.leads.map((lead, idx) => (
                                                                    <div key={idx} className="flex items-start gap-3 text-sm bg-white/5 rounded-lg p-3 border border-white/5">
                                                                        <div className="flex-1">
                                                                            <p className="text-white font-medium">
                                                                                {lead.first_name} {lead.last_name}
                                                                            </p>
                                                                            <p className="text-gray-400 text-xs">{lead.title}</p>
                                                                            <p className="text-gray-500 text-xs mt-1">{lead.company_name}</p>
                                                                        </div>
                                                                        {lead.email && (
                                                                            <a href={`mailto:${lead.email}`} className="text-[#139187] text-xs hover:underline flex-shrink-0">
                                                                                {lead.email}
                                                                            </a>
                                                                        )}
                                                                        {lead.linkedin_url && (
                                                                            <button
                                                                                onClick={() => handleEnrichLead(lead.id)}
                                                                                disabled={enrichingId === lead.id}
                                                                                className="ml-auto text-xs bg-teal-500/10 text-teal-400 px-2 py-1 rounded hover:bg-teal-500/20 disabled:opacity-50"
                                                                            >
                                                                                {enrichingId === lead.id ? '...' : '+ Enrich Phone'}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Execution Timeline */}
                                                    <div className="bg-black/20 rounded-xl p-6 border border-white/10">
                                                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                                                            <Clock className="w-4 h-4" />
                                                            Execution Timeline
                                                        </h4>
                                                        {stats.logs && stats.logs.length > 0 ? (
                                                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                                                {stats.logs.map((log, idx) => {
                                                                    // Determine status color
                                                                    const statusColor =
                                                                        log.status === 'completed' ? 'bg-green-400' :
                                                                            log.status === 'started' ? 'bg-blue-400' :
                                                                                log.status === 'partial' ? 'bg-orange-400' :
                                                                                    log.status === 'failed' ? 'bg-red-400' :
                                                                                        log.status === 'skipped' ? 'bg-gray-500' :
                                                                                            'bg-gray-400';

                                                                    return (
                                                                        <div key={idx} className="flex gap-3 text-sm bg-black/20 rounded-lg p-3 border border-white/5">
                                                                            <div className="flex-shrink-0 flex flex-col items-center">
                                                                                <span className={`w-2 h-2 rounded-full ${statusColor}`}></span>
                                                                                <div className="w-0.5 h-full bg-white/10 mt-1"></div>
                                                                            </div>
                                                                            <div className="flex-1">
                                                                                <div className="flex items-center justify-between">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="font-medium text-white">{log.stage || log.step}</span>
                                                                                        {log.status && (
                                                                                            <span className={`text-xs px-2 py-0.5 rounded ${log.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                                                                                log.status === 'started' ? 'bg-blue-500/20 text-blue-400' :
                                                                                                    log.status === 'partial' ? 'bg-orange-500/20 text-orange-400' :
                                                                                                        log.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                                                                                            'bg-gray-500/20 text-gray-400'
                                                                                                }`}>
                                                                                                {log.status}
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                    <span className="text-gray-500 font-mono text-xs">
                                                                                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}
                                                                                    </span>
                                                                                </div>
                                                                                {log.message && (
                                                                                    <p className="text-gray-400 text-xs mt-1">{log.message}</p>
                                                                                )}
                                                                                {log.duration && (
                                                                                    <p className="text-gray-600 text-xs mt-1">Duration: {log.duration}</p>
                                                                                )}
                                                                                {log.details && typeof log.details === 'object' && Object.keys(log.details).length > 0 && (
                                                                                    <div className="mt-2 text-xs text-gray-600">
                                                                                        {Object.entries(log.details)
                                                                                            .filter(([k]) => !['timestamp', 'stage', 'status', 'duration', 'message'].includes(k))
                                                                                            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                                                                                            .join(' • ')}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        ) : (
                                                            <p className="text-sm text-gray-500">No execution logs available</p>
                                                        )}
                                                    </div>

                                                    {/* API Cost Breakdown */}
                                                    {(stats.apiCosts.totalCalls > 0 || stats.apiCosts.totalTokens > 0) && (
                                                        <div className="bg-gradient-to-br from-yellow-500/5 to-orange-500/5 rounded-xl p-6 border border-yellow-500/20">
                                                            <h4 className="text-xs font-bold uppercase tracking-wider text-yellow-400 mb-4 flex items-center gap-2">
                                                                <DollarSign className="w-4 h-4" />
                                                                API Cost Breakdown
                                                            </h4>

                                                            {/* Summary Stats */}
                                                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                                                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                                                    <p className="text-lg font-bold text-yellow-300">{stats.apiCosts.totalCost}</p>
                                                                    <p className="text-xs text-gray-500">Total Cost</p>
                                                                </div>
                                                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                                                    <p className="text-lg font-bold text-white">{stats.apiCosts.totalTokens?.toLocaleString()}</p>
                                                                    <p className="text-xs text-gray-500">Total Tokens</p>
                                                                </div>
                                                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                                                    <p className="text-lg font-bold text-blue-300">{stats.apiCosts.inputTokens?.toLocaleString()}</p>
                                                                    <p className="text-xs text-gray-500">Input Tokens</p>
                                                                </div>
                                                                <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                                                    <p className="text-lg font-bold text-green-300">{stats.apiCosts.outputTokens?.toLocaleString()}</p>
                                                                    <p className="text-xs text-gray-500">Output Tokens</p>
                                                                </div>
                                                            </div>

                                                            {/* By Agent Breakdown */}
                                                            {Object.keys(stats.apiCosts.byAgent).length > 0 && (
                                                                <div className="mb-6">
                                                                    <h5 className="text-xs font-semibold text-gray-400 mb-3 flex items-center gap-2">
                                                                        <Activity className="w-3 h-3" />
                                                                        Cost by Agent
                                                                    </h5>
                                                                    <div className="space-y-2">
                                                                        {Object.entries(stats.apiCosts.byAgent).map(([agent, data]) => (
                                                                            <div key={agent} className="flex items-center justify-between bg-black/20 rounded-lg p-3 border border-white/5">
                                                                                <div className="flex items-center gap-3">
                                                                                    <Zap className="w-4 h-4 text-purple-400" />
                                                                                    <div>
                                                                                        <p className="text-sm font-medium text-white">{agent}</p>
                                                                                        <p className="text-xs text-gray-500">
                                                                                            {data.callCount} call{data.callCount !== 1 ? 's' : ''} • {data.totalTokens?.toLocaleString()} tokens
                                                                                        </p>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="text-right">
                                                                                    <p className="text-sm font-bold text-yellow-300">${data.cost?.toFixed(4)}</p>
                                                                                    <p className="text-xs text-gray-500">avg {data.avgDuration?.toFixed(1)}s</p>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* By Model Breakdown */}
                                                            {Object.keys(stats.apiCosts.byModel).length > 0 && (
                                                                <div className="mb-6">
                                                                    <h5 className="text-xs font-semibold text-gray-400 mb-3">Cost by Model</h5>
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                        {Object.entries(stats.apiCosts.byModel).map(([model, data]) => (
                                                                            <div key={model} className="flex items-center justify-between bg-black/20 rounded-lg p-3 border border-white/5">
                                                                                <div>
                                                                                    <p className="text-xs font-mono text-gray-300">{model}</p>
                                                                                    <p className="text-xs text-gray-500">{data.callCount} calls</p>
                                                                                </div>
                                                                                <p className="text-sm font-bold text-yellow-300">${data.cost?.toFixed(4)}</p>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Detailed Calls - ALWAYS VISIBLE for full transparency */}
                                                            {stats.apiCosts.detailedCalls && stats.apiCosts.detailedCalls.length > 0 && (
                                                                <div>
                                                                    <h5 className="text-xs font-semibold text-gray-400 mb-3 flex items-center gap-2">
                                                                        <Activity className="w-3 h-3" />
                                                                        All API Calls ({stats.apiCosts.detailedCalls.length} calls)
                                                                    </h5>
                                                                    <div className="space-y-2 max-h-[500px] overflow-y-auto">
                                                                        {stats.apiCosts.detailedCalls.map((call, idx) => (
                                                                            <div key={idx} className="bg-black/30 rounded-lg p-3 border border-white/5">
                                                                                <div className="flex items-center justify-between mb-2">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className={`w-2 h-2 rounded-full ${call.success ? 'bg-green-400' : 'bg-red-400'}`}></span>
                                                                                        <span className="text-sm font-medium text-white">{call.agent}</span>
                                                                                        <span className="text-xs text-gray-600">•</span>
                                                                                        <span className="text-xs font-mono text-purple-400">{call.model}</span>
                                                                                    </div>
                                                                                    <span className="text-sm font-bold text-yellow-300">${call.cost?.toFixed(6)}</span>
                                                                                </div>
                                                                                <div className="grid grid-cols-4 gap-4 text-xs">
                                                                                    <div>
                                                                                        <p className="text-gray-500">Input Tokens</p>
                                                                                        <p className="text-blue-300 font-mono">{call.inputTokens?.toLocaleString() || 0}</p>
                                                                                    </div>
                                                                                    <div>
                                                                                        <p className="text-gray-500">Output Tokens</p>
                                                                                        <p className="text-green-300 font-mono">{call.outputTokens?.toLocaleString() || 0}</p>
                                                                                    </div>
                                                                                    <div>
                                                                                        <p className="text-gray-500">Duration</p>
                                                                                        <p className="text-gray-300 font-mono">{call.duration?.toFixed(2)}s</p>
                                                                                    </div>
                                                                                    <div>
                                                                                        <p className="text-gray-500">Total Tokens</p>
                                                                                        <p className="text-white font-mono">{((call.inputTokens || 0) + (call.outputTokens || 0)).toLocaleString()}</p>
                                                                                    </div>
                                                                                </div>
                                                                                {call.metadata && Object.keys(call.metadata).length > 0 && (
                                                                                    <div className="mt-2 pt-2 border-t border-white/5">
                                                                                        <p className="text-xs text-gray-600">
                                                                                            {Object.entries(call.metadata).map(([k, v]) => `${k}: ${v}`).join(' • ')}
                                                                                        </p>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {run.error_log && (
                                                        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                                                            <h4 className="text-sm font-semibold text-red-400 mb-2">Error Details:</h4>
                                                            <p className="text-sm text-red-300 font-mono">{run.error_log}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* TAB CONTENT: DISQUALIFIED LEADS */}
                {activeTab === 'disqualified' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center bg-white/5 backdrop-blur-md border border-white/10 p-4 rounded-xl">
                            <div className="flex items-center gap-3">
                                <AlertCircle className="text-[#139187] w-5 h-5" />
                                <p className="text-sm text-gray-300">
                                    These leads were filtered out by the AI. Review and reinstate to restore to CRM.
                                </p>
                            </div>
                            <div className="flex gap-2">
                                {selectedLeads.size > 0 && (
                                    <>
                                        <button
                                            onClick={reinstateSelected}
                                            className="px-4 py-2 bg-[#139187]/20 hover:bg-[#139187]/30 text-[#139187] rounded-lg transition-colors flex items-center gap-2 border border-[#139187]/30"
                                        >
                                            <Check className="w-4 h-4" />
                                            Reinstate Selected ({selectedLeads.size})
                                        </button>
                                        <button
                                            onClick={deleteSelected}
                                            className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors flex items-center gap-2 border border-red-500/30"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            Delete Selected ({selectedLeads.size})
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={loadDroppedLeads}
                                    className="p-2 hover:bg-white/5 rounded-lg text-gray-400 transition-colors"
                                >
                                    <RefreshCw className={`w-4 h-4 ${loadingLeads ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        </div>

                        {loadingLeads ? (
                            <div className="text-center py-12 text-gray-400">Loading disqualified leads...</div>
                        ) : droppedLeads.length === 0 ? (
                            <div className="bg-gray-800/50 backdrop-blur-md border border-gray-700/50 rounded-2xl p-12 text-center">
                                <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                                <p className="text-white font-medium">No disqualified leads!</p>
                                <p className="text-sm text-gray-400 mt-1">All leads passed AI validation</p>
                            </div>
                        ) : (
                            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-black/20 text-xs font-semibold uppercase tracking-wider text-gray-400">
                                            <tr>
                                                <th className="px-4 py-3 text-left">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectAll}
                                                        onChange={toggleSelectAll}
                                                        className="rounded border-gray-600 text-[#139187] focus:ring-[#139187] focus:ring-offset-gray-900"
                                                    />
                                                </th>
                                                <th className="px-4 py-3 text-left">Person</th>
                                                <th className="px-4 py-3 text-left">Email</th>
                                                <th className="px-4 py-3 text-left">Title</th>
                                                <th className="px-4 py-3 text-left">Company</th>
                                                <th className="px-4 py-3 text-left">Reason</th>
                                                <th className="px-4 py-3"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {droppedLeads.map((lead) => {
                                                const reason = (lead.source_notes || 'AI Filtered').replace(/archived|no connection request sent|zombie/gi, '').trim() || 'Did not match ICP criteria'
                                                return (
                                                    <tr key={lead.id} className="hover:bg-white/5 transition-colors">
                                                        <td className="px-4 py-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedLeads.has(lead.id)}
                                                                onChange={() => toggleLeadSelection(lead.id)}
                                                                className="rounded border-gray-600 text-[#139187] focus:ring-[#139187] focus:ring-offset-gray-900"
                                                            />
                                                        </td>
                                                        <td className="px-4 py-3 text-white font-medium">{lead.person_name || '—'}</td>
                                                        <td className="px-4 py-3 text-gray-300">{lead.email || '—'}</td>
                                                        <td className="px-4 py-3 text-gray-400">{lead.job_title || '—'}</td>
                                                        <td className="px-4 py-3 text-gray-300">{lead.company_name || '—'}</td>
                                                        <td className="px-4 py-3 text-yellow-400 text-xs">{lead.source_notes || 'AI Filtered'}</td>
                                                        <td className="px-4 py-3 text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button
                                                                    onClick={() => openApprovalModal(lead.id)}
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#139187]/20 hover:bg-[#139187]/30 text-[#139187] text-xs font-medium rounded-lg transition-colors"
                                                                >
                                                                    <ThumbsUp className="w-3 h-3" />
                                                                    Reinstate
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteLead(lead.id)}
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium rounded-lg transition-colors"
                                                                >
                                                                    <Trash2 className="w-3 h-3" />
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Approval Modal */}
            {approvalModalOpen && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 max-w-md w-full">
                        <h3 className="text-xl font-bold text-white mb-4">Reinstate Lead</h3>
                        <p className="text-sm text-gray-400 mb-4">
                            Why should this lead be reinstated? This feedback helps train the AI.
                        </p>
                        <textarea
                            value={approvalReason}
                            onChange={(e) => setApprovalReason(e.target.value)}
                            className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 transition-all resize-none"
                            rows={4}
                            placeholder="e.g., This lead matches our ICP criteria because..."
                        />
                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setApprovalModalOpen(false)}
                                className="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                                disabled={submittingApproval}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmApproval}
                                className="flex-1 px-4 py-2.5 bg-[#139187]/20 hover:bg-[#139187]/30 text-[#139187] rounded-lg transition-colors font-medium disabled:opacity-50"
                                disabled={submittingApproval}
                            >
                                {submittingApproval ? 'Reinstating...' : 'Reinstate & Train'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Logbook
