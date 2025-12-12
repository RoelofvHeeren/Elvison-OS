
import { useState, useEffect } from 'react'
import { Book, Clock, CheckCircle, AlertCircle, Trash2, FileText, ChevronRight, User, Building, Mail } from 'lucide-react'

const Logbook = () => {
    const [jobs, setJobs] = useState([])
    const [expandedJobId, setExpandedJobId] = useState(null)

    useEffect(() => {
        const savedJobs = localStorage.getItem('elvison_job_history')
        if (savedJobs) {
            try {
                setJobs(JSON.parse(savedJobs).reverse()) // Newest first
            } catch (e) {
                console.error('Failed to parse job history', e)
            }
        }
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
        <div className="space-y-6 animate-fade-in h-[calc(100vh-8rem)] flex flex-col">
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

            <div className="flex-1 overflow-hidden rounded-2xl border border-outline bg-white/5 backdrop-blur-sm shadow-xl flex flex-col">
                {jobs.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                        <Book className="h-16 w-16 opacity-20 mb-4" />
                        <p>No jobs recorded yet.</p>
                        <p className="text-sm opacity-60 mt-1">Run a workflow to see it here.</p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                                        {expandedJobId === job.id && job.result?.leads && (
                                            <div className="mt-4 space-y-2 border-t border-white/10 pt-4 animate-in slide-in-from-top-2 duration-200">
                                                {job.result.leads.map((lead, i) => (
                                                    <div key={i} className="flex flex-col md:flex-row md:items-center gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
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
