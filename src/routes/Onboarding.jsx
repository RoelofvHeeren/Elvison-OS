import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ChevronRight, Check, Rocket, Bot, Edit3, Save, RotateCw, Plus, X } from 'lucide-react'
import Typewriter from '../components/Typewriter'
import { saveAgentPrompts, saveCrmColumns, fetchAgentPrompts, fetchCrmColumns } from '../utils/api'
import VisualColumnEditor from '../components/VisualColumnEditor'

// --- Configuration ---

const JOB_TITLE_SUGGESTIONS = [
    "CEO", "Founder", "Co-Founder", "CTO", "CIO", "VP of Sales", "VP of Engineering",
    "Director of Marketing", "Product Manager", "Head of Growth", "Sales Director"
]

const AGENTS = [
    {
        id: 'company_finder',
        name: 'Company Finder',
        description: 'Finds companies matching your Ideal Customer Profile (ICP).',
        questions: [
            { id: 'icp_description', label: 'Describe your Ideal Customer Profile in detail.' },
            { id: 'industries', label: 'Which industries should we target?' },
            { id: 'location', label: 'What are the target geographic locations?' },
            { id: 'exclusions', label: 'Any specific types of companies to exclude?' },
        ],
        template: (a) => `You are an expert lead researcher. Find companies matching this profile:
ICP: ${a.icp_description || 'N/A'}
Industries: ${a.industries || 'Generic'}
Location: ${a.location || 'Global'}
Exclusions: ${a.exclusions || 'None'}
Output the list in JSON format.`
    },
    {
        id: 'apollo',
        name: 'Apollo Enricher',
        description: 'Finds contact details for key decision makers.',
        questions: [
            { id: 'job_titles', label: 'What job titles are you looking for?', type: 'multi-select' },
            { id: 'seniority', label: 'What seniority levels (e.g., C-Suite, VP)?' },
            { id: 'max_contacts', label: 'Maximum contacts per company?' },
            { id: 'email_requirement', label: 'Are verified emails required?' },
        ],
        template: (a) => `You are a data enrichment specialist. Find contacts for the identified companies.
Job Titles: ${Array.isArray(a.job_titles) ? a.job_titles.join(', ') : a.job_titles}
Seniority: ${a.seniority || 'Any'}
Max per Company: ${a.max_contacts || '3'}
Verified Emails Only: ${a.email_requirement || 'Yes'}
Use Apollo API to fetch these details.`
    },
    {
        id: 'outreach_creator',
        name: 'Outreach Creator',
        description: 'Drafts personalized cold outreach messages.',
        questions: [
            { id: 'value_prop', label: 'What is your core value proposition?' },
            { id: 'tone', label: 'What tone should the emails have (e.g., Professional, Casual)?' },
            { id: 'call_to_action', label: 'What is the Call to Action (CTA)?' },
            { id: 'pain_points', label: 'What customer pain points do you solve?' },
        ],
        template: (a) => `You are an expert copywriter. Draft cold outreach emails.
Value Prop: ${a.value_prop}
Tone: ${a.tone}
CTA: ${a.call_to_action}
Pain Points: ${a.pain_points}
Create unique, high-converting drafts for each lead.`
    },
    {
        id: 'data_architect',
        name: 'Data Architect',
        description: 'Configures your internal CRM and data structure.',
        isVisualEditor: true, // Special flag for Visual Column Editor
        questions: [], // No standard questions for this one
        template: (a, columns) => `You are a CRM Data Architect.
The user has defined the following data structure:
${columns.map(c => `- ${c.name} (${c.type}) ${c.required ? '[Required]' : ''}`).join('\n')}

Key Requirements:
- Ensure all data is normalized.
- Validate types strictly.
- Map incoming data to these fields accurately.`
    },
    {
        id: 'research_framework',
        name: 'Research Framework',
        description: 'Conducts deep-dive research on prospects.',
        questions: [
            { id: 'research_depth', label: 'How deep should the research be (High/Medium/Low)?' },
            { id: 'sources', label: 'Any specific sources to check (LinkedIn, News, Website)?' },
            { id: 'key_insights', label: 'What key insights are influential for your sales process?' },
            { id: 'report_format', label: 'How should the research summary be formatted?' },
        ],
        template: (a) => `You are a market researcher. Conduct deep analysis on each prospect.
Depth: ${a.research_depth}
Sources: ${a.sources}
Key Insights to Find: ${a.key_insights}
Format: ${a.report_format}
Provide a comprehensive summary.`
    }
]

// --- Styles ---
const PREMIUM_CONTAINER = "bg-black/40 backdrop-blur-md border border-teal-500/30 rounded-2xl shadow-[0_0_15px_rgba(255,255,255,0.1)] p-8 text-white transition-all duration-300 hover:shadow-[0_0_20px_rgba(20,184,166,0.15)]"
const PREMIUM_INPUT = "w-full bg-black/60 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition-all outline-none"
const PREMIUM_BUTTON_PRIMARY = "px-8 py-3 bg-teal-500 hover:bg-teal-400 text-black font-bold rounded-lg shadow-[0_0_10px_rgba(20,184,166,0.5)] transition-all hover:scale-105"
const PREMIUM_BUTTON_SECONDARY = "px-6 py-3 border border-white/30 hover:bg-white/10 text-white rounded-lg transition-all"


// --- Sub-Components ---

const TagInput = ({ value, onChange, suggestions }) => {
    const [input, setInput] = useState('')
    const tags = Array.isArray(value) ? value : []

    const addTag = (tag) => {
        if (tag && !tags.includes(tag)) {
            onChange([...tags, tag])
        }
        setInput('')
    }

    const removeTag = (tag) => {
        onChange(tags.filter(t => t !== tag))
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2 p-3 bg-black/60 border border-white/20 rounded-lg min-h-[50px]">
                {tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 bg-teal-500/20 text-teal-300 px-3 py-1 rounded-full text-sm border border-teal-500/30">
                        {tag} <button onClick={() => removeTag(tag)}><X className="w-3 h-3 hover:text-white" /></button>
                    </span>
                ))}
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag(input))}
                    className="bg-transparent outline-none flex-1 min-w-[120px] text-white placeholder-gray-500"
                    placeholder="Type & Enter..."
                />
            </div>
            {/* Suggestions */}
            <div className="flex flex-wrap gap-2">
                {suggestions.filter(s => !tags.includes(s)).slice(0, 8).map(s => (
                    <button
                        key={s}
                        onClick={() => addTag(s)}
                        className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        + {s}
                    </button>
                ))}
            </div>
        </div>
    )
}

const StepWelcome = ({ onNext, userName }) => (
    <div className="flex flex-col items-center justify-center p-12 text-center h-full max-w-3xl mx-auto">
        <div className="mb-8 p-6 rounded-full bg-black/50 border border-teal-500/50 shadow-[0_0_30px_rgba(20,184,166,0.3)] animate-pulse">
            <Sparkles className="w-16 h-16 text-teal-400" />
        </div>
        <h1 className="text-5xl font-serif font-bold mb-8 text-white drop-shadow-lg tracking-wide">
            <Typewriter text={`Hello, ${userName || 'User'}. Time to set this up.`} delay={50} />
        </h1>
        <p className="text-2xl text-gray-200 mb-12 max-w-2xl font-light leading-relaxed drop-shadow-md">
            <Typewriter
                text="We'll configure your AI agents one by one to ensure they perform perfectly for your needs."
                delay={30}
                onComplete={() => { }}
            />
        </p>
        <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 3 }}
            onClick={onNext}
            className={PREMIUM_BUTTON_PRIMARY + " flex items-center gap-2 group text-lg"}
        >
            Initialize Onboarding <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </motion.button>
    </div>
)

const StepCompanyInfo = ({ onNext, data, onChange }) => (
    <div className={`max-w-xl mx-auto mt-20 ${PREMIUM_CONTAINER}`}>
        <h2 className="text-3xl font-serif font-bold mb-2 text-white">Company Information</h2>
        <p className="text-gray-300 mb-8 border-b border-white/10 pb-4">First, tell us a little about who you are.</p>

        <div className="space-y-6">
            <div>
                <label className="block text-sm font-medium text-teal-400 mb-2 uppercase tracking-wider">Your Name</label>
                <input
                    type="text"
                    value={data.userName}
                    onChange={(e) => onChange('userName', e.target.value)}
                    className={PREMIUM_INPUT}
                    placeholder="e.g. Roelof"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-teal-400 mb-2 uppercase tracking-wider">Company Name</label>
                <input
                    type="text"
                    value={data.companyName}
                    onChange={(e) => onChange('companyName', e.target.value)}
                    className={PREMIUM_INPUT}
                    placeholder="e.g. Elvison AI"
                />
            </div>
        </div>

        <div className="mt-12 flex justify-end">
            <button
                onClick={onNext}
                disabled={!data.userName || !data.companyName}
                className={`${PREMIUM_BUTTON_PRIMARY} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
                Next Step
            </button>
        </div>
    </div>
)

const StepAgentSurvey = ({ agent, answers, setAnswers, onNext, onGenerate, crmColumns, setCrmColumns }) => {
    const [qIndex, setQIndex] = useState(0)

    const handleAnswer = (qid, val) => {
        setAnswers(prev => ({ ...prev, [agent.id]: { ...prev[agent.id], [qid]: val } }))
    }

    if (agent.isVisualEditor) {
        // Special render for Data Architect
        return (
            <div className="max-w-5xl mx-auto pt-10 h-full flex flex-col relative">
                <div className="flex items-start gap-8 mb-8">
                    <div className="w-16 h-16 shrink-0 bg-teal-900/40 rounded-2xl flex items-center justify-center border border-teal-500/30 shadow-[0_0_15px_rgba(20,184,166,0.2)]">
                        <Bot className="w-8 h-8 text-teal-400" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-serif font-bold mb-2 text-white">{agent.name}</h2>
                        <p className="text-gray-300 leading-relaxed text-lg font-light">{agent.description}</p>
                    </div>
                </div>

                <div className={`${PREMIUM_CONTAINER} flex-1 overflow-y-auto`}>
                    <p className="text-teal-400 text-sm font-bold uppercase tracking-wider mb-6">Database Schema Definition</p>
                    <VisualColumnEditor columns={crmColumns} onChange={setCrmColumns} />
                </div>

                <div className="mt-8 flex justify-end pb-10">
                    <button
                        onClick={onGenerate}
                        className={PREMIUM_BUTTON_PRIMARY + " flex items-center gap-2"}
                    >
                        Optimize & Generate <Sparkles className="w-5 h-5" />
                    </button>
                </div>
            </div>
        )
    }

    const currentQuestion = agent.questions[qIndex]
    const currentAnswer = answers[agent.id]?.[currentQuestion.id]

    // Determine if next is allowed (basic validation)
    const canProceed = currentQuestion.type === 'multi-select'
        ? Array.isArray(currentAnswer) && currentAnswer.length > 0
        : currentAnswer?.trim().length > 0

    const isLastQuestion = qIndex === agent.questions.length - 1

    const handleNext = () => {
        if (isLastQuestion) {
            onGenerate()
        } else {
            setQIndex(prev => prev + 1)
        }
    }

    const handleBack = () => {
        if (qIndex > 0) {
            setQIndex(prev => prev - 1)
        }
    }

    const progress = ((qIndex + 1) / agent.questions.length) * 100

    return (
        <div className="max-w-4xl mx-auto pt-10 h-full flex flex-col relative">
            {/* Header / Info */}
            <div className="flex items-start gap-8 mb-12">
                <div className="w-16 h-16 shrink-0 bg-teal-900/40 rounded-2xl flex items-center justify-center border border-teal-500/30 shadow-[0_0_15px_rgba(20,184,166,0.2)]">
                    <Bot className="w-8 h-8 text-teal-400" />
                </div>
                <div>
                    <h2 className="text-3xl font-serif font-bold mb-2 text-white">{agent.name}</h2>
                    <p className="text-gray-300 leading-relaxed text-lg font-light">{agent.description}</p>
                </div>
            </div>

            {/* Question Card */}
            <div className="flex-1 flex flex-col justify-center pb-20">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentQuestion.id}
                        initial={{ opacity: 0, x: 20, filter: "blur(5px)" }}
                        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, x: -20, filter: "blur(5px)" }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        className="w-full"
                    >
                        <label className="block text-2xl md:text-3xl font-medium text-white mb-8 flex flex-col gap-2">
                            <span className="text-teal-500 font-mono text-sm uppercase tracking-widest font-bold">
                                Question {qIndex + 1} of {agent.questions.length}
                            </span>
                            {currentQuestion.label}
                        </label>

                        <div className={`${PREMIUM_CONTAINER} p-1`}>
                            {currentQuestion.type === 'multi-select' ? (
                                <div className="p-6">
                                    <TagInput
                                        value={currentAnswer}
                                        onChange={(val) => handleAnswer(currentQuestion.id, val)}
                                        suggestions={JOB_TITLE_SUGGESTIONS}
                                    />
                                </div>
                            ) : (
                                <textarea
                                    className="w-full bg-transparent border-none rounded-xl p-6 text-xl text-white placeholder-gray-500 focus:ring-0 outline-none resize-none leading-relaxed min-h-[160px]"
                                    placeholder="Type your answer here..."
                                    value={currentAnswer || ''}
                                    onChange={(e) => handleAnswer(currentQuestion.id, e.target.value)}
                                    autoFocus
                                />
                            )}

                        </div>
                    </motion.div>
                </AnimatePresence>

                {/* Navigation & Progress */}
                <div className="mt-12 flex items-center justify-between">
                    <button
                        onClick={handleBack}
                        disabled={qIndex === 0}
                        className={`text-gray-400 hover:text-white transition-colors flex items-center gap-2 ${qIndex === 0 ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                    >
                        Back
                    </button>

                    <div className="flex-1 mx-12 h-1 bg-gray-800 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-teal-500 shadow-[0_0_10px_rgba(20,184,166,0.8)]"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.5 }}
                        />
                    </div>

                    <button
                        onClick={handleNext}
                        disabled={!canProceed}
                        className={`${PREMIUM_BUTTON_PRIMARY} flex items-center gap-2 disabled:opacity-50 disabled:grayscale`}
                    >
                        {isLastQuestion ? (
                            <>Optimize & Generate <Sparkles className="w-4 h-4" /></>
                        ) : (
                            <>Next <ChevronRight className="w-4 h-4" /></>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}

const StepVerifyPrompt = ({ agent, prompt, setPrompt, onConfirm, onBack, isOptimizing }) => {
    if (isOptimizing) {
        return (
            <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto text-center">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="mb-8"
                >
                    <RotateCw className="w-16 h-16 text-teal-500" />
                </motion.div>
                <h2 className="text-3xl font-bold text-white mb-4">Optimizing your inputs...</h2>
                <div className="space-y-2">
                    <Typewriter text="Analyzing intent..." delay={50} />
                    <Typewriter text="Structuring logic..." delay={50} startDelay={1500} />
                    <Typewriter text="Polishing formatting..." delay={50} startDelay={3000} />
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-5xl mx-auto pt-10 h-full flex flex-col">
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h2 className="text-4xl font-serif font-bold text-white drop-shadow-md">Verify Instructions</h2>
                    <p className="text-teal-400 text-lg mt-2">Review the generated prompt for {agent.name}</p>
                </div>
                <div className="flex gap-4">
                    <button onClick={onBack} className={PREMIUM_BUTTON_SECONDARY}>Back</button>
                    <button onClick={onConfirm} className={PREMIUM_BUTTON_PRIMARY + " flex items-center gap-2"}>
                        <Check className="w-5 h-5" /> Confirm & Next
                    </button>
                </div>
            </div>

            <div className="flex-1 bg-black/80 backdrop-blur-xl rounded-2xl p-1 overflow-hidden flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-teal-500/30">
                <div className="flex items-center gap-2 px-6 py-4 bg-white/5 border-b border-white/10 text-teal-400 text-sm uppercase tracking-wider font-bold">
                    <Edit3 className="w-4 h-4" /> System Prompt Editor
                </div>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="flex-1 w-full bg-transparent text-gray-200 font-mono text-base outline-none resize-none leading-relaxed p-8 focus:bg-white/5 transition-colors"
                    spellCheck="false"
                />
            </div>
        </div>
    )
}

const StepComplete = ({ onLaunch, isSaving }) => (
    <div className="flex flex-col items-center justify-center h-full max-w-3xl mx-auto text-center">
        <div className="mb-10 p-8 rounded-full bg-teal-500/20 border border-teal-500 shadow-[0_0_40px_rgba(20,184,166,0.4)] animate-bounce">
            <Rocket className="w-20 h-20 text-teal-400" />
        </div>
        <h2 className="text-5xl font-serif font-bold mb-8 text-white">You're All Set!</h2>
        <p className="text-2xl text-gray-300 mb-12 font-light">
            We have gathered all the necessary intelligence to power your agentic workforce.
            Click below to launch the system and save your configurations.
        </p>
        <button
            onClick={onLaunch}
            disabled={isSaving}
            className="px-12 py-6 bg-teal-500 hover:bg-teal-400 text-black text-xl rounded-full font-bold shadow-[0_0_20px_rgba(20,184,166,0.6)] hover:shadow-[0_0_40px_rgba(20,184,166,0.8)] transition-all hover:scale-105 disabled:opacity-50 disabled:scale-100"
        >
            {isSaving ? 'Launching System...' : 'Launch System 🚀'}
        </button>
    </div>
)


// --- Main Container ---

const Onboarding = () => {
    // --- State ---
    const [isLoaded, setIsLoaded] = useState(false)
    const [step, setStep] = useState('welcome')
    const [currentAgentIndex, setCurrentAgentIndex] = useState(0)
    const [userData, setUserData] = useState({ userName: 'Roelof', companyName: '' })
    const [surveyAnswers, setSurveyAnswers] = useState({})
    const [crmColumns, setCrmColumns] = useState([])
    const [generatedPrompts, setGeneratedPrompts] = useState({})
    const [currentDraftPrompt, setCurrentDraftPrompt] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [isOptimizing, setIsOptimizing] = useState(false)

    // --- Persistence ---
    useEffect(() => {
        // Load from localStorage
        const savedState = localStorage.getItem('onboarding_state')
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState)
                setStep(parsed.step || 'welcome')
                setCurrentAgentIndex(parsed.currentAgentIndex || 0)
                setUserData(parsed.userData || { userName: 'Roelof', companyName: '' })
                setSurveyAnswers(parsed.surveyAnswers || {})
                setCrmColumns(parsed.crmColumns || [])
                setGeneratedPrompts(parsed.generatedPrompts || {})
                console.log('Restored state from localStorage')
            } catch (e) {
                console.error('Failed to parse saved state', e)
            }
        }
        setIsLoaded(true)
    }, [])

    useEffect(() => {
        // Save to localStorage on change
        if (!isLoaded) return
        const stateToSave = {
            step,
            currentAgentIndex,
            userData,
            surveyAnswers,
            crmColumns,
            generatedPrompts
        }
        localStorage.setItem('onboarding_state', JSON.stringify(stateToSave))
    }, [step, currentAgentIndex, userData, surveyAnswers, crmColumns, generatedPrompts, isLoaded])

    const handleUserChange = (field, val) => setUserData(prev => ({ ...prev, [field]: val }))

    const handleGeneratePrompt = () => {
        // Start Optimization Animation
        setIsOptimizing(true)
        setStep('agent_verify')

        setTimeout(() => {
            const agent = AGENTS[currentAgentIndex]
            const answers = surveyAnswers[agent.id] || {}
            // Merge common user data
            const fullContext = { ...userData, ...answers }

            // Generate prompt
            const prompt = agent.template(fullContext, crmColumns)
            setCurrentDraftPrompt(prompt)

            setIsOptimizing(false)
        }, 3500) // 3.5s delay for "Optimization" effect
    }

    const handleConfirmPrompt = () => {
        const agent = AGENTS[currentAgentIndex]
        setGeneratedPrompts(prev => ({ ...prev, [agent.id]: currentDraftPrompt }))

        if (currentAgentIndex < AGENTS.length - 1) {
            setCurrentAgentIndex(prev => prev + 1)
            setStep('agent_survey')
        } else {
            setStep('complete')
        }
    }

    const handleLaunch = async () => {
        setIsSaving(true)
        try {
            await saveAgentPrompts(generatedPrompts)
            await saveCrmColumns(crmColumns)

            localStorage.removeItem('onboarding_state') // Clear progress just in case
            alert('System Launched! Configurations saved.')
        } catch (err) {
            console.error(err)
            alert('Failed to save configurations.')
        } finally {
            setIsSaving(false)
        }
    }

    // Render Logic
    if (!isLoaded) return null // Prevent flash of wrong state

    let content = null
    if (step === 'welcome') {
        content = <StepWelcome userName={userData.userName} onNext={() => setStep('company')} />
    } else if (step === 'company') {
        content = <StepCompanyInfo data={userData} onChange={handleUserChange} onNext={() => setStep('agent_survey')} />
    } else if (step === 'agent_survey') {
        content = (
            <StepAgentSurvey
                agent={AGENTS[currentAgentIndex]}
                answers={surveyAnswers}
                setAnswers={setSurveyAnswers}
                crmColumns={crmColumns}
                setCrmColumns={setCrmColumns}
                onGenerate={handleGeneratePrompt}
            />
        )
    } else if (step === 'agent_verify') {
        content = (
            <StepVerifyPrompt
                agent={AGENTS[currentAgentIndex]}
                prompt={currentDraftPrompt}
                setPrompt={setCurrentDraftPrompt}
                onConfirm={handleConfirmPrompt}
                onBack={() => setStep('agent_survey')}
                isOptimizing={isOptimizing}
            />
        )
    } else if (step === 'complete') {
        content = <StepComplete onLaunch={handleLaunch} isSaving={isSaving} />
    }

    return (
        <div className="min-h-screen font-sans relative">
            <div className="absolute inset-0 z-0 bg-transparent" />
            <div className="relative z-10 h-full w-full p-6">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={step + (step === 'agent_survey' ? currentAgentIndex : '')}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.3 }}
                        className="h-full"
                    >
                        {content}
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Progress Bar (Only for agent steps) */}
            {(step === 'agent_survey' || step === 'agent_verify') && (
                <div className="fixed bottom-0 left-0 right-0 h-1.5 bg-gray-900 border-t border-white/10 z-20">
                    <div
                        className="h-full bg-teal-500 shadow-[0_0_10px_rgba(20,184,166,0.8)] transition-all duration-500 ease-out"
                        style={{ width: `${((currentAgentIndex + (step === 'agent_verify' ? 0.5 : 0)) / AGENTS.length) * 100}%` }}
                    />
                </div>
            )}
        </div>
    )
}

export default Onboarding
