import { useState, useEffect } from 'react'
import { Book, Clock, CheckCircle, AlertCircle, Trash2, FileText, ChevronRight, ChevronDown, User, Building, Mail, RefreshCw, ThumbsUp } from 'lucide-react'

import { fetchRuns, fetchLeads, approveLead } from '../utils/api'

const Logbook = () => {
    const [activeTab, setActiveTab] = useState('review') // 'review' | 'import'

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
        <div className="p-8 max-w-7xl mx-auto animate-fade-in">
            <header className="mb-8">
                <h1 className="text-3xl font-bold font-display text-gray-900 mb-2 flex items-center gap-3">
                    <Book className="h-8 w-8 text-[#139187]" />
                    Logbook
                </h1>
                <p className="text-gray-500">Review disqualified leads and manage data imports.</p>
            </header>

            {/* TABS */}
            <div className="flex space-x-6 border-b border-gray-200 mb-6">
                <button
                    onClick={() => setActiveTab('review')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'review'
                            ? 'border-indigo-600 text-indigo-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Disqualified Leads ({droppedLeads.length})
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('import')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'import'
                            ? 'border-indigo-600 text-indigo-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Job History & Imports
                    </div>
                </button>
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
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Person</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Role</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Company</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Reason</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase text-right">Action</th>
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

            {/* TAB CONTENT: IMPORT (Simplified View for now) */}
            {activeTab === 'import' && (
                <div className="space-y-6">
                    {jobs.length === 0 && !loadingJobs && (
                        <div className="text-center py-12 text-gray-400">No job history.</div>
                    )}
                    {jobs.map(job => (
                        <div key={job.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                            <div className="flex justify-between">
                                <div>
                                    <div className="font-medium">{job.agent_id || 'Workflow'}</div>
                                    <div className="text-xs text-gray-500">{new Date(job.timestamp).toLocaleString()}</div>
                                </div>
                                <div className={`text-sm ${job.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                                    {job.status}
                                </div>
                            </div>
                        </div>
                    ))}
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
