
import { useState, useEffect } from 'react'
import { Book, Clock, CheckCircle, AlertCircle, Trash2, FileText, ChevronRight, ChevronDown, User, Building, Mail } from 'lucide-react'

import { fetchRuns } from '../utils/api'

const Logbook = () => {
    const [jobs, setJobs] = useState([])
    const [expandedJobId, setExpandedJobId] = useState(null)
    const [loading, setLoading] = useState(true)

    const loadJobs = async () => {
        try {
            const data = await fetchRuns()
            // Map DB format to UI expects
            const mapped = data.map(run => {
                let result = {}
                let prompt = 'Workflow Run'
                try {
                    if (run.output_data) result = run.output_data // It's already JSON from pg driver usually
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
                    error: run.error_log
                }
            })
            setJobs(mapped)
        } catch (error) {
            console.error('Failed to load logs:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadJobs()
        const interval = setInterval(loadJobs, 5000) // Poll for updates
        return () => clearInterval(interval)
    }, [])

    const clearHistory = () => {
        if (confirm('Are you sure you want to clear the entire logbook?')) {
            localStorage.removeItem('elvison_job_history')
            setJobs([])
        }
    }

    const toggleExpand = (id) => {
        setExpandedJobId(expandedJobId === id ? null : id)
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="font-serif text-3xl font-medium text-primary flex items-center gap-3">
                        <Book className="h-8 w-8 text-[#139187]" />
                        Logbook
                    </h1>
                    <p className="text-gray-400 mt-2">History of executed workflows and their results.</p>
                </div>
                {jobs.length > 0 && (
                    <button
                        onClick={clearHistory}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors border border-rose-500/20"
                    >
                        <Trash2 className="h-4 w-4" />
                        Clear History
                    </button>
                )}
            </header>

            <div className="rounded-2xl border border-outline bg-white/5 backdrop-blur-sm shadow-xl">
                {jobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-gray-500 py-12">
                        <Book className="h-16 w-16 opacity-20 mb-4" />
                        <p>No jobs recorded yet.</p>
                        <p className="text-sm opacity-60 mt-1">Run a workflow to see it here.</p>
                    </div>
                ) : (
                    <div className="p-4 space-y-3">
                        {jobs.map((job, index) => (
                            <div key={index} className="group rounded-xl border border-white/10 bg-black/20 p-5 hover:bg-black/30 transition-all hover:border-[#139187]/30">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className="text-xs font-mono text-gray-500 flex items-center gap-1.5">
                                                <Clock className="h-3 w-3" />
                                                {new Date(job.timestamp).toLocaleString()}
                                            </span>
                                            {job.status === 'success' ? (
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                                    Success
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                                                    Failed
                                                </span>
                                            )}
                                        </div>
                                        <p className="font-medium text-white line-clamp-2 mb-3">
                                            {job.prompt}
                                        </p>

                                        {/* Actions Bar */}
                                        <div className="flex items-center gap-4 mt-4">
                                            {job.result?.spreadsheet_url && (
                                                <a
                                                    href={job.result.spreadsheet_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-2 text-sm text-[#139187] hover:text-[#139187]/80 hover:underline"
                                                >
                                                    <FileText className="h-4 w-4" />
                                                    View Spreadsheet
                                                    <ChevronRight className="h-3 w-3" />
                                                </a>
                                            )}

                                            {job.result?.leads && job.result.leads.length > 0 && (
                                                <button
                                                    onClick={() => toggleExpand(job.id)}
                                                    className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                                                >
                                                    <User className="h-4 w-4" />
                                                    {expandedJobId === job.id ? 'Hide Leads' : `View ${job.result.leads.length} Leads`}
                                                </button>
                                            )}
                                        </div>

                                        {job.error && (
                                            <div className="flex items-start gap-2 text-sm text-rose-400 bg-rose-500/5 p-2 rounded mt-2">
                                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                                <span>{job.error}</span>
                                            </div>
                                        )}

                                        {/* Expanded Leads View */}
                                        {expandedJobId === job.id && (
                                            <div className="mt-4 space-y-6 border-t border-white/10 pt-4 animate-in slide-in-from-top-2 duration-200">

                                                {/* Leads List */}
                                                {job.result?.leads && job.result.leads.length > 0 ? (
                                                    <div className="space-y-2">
                                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Generated Leads</h4>
                                                        {job.result.leads.map((lead, i) => (
                                                            <div key={i} className="flex flex-col md:flex-row md:items-center gap-4 p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 text-white font-bold text-sm">
                                                                        <User className="h-3.5 w-3.5 text-gray-400" />
                                                                        {lead.first_name} {lead.last_name}
                                                                    </div>
                                                                    <div className="text-xs text-gray-400 mt-0.5">{lead.title}</div>
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 text-sm text-gray-300">
                                                                        <Building className="h-3.5 w-3.5 text-gray-400" />
                                                                        {lead.company_name}
                                                                    </div>
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 text-sm text-gray-300">
                                                                        <Mail className="h-3.5 w-3.5 text-gray-400" />
                                                                        {lead.email || 'N/A'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="text-center p-4 text-gray-500 italic text-sm">No final leads generated in this run.</div>
                                                )}

                                                {/* Debug / Execution Trace */}
                                                {job.result?.debug && (
                                                    <div className="space-y-2">
                                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Execution Details</h4>

                                                        {/* Phase 1: Discovery */}
                                                        <details className="group bg-black/20 rounded-lg border border-white/5 open:bg-black/30 transition-all">
                                                            <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                                                                <div className="flex items-center gap-2 text-sm font-medium text-purple-300">
                                                                    <div className="h-2 w-2 rounded-full bg-purple-400" />
                                                                    Phase 1: Discovery Rounds
                                                                </div>
                                                                <ChevronDown className="h-4 w-4 text-gray-500 group-open:rotate-180 transition-transform" />
                                                            </summary>
                                                            <div className="p-3 pt-0 text-sm space-y-3 border-t border-white/5 mt-2 pt-3">
                                                                {job.result.debug.discovery.map((round, idx) => (
                                                                    <div key={idx} className="bg-white/5 p-2 rounded">
                                                                        <div className="text-xs text-gray-400 font-mono mb-1">Round {round.round}</div>
                                                                        <div className="text-gray-200">Found {round.results.length} candidates</div>
                                                                        <ul className="mt-1 space-y-1">
                                                                            {round.results.map((c, ci) => (
                                                                                <li key={ci} className="text-xs text-gray-400 pl-2 border-l border-gray-600">
                                                                                    {c.company_name} <span className="opacity-50">({c.hq_city})</span>
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </details>

                                                        {/* Phase 2: Qualification */}
                                                        <details className="group bg-black/20 rounded-lg border border-white/5 open:bg-black/30 transition-all">
                                                            <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                                                                <div className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                                                                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                                                                    Phase 2: Qualification
                                                                </div>
                                                                <ChevronDown className="h-4 w-4 text-gray-500 group-open:rotate-180 transition-transform" />
                                                            </summary>
                                                            <div className="p-3 pt-0 text-sm space-y-3 border-t border-white/5 mt-2 pt-3">
                                                                {job.result.debug.qualification.map((round, idx) => (
                                                                    <div key={idx} className="bg-white/5 p-2 rounded">
                                                                        <div className="flex justify-between items-center text-xs mb-2">
                                                                            <span className="text-gray-400 font-mono">Round {round.round}</span>
                                                                            <span className="text-gray-500">{round.rejectedCount} Rejected</span>
                                                                        </div>
                                                                        {round.approved.length > 0 ? (
                                                                            <ul className="space-y-2">
                                                                                {round.approved.map((c, ci) => (
                                                                                    <li key={ci} className="text-xs bg-emerald-500/5 p-2 rounded border border-emerald-500/10">
                                                                                        <div className="font-bold text-emerald-300">{c.company_name}</div>
                                                                                        <div className="opacity-70 mt-1 line-clamp-2">{c.company_profile}</div>
                                                                                    </li>
                                                                                ))}
                                                                            </ul>
                                                                        ) : (
                                                                            <div className="text-xs text-rose-400 italic">No companies passed qualification in this round.</div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </details>

                                                        {/* Phase 3: Apollo Search */}
                                                        <details className="group bg-black/20 rounded-lg border border-white/5 open:bg-black/30 transition-all">
                                                            <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                                                                <div className="flex items-center gap-2 text-sm font-medium text-blue-300">
                                                                    <div className="h-2 w-2 rounded-full bg-blue-400" />
                                                                    Phase 3: Apollo Lead Search
                                                                </div>
                                                                <ChevronDown className="h-4 w-4 text-gray-500 group-open:rotate-180 transition-transform" />
                                                            </summary>
                                                            <div className="p-3 pt-0 text-sm border-t border-white/5 mt-2 pt-3">
                                                                <div className="text-gray-300 mb-2">
                                                                    Total Leads Found: <span className="font-mono text-white">{job.result.debug.apollo?.length || 0}</span>
                                                                </div>
                                                                {job.result.debug.apollo && job.result.debug.apollo.length > 0 ? (
                                                                    <div className="grid grid-cols-1 gap-2">
                                                                        {job.result.debug.apollo.map((lead, li) => (
                                                                            <div key={li} className="text-xs text-gray-400 flex items-center gap-2">
                                                                                <div className="h-1.5 w-1.5 rounded-full bg-blue-500/50" />
                                                                                {lead.first_name} {lead.last_name} @ {lead.company_name}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-xs text-yellow-400 bg-yellow-500/5 p-2 rounded border border-yellow-500/10">
                                                                        No leads were returned by Apollo. Check the agent logs or refine search criteria.
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </details>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default Logbook
