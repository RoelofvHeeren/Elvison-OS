
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlayCircle, Terminal, CheckCircle, AlertCircle, Loader2, Send, FileText, Bot, Users } from 'lucide-react'

const STEPS = [
    { id: 'Company Finder', label: 'Company Finder' },
    { id: 'Company Profiler', label: 'Company Profiler' },
    { id: 'Apollo Lead Finder', label: 'Lead Finder' },
    { id: 'Outreach Creator', label: 'Outreach Creator' },
    { id: 'Sheet Builder', label: 'Sheet Builder' }
]

const AgentRunner = () => {
    const navigate = useNavigate()
    const [prompt, setPrompt] = useState('')
    const [isRunning, setIsRunning] = useState(false)
    const [logs, setLogs] = useState([])
    const [currentStep, setCurrentStep] = useState(null)
    const [result, setResult] = useState(null)
    const [error, setError] = useState(null)
    const logsEndRef = useRef(null)

    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    // Load prompt from local storage
    useEffect(() => {
        const savedPrompt = localStorage.getItem('elvison_prompt')
        if (savedPrompt) setPrompt(savedPrompt)

        scrollToBottom()
    }, [logs])

    const saveJobToHistory = (jobResult) => {
        const historyItem = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            prompt: prompt,
            status: jobResult ? 'success' : 'failed',
            result: jobResult,
            error: error
        }

        const existingHistory = JSON.parse(localStorage.getItem('elvison_job_history') || '[]')
        const newHistory = [...existingHistory, historyItem]
        localStorage.setItem('elvison_job_history', JSON.stringify(newHistory))
    }

    const handleRun = async () => {
        if (!prompt.trim()) return

        // Persist prompt
        localStorage.setItem('elvison_prompt', prompt)

        setIsRunning(true)
        setLogs([])
        setResult(null)
        setError(null)
        setCurrentStep(STEPS[0].id)

        try {
            // Get vectorStoreId from local storage
            const vectorStoreId = localStorage.getItem('elvison_vector_store_id')

            const response = await fetch('/api/agents/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt,
                    vectorStoreId // Pass the persistent ID
                })
            })

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
                            } else if (type === 'result') {
                                setResult(data)
                                setCurrentStep('Complete')
                                saveJobToHistory(data) // Save success
                            } else if (type === 'error') {
                                setError(data.message)
                                setIsRunning(false)
                                saveJobToHistory(null)
                            } else if (type === 'done') {
                                setIsRunning(false)
                            }
                        } catch (e) {
                            console.error('Error parsing SSE data', e)
                        }
                    }
                }
            }
        } catch (err) {
            setError(err.message)
            setIsRunning(false)
            // Save failure to history
            const historyItem = {
                id: Date.now(),
                timestamp: new Date().toISOString(),
                prompt: prompt,
                status: 'failed',
                error: err.message
            }
            const existingHistory = JSON.parse(localStorage.getItem('elvison_job_history') || '[]')
            localStorage.setItem('elvison_job_history', JSON.stringify([...existingHistory, historyItem]))
        }
    }

    return (
        <div className="flex h-[calc(100vh-8rem)] gap-6">
            {/* Left Panel: Input & Status */}
            <div className="w-1/3 flex flex-col gap-6">
                <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
                    <h2 className="mb-4 text-xl font-serif font-bold text-white flex items-center gap-2">
                        <Bot className="h-5 w-5 text-[#139187]" />
                        Run Workflow
                    </h2>

                    <div className="space-y-4">
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

                        <button
                            onClick={handleRun}
                            disabled={isRunning || !prompt.trim()}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#139187] py-3 text-sm font-bold text-white shadow-[0_0_20px_rgba(19,145,135,0.3)] transition-all hover:bg-[#139187]/90 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-[0_0_30px_rgba(19,145,135,0.5)]"
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
                    </div>
                </div>

                {/* Progress Indicators */}
                <div className="flex-1 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm overflow-hidden flex flex-col">
                    <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">Current Progress</h3>
                    <div className="space-y-4 overflow-y-auto pr-2">
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
            </div>

            {/* Right Panel: Logs & Result */}
            <div className="flex-1 flex flex-col gap-6 overflow-hidden">
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

                {result && (
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
                )}
            </div>
        </div>
    )
}

export default AgentRunner
