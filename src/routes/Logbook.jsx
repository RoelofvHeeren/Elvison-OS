
import { useState, useEffect } from 'react'
import { Book, Clock, CheckCircle, AlertCircle, Trash2, FileText, ChevronRight, ChevronDown, User, Building, Mail } from 'lucide-react'

import { fetchRuns } from '../utils/api'

const Logbook = () => {
    const [jobs, setJobs] = useState([])
    const [expandedJobId, setExpandedJobId] = useState(null)
    const [loading, setLoading] = useState(true)

    // Apify Integration State
    const [apifyInputs, setApifyInputs] = useState({}) // { jobId: { url: '', token: '' } }
    const [extracting, setExtracting] = useState({}) // { jobId: boolean }
    const [extractionStatus, setExtractionStatus] = useState({}) // { jobId: string }

    useEffect(() => {
        // Load saved Apify token
        const savedToken = localStorage.getItem('apify_token')
        if (savedToken) {
            // We can't pre-fill for specific jobs easily here without job IDs, 
            // but we can default when rendering or initial state? 
            // Better: useEffect to patch apifyInputs when jobs load? 
            // Actually, easiest is to just use 'savedToken' as default value in render if state is empty.
        }
    }, [])

    const handleApifyRun = async (jobId) => {
        // Find the job to get domains
        const job = jobs.find(j => j.id === jobId)
        if (!job || !job.result?.companies) {
            alert('No companies found in this job to enrich.')
            return
        }

        const domains = job.result.companies.map(c => c.domain || c.website).filter(Boolean)
        if (domains.length === 0) {
            alert('No valid domains found.')
            return
        }

        const input = apifyInputs[jobId] || {}
        const token = input.token || localStorage.getItem('apify_token')

        if (!token) {
            alert('Please enter your Apify API Token')
            return
        }

        setExtracting(prev => ({ ...prev, [jobId]: true }))
        setExtractionStatus(prev => ({ ...prev, [jobId]: 'Starting Apify Actor...' }))

        try {
            // 1. Run Actor
            const runRes = await fetch('/api/integrations/apify/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, domains })
            })
            const runData = await runRes.json()
            if (runData.error) throw new Error(runData.error)

            const runId = runData.runId
            setExtractionStatus(prev => ({ ...prev, [jobId]: `Scraping ${domains.length} companies... (Run ID: ${runId})` }))

            // 2. Poll for Status
            const poll = setInterval(async () => {
                try {
                    const statusRes = await fetch(`/api/integrations/apify/status/${runId}?token=${token}`)
                    const statusData = await statusRes.json()

                    if (statusData.status === 'SUCCEEDED') {
                        clearInterval(poll)
                        setExtracting(prev => ({ ...prev, [jobId]: false }))
                        setExtractionStatus(prev => ({ ...prev, [jobId]: `Done! Imported ${statusData.importedCount} leads.` }))
                        alert(`Success! Imported ${statusData.importedCount} leads into the CRM.`)
                    } else if (statusData.status === 'FAILED' || statusData.status === 'ABORTED') {
                        clearInterval(poll)
                        setExtracting(prev => ({ ...prev, [jobId]: false }))
                        setExtractionStatus(prev => ({ ...prev, [jobId]: `Failed: ${statusData.status}` }))
                        alert('Apify run failed. Check Apify console.')
                    } else {
                        setExtractionStatus(prev => ({ ...prev, [jobId]: `Status: ${statusData.status}...` }))
                    }
                } catch (e) {
                    console.error("Poll error", e)
                }
            }, 3000)

        } catch (err) {
            console.error(err)
            alert('Failed to start extraction: ' + err.message)
            setExtracting(prev => ({ ...prev, [jobId]: false }))
            setExtractionStatus(prev => ({ ...prev, [jobId]: '' }))
        }
    }

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
                                                ) : job.result?.type === 'list_builder' ? (
                                                    <div className="space-y-4">
                                                        <div className="bg-teal-500/10 border border-teal-500/20 p-5 rounded-xl">
                                                            <div className="flex items-start gap-4">
                                                                <div className="p-3 bg-teal-500/20 rounded-lg">
                                                                    <Building className="w-6 h-6 text-teal-400" />
                                                                </div>
                                                                <div className="flex-1">
                                                                    <h4 className="text-base font-bold text-white mb-1">Company List Ready</h4>
                                                                    <p className="text-gray-400 text-sm mb-4 leading-relaxed">
                                                                        Found {job.result.companies?.length || 0} companies. You can now automatically find employee contact info for these domains.
                                                                    </p>

                                                                    {/* Auto-Extract via Apify */}
                                                                    <div className="bg-black/20 border border-white/5 p-4 rounded-lg flex flex-col gap-3 group mt-4">
                                                                        <div>
                                                                            <div className="text-xs font-bold text-teal-500 uppercase tracking-wider mb-0.5">Auto-Enrichment</div>
                                                                            <div className="text-gray-300 text-sm">Use your subscription or System Key to find leads</div>
                                                                        </div>

                                                                        <div className="gap-2 flex flex-col">
                                                                            <div className="flex gap-2">
                                                                                <input
                                                                                    type="password"
                                                                                    placeholder="Apify API Token (Optional if using System Key)"
                                                                                    className="bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-teal-500/50 flex-1"
                                                                                    onChange={(e) => {
                                                                                        const val = e.target.value
                                                                                        setApifyInputs(prev => ({ ...prev, [job.id]: { ...prev[job.id], token: val } }))
                                                                                        localStorage.setItem('apify_token', val)
                                                                                    }}
                                                                                    value={apifyInputs[job.id]?.token !== undefined ? apifyInputs[job.id]?.token : (localStorage.getItem('apify_token') || '')}
                                                                                />
                                                                                <button
                                                                                    onClick={() => handleApifyRun(job.id)}
                                                                                    disabled={extracting[job.id]}
                                                                                    className="px-4 py-1.5 bg-teal-500 hover:bg-teal-400 text-black text-xs font-bold rounded transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                                                                                >
                                                                                    {extracting[job.id] ? 'Enriching...' : 'Find Decision Makers'}
                                                                                </button>
                                                                            </div>
                                                                            {extractionStatus[job.id] && (
                                                                                <div className="text-xs text-teal-400 mt-1 font-mono">{extractionStatus[job.id]}</div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Quick Preview */}
                                                        <details className="group">
                                                            <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-300 flex items-center gap-2 select-none">
                                                                <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                                                                Preview Domain List
                                                            </summary>
                                                            <div className="mt-2 p-3 bg-black/40 rounded border border-white/5 font-mono text-xs text-gray-400 max-h-32 overflow-y-auto select-all">
                                                                {job.result.companies?.map(c => c.domain || c.website).filter(Boolean).join('\n')}
                                                            </div>
                                                        </details>
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
