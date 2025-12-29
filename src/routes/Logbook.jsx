import React, { useState, useEffect } from 'react'
import { Book, Clock, CheckCircle, AlertCircle, Trash2, ChevronDown, ChevronUp, RefreshCw, ThumbsUp, Building, Users, Filter, Check } from 'lucide-react'
import { fetchRuns, fetchLeads, approveLead } from '../utils/api'

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

    const parseRunStats = (run) => {
        // Parse metadata and output_data to extract stats
        const metadata = typeof run.metadata === 'string' ? JSON.parse(run.metadata) : (run.metadata || {})
        const outputData = typeof run.output_data === 'string' ? JSON.parse(run.output_data) : (run.output_data || {})

        // Extract stats from workflow output (stats object) or result object
        const stats = outputData.stats || metadata.stats || outputData || metadata || {}

        return {
            companies: stats.companies_discovered || stats.companiesFound || 0,
            totalLeads: stats.leads_returned || stats.leadsGenerated || 0,
            qualified: stats.qualified || stats.leadsQualified || 0,
            disqualified: stats.dropped || stats.leadsDisqualified || 0,
            emailYield: stats.email_yield_percentage || stats.emailYield || 0,
            logs: outputData.execution_logs || metadata.execution_logs || outputData.executionLogs || metadata.executionLogs || []
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
                                        : run.status === 'FAILED' ? 'text-red-400'
                                            : run.status === 'RUNNING' ? 'text-yellow-400'
                                                : 'text-gray-400'

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
                                                            {run.status === 'COMPLETED' && '✓ '}
                                                            {run.status === 'FAILED' && '✗ '}
                                                            {run.status}
                                                            {run.status === 'COMPLETED' && run.completed_at && (
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
                                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                                    <div className="bg-black/20 rounded-lg p-4 border border-white/10">
                                                        <Building className="w-5 h-5 text-[#139187] mb-2" />
                                                        <p className="text-2xl font-bold text-white">{stats.companies}</p>
                                                        <p className="text-xs text-gray-400 uppercase tracking-wider">Companies</p>
                                                    </div>
                                                    <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
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
                                                </div>
                                            </div>

                                            {/* Expanded: Execution Logs */}
                                            {isExpanded && (
                                                <div className="px-6 pb-6 border-t border-gray-700/50">
                                                    <div className="mt-4">
                                                        <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">
                                                            Execution Timeline
                                                        </h4>
                                                        {stats.logs.length > 0 ? (
                                                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                                                {stats.logs.map((log, idx) => (
                                                                    <div key={idx} className="bg-black/20 rounded-lg p-3 border border-white/10">
                                                                        <div className="flex items-start gap-3">
                                                                            <div className="flex-shrink-0 w-2 h-2 bg-[#139187] rounded-full mt-2"></div>
                                                                            <div className="flex-1">
                                                                                <p className="text-sm text-gray-300">{log.message || log}</p>
                                                                                {log.timestamp && (
                                                                                    <p className="text-xs text-gray-500 mt-1">
                                                                                        {new Date(log.timestamp).toLocaleTimeString()}
                                                                                    </p>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-sm text-gray-500 italic">No execution logs available</p>
                                                        )}
                                                    </div>

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
                                    <button
                                        onClick={reinstateSelected}
                                        className="px-4 py-2 bg-[#139187]/20 hover:bg-[#139187]/30 text-[#139187] rounded-lg transition-colors flex items-center gap-2 border border-[#139187]/30"
                                    >
                                        <Check className="w-4 h-4" />
                                        Reinstate Selected ({selectedLeads.size})
                                    </button>
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
                                                            <button
                                                                onClick={() => openApprovalModal(lead.id)}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#139187]/20 hover:bg-[#139187]/30 text-[#139187] text-xs font-medium rounded-lg transition-colors"
                                                            >
                                                                <ThumbsUp className="w-3 h-3" />
                                                                Reinstate
                                                            </button>
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
