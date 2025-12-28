import React, { useState, useEffect } from 'react'
import { Book, Clock, CheckCircle, AlertCircle, Trash2, FileText, ChevronRight, ChevronDown, User, Building, Mail, RefreshCw, ThumbsUp } from 'lucide-react'

import { fetchRuns, fetchLeads, approveLead } from '../utils/api'

const Logbook = () => {
    const [activeTab, setActiveTab] = useState('import') // 'import' (Job History) | 'review' (Disqualified Leads)

    // Disqualified Leads State
    const [droppedLeads, setDroppedLeads] = useState([])
    const [loadingLeads, setLoadingLeads] = useState(false)

    // Approval / Feedback State
    const [approvalModalOpen, setApprovalModalOpen] = useState(false)
    const [selectedLeadId, setSelectedLeadId] = useState(null)
    const [approvalReason, setApprovalReason] = useState('')
    const [submittingApproval, setSubmittingApproval] = useState(false)

    // Apify Integration State (Legacy/Jobs Tab)
    const [jobs, setJobs] = useState([])
    const [expandedJobId, setExpandedJobId] = useState(null)
    const [loadingJobs, setLoadingJobs] = useState(false)
    const [apifyInputs, setApifyInputs] = useState({})
    const [extracting, setExtracting] = useState({})
    const [extractionStatus, setExtractionStatus] = useState({})

    useEffect(() => {
        if (activeTab === 'review') {
            loadDroppedLeads()
        } else {
            loadJobs()
        }
    }, [activeTab])

    const loadDroppedLeads = async () => {
        setLoadingLeads(true)
        try {
            const data = await fetchLeads({ status: 'DISQUALIFIED' })
            setDroppedLeads(data || [])
        } catch (e) {
            console.error("Failed to load disqualified leads", e)
        } finally {
            setLoadingLeads(false)
        }
    }

    // --- Legacy Job Loading ---
    const loadJobs = async () => {
        setLoadingJobs(true)
        try {
            const data = await fetchRuns()
            const mapped = data.map(run => {
                let result = {}
                let prompt = 'Workflow Run'
                try {
                    if (run.output_data) result = run.output_data
                    if (typeof result === 'string') result = JSON.parse(result)
                    const meta = run.metadata || {}
                    if (meta.prompt) prompt = meta.prompt
                } catch (e) { console.error(e) }

                return {
                    id: run.id,
                    timestamp: run.started_at,
                    status: run.status === 'COMPLETED' ? 'success' : run.status.toLowerCase(),
                    prompt: prompt,
                    result: result,
                    error: run.error_log,
                    agent_id: run.agent_id
                }
            })
            setJobs(mapped)
        } catch (error) {
            console.error('Failed to load logs:', error)
        } finally {
            setLoadingJobs(false)
        }
    }

    // --- Approval Logic ---

    const openApprovalModal = (leadId) => {
        setSelectedLeadId(leadId)
        setApprovalReason('')
        setApprovalModalOpen(true)
    }

    const confirmApproval = async () => {
        if (!approvalReason.trim()) {
            alert("Please provide a reason. This helps the AI learn.")
            return
        }

        setSubmittingApproval(true)
        try {
            await approveLead(selectedLeadId, approvalReason)
            alert("Lead restored! Your feedback has been saved.")
            // Remove from list
            setDroppedLeads(prev => prev.filter(l => l.id !== selectedLeadId))
            setApprovalModalOpen(false)
        } catch (e) {
            alert("Failed to approve lead: " + e.message)
        } finally {
            setSubmittingApproval(false)
        }
    }

    return (
        <div className="space-y-6 p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
            {/* Enhanced Header */}
            <div className="glass-panel p-6 bg-white/5 border border-white/10 backdrop-blur-md">
                <div className="flex items-center gap-3 mb-2">
                    <Book className="h-8 w-8 text-teal-400" />
                    <h1 className="font-serif text-3xl font-bold text-white">Logbook</h1>
                </div>
                <p className="text-sm text-gray-400">Track workflow runs, review disqualified leads, and monitor system performance.</p>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-700">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('import')}
                        className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'import'
                            ? 'border-teal-500 text-teal-400'
                            : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                            }`}
                    >
                        <span className="flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            Job History & Imports
                        </span>
                    </button>
                    <button
                        onClick={() => setActiveTab('review')}
                        className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'review'
                            ? 'border-teal-500 text-teal-400'
                            : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                            }`}
                    >
                        <span className="flex items-center gap-2">
                            <Trash2 className="w-4 h-4" />
                            Disqualified Leads
                        </span>
                    </button>
                </nav>
            </div>

            {/* TAB CONTENT: REVIEW */}
            {activeTab === 'review' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center bg-yellow-50 p-4 rounded-lg border border-yellow-100">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="text-yellow-600 w-5 h-5" />
                            <p className="text-sm text-yellow-800">
                                These leads were filtered out by the AI Agent. Review and approve them to restore to CRM.
                            </p>
                        </div>
                        <button onClick={loadDroppedLeads} className="p-2 hover:bg-yellow-100 rounded-full text-yellow-700 transition-colors">
                            <RefreshCw className={`w-4 h-4 ${loadingLeads ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    {loadingLeads ? (
                        <div className="text-center py-12 text-gray-400">Loading leads...</div>
                    ) : droppedLeads.length === 0 ? (
                        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                            <p className="text-gray-500 font-medium">No disqualified leads found!</p>
                            <p className="text-sm text-gray-400">Your filters are working perfectly (or no runs yet).</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-700 uppercase">Person</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-700 uppercase">Role</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-700 uppercase">Company</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-700 uppercase">Reason</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-700 uppercase text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {droppedLeads.map(lead => (
                                        <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="py-3 px-4">
                                                <div className="font-medium text-gray-900">{lead.person_name}</div>
                                                <div className="text-xs text-gray-400">{lead.email}</div>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-gray-600">{lead.job_title}</td>
                                            <td className="py-3 px-4 text-sm text-gray-600">{lead.company_name}</td>
                                            <td className="py-3 px-4">
                                                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">
                                                    {lead.source_notes || 'AI Filtered'}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                <button
                                                    onClick={() => openApprovalModal(lead.id)}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-medium rounded-md transition-colors"
                                                >
                                                    <ThumbsUp className="w-3 h-3" />
                                                    Reinstate
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* TAB CONTENT: JOB HISTORY & IMPORTS - Enhanced with detailed metrics */}
            {activeTab === 'import' && (
                <div className="space-y-4">
                    {loadingJobs ? (
                        <div className="text-center py-12 text-gray-400">Loading job history...</div>
                    ) : jobs.length === 0 ? (
                        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                            <Clock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                            <p className="text-gray-500 font-medium">No job history.</p>
                            <p className="text-sm text-gray-400">Run your first workflow to see results here.</p>
                        </div>
                    ) : (
                        <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-900/50 border-b border-gray-700">
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase">Run Name</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase">Date/Time</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase">Status</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-center">Companies</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-center">Leads</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-center">Yield</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-right">Details</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {jobs.map(job => {
                                        const stats = job.stats || {};
                                        const companiesDiscovered = stats.companies_discovered ?? 0;
                                        const leadsReturned = stats.leads_returned ?? 0;
                                        const targetLeads = stats.target_leads ?? null;
                                        const emailYield = stats.email_yield_percentage ?? 0;
                                        const hasStats = stats.companies_discovered !== undefined;
                                        const isPartial = targetLeads && leadsReturned < targetLeads;
                                        const isExpanded = expandedJobId === job.id;

                                        return (
                                            <React.Fragment key={job.id}>
                                                {/* Main Row - Enhanced Design */}
                                                <tr className="hover:bg-gray-700/50 transition-colors cursor-pointer" onClick={() => setExpandedJobId(isExpanded ? null : job.id)}>
                                                    <td className="py-4 px-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${job.status === 'COMPLETED' ? 'bg-teal-500/10 border border-teal-500/20' :
                                                                    job.status === 'RUNNING' ? 'bg-blue-500/10 border border-blue-500/20' :
                                                                        'bg-red-500/10 border border-red-500/20'
                                                                }`}>
                                                                {job.status === 'COMPLETED' && <CheckCircle className="w-5 h-5 text-teal-400" />}
                                                                {job.status === 'RUNNING' && <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />}
                                                                {job.status === 'FAILED' && <AlertCircle className="w-5 h-5 text-red-400" />}
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-semibold text-gray-100">
                                                                    {new Date(job.started_at).toLocaleDateString('en-US', {
                                                                        month: 'short',
                                                                        day: 'numeric',
                                                                        hour: 'numeric',
                                                                        minute: '2-digit'
                                                                    })}
                                                                </div>
                                                                {job.icp_name && (
                                                                    <div className="text-xs text-gray-500">{job.icp_name}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-4 text-center">
                                                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700">
                                                            <Building className="w-3.5 h-3.5 text-gray-400" />
                                                            <span className="text-sm font-semibold text-gray-100">{companiesDiscovered}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-4 text-center">
                                                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700">
                                                            <User className="w-3.5 h-3.5 text-gray-400" />
                                                            <span className="text-sm font-semibold text-gray-100">
                                                                {leadsReturned}
                                                                {isPartial && (
                                                                    <span className="text-xs text-orange-400 ml-1">/ {targetLeads}</span>
                                                                )}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-4 text-center">
                                                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700">
                                                            <Mail className="w-3.5 h-3.5 text-gray-400" />
                                                            <span className="text-sm font-medium text-gray-300">
                                                                {emailYield > 0 ? `${emailYield}%` : !hasStats ? '-' : '0%'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-4 text-center">
                                                        <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${job.status === 'success' || job.status === 'COMPLETED'
                                                                ? isPartial
                                                                    ? 'bg-orange-900/50 text-orange-300 border border-orange-700/50'
                                                                    : 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50'
                                                                : job.status === 'RUNNING'
                                                                    ? 'bg-blue-900/50 text-blue-300 border border-blue-700/50'
                                                                    : 'bg-red-900/50 text-red-300 border border-red-700/50'
                                                            }`}>
                                                            {job.status === 'FAILED' && isPartial
                                                                ? `Partial (${leadsReturned}/${targetLeads})`
                                                                : job.status === 'success' || job.status === 'COMPLETED'
                                                                    ? 'Completed'
                                                                    : job.status}
                                                        </span>
                                                    </td>
                                                    <td className="py-4 px-4 text-right">
                                                        <button className="text-gray-400 hover:text-teal-400 transition-colors">
                                                            {isExpanded ? (
                                                                <ChevronDown className="w-5 h-5" />
                                                            ) : (
                                                                <ChevronRight className="w-5 h-5" />
                                                            )}
                                                        </button>
                                                    </td>
                                                </tr>
                                                {isExpanded && stats.filtering_breakdown && (
                                                    <tr>
                                                        <td colSpan="7" className="bg-gray-900/30 p-4">
                                                            {stats.error_message && (
                                                                <div className="mb-4 p-3 bg-orange-900/30 border border-orange-700/50 rounded-lg">
                                                                    <div className="text-xs font-semibold text-orange-400 mb-1">Why Target Not Met</div>
                                                                    <div className="text-sm text-orange-300">{stats.error_message}</div>
                                                                </div>
                                                            )}
                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                                <div className="bg-white p-3 rounded-lg border border-gray-200">
                                                                    <div className="text-xs text-gray-500 mb-1">Companies Found (Raw)</div>
                                                                    <div className="text-lg font-bold text-gray-900">{stats.filtering_breakdown.companies_found_raw || 0}</div>
                                                                </div>
                                                                <div className="bg-white p-3 rounded-lg border border-gray-200">
                                                                    <div className="text-xs text-gray-500 mb-1">Companies Qualified</div>
                                                                    <div className="text-lg font-bold text-green-600">{stats.filtering_breakdown.companies_qualified || 0}</div>
                                                                </div>
                                                                <div className="bg-white p-3 rounded-lg border border-gray-200">
                                                                    <div className="text-xs text-gray-500 mb-1">Leads Scraped</div>
                                                                    <div className="text-lg font-bold text-blue-600">{stats.filtering_breakdown.leads_scraped || 0}</div>
                                                                </div>
                                                                <div className="bg-white p-3 rounded-lg border border-gray-200">
                                                                    <div className="text-xs text-gray-500 mb-1">Leads Disqualified</div>
                                                                    <div className="text-lg font-bold text-red-600">{stats.filtering_breakdown.leads_disqualified || 0}</div>
                                                                </div>
                                                            </div>
                                                            {job.error && (
                                                                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                                                                    <div className="text-xs font-semibold text-red-700 mb-1">Error Details</div>
                                                                    <div className="text-sm text-red-600">{job.error}</div>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* REINSTATEMENT MODAL */}
            {approvalModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in">
                    <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">Reinstate Lead</h3>
                                <p className="text-sm text-gray-500">Why should we approve this lead?</p>
                            </div>
                            <button onClick={() => setApprovalModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                                &times;
                            </button>
                        </div>

                        <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-700 mb-4 flex gap-2">
                            <Book className="w-4 h-4 shrink-0" />
                            <p>Your feedback teaches the AI. e.g. "VP of Design is a key decision maker"</p>
                        </div>

                        <textarea
                            className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none mb-4"
                            rows={3}
                            placeholder="Reason for reinstatement..."
                            value={approvalReason}
                            onChange={(e) => setApprovalReason(e.target.value)}
                            autoFocus
                        />

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setApprovalModalOpen(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmApproval}
                                disabled={submittingApproval || !approvalReason.trim()}
                                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {submittingApproval && <RefreshCw className="w-3 h-3 animate-spin" />}
                                Reinstate & Train
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Logbook
