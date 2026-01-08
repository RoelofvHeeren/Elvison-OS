
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { safeUUID } from '../utils/security'
import { PlayCircle, Terminal, CheckCircle, AlertCircle, Loader2, Send, FileText, Bot, Users, StopCircle } from 'lucide-react'
import { useIcp } from '../context/IcpContext'

const STEPS = [
    { id: 'Company Profiler', label: 'Company Profiler' },
    { id: 'Apollo Lead Finder', label: 'Lead Finder' },
    { id: 'Outreach Creator', label: 'Outreach Creator' },
    { id: 'Data Architect', label: 'Data Architect' }, // Updated
    { id: 'CRM Sync', label: 'CRM Sync' } // Renamed from Sheet Builder conceptually
]

const AgentRunner = () => {
    const navigate = useNavigate()
    const { icps, selectedIcp, setSelectedIcp } = useIcp()
    const [prompt, setPrompt] = useState('Find 3 law firms in Toronto, Canada and identify 1 Partner per firm.')
    const [mode, setMode] = useState('default') // 'default' or 'list_builder'
    const [isRunning, setIsRunning] = useState(false)
    const [logs, setLogs] = useState([])
    const [currentStep, setCurrentStep] = useState(null)
    const [result, setResult] = useState(null)
    const [error, setError] = useState(null)
    const [activeRunId, setActiveRunId] = useState(null)
    const [isStale, setIsStale] = useState(false) // Stale run detection
    const logsEndRef = useRef(null)
    const abortControllerRef = useRef(null)
    const lastLogCountRef = useRef(0) // Track log updates for staleness detection

    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    // Load prompt from local storage
    useEffect(() => {
        const savedPrompt = localStorage.getItem('elvison_prompt_diagnostic')
        if (savedPrompt) setPrompt(savedPrompt)

        scrollToBottom()
    }, [logs])

    const saveJobToHistory = (jobResult, jobError = null) => {
        const historyItem = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            prompt: prompt,
            status: jobResult ? 'success' : 'failed',
            result: jobResult,
            error: jobError
        }

        try {
            const existingHistory = JSON.parse(localStorage.getItem('elvison_job_history') || '[]')
            const newHistory = [...existingHistory, historyItem]
            localStorage.setItem('elvison_job_history', JSON.stringify(newHistory))
        } catch (e) {
            console.error('Failed to save job history', e)
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                // Determine if we should clear old items or just not save the huge result
                try {
                    // Try saving just the metadata without the massive result
                    const success = { ...historyItem, result: { ...historyItem.result, debug: null, leads: historyItem.result?.leads?.slice(0, 5) } }
                    const existingHistory = JSON.parse(localStorage.getItem('elvison_job_history') || '[]')
                    // Keep only last 10
                    const trimmedHistory = existingHistory.slice(-10);
                    localStorage.setItem('elvison_job_history', JSON.stringify([...trimmedHistory, success]))
                } catch (retryErr) {
                    console.error('Could not save even trimmed history', retryErr);
                }
            }
        }
    }


    // --- RESUMPTION LOGIC ---
    const pollLogs = async (runId) => {
        setIsRunning(true);
        setActiveRunId(runId);
        setIsStale(false);
        lastLogCountRef.current = 0;
        let stalePollCount = 0; // Track consecutive polls with no new logs

        let polling = true;
        const interval = setInterval(async () => {
            if (!polling) return;
            try {
                // 1. Get Status
                const statusRes = await fetch(`/api/runs/${runId}`);
                if (!statusRes.ok) { // 404 or error
                    clearInterval(interval);
                    localStorage.removeItem('elvison_active_run_id');
                    setIsRunning(false);
                    return;
                }
                const runData = await statusRes.json();

                // Check if run was auto-marked as stale by backend
                if (runData.was_stale) {
                    clearInterval(interval);
                    setIsRunning(false);
                    setError(runData.error_log || 'Run terminated unexpectedly');
                    localStorage.removeItem('elvison_active_run_id');
                    return;
                }

                // 2. Get Logs
                const logRes = await fetch(`/api/runs/${runId}/logs`);
                if (logRes.ok) {
                    const { logs: newLogs } = await logRes.json();
                    setLogs(newLogs.map(l => ({
                        step: l.step,
                        detail: l.message,
                        timestamp: l.created_at
                    })));
                    if (newLogs.length > 0) {
                        setCurrentStep(newLogs[newLogs.length - 1].step);
                    }

                    // Staleness detection: no new logs for 6+ consecutive polls (~12+ seconds)
                    if (newLogs.length === lastLogCountRef.current) {
                        stalePollCount++;
                        if (stalePollCount >= 30) { // ~60 seconds of no new logs
                            setIsStale(true);
                        }
                    } else {
                        stalePollCount = 0;
                        setIsStale(false);
                    }
                    lastLogCountRef.current = newLogs.length;
                }

                // 3. Check Termination
                if (runData.status === 'COMPLETED') {
                    clearInterval(interval);
                    setIsRunning(false);
                    setResult({ leads: runData.output_data?.leads || [] }); // Rough approximation, usually full object
                    setCurrentStep('Complete');
                    localStorage.removeItem('elvison_active_run_id');
                } else if (runData.status === 'FAILED' || runData.status === 'CANCELLED') {
                    clearInterval(interval);
                    setIsRunning(false);
                    setError(runData.error_log || 'Run failed');
                    localStorage.removeItem('elvison_active_run_id');
                }
            } catch (e) {
                console.error("Polling error:", e);
            }
        }, 2000);

        // Cleanup function for unmount (ref based usually, but here simplicity wins)
        return () => clearInterval(interval);
    };

    const checkActiveRun = async () => {
        const savedRunId = localStorage.getItem('elvison_active_run_id');
        if (!savedRunId) return;

        try {
            const res = await fetch(`/api/runs/${savedRunId}`);
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'RUNNING' || data.status === 'PENDING') {
                    console.log(`[Resumption] Resuming Run ${savedRunId}`);
                    pollLogs(savedRunId);
                } else {
                    // It finished while we were gone
                    localStorage.removeItem('elvison_active_run_id');
                }
            } else {
                localStorage.removeItem('elvison_active_run_id');
            }
        } catch (e) {
            console.error("Resumption check failed:", e);
        }
    };

    useEffect(() => {
        checkActiveRun();
    }, []); // Run once on mount

    const handleRun = async () => {
        if (isRunning) return
        setIsRunning(true)
        setLogs([])
        // setProgress(0) // Unused variable?

        if (!selectedIcp && !localStorage.getItem('onboarding_state')) {
            console.warn("No Strategy selected and no Onboarding State found. Running with empty defaults.");
        }

        // Generate Idempotency Key
        const idempotencyKey = safeUUID();

        abortControllerRef.current = new AbortController()

        try {
            // Build Prompt Context
            // Use ICP config prompts if available, else legacy
            let promptToSend = "Find SaaS companies"
            // Use the user's input prompt as the main objective if it's set
            if (prompt.trim()) {
                promptToSend = prompt;
            }

            // Retrieve Vector Store ID from storage (managed in Knowledge Base)
            const vectorStoreId = localStorage.getItem('elvison_vector_store_id') || null

            // Extract and Flatten Filters from ICP Config or Onboarding State
            // Prefer Selected ICP Config
            let filters = {}
            if (selectedIcp && selectedIcp.config) {
                filters = selectedIcp.config
            } else {
                // Fallback to local storage (legacy single-ICP)
                const onboardingState = JSON.parse(localStorage.getItem('onboarding_state') || '{}')
                const apolloAnswers = onboardingState.surveyAnswers?.apollo_lead_finder || {}
                const companyAnswers = onboardingState.surveyAnswers?.company_finder || {}

                filters = {
                    job_titles: apolloAnswers.job_titles || [],
                    seniority: apolloAnswers.seniority || [],
                    job_functions: apolloAnswers.job_functions || [],
                    excluded_functions: apolloAnswers.excluded_functions || [],
                    max_contacts: parseInt(apolloAnswers.max_contacts || 3),
                    countries: companyAnswers.geography || [],
                    org_types: companyAnswers.org_types || [],
                    intent: companyAnswers.intent,
                    ...apolloAnswers
                }
            }

            console.log('Using Active Filters:', filters)

            const response = await fetch('/api/agents/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: promptToSend,
                    vectorStoreId,
                    mode: 'default', // Always default now
                    filters,
                    targetLeads: 50,
                    maxLeadsPerCompany: filters.max_contacts,
                    idempotencyKey,
                    icpId: selectedIcp?.id // Pass Selected ICP ID
                }),
                signal: abortControllerRef.current.signal
            })

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()

            while (true) {
                const { value, done } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value)
                const lines = chunk.split('\n\n')

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        const type = line.split('\n')[0].replace('event: ', '')
                        const dataStr = line.split('\n')[1]?.replace('data: ', '')

                        if (!dataStr) continue

                        try {
                            const data = JSON.parse(dataStr)

                            if (type === 'log') {
                                setLogs(prev => [...prev, data])
                                if (data.step) setCurrentStep(data.step)
                            } else if (type === 'run_id') {
                                setActiveRunId(data.runId)
                                localStorage.setItem('elvison_active_run_id', data.runId); // PERSIST
                            } else if (type === 'result') {
                                setResult(data)
                                setCurrentStep('Complete')
                                saveJobToHistory(data, null) // Save success
                                localStorage.removeItem('elvison_active_run_id'); // CLEANUP
                            } else if (type === 'error') {
                                setError(data.message)
                                setIsRunning(false)
                                saveJobToHistory(null, data.message)
                                localStorage.removeItem('elvison_active_run_id'); // CLEANUP
                            } else if (type === 'done') {
                                setIsRunning(false)
                                localStorage.removeItem('elvison_active_run_id'); // CLEANUP
                            }
                        } catch (e) {
                            console.error('Error parsing SSE data', e)
                        }
                    }
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                setLogs(prev => [...prev, { step: 'System', detail: '⛔ Run cancelled by user', timestamp: new Date().toISOString() }])
                return
            }
            setError(err.message)
            // Save failure to history
            saveJobToHistory(null, err.message)
        } finally {
            setIsRunning(false)
            abortControllerRef.current = null
        }
    }

    const handleCancel = async () => {
        // Abort client-side stream if available (for runs started in this session)
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        setLogs(prev => [...prev, { step: 'System', detail: '⛔ Cancelling run...', timestamp: new Date().toISOString() }])

        // Always notify the backend (this is the real cancel mechanism)
        if (activeRunId) {
            try {
                await fetch('/api/workflow/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ runId: activeRunId })
                });
                // Optimistic UI update - mark as cancelled immediately
                setIsRunning(false);
                setError('Run cancelled by user');
                localStorage.removeItem('elvison_active_run_id');
                setLogs(prev => [...prev, { step: 'System', detail: '✓ Run cancelled successfully', timestamp: new Date().toISOString() }])
            } catch (e) {
                console.error("Cancel API failed", e);
                setLogs(prev => [...prev, { step: 'System', detail: `⚠️ Cancel request failed: ${e.message}`, timestamp: new Date().toISOString() }])
            }
        } else {
            // No active run ID, just stop the UI
            setIsRunning(false);
        }
    }

    // Force-stop a stuck/stale run
    const handleForceStop = async () => {
        if (!activeRunId) return;

        setLogs(prev => [...prev, { step: 'System', detail: '⚠️ Force stopping stuck run...', timestamp: new Date().toISOString() }]);

        try {
            const res = await fetch(`/api/runs/${activeRunId}/force-fail`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Manually stopped by user - run appeared stuck' })
            });

            if (res.ok) {
                setIsRunning(false);
                setIsStale(false);
                setError('Run was force-stopped due to appearing stuck.');
                localStorage.removeItem('elvison_active_run_id');
            } else {
                const data = await res.json();
                console.error('Force-stop failed:', data.error);
            }
        } catch (e) {
            console.error('Force-stop request failed:', e);
        }
    }

    return (
        <div className="flex h-[calc(100vh-2rem)] gap-6 p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
            {/* Left Panel: Input & Status */}
            <div className="w-1/3 flex flex-col gap-6">
                <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
                    <h2 className="mb-4 text-xl font-serif font-bold text-white flex items-center gap-2">
                        <Bot className="h-5 w-5 text-[#139187]" />
                        Run Workflow
                    </h2>

                    <div className="space-y-4">
                        {/* ICP Selector */}
                        <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-400">
                                ICP
                            </label>
                            <select
                                value={selectedIcp?.id || ''}
                                onChange={(e) => {
                                    const icp = icps.find(i => i.id === e.target.value)
                                    if (icp) setSelectedIcp(icp)
                                }}
                                className="w-full rounded-lg border-2 border-white/10 bg-black/20 p-3 text-sm text-white focus:border-[#139187] focus:outline-none transition-all"
                            >
                                <option value="" disabled>Select an ICP</option>
                                {icps.map(icp => (
                                    <option key={icp.id} value={icp.id}>{icp.name}</option>
                                ))}
                            </select>
                            {selectedIcp && (
                                <p className="mt-1 text-[10px] text-gray-500">
                                    Using config from: <span className="text-[#139187]">{selectedIcp.name}</span>
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-400">
                                Objective
                            </label>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="E.g., Find 50 construction companies in Texas and profile them..."
                                className="w-full h-32 rounded-lg border-2 border-white/10 bg-black/20 p-3 text-sm text-white placeholder:text-gray-600 focus:border-[#139187] focus:outline-none transition-all resize-none"
                                disabled={isRunning}
                            />
                        </div>

                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={handleRun}
                                disabled={isRunning || !prompt.trim()}
                                title={isRunning ? "Running..." : "Start Workflow"}
                                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#139187] py-3 text-sm font-bold text-white shadow-[0_0_20px_rgba(19,145,135,0.3)] transition-all hover:bg-[#139187]/90 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-[0_0_30px_rgba(19,145,135,0.5)]"
                            >
                                {isRunning ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Running Agents...
                                    </>
                                ) : (
                                    <>
                                        <PlayCircle className="h-4 w-4 fill-current" />
                                        Start Workflow
                                    </>
                                )}
                            </button>
                            {isRunning && (
                                <>
                                    <button
                                        onClick={handleCancel}
                                        className="flex items-center justify-center gap-2 rounded-lg bg-red-500/80 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-red-500"
                                    >
                                        <StopCircle className="h-4 w-4" />
                                        Cancel
                                    </button>
                                    {isStale && (
                                        <button
                                            onClick={handleForceStop}
                                            title="Run appears stuck - force stop it"
                                            className="flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-bold text-black transition-all hover:bg-amber-400 animate-pulse"
                                        >
                                            <AlertCircle className="h-4 w-4" />
                                            Force Stop
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Progress Indicators */}
                <div className="flex-1 rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm overflow-hidden flex flex-col justify-center">
                    <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400 text-center">Current Progress</h3>
                    <div className="space-y-4 overflow-y-auto pr-2 px-2">
                        {STEPS.map((step, idx) => {
                            const isCompleted = STEPS.findIndex(s => s.id === currentStep) > idx || currentStep === 'Complete'
                            const isActive = currentStep === step.id && isRunning

                            return (
                                <div
                                    key={step.id}
                                    className={`flex items-center gap-3 rounded-lg p-3 transition-all ${isActive
                                        ? 'bg-[#139187]/10 border border-[#139187]/40'
                                        : isCompleted
                                            ? 'bg-emerald-500/5'
                                            : 'opacity-50'
                                        }`}
                                >
                                    <div className={`flex h-8 w-8 items-center justify-center rounded-full border ${isActive
                                        ? 'border-[#139187] text-[#139187] animate-pulse'
                                        : isCompleted
                                            ? 'border-emerald-500 bg-emerald-500 text-white'
                                            : 'border-white/20 text-gray-500'
                                        }`}>
                                        {isCompleted ? <CheckCircle className="h-4 w-4" /> : <span className="text-xs font-bold">{idx + 1}</span>}
                                    </div>
                                    <div className="flex-1">
                                        <div className={`text-sm font-bold ${isActive ? 'text-white' : isCompleted ? 'text-emerald-400' : 'text-gray-500'}`}>
                                            {step.label}
                                        </div>
                                        {isActive && <div className="text-xs text-[#139187] mt-0.5">Processing...</div>}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div >

            {/* Right Panel: Logs & Result */}
            < div className="flex-1 flex flex-col gap-6 overflow-hidden" >
                <div className="flex-1 rounded-xl border border-white/10 bg-black/40 p-0 backdrop-blur-sm overflow-hidden flex flex-col font-mono text-sm shadow-2xl">
                    <div className="flex items-center justify-between border-b border-white/10 bg-white/5 p-3 px-4">
                        <div className="flex items-center gap-2 text-gray-400">
                            <Terminal className="h-4 w-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Live Execution Logs</span>
                        </div>
                        {result && (
                            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
                                <CheckCircle className="h-3 w-3" />
                                Complete
                            </span>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                        {logs.length === 0 && !isRunning && !result ? (
                            <div className="flex h-full flex-col items-center justify-center text-gray-600">
                                <Bot className="mb-4 h-12 w-12 opacity-20" />
                                <p>Ready to start workflow execution.</p>
                            </div>
                        ) : (
                            logs.map((log, i) => (
                                <div key={i} className="flex gap-3 animate-fade-in group hover:bg-white/5 p-1 rounded -mx-1">
                                    <span className="shrink-0 text-gray-600 text-[10px] pt-1">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                    <div>
                                        <span className={`font-bold mr-2 ${log.step.includes('Finder') ? 'text-blue-400' :
                                            log.step.includes('Profiler') ? 'text-purple-400' :
                                                log.step.includes('Outreach') ? 'text-amber-400' :
                                                    log.step.includes('Sheet') ? 'text-emerald-400' : 'text-[#139187]'
                                            }`}>[{log.step}]</span>
                                        <span className="text-gray-300">{log.detail}</span>
                                    </div>
                                </div>
                            ))
                        )}
                        {isRunning && (
                            <div className="flex items-center gap-2 text-gray-500 px-1">
                                <span className="h-2 w-2 rounded-full bg-[#139187] animate-pulse"></span>
                                <span className="text-xs">Agents working...</span>
                            </div>
                        )}
                        {error && (
                            <div className="rounded border border-red-500/20 bg-red-500/10 p-3 text-red-400 flex items-center gap-2 mt-4">
                                <AlertCircle className="h-4 w-4" />
                                <div>
                                    <div className="font-bold">Execution Error</div>
                                    <div className="text-xs opacity-80">{error}</div>
                                </div>
                            </div>
                        )}
                        <div ref={logsEndRef} />
                    </div>
                </div>

                {
                    result && (
                        <div className="h-auto shrink-0 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 animate-in slide-in-from-bottom duration-500">
                            <div className="flex items-start gap-4">
                                <div className="rounded-full bg-emerald-500/20 p-2 text-emerald-400">
                                    <CheckCircle className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">Workflow Completed Successfully</h3>
                                    <p className="text-emerald-200/80 mt-1 text-sm">
                                        {result.leads ? `Generated ${result.leads.length} leads and wrote to spreadsheet.` : 'Spreadsheet populated.'}
                                    </p>
                                    <button
                                        onClick={() => navigate('/crm')}
                                        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-black transition-all hover:bg-emerald-400"
                                    >
                                        <Users className="h-4 w-4" />
                                        Go to CRM
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }
            </div >
        </div >
    )
}

export default AgentRunner
