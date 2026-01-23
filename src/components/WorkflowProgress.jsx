import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, AlertCircle, ChevronDown, ChevronUp, Copy, Check, Loader2, Sparkles } from 'lucide-react'

// Stage definitions for workflow progress
const STAGE_DEFINITIONS = [
    {
        id: 'initializing',
        label: 'Initializing',
        description: 'Preparing workflow...',
        matchSteps: ['Initialization']
    },
    {
        id: 'searching',
        label: 'Company Search',
        description: 'Finding target companies...',
        matchSteps: ['Company Finder']
    },
    {
        id: 'profiling',
        label: 'Company Profiling',
        description: 'Analyzing companies...',
        matchSteps: ['Company Profiler']
    },
    {
        id: 'finding_leads',
        label: 'Lead Discovery',
        description: 'Identifying decision makers...',
        matchSteps: ['Apollo Lead Finder', 'Lead Finder']
    },
    {
        id: 'crafting_messages',
        label: 'Message Creation',
        description: 'Personalizing outreach...',
        matchSteps: ['Outreach Creator']
    },
    {
        id: 'finalizing',
        label: 'Finalizing',
        description: 'Saving results...',
        matchSteps: ['Data Architect', 'CRM Sync', 'Database']
    }
]

// Helper to determine current stage from logs
const getCurrentStage = (logs, status) => {
    if (!logs || logs.length === 0) return 'initializing'
    if (status === 'COMPLETED') return 'complete'
    if (status === 'FAILED') return 'error'

    // Iterate BACKWARDS to find the most recent meaningful stage
    // (Skipping "System" logs that might happen in between)
    for (let i = logs.length - 1; i >= 0; i--) {
        const logStep = logs[i]?.step || ''

        // Find matching stage
        for (const stage of STAGE_DEFINITIONS) {
            // Check provided match steps
            if (stage.matchSteps.some(step => logStep.includes(step))) {
                return stage.id
            }
        }
    }

    return 'initializing'
}

// Extract key milestones from logs
const extractMilestones = (logs) => {
    const milestones = []
    const keyPhrases = ['found', 'generated', 'completed', 'saved', 'success', 'starting', 'processing']

    logs.forEach((log, index) => {
        const detail = log.detail?.toLowerCase() || ''
        const isKeyPhrase = keyPhrases.some(phrase => detail.includes(phrase))
        const isError = detail.includes('error') || detail.includes('failed')
        const isStepChange = index === 0 || log.step !== logs[index - 1]?.step

        if (isKeyPhrase || isError || isStepChange) {
            milestones.push({
                ...log,
                id: `${log.step}-${index}`,
                isError
            })
        }
    })

    // Return last 7 milestones
    return milestones.slice(-7)
}

const StageHeader = ({ currentStage, status }) => {
    const stage = STAGE_DEFINITIONS.find(s => s.id === currentStage)
    const isComplete = status === 'COMPLETED'
    const isError = status === 'FAILED'

    return (
        <div className="px-6 py-8 border-b border-white/5">
            <AnimatePresence mode="wait">
                <motion.div
                    key={currentStage}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.4, ease: 'easeInOut' }}
                    className="flex items-center gap-4"
                >
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center backdrop-blur-md transition-all duration-500 ${isComplete ? 'bg-emerald-500/20 border-2 border-emerald-500/50' :
                        isError ? 'bg-red-500/20 border-2 border-red-500/50' :
                            'bg-[#139187]/20 border-2 border-[#139187]/50 shadow-[0_0_20px_rgba(19,145,135,0.3)]'
                        }`}>
                        {isComplete ? (
                            <CheckCircle className="w-6 h-6 text-emerald-400" />
                        ) : isError ? (
                            <AlertCircle className="w-6 h-6 text-red-400" />
                        ) : (
                            <Loader2 className="w-6 h-6 text-[#139187] animate-spin" />
                        )}
                    </div>
                    <div className="flex-1">
                        <h3 className={`text-2xl font-semibold mb-1 transition-colors duration-300 ${isComplete ? 'text-emerald-400' :
                            isError ? 'text-red-400' :
                                'text-white'
                            }`}>
                            {isComplete ? 'Complete!' : isError ? 'Failed' : stage?.label || 'Processing'}
                        </h3>
                        <p className="text-sm text-gray-400">
                            {isComplete ? 'Workflow completed successfully' :
                                isError ? 'An error occurred during processing' :
                                    stage?.description || 'Working...'}
                        </p>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    )
}

const StageTimeline = ({ currentStage, status }) => {
    const currentIndex = STAGE_DEFINITIONS.findIndex(s => s.id === currentStage)
    const isComplete = status === 'COMPLETED'

    return (
        <div className="px-6 py-6 border-b border-white/5">
            <div className="flex items-center justify-between relative">
                {/* Progress line */}
                <div className="absolute top-4 left-0 right-0 h-0.5 bg-white/5" />
                <motion.div
                    className="absolute top-4 left-0 h-0.5 bg-gradient-to-r from-[#139187] to-emerald-500"
                    initial={{ width: '0%' }}
                    animate={{
                        width: isComplete ? '100%' : `${(currentIndex / (STAGE_DEFINITIONS.length - 1)) * 100}%`
                    }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                />

                {STAGE_DEFINITIONS.map((stage, index) => {
                    const isPast = index < currentIndex || isComplete
                    const isCurrent = index === currentIndex && !isComplete
                    const isFuture = index > currentIndex && !isComplete

                    return (
                        <div key={stage.id} className="relative z-10 flex flex-col items-center">
                            <motion.div
                                className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${isPast ? 'bg-emerald-500 border-emerald-500' :
                                    isCurrent ? 'bg-[#139187] border-[#139187] shadow-[0_0_15px_rgba(19,145,135,0.5)]' :
                                        'bg-[#0f1115] border-white/10'
                                    }`}
                                animate={isCurrent ? { scale: [1, 1.1, 1] } : {}}
                                transition={{ duration: 2, repeat: Infinity }}
                            >
                                {isPast ? (
                                    <Check className="w-4 h-4 text-white" />
                                ) : (
                                    <span className={`text-xs font-bold ${isCurrent ? 'text-white' : 'text-gray-600'}`}>
                                        {index + 1}
                                    </span>
                                )}
                            </motion.div>
                            <span className={`text-[10px] font-medium mt-2 text-center max-w-[60px] transition-colors duration-300 ${isPast ? 'text-emerald-400' :
                                isCurrent ? 'text-white' :
                                    'text-gray-600'
                                }`}>
                                {stage.label}
                            </span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

const ActivityFeed = ({ milestones }) => {
    return (
        <div className="flex-1 overflow-hidden flex flex-col px-6 py-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Recent Activity</h4>
            <div className="space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                <AnimatePresence mode="popLayout">
                    {milestones.map((milestone) => (
                        <motion.div
                            key={milestone.id}
                            initial={{ opacity: 0, x: -20, height: 0 }}
                            animate={{ opacity: 1, x: 0, height: 'auto' }}
                            exit={{ opacity: 0, x: 20, height: 0 }}
                            transition={{ duration: 0.3, ease: 'easeOut' }}
                            className={`flex items-start gap-3 p-3 rounded-lg backdrop-blur-sm transition-colors ${milestone.isError ? 'bg-red-500/5 border border-red-500/20' : 'bg-white/5'
                                }`}
                        >
                            <Sparkles className={`w-4 h-4 mt-0.5 shrink-0 ${milestone.isError ? 'text-red-400' : 'text-[#139187]'
                                }`} />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-300 leading-relaxed break-words">
                                    {milestone.detail}
                                </p>
                                <p className="text-[10px] text-gray-600 mt-1">
                                    {new Date(milestone.timestamp).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                    })}
                                </p>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    )
}

const FullLogsPanel = ({ logs, isOpen, onToggle }) => {
    const [copied, setCopied] = useState(false)

    const handleCopy = () => {
        const logText = logs.map(log =>
            `[${new Date(log.timestamp).toISOString()}] [${log.step}] ${log.detail}`
        ).join('\n')

        navigator.clipboard.writeText(logText).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }

    return (
        <div className="border-t border-white/5">
            <button
                onClick={onToggle}
                className="w-full px-6 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
                <span className="text-xs font-medium text-gray-400">Full Logs ({logs.length})</span>
                <div className="flex items-center gap-2">
                    {isOpen && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                handleCopy()
                            }}
                            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 transition-colors flex items-center gap-1"
                        >
                            {copied ? (
                                <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span className="text-[10px] text-emerald-400">Copied!</span>
                                </>
                            ) : (
                                <>
                                    <Copy className="w-3 h-3" />
                                    <span className="text-[10px]">Copy</span>
                                </>
                            )}
                        </button>
                    )}
                    {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                        <div className="px-6 py-4 max-h-[400px] overflow-y-auto bg-black/20 font-mono text-xs scrollbar-thin scrollbar-thumb-white/10">
                            {logs.map((log, i) => (
                                <div key={i} className="flex gap-4 mb-2 hover:bg-white/5 p-1 -mx-1 rounded">
                                    <span className="shrink-0 text-gray-600 w-20 text-right">
                                        {new Date(log.timestamp).toLocaleTimeString([], {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                            second: '2-digit'
                                        })}
                                    </span>
                                    <div className="flex-1 break-words">
                                        <span className={`font-bold mr-2 ${log.step.includes('Finder') ? 'text-blue-400' :
                                            log.step.includes('Profiler') ? 'text-purple-400' :
                                                log.step.includes('Outreach') ? 'text-amber-400' :
                                                    log.step.includes('System') ? 'text-gray-400' :
                                                        'text-[#139187]'
                                            }`}>
                                            [{log.step}]
                                        </span>
                                        <span className="text-gray-300">{log.detail}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

const WorkflowProgress = ({ logs = [], status = 'RUNNING', isInitializing = false }) => {
    const [showFullLogs, setShowFullLogs] = useState(false)

    const currentStage = useMemo(() => {
        if (isInitializing) return 'initializing'
        return getCurrentStage(logs, status)
    }, [logs, status, isInitializing])

    const milestones = useMemo(() => extractMilestones(logs), [logs])

    return (
        <div className="h-full flex flex-col bg-white/5 rounded-xl border border-white/10 backdrop-blur-sm overflow-hidden">
            <StageHeader currentStage={currentStage} status={status} />
            <StageTimeline currentStage={currentStage} status={status} />
            <ActivityFeed milestones={milestones} />
            <FullLogsPanel
                logs={logs}
                isOpen={showFullLogs}
                onToggle={() => setShowFullLogs(!showFullLogs)}
            />
        </div>
    )
}

export default WorkflowProgress
