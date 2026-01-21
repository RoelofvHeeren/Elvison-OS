import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { safeUUID } from '../utils/security'
import { PlayCircle, Terminal, CheckCircle, AlertCircle, Loader2, Send, FileText, Bot, Users, StopCircle, Clock, ChevronRight, Activity, RefreshCw, Search, List, History, ChevronLeft } from 'lucide-react'
import { useIcp } from '../context/IcpContext'
import WorkflowProgress from '../components/WorkflowProgress'

const STEPS = [
    { id: 'Company Profiler', label: 'Company Profiler' },
    { id: 'Apollo Lead Finder', label: 'Lead Finder' },
    { id: 'Outreach Creator', label: 'Outreach Creator' },
    { id: 'Data Architect', label: 'Data Architect' },
    { id: 'CRM Sync', label: 'CRM Sync' }
]

const AgentRunner = () => {
    const navigate = useNavigate()
    const { icps, selectedIcp, selectIcp } = useIcp()
    const [prompt, setPrompt] = useState('Find 3 law firms in Toronto, Canada and identify 1 Partner per firm.')
    const [runMode, setRunMode] = useState('search') // 'search' or 'manual'
    const [manualDomains, setManualDomains] = useState('')

    // Run State
    const [runs, setRuns] = useState([])
    const [selectedRunId, setSelectedRunId] = useState(null)
    const [isLoadingRuns, setIsLoadingRuns] = useState(true)
    const [showHistory, setShowHistory] = useState(false)
    const [sessionRunIds, setSessionRunIds] = useState(new Set())

    // Active Run Details
    const [logs, setLogs] = useState([])
    const [isPolling, setIsPolling] = useState(false)
    const [runStatus, setRunStatus] = useState(null)
    const [runResult, setRunResult] = useState(null)
    const [runError, setRunError] = useState(null)
    const [currentStep, setCurrentStep] = useState(null)
    const [isInitializing, setIsInitializing] = useState(false)

    // Refs
    const logsEndRef = useRef(null)
    const activeStreamsRef = useRef({}) // Map of runId -> AbortController to keep streams alive/cancel them

    // --- INITIALIZATION ---

    useEffect(() => {
        fetchRuns();
        const savedPrompt = localStorage.getItem('elvison_prompt_diagnostic')
        if (savedPrompt) setPrompt(savedPrompt)

        // Cleanup streams on unmount
        return () => {
            Object.values(activeStreamsRef.current).forEach(controller => controller.abort());
        };
    }, []);

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [logs]);

    // --- API & LOGIC ---

    const fetchRuns = async () => {
        setIsLoadingRuns(true)
        try {
            const res = await fetch('/api/runs')
            if (res.ok) {
                const data = await res.json()
                setRuns(data)

                // If no run selected, but we have runs, verify if we should auto-select one?
                // For now, let's select the first one if it's running, or just let user choose.
                // Better user experience: If there's a running task, select it.
                if (!selectedRunId && data.length > 0) {
                    const running = data.find(r => r.status === 'RUNNING');
                    if (running) {
                        setSelectedRunId(running.id);
                    }
                    // Else: Don't auto-select completed runs on initial load anymore
                }
            }
        } catch (e) {
            console.error("Failed to fetch runs", e)
        } finally {
            setIsLoadingRuns(false)
        }
    }

    const fetchRunDetails = async (runId) => {
        try {
            // 1. Get Status (Metadata)
            const statusRes = await fetch(`/api/runs/${runId}`);
            if (!statusRes.ok) return null;
            const runData = await statusRes.json();

            setRunStatus(runData.status);
            setRunError(runData.error_log);

            if (runData.status === 'COMPLETED' && runData.output_data) {
                setRunResult({ leads: runData.output_data.leads || [] });
                setCurrentStep('Complete');
            } else if (runData.status === 'FAILED') {
                setCurrentStep('Failed');
            }

            // 2. Get Logs
            const logRes = await fetch(`/api/runs/${runId}/logs`);
            if (logRes.ok) {
                const { logs: fetchedLogs } = await logRes.json();
                const formattedLogs = fetchedLogs.map(l => ({
                    step: l.step,
                    detail: l.message,
                    timestamp: l.created_at
                }));
                // Sort by ID or Timestamp to ensure order (DB usually returns created_at ASC)
                // formattedLogs.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));

                setLogs(formattedLogs);

                if (formattedLogs.length > 0) {
                    // Determine current step from last log if not completed
                    if (runData.status === 'RUNNING') {
                        setCurrentStep(formattedLogs[formattedLogs.length - 1].step);
                    }
                }
            }

            return runData;
        } catch (e) {
            console.error("Error fetching run details", e);
            return null;
        }
    }

    // --- POLLING LOGIC ---
    useEffect(() => {
        if (!selectedRunId) return;

        // Reset View for new selection
        setLogs([]);
        setRunStatus('LOADING');
        setRunError(null);
        setRunResult(null);
        setCurrentStep(null);
        setIsPolling(true);
        setIsInitializing(false); // Clear initializing state when switching runs

        // Initial Fetch
        fetchRunDetails(selectedRunId).then((data) => {
            if (!data) return;

            if (data.status === 'RUNNING') {
                // Start Polling
                const interval = setInterval(async () => {
                    const freshData = await fetchRunDetails(selectedRunId);
                    // Also refetch list periodically to update status icons of other runs
                    // fetchRuns(); // might be too heavy?

                    if (freshData && freshData.status !== 'RUNNING') {
                        clearInterval(interval);
                        setIsPolling(false);
                        fetchRuns(); // Refresh list to show correct status
                    }
                }, 2000);
                return () => clearInterval(interval);
            } else {
                setIsPolling(false);
            }
        });

    }, [selectedRunId]);

    // --- ACTION HANDLERS ---

    const handleStartRun = async () => {
        // INSTANT FEEDBACK - Show initializing state immediately
        console.log('[DEBUG] handleStartRun called - setting isInitializing=true');
        setIsInitializing(true)
        setLogs([{
            step: 'System',
            detail: 'Initializing workflow...',
            timestamp: new Date().toISOString()
        }])
        setRunStatus('RUNNING')
        console.log('[DEBUG] Initial state set:', { isInitializing: true, logsCount: 1, runStatus: 'RUNNING', selectedRunId });

        // Validation
        if (!selectedIcp && !localStorage.getItem('onboarding_state')) {
            console.warn("No Strategy selected. Running default.");
        }

        const idempotencyKey = safeUUID();
        const abortController = new AbortController();
        const vectorStoreId = localStorage.getItem('elvison_vector_store_id') || null;

        // Prepare Filters
        let filters = {}
        if (selectedIcp && selectedIcp.config) {
            filters = selectedIcp.config
        } else {
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

        // Save prompt for next time
        if (prompt) localStorage.setItem('elvison_prompt_diagnostic', prompt);

        let promptToSend = prompt.trim() || "Find SaaS companies";

        try {
            // Initiate Run
            const response = await fetch('/api/agents/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: promptToSend,
                    vectorStoreId,
                    mode: 'default',
                    filters,
                    maxLeadsPerCompany: filters.max_contacts,
                    idempotencyKey,
                    icpId: selectedIcp?.id,
                    manualDomains: runMode === 'manual' ? manualDomains.split('\n').map(d => d.trim()).filter(Boolean) : null
                }),
                signal: abortController.signal
            });

            if (!response.ok) throw new Error("Failed to start run");

            // Handle Stream to get Run ID and Keep Alive
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let foundRunId = false;

            // Background Stream Reader
            const processStream = async () => {
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value);
                        const lines = chunk.split('\n\n');

                        for (const line of lines) {
                            if (line.startsWith('event: run_id')) {
                                const data = JSON.parse(line.split('\n')[1].replace('data: ', ''));
                                if (data.runId && !foundRunId) {
                                    foundRunId = true;
                                    // Clear initializing state now that we have a run ID
                                    setIsInitializing(false);
                                    // Add to active streams tracking
                                    activeStreamsRef.current[data.runId] = abortController;
                                    // Add to session runs
                                    setSessionRunIds(prev => new Set([...prev, data.runId]));
                                    // Refresh list (will pick up new run)
                                    await fetchRuns();
                                    // Auto-select the new run
                                    setSelectedRunId(data.runId);
                                }
                            }
                        }
                    }
                } catch (err) {
                    if (err.name !== 'AbortError') console.error("Stream reading error:", err);
                } finally {
                    // Update list when stream closes (run likely done)
                    fetchRuns();
                }
            };

            // Start processing but don't await it (let it run in background to drain stream and keep connection)
            processStream();

        } catch (e) {
            console.error("Start run error:", e);
            setIsInitializing(false);
            setRunStatus(null);
            setLogs([]);
            alert("Failed to start workflow: " + e.message);
        }
    }

    const handleStopRun = async (runId) => {
        // 1. Cancel Active Stream if exists (Client side)
        if (activeStreamsRef.current[runId]) {
            activeStreamsRef.current[runId].abort();
            delete activeStreamsRef.current[runId];
        }

        // 2. Kill on Backend
        try {
            await fetch('/api/workflow/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId })
            });
            // Force refresh status
            setTimeout(fetchRuns, 500);
        } catch (e) {
            console.error("Stop failed:", e);
        }
    }

    const handleForceStop = async () => {
        if (!selectedRunId) return;
        try {
            const res = await fetch(`/api/runs/${selectedRunId}/force-fail`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Manually stopped by user' })
            });
            const data = await res.json();

            if (!res.ok) {
                // If it's 400/500, alert user
                alert(`Force stop failed: ${data.error || 'Unknown error'}`);
            } else {
                // Success
                console.log("Force stop successful:", data.message);
            }
        } catch (e) {
            console.error("Force stop failed", e);
            alert("Force stop failed (Network/Client error)");
        } finally {
            // Always refresh runs to ensure UI is in sync
            fetchRuns();
        }
    }

    // Selected Run Derived State
    const currentRun = runs.find(r => r.id === selectedRunId);

    return (
        <div className="flex h-[calc(100vh-2rem)] gap-6 p-6 lg:p-8 max-w-[1800px] mx-auto animate-fade-in relative">

            {/* LEFT: Run History & Config */}
            <div className={`${showHistory ? 'w-1/4' : 'w-auto'} flex flex-col gap-4 min-w-fit transition-all duration-300`}>

                {/* New Run Config */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm flex flex-col gap-3 shrink-0 w-[300px]">
                    <h2 className="text-lg font-serif font-bold text-white flex items-center gap-2">
                        <PlayCircle className="h-5 w-5 text-[#139187]" />
                        New Run
                    </h2>

                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block">Strategy (ICP)</label>
                        <select
                            value={selectedIcp?.id || ''}
                            onChange={(e) => {
                                const icp = icps.find(i => i.id == e.target.value)
                                if (icp) selectIcp(icp)
                            }}
                            className="w-full rounded bg-black/20 border border-white/10 p-2 text-sm text-white focus:border-[#139187] focus:outline-none"
                        >
                            <option value="" disabled>Select Strategy...</option>
                            {icps.map(icp => (
                                <option key={icp.id} value={icp.id}>{icp.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex gap-2 p-1 bg-black/20 rounded-lg mb-2">
                        <button
                            onClick={() => setRunMode('search')}
                            className={`flex-1 text-[10px] font-bold py-1.5 rounded transition-colors ${runMode === 'search' ? 'bg-[#139187] text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            <div className="flex items-center justify-center gap-1">
                                <Search className="h-3 w-3" /> Auto Search
                            </div>
                        </button>
                        <button
                            onClick={() => setRunMode('manual')}
                            className={`flex-1 text-[10px] font-bold py-1.5 rounded transition-colors ${runMode === 'manual' ? 'bg-[#139187] text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            <div className="flex items-center justify-center gap-1">
                                <List className="h-3 w-3" /> Manual List
                            </div>
                        </button>
                    </div>

                    {runMode === 'search' ? (
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Describe your objective (e.g. Find SaaS companies in Canada)..."
                            className="w-full h-24 rounded bg-black/20 border border-white/10 p-2 text-xs text-white focus:border-[#139187] focus:outline-none resize-none"
                        />
                    ) : (
                        <textarea
                            value={manualDomains}
                            onChange={(e) => setManualDomains(e.target.value)}
                            placeholder="Enter domains (one per line)&#10;example.com&#10;another-company.ca"
                            className="w-full h-24 rounded bg-black/20 border border-white/10 p-2 text-xs text-white focus:border-[#139187] focus:outline-none resize-none font-mono"
                        />
                    )}

                    <button
                        onClick={handleStartRun}
                        disabled={runMode === 'search' ? !prompt.trim() : !manualDomains.trim()}
                        className="flex items-center justify-center gap-2 rounded bg-[#139187] py-2 text-sm font-bold text-white shadow-lg hover:bg-[#139187]/90 transition-all disabled:opacity-50 mt-2"
                    >
                        <PlayCircle className="h-4 w-4" />
                        Start {runMode === 'search' ? 'Search' : 'Processing'}
                    </button>
                </div>

                {/* History List - Toggleable */}
                {showHistory && (
                    <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-0 backdrop-blur-sm overflow-hidden flex flex-col animate-in slide-in-from-left duration-300">
                        <div className="p-3 border-b border-white/10 flex justify-between items-center text-xs font-bold uppercase text-gray-400 tracking-wider bg-black/10">
                            <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Run History</span>
                            <button onClick={() => fetchRuns()} className="hover:text-white"><RefreshCw className="h-3 w-3" /></button>
                        </div>

                        <div className="overflow-y-auto flex-1 p-2 space-y-1 scrollbar-thin scrollbar-thumb-white/10">
                            {isLoadingRuns && runs.length === 0 ? (
                                <div className="p-4 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-500" /></div>
                            ) : runs.length === 0 ? (
                                <div className="p-4 text-center text-gray-500 text-xs text-italic">No runs found.</div>
                            ) : (
                                runs.map(run => {
                                    const isActive = currentRun?.id === run.id;
                                    const isRunning = run.status === 'RUNNING';
                                    return (
                                        <button
                                            key={run.id}
                                            onClick={() => setSelectedRunId(run.id)}
                                            className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1 relative ${isActive
                                                ? 'bg-[#139187]/10 border-[#139187] shadow-[0_0_15px_rgba(19,145,135,0.1)]'
                                                : 'bg-transparent border-transparent hover:bg-white/5'
                                                }`}
                                        >
                                            <div className="flex justify-between items-center w-full">
                                                <span className={`text-xs font-bold ${isActive ? 'text-white' : 'text-gray-300'}`}>
                                                    {run.run_name || `Run #${run.run_number || '?'}`}
                                                </span>
                                                {isRunning ? (
                                                    <Activity className="h-3 w-3 text-[#139187] animate-pulse" />
                                                ) : run.status === 'COMPLETED' ? (
                                                    <CheckCircle className="h-3 w-3 text-emerald-500" />
                                                ) : (
                                                    <AlertCircle className="h-3 w-3 text-red-500" />
                                                )}
                                            </div>
                                            <div className="flex justify-between items-center text-[10px] text-gray-500">
                                                <span>{new Date(run.started_at).toLocaleDateString()}</span>
                                                <span>{new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#139187] rounded-l-lg"></div>}
                                        </button>
                                    )
                                })
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* MIDDLE: Logs */}
            <div className="flex-1 rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden flex flex-col shadow-2xl min-w-[400px]">
                {/* Header */}
                <div className="h-14 border-b border-white/10 bg-white/5 flex items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            className={`p-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors ${showHistory ? 'text-[#139187] border-[#139187]/30' : 'text-gray-400'}`}
                            title={showHistory ? "Hide History" : "Show History"}
                        >
                            <History className="h-4 w-4" />
                        </button>
                        <Terminal className="h-4 w-4 text-gray-400" />
                        {currentRun ? (
                            <div>
                                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                    {currentRun.run_name}
                                    <span className={`text-[10px] px-2 py-0.5 rounded border ${currentRun.status === 'RUNNING' ? 'border-[#139187] text-[#139187] animate-pulse' :
                                        currentRun.status === 'COMPLETED' ? 'border-emerald-500/50 text-emerald-400' :
                                            'border-red-500/50 text-red-400'
                                        }`}>{currentRun.status}</span>
                                </h3>
                            </div>
                        ) : (
                            <span className="text-sm text-gray-500 font-medium">Ready to start a new search</span>
                        )}
                    </div>
                    {/* Controls */}
                    {currentRun && currentRun.status === 'RUNNING' && (
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleStopRun(currentRun.id)}
                                className="text-xs bg-red-500/20 text-red-400 px-3 py-1.5 rounded hover:bg-red-500/40 transition-colors flex items-center gap-1"
                            >
                                <StopCircle className="h-3 w-3" /> Stop
                            </button>
                            <button
                                onClick={handleForceStop}
                                className="text-xs bg-amber-500/20 text-amber-400 px-3 py-1.5 rounded hover:bg-amber-500/40 transition-colors flex items-center gap-1"
                                title="Force update status if stuck"
                            >
                                <AlertCircle className="h-3 w-3" /> Force Stop
                            </button>
                        </div>
                    )}
                    {currentRun && currentRun.status === 'COMPLETED' && (
                        <button
                            onClick={() => navigate('/crm')}
                            className="text-xs bg-emerald-500 text-black font-bold px-3 py-1.5 rounded hover:bg-emerald-400 transition-colors flex items-center gap-1"
                        >
                            <Users className="h-3 w-3" /> View Results
                        </button>
                    )}
                </div>

                {/* Logs Area - New Progress Display */}
                <div className="flex-1 overflow-hidden">
                    {(() => {
                        console.log('[DEBUG] Render conditions:', {
                            selectedRunId,
                            isInitializing,
                            runStatus,
                            logsLength: logs.length,
                            condition1: !selectedRunId && !isInitializing,
                            condition2: runStatus === 'LOADING' && logs.length === 0 && !isInitializing
                        });

                        if (!selectedRunId && !isInitializing) {
                            console.log('[DEBUG] Showing empty state');
                            return (
                                <div className="h-full flex flex-col items-center justify-center text-gray-600">
                                    <Bot className="h-16 w-16 opacity-20 mb-4" />
                                    <p>Select a workflow run from the history</p>
                                    <p className="text-xs mt-2">or start a new one.</p>
                                </div>
                            );
                        } else if (runStatus === 'LOADING' && logs.length === 0 && !isInitializing) {
                            console.log('[DEBUG] Showing loading spinner');
                            return (
                                <div className="h-full flex items-center justify-center">
                                    <Loader2 className="h-8 w-8 text-[#139187] animate-spin" />
                                </div>
                            );
                        } else {
                            console.log('[DEBUG] Showing WorkflowProgress');
                            return (
                                <WorkflowProgress
                                    logs={logs}
                                    status={runStatus}
                                    isInitializing={isInitializing}
                                />
                            );
                        }
                    })()}
                </div>
            </div>

            {/* RIGHT: Status Overview */}
            {selectedRunId && (
                <div className="w-1/5 flex flex-col gap-4 min-w-[250px] animate-in fade-in slide-in-from-right duration-500">
                    <div className="bg-white/5 border border-white/10 rounded-xl p-5 backdrop-blur-sm h-full flex flex-col">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4 text-center">Step Progress</h3>

                        <div className="space-y-3 relative">
                            {/* Connecting Line */}
                            <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-white/5 -z-10"></div>

                            {STEPS.map((step, idx) => {
                                const currentStepIdx = STEPS.findIndex(s => s.id === currentStep);
                                const stepIdx = idx;

                                let status = 'pending'; // pending, active, completed

                                if (runStatus === 'COMPLETED') status = 'completed';
                                else if (runStatus === 'FAILED' && currentStepIdx === stepIdx) status = 'error';
                                else if (currentStepIdx > stepIdx) status = 'completed';
                                else if (currentStepIdx === stepIdx && runStatus === 'RUNNING') status = 'active';

                                return (
                                    <div key={step.id} className="flex items-center gap-3">
                                        <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 z-10 transition-all ${status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white' :
                                            status === 'active' ? 'bg-[#139187] border-[#139187] text-white shadow-[0_0_10px_#139187]' :
                                                status === 'error' ? 'bg-red-500 border-red-500 text-white' :
                                                    'bg-[#0f1115] border-white/10 text-gray-600'
                                            }`}>
                                            {status === 'completed' ? <CheckCircle className="h-4 w-4" /> :
                                                status === 'error' ? <AlertCircle className="h-4 w-4" /> :
                                                    <span className="text-xs font-bold">{idx + 1}</span>}
                                        </div>
                                        <div className={`text-xs font-medium transition-colors ${status === 'completed' ? 'text-emerald-400' :
                                            status === 'active' ? 'text-white' :
                                                status === 'error' ? 'text-red-400' :
                                                    'text-gray-600'
                                            }`}>
                                            {step.label}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        {/* Result Card */}
                        {runResult && (
                            <div className="mt-auto pt-6 animate-in slide-in-from-bottom fade-in duration-500">
                                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 text-center">
                                    <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                                    <div className="text-white font-bold text-sm">Success!</div>
                                    <div className="text-emerald-400/80 text-xs mt-1">
                                        {runResult.leads ? `${runResult.leads.length} leads generated` : 'Task completed'}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    )
}

export default AgentRunner
