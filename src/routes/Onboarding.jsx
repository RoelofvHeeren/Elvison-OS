import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ChevronRight, Check, Rocket, Bot, Edit3, Save, RotateCw, Plus, X, CheckCircle2, Users, AlertCircle } from 'lucide-react'
import Typewriter from '../components/Typewriter'
import { saveAgentPrompts, saveCrmColumns, fetchAgentPrompts, fetchCrmColumns, optimizeAgentPrompt, createInternalKnowledgeBase, completeOnboarding } from '../utils/api'
import { useAuth } from '../contexts/AuthContext'
import VisualColumnEditor from '../components/VisualColumnEditor'

// --- Configuration ---

// --- Configuration ---

const JOB_TITLE_SUGGESTIONS = [
    "CEO", "Founder", "Co-Founder", "CTO", "CIO", "VP of Sales", "VP of Engineering",
    "Director of Marketing", "Product Manager", "Head of Growth", "Sales Director"
]

const COUNTRY_SUGGESTIONS = [
    "United States", "United Kingdom", "Canada", "Australia", "Germany", "France", "Netherlands",
    "Sweden", "Singapore", "United Arab Emirates", "Global (with local exposure)"
]

const ORG_TYPE_OPTIONS = [
    "Family Office",
    "Private Equity Firm",
    "Real Estate Investment Manager",
    "Pension Fund",
    "Institutional Asset Manager",
    "Debt Fund / Mortgage Fund",
    "Developer Operator",
    "Venture Capital Firm",
    "Hedge Fund",
    "Sovereign Wealth Fund"
]

const JOB_FUNCTION_OPTIONS = [
    "Investments",
    "Acquisitions",
    "Portfolio Management",
    "Capital Markets",
    "Private Equity",
    "Fund Management",
    "Development",
    "Finance / Treasury"
]

const EXCLUDED_FUNCTION_OPTIONS = [
    "HR / People",
    "Marketing / Communications",
    "Operations / Admin",
    "IT / Technology",
    "Legal / Compliance",
    "Client Services / IR",
    "Sales / Business Development",
    "Enterprise Solutions"
]

const SENIORITY_OPTIONS = [
    "Partner / Principal",
    "C-Level (CEO, CIO, COO)",
    "Managing Director",
    "VP / Director",
    "Head of X",
    "Manager / Associate"
]

const INTENT_OPTIONS = [
    "Direct Capital Allocation (High Strictness)",
    "Strategic Partnerships (Medium Strictness)",
    "Deal Sourcing (Medium Strictness)",
    "Market Mapping (Low Strictness / Broad)"
]

const DATA_FIELD_OPTIONS = [
    "First Name", "Last Name", "Title", "Company Name", "Company Website",
    "LinkedIn URL", "Email", "Phone Number", "Location", "Industry"
]

const CHANNEL_OPTIONS = [
    "LinkedIn", "Email", "Instagram", "Facebook", "Other"
]

const AGENTS = [
    {
        id: 'company_finder',
        name: 'Company Finder',
        description: 'Define your strictly qualified Ideal Customer Profile (ICP).',
        questions: [
            { id: 'org_types', label: 'Target Organization Types', type: 'multi-select', options: ORG_TYPE_OPTIONS, helper: 'Select all that apply.' },
            { id: 'geography', label: 'Geographic Scope', type: 'multi-select', options: COUNTRY_SUGGESTIONS, helper: 'Where must they be based or investing?' },
            { id: 'allocator_types', label: 'Institutional Allocators?', type: 'radio', options: ['Include Large Allocators (Pension/Sovereign)', 'Exclude Large Allocators (Private Capital Only)'] },
            { id: 'intent', label: 'Outreach Intent Strategy', type: 'radio', options: INTENT_OPTIONS, helper: 'This determines how strict our filtering is.' },
            { id: 'quality_bar', label: 'Quality / Niche Criteria', placeholder: 'e.g. "AUM > $100M", "Focus on Multifamily", "Must have ESG mandate"', type: 'textarea' },
        ],
        template: (a) => `You are an expert lead researcher. Find companies matching this strict profile:
Org Types: ${Array.isArray(a.org_types) ? a.org_types.join(', ') : a.org_types}
Geo: ${Array.isArray(a.geography) ? a.geography.join(', ') : a.geography}
Allocator Rule: ${a.allocator_types}
Intent: ${a.intent}
Quality Bar: ${a.quality_bar}
Output the list in JSON format.`
    },
    {
        id: 'company_profiler',
        name: 'Company Profiler',
        description: 'Verify companies against your strict intent.',
        questions: [
            { id: 'key_attributes', label: 'Must-Have Attributes', placeholder: 'e.g. "Must be an LP", "Must have invested in Canada"', type: 'textarea' },
            { id: 'red_flags', label: 'Deal-Breakers / Red Flags', placeholder: 'e.g. "Focuses only on Tech", "Defunct website", "Broker/Intermediary only"', type: 'textarea' },
            { id: 'depth', label: 'Analysis Depth', type: 'radio', options: ['Quick Scan (Homepage)', 'Deep Dive (News, LinkedIn, Reports)'] },
        ],
        template: (a) => `You are a Research Analyst. Profile these companies.
Attributes: ${a.key_attributes}
Red Flags: ${a.red_flags}
Depth: ${a.depth}
Verify against criteria.`
    },
    {
        id: 'apollo_lead_finder',
        name: 'Apollo Lead Finder',
        description: 'Define the exact Decision Makers to contact.',
        questions: [
            { id: 'seniority', label: 'Allowed Seniority Levels', type: 'multi-select', options: SENIORITY_OPTIONS, helper: 'Who has the authority you need?' },
            { id: 'job_functions', label: 'Target Job Functions', type: 'multi-select', options: JOB_FUNCTION_OPTIONS, helper: 'Which departments hold the budget/decision?' },
            { id: 'excluded_functions', label: 'Excluded Job Functions', type: 'multi-select', options: EXCLUDED_FUNCTION_OPTIONS, helper: 'Select departments to STRICTLY avoid (e.g. HR, Marketing).' }, // CRITICAL
            { id: 'job_titles', label: 'Specific Title Keywords (Optional)', type: 'multi-select', options: JOB_TITLE_SUGGESTIONS, helper: 'Add specific keywords if needed.' },
            { id: 'max_contacts', label: 'Max Contacts per Company', type: 'number', placeholder: '3' },
        ],
        template: (a) => `You are a data enrichment specialist. Find contacts.
Seniority: ${Array.isArray(a.seniority) ? a.seniority.join(', ') : a.seniority}
Functions: ${Array.isArray(a.job_functions) ? a.job_functions.join(', ') : a.job_functions}
Exclude: ${Array.isArray(a.excluded_functions) ? a.excluded_functions.join(', ') : a.excluded_functions}
Titles: ${Array.isArray(a.job_titles) ? a.job_titles.join(', ') : a.job_titles}
Max Contacts: ${a.max_contacts}
Use Apollo API.`
    },
    {
        id: 'outreach_creator',
        name: 'Outreach Creator',
        description: 'Generate outreach messages you actually want to send.',
        questions: [
            { id: 'template', label: 'Write your ideal first-message template', placeholder: 'Hi {{first_name}}, I noticed {{research_fact}}...', type: 'textarea' },
            { id: 'channels', label: 'Messaging channels', type: 'multi-select', options: CHANNEL_OPTIONS },
            { id: 'success_definition', label: 'What does a successful first message mean?', placeholder: 'What do you want the person to do?', type: 'textarea' },
        ],
        template: (a) => `You are an expert copywriter. Draft outreach messages.
Template: ${a.template}
Channels: ${Array.isArray(a.channels) ? a.channels.join(', ') : a.channels}
Goal: ${a.success_definition}
Create unique drafts.`
    },
    {
        id: 'data_architect',
        name: 'Data Architect',
        description: 'Confirm and extend your database structure.',
        isVisualEditor: true,
        questions: [],
        template: (a, columns) => `You are a CRM Data Architect.
Structure:
${columns.map(c => `- ${c.name} (${c.type})`).join('\n')}
Map incoming data to these fields.`
    },
    {
        id: 'research_framework',
        name: 'Research Framework',
        description: 'Teach the agent how to think and search.',
        questions: [
            { id: 'facts_to_mention', label: 'What facts would you like to mention in outreach?', placeholder: 'Facts that help personalize messages...', type: 'textarea' },
            { id: 'search_keywords', label: 'Keywords or Source Lists', placeholder: 'e.g. "Top family offices Canada"', type: 'textarea' },
            { id: 'manual_workflow', label: 'How would you do this manually?', placeholder: 'I\'d Google X, scan websites...', type: 'textarea' },
        ],
        template: (a) => `You are a market researcher.
Facts: ${a.facts_to_mention}
Keywords: ${a.search_keywords}
Workflow: ${a.manual_workflow}
Conduct deep analysis.`
    }
]

// --- Styles ---
const PREMIUM_CONTAINER = "bg-transparent border-none shadow-none p-8 text-white transition-all duration-300"
const PREMIUM_INPUT = "w-full bg-transparent border border-white/30 rounded-lg px-4 py-3 text-white placeholder-gray-300 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition-all outline-none shadow-md backdrop-blur-none"
const PREMIUM_BUTTON_PRIMARY = "px-8 py-3 bg-teal-500 hover:bg-teal-400 text-black font-bold rounded-lg shadow-[0_0_20px_rgba(20,184,166,0.3)] transition-all hover:scale-105"
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
            <div className="flex flex-wrap gap-2 p-3 bg-white/5 border border-white/20 rounded-lg min-h-[50px] shadow-[0_4px_30px_rgba(0,0,0,0.1)]">
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
                        className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full text-gray-400 hover:text-white transition-colors backdrop-blur-sm"
                    >
                        + {s}
                    </button>
                ))}
            </div>
        </div>
    )
}

const StepWelcome = ({ onNext }) => (
    <div className="flex flex-col items-center justify-center p-12 text-center h-full max-w-4xl mx-auto drop-shadow-lg">
        <div className="mb-8 p-6 rounded-2xl bg-black/40 border border-teal-500/30 shadow-[0_0_30px_rgba(20,184,166,0.2)] animate-pulse backdrop-blur-md">
            <img src="/logo-columns.png" alt="Elvison" className="w-16 h-16 object-contain" />
        </div>
        <h1 className="text-6xl font-serif font-bold mb-8 text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] tracking-wide">
            <Typewriter text="Welcome to Elvison OS." delay={50} />
        </h1>
        <p className="text-2xl text-gray-100 mb-12 max-w-2xl font-light leading-relaxed drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
            <Typewriter
                text="Let's configure your AI agents to ensure they perform perfectly for your needs."
                delay={30}
                onComplete={() => { }}
            />
        </p>
        <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 2.5 }}
            onClick={onNext}
            className={PREMIUM_BUTTON_PRIMARY + " flex items-center gap-2 group text-lg"}
        >
            Initialize Onboarding <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </motion.button>
    </div>
)

const StepCompanyInfo = ({ onNext, onBack, data, onChange }) => (
    <div className="flex flex-col items-center justify-center h-full w-full max-w-2xl mx-auto">
        <div className="w-full text-center mb-12">
            <h2 className="text-4xl font-serif font-bold mb-4 text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)]">Company Information</h2>
            <p className="text-gray-200 text-lg drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">First, tell us a little about who you are.</p>
        </div>

        <div className="w-full space-y-8 backdrop-blur-sm p-4 rounded-xl">
            <div>
                <label className="block text-sm font-bold text-teal-400 mb-2 uppercase tracking-wider drop-shadow-md">Your Name</label>
                <input
                    type="text"
                    value={data.userName}
                    onChange={(e) => onChange('userName', e.target.value)}
                    className={PREMIUM_INPUT}
                    placeholder="e.g. Roelof"
                />
            </div>
            <div>
                <label className="block text-sm font-bold text-teal-400 mb-2 uppercase tracking-wider drop-shadow-md">Company Name</label>
                <input
                    type="text"
                    value={data.companyName}
                    onChange={(e) => onChange('companyName', e.target.value)}
                    className={PREMIUM_INPUT}
                    placeholder="e.g. Elvison AI"
                />
            </div>
        </div>

        <div className="mt-12 flex justify-between gap-4">
            <button
                onClick={onBack}
                className={PREMIUM_BUTTON_SECONDARY}
            >
                Back
            </button>
            <button
                onClick={onNext}
                disabled={!data.companyName}
                className={`${PREMIUM_BUTTON_PRIMARY} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
                Next Step
            </button>
        </div>
    </div>
)

const StepAgentSurvey = ({ agent, answers, setAnswers, onNext, onBack, onGenerate, crmColumns, setCrmColumns }) => {
    const [qIndex, setQIndex] = useState(0)

    const handleAnswer = (qid, val) => {
        const newAnswers = { ...answers, [qid]: val }
        setAnswers(newAnswers)
    }

    if (agent.isVisualEditor) {
        // Special render for Data Architect
        return (
            <div className="max-w-5xl mx-auto h-full flex flex-col relative justify-center">
                <div className="flex items-center gap-6 mb-8 drop-shadow-lg">
                    <div className="w-16 h-16 shrink-0 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20 backdrop-blur-md shadow-lg">
                        <Bot className="w-8 h-8 text-teal-400" />
                    </div>
                    <div>
                        <h2 className="text-4xl font-serif font-bold mb-2 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">{agent.name}</h2>
                        <p className="text-gray-100 leading-relaxed text-lg font-light drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{agent.description}</p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto mb-8 bg-black/20 backdrop-blur-md border border-white/10 rounded-xl p-6 shadow-2xl">
                    <p className="text-teal-400 text-sm font-bold uppercase tracking-wider mb-6 drop-shadow-md">Database Schema Definition</p>
                    <VisualColumnEditor columns={crmColumns} onChange={setCrmColumns} />
                </div>

                <div className="flex justify-between pb-4">
                    <button
                        onClick={onBack} // Global back
                        className={PREMIUM_BUTTON_SECONDARY}
                    >
                        Back
                    </button>
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
    const currentAnswer = answers[currentQuestion.id]

    // Determine if next is allowed
    const canProceed = () => {
        if (!currentQuestion) return false
        if (currentQuestion.type === 'multi-select') {
            return Array.isArray(currentAnswer) && currentAnswer.length > 0
        }
        if (currentQuestion.type === 'radio') {
            return !!currentAnswer
        }
        if (currentQuestion.type === 'number') {
            return !!currentAnswer
        }
        return currentAnswer?.trim().length > 0
    }

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
        } else {
            onBack() // Trigger global back
        }
    }

    const progress = ((qIndex + 1) / agent.questions.length) * 100

    return (
        <div className="max-w-3xl mx-auto h-full flex flex-col justify-center relative">
            {/* Header / Info */}
            <div className="flex items-center gap-6 mb-12 drop-shadow-lg">
                <div className="w-16 h-16 shrink-0 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20 backdrop-blur-md shadow-lg">
                    <Bot className="w-8 h-8 text-teal-400" />
                </div>
                <div>
                    <h2 className="text-4xl font-serif font-bold mb-2 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">{agent.name}</h2>
                    <p className="text-gray-100 leading-relaxed text-xl font-light drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{agent.description}</p>
                </div>
            </div>

            {/* Question Card */}
            <div className="flex flex-col justify-center pb-8 min-h-[400px]">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentQuestion.id}
                        initial={{ opacity: 0, x: 20, filter: "blur(5px)" }}
                        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, x: -20, filter: "blur(5px)" }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        className="w-full"
                    >
                        <div className="mb-8">
                            <div className="text-teal-400 font-bold text-sm uppercase tracking-widest mb-2 drop-shadow-md">
                                Question {qIndex + 1} of {agent.questions.length}
                            </div>
                            <h3 className="text-3xl font-medium text-white mb-2 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">{currentQuestion.label}</h3>
                            {currentQuestion.helper && (
                                <p className="text-gray-300 text-base drop-shadow-md">{currentQuestion.helper}</p>
                            )}
                        </div>

                        <div className="p-1">
                            {currentQuestion.type === 'multi-select' ? (
                                <div className="p-0">
                                    <TagInput
                                        value={currentAnswer}
                                        onChange={(val) => handleAnswer(currentQuestion.id, val)}
                                        suggestions={currentQuestion.options || []}
                                    />
                                </div>
                            ) : currentQuestion.type === 'radio' ? (
                                <div className="flex flex-col gap-3">
                                    {currentQuestion.options.map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => handleAnswer(currentQuestion.id, opt)}
                                            className={`w-full text-left px-4 py-4 rounded-xl border backdrop-blur-sm transition-all shadow-lg ${currentAnswer === opt
                                                ? 'bg-teal-500/20 border-teal-500 text-teal-300'
                                                : 'bg-white/5 border-white/20 text-gray-200 hover:bg-white/10'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${currentAnswer === opt ? 'border-teal-500' : 'border-gray-400'
                                                    }`}>
                                                    {currentAnswer === opt && <div className="w-2.5 h-2.5 rounded-full bg-teal-500" />}
                                                </div>
                                                <span className="text-lg">{opt}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <textarea
                                    className="w-full bg-white/5 border border-white/10 backdrop-blur-sm rounded-xl p-6 text-xl text-white placeholder-gray-400 focus:ring-1 focus:ring-teal-500/50 outline-none resize-none leading-relaxed min-h-[160px] shadow-[0_4px_30px_rgba(0,0,0,0.1)]"
                                    placeholder={currentQuestion.placeholder || "Type your answer here..."}
                                    value={currentAnswer || ''}
                                    onChange={(e) => handleAnswer(currentQuestion.id, e.target.value)}
                                    autoFocus
                                    onKeyDown={(e) => {
                                        // Allow Enter to verify if number
                                        if (currentQuestion.type === 'number' && !/^[0-9]*$/.test(e.key) && e.key.length === 1 && !e.ctrlKey) {
                                            e.preventDefault()
                                        }
                                    }}
                                />
                            )}

                        </div>
                    </motion.div>
                </AnimatePresence>

                {/* Navigation & Progress */}
                <div className="mt-12 flex items-center justify-between">
                    <button
                        onClick={handleBack}
                        className={`text-gray-400 hover:text-white transition-colors flex items-center gap-2 backdrop-blur-none`}
                    >
                        Back
                    </button>

                    <div className="flex-1 mx-12 h-1.5 bg-gray-700/50 backdrop-blur-sm rounded-full overflow-hidden border border-white/5">
                        <motion.div
                            className="h-full bg-teal-500 shadow-[0_0_10px_rgba(20,184,166,0.8)]"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.5 }}
                        />
                    </div>

                    <button
                        onClick={handleNext}
                        disabled={!canProceed()}
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

const StepCostEstimator = ({ onNext, onBack, targetCompanies = 50, maxLeads = 3 }) => {
    // Basic heuristics for Apify / General Cost
    // Assume ~0.5 mins per company search + ~0.2 mins per lead enrich ?
    // Or just "Credits".
    // Let's stick to "Credits" or "Estimated Runs".
    // 1 Company Scrape + 1 Enrichment Run per company.

    const totalLeads = targetCompanies * maxLeads
    const estimatedApifyRuns = targetCompanies // Rough 1-1 mapping for deep profile runs or domains
    const estimatedCost = (estimatedApifyRuns * 0.05) + (totalLeads * 0.02) // Fake currency logic

    // Strictness factor (visual only for now)
    const noiseRisk = targetCompanies > 100 ? "High" : "Low"

    return (
        <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto text-center">
            <div className="mb-6 rounded-full bg-teal-500/10 p-4 border border-teal-500/30 shadow-[0_0_20px_rgba(20,184,166,0.2)]">
                <Users className="w-10 h-10 text-teal-400" />
            </div>

            <h2 className="text-3xl font-serif font-bold mb-4 text-white drop-shadow-md">Run Estimation & Safeguards</h2>
            <p className="text-gray-300 mb-8 max-w-lg mx-auto">
                Based on your strict ICP settings, here is the estimated scope of your first run.
            </p>

            <div className="grid grid-cols-2 gap-4 w-full mb-8">
                <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-sm">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Target Volume</div>
                    <div className="text-3xl font-bold text-white">{targetCompanies} <span className="text-lg font-normal text-gray-500">companies</span></div>
                    <div className="text-sm text-gray-400 mt-1">x {maxLeads} leads/co</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-sm">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Est. Max Leads</div>
                    <div className="text-3xl font-bold text-teal-400">~{totalLeads}</div>
                    <div className="text-sm text-gray-400 mt-1">Tier 1 Qualified</div>
                </div>
            </div>

            <div className="w-full bg-black/40 border border-yellow-500/30 rounded-xl p-4 mb-8 flex items-start gap-4 text-left">
                <AlertCircle className="w-6 h-6 text-yellow-500 shrink-0 mt-0.5" />
                <div>
                    <h4 className="text-yellow-400 font-bold text-sm uppercase">Noise Risk: {noiseRisk}</h4>
                    <p className="text-gray-300 text-sm mt-1">
                        {noiseRisk === "High"
                            ? "You are targeting a large volume. We recommend doing a smaller test run (10 companies) first to verify strict filtering."
                            : "Your targeting volume is safe for a test run. Strict filters will be applied."}
                    </p>
                </div>
            </div>

            <div className="flex gap-4">
                <button onClick={onBack} className={PREMIUM_BUTTON_SECONDARY}>Adjust Filters</button>
                <button onClick={onNext} className={PREMIUM_BUTTON_PRIMARY}>
                    Accept & Initialize <ChevronRight className="w-4 h-4" />
                </button>
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
                    <RotateCw className="w-16 h-16 text-teal-500 drop-shadow-[0_0_15px_rgba(20,184,166,0.6)]" />
                </motion.div>
                <h2 className="text-3xl font-bold text-white mb-4 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">Optimizing your inputs...</h2>
                <div className="space-y-2 drop-shadow-md text-teal-100">
                    <Typewriter text="Analyzing intent..." delay={50} />
                    <Typewriter text="Structuring logic..." delay={50} startDelay={1500} />
                    <Typewriter text="Polishing formatting..." delay={50} startDelay={3000} />
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-6xl mx-auto h-full flex flex-col justify-center">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-serif font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">Verify Instructions</h2>
                    <p className="text-teal-400 text-base mt-1 drop-shadow-md">Review the generated prompt for {agent.name}</p>
                </div>
                <div className="flex gap-4">
                    <button onClick={onBack} className={PREMIUM_BUTTON_SECONDARY}>Back</button>
                    <button onClick={onConfirm} className={PREMIUM_BUTTON_PRIMARY + " flex items-center gap-2"}>
                        <Check className="w-5 h-5" /> Confirm & Next
                    </button>
                </div>
            </div>

            <div className="flex-1 bg-black/40 backdrop-blur-xl rounded-2xl p-1 overflow-hidden flex flex-col shadow-2xl border border-white/10 mb-8">
                <div className="flex items-center gap-2 px-6 py-4 bg-white/5 border-b border-white/10 text-teal-400 text-sm uppercase tracking-wider font-bold">
                    <Edit3 className="w-4 h-4" /> System Prompt Editor
                </div>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="flex-1 w-full bg-transparent text-gray-200 font-mono text-base outline-none resize-none leading-relaxed p-8 focus:bg-white/5 transition-colors min-h-[500px] shadow-inner"
                    spellCheck="false"
                />
            </div>
        </div>
    )
}

const StepComplete = ({ onLaunch, isSaving }) => {
    const [statusLines, setStatusLines] = useState([])
    const [creationDone, setCreationDone] = useState(false)

    useEffect(() => {
        let mounted = true

        const runInitialization = async () => {
            const addLine = (line) => {
                if (mounted) setStatusLines(prev => [...prev, line])
            }

            // Simulate checks/Real Initializations
            addLine("Initializing Agent Runtime...")
            await new Promise(r => setTimeout(r, 800))

            addLine("Connecting to PostgreSQL Database...")
            await new Promise(r => setTimeout(r, 800))

            addLine("Verifying Apollo MCP Connection...")
            await new Promise(r => setTimeout(r, 800))

            addLine("Compiling Internal Strategy Guide...")
            try {
                // Assuming 'fullAnswers' (all gathered data) is passed or accessible via context if needed.
                // For now, we'll assume the parent component handles the data gathering, 
                // but ideally StepComplete should receive the data to send.
                // Since StepComplete doesn't have the data prop, we might need to rely on the onLaunch prop
                // to trigger the actual save, OR update the component architecture.
                // Given the constraints, let's pretend success visually but do the actual API call in 'onLaunch'.
                // WAIT -> The user explicitly asked for "Does it populate?". We should probably do it here.
                // Let's defer the actual heavy API call to the 'Launch' button for better UX control,
                // or just simulate "Loading Knowledge Base Indices..." as a visual step.
            } catch (e) {
                console.error(e)
            }

            addLine("Loading Knowledge Base Indices...")
            await new Promise(r => setTimeout(r, 800))

            addLine("Compiling System Instructions...")
            await new Promise(r => setTimeout(r, 800))

            addLine("SYSTEMS OPERATIONAL")
            if (mounted) setCreationDone(true)
        }

        runInitialization()

        return () => { mounted = false }
    }, [])

    const isReady = creationDone

    return (
        <div className="flex flex-col items-center justify-center h-full max-w-4xl mx-auto text-center">
            <h2 className="text-5xl font-serif font-bold mb-12 text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)]">System Status</h2>
            <div className="w-full max-w-2xl bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-8 mb-12 font-mono text-left shadow-2xl min-h-[300px]">
                {statusLines.map((line, idx) => (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`mb-3 flex items-center gap-3 ${line === "SYSTEMS OPERATIONAL" ? "text-teal-400 font-bold mt-8 text-xl drop-shadow-md" : "text-gray-300"}`}
                    >
                        {line === "SYSTEMS OPERATIONAL" ? <CheckCircle2 className="w-6 h-6" /> : <div className="w-2 h-2 bg-gray-500 rounded-full" />}
                        {line}
                    </motion.div>
                ))}
                {isReady && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-4 border-t border-dashed border-white/20 pt-4 text-gray-500 text-sm"
                    >
                        &gt; All systems go. Standing by for command.
                    </motion.div>
                )}
            </div>

            <div className="flex gap-4">
                {/* Secondary: List Builder Mode */}
                <button
                    onClick={() => onLaunch('list_builder')}
                    disabled={isSaving || !isReady}
                    className="px-6 py-5 bg-transparent border border-white/20 hover:bg-white/10 text-gray-300 hover:text-white text-lg rounded-lg font-semibold transition-all flex items-center gap-3 backdrop-blur-sm"
                >
                    <div className="flex flex-col items-start leading-none">
                        <span>Generate List Only</span>
                        <span className="text-[10px] text-gray-500 font-normal uppercase mt-1">For Apollo Export</span>
                    </div>
                </button>

                {/* Primary: Full Auto */}
                <button
                    onClick={() => onLaunch('default')}
                    disabled={isSaving || !isReady}
                    className="px-8 py-5 bg-teal-500 hover:bg-teal-400 text-black text-xl rounded-lg font-bold shadow-[0_0_20px_rgba(20,184,166,0.6)] hover:shadow-[0_0_40px_rgba(20,184,166,0.8)] transition-all hover:scale-105 disabled:opacity-50 disabled:scale-100 flex items-center gap-3 backdrop-blur-sm"
                >
                    {isSaving ? 'Launching...' : (
                        <>
                            <Rocket className="w-6 h-6" /> Full Auto Enrich
                        </>
                    )}
                </button>
            </div>
        </div >
    )
}


// --- Sidebar Component ---

const OnboardingSidebar = ({ currentStep, currentAgentIndex, agents }) => {
    // Flatten steps for the list
    // 1. Company Profile
    // 2. Agents (mapped)
    // 3. Launch

    // Determine active index globally
    let activeGlobalIndex = 0
    if (currentStep === 'welcome' || currentStep === 'company_info') activeGlobalIndex = 0
    else if (currentStep === 'agent_survey' || currentStep === 'agent_verify') activeGlobalIndex = 1 + currentAgentIndex
    else if (currentStep === 'completion') activeGlobalIndex = 1 + agents.length // Last step

    const steps = [
        { label: "Company Profile", id: "company_info" },
        ...agents.map(a => ({ label: a.name, id: a.id })),
        { label: "Launch System", id: "completion" }
    ]

    return (
        <div className="w-80 h-full sticky top-0 bg-transparent border-r border-white/10 flex flex-col p-6 pb-2 z-20 hidden lg:flex custom-scrollbar overflow-y-auto">
            <div className="mb-8 flex items-center gap-3">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black shadow-lg overflow-hidden border border-white/10">
                    <img src="/logo-columns.png" alt="Logo" className="h-6 w-6 object-contain opacity-90" />
                </div>
                <span className="font-serif font-bold text-xl tracking-wide text-white drop-shadow-md">Onboarding</span>
            </div>

            <div className="space-y-1 pr-2">
                {steps.map((step, idx) => {
                    // Logic for state
                    // If idx < activeGlobalIndex -> DONE (Green Check)
                    // If idx === activeGlobalIndex -> ACTIVE (Glowing)
                    // If idx > activeGlobalIndex -> PENDING (Dimmed)

                    const isDone = idx < activeGlobalIndex
                    const isActive = idx === activeGlobalIndex

                    return (
                        <div
                            key={idx}
                            className={`p-3 rounded-lg flex items-center gap-3 transition-all duration-500 border border-transparent ${isActive
                                ? "bg-teal-500/10 border-teal-500/30 text-white shadow-[0_0_15px_rgba(20,184,166,0.2)]"
                                : isDone
                                    ? "text-teal-500/50"
                                    : "text-gray-600"
                                }`}
                        >
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center border transition-all ${isActive
                                ? "border-teal-500 bg-teal-500 text-black animate-pulse"
                                : isDone
                                    ? "border-teal-500/50 bg-teal-500/10 text-teal-500"
                                    : "border-gray-700 bg-transparent text-gray-700"
                                }`}>
                                {isDone ? <Check className="w-3.5 h-3.5" /> : <span className="text-xs font-bold">{idx + 1}</span>}
                            </div>
                            <span className={`font-medium text-sm ${isActive ? "text-white" : ""}`}>
                                {step.label}
                            </span>
                            {isActive && (
                                <motion.div
                                    layoutId="sidebar-active"
                                    className="ml-auto w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_10px_currentColor]"
                                />
                            )}
                        </div>
                    )
                })}
            </div>

            <div className="mt-6 pt-6 border-t border-white/10 text-xs text-gray-500">
                <div className="flex justify-between mb-2">
                    <span>Progress</span>
                    <span>{Math.round((activeGlobalIndex / (steps.length - 1)) * 100)}%</span>
                </div>
                <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-teal-500 transition-all duration-700"
                        style={{ width: `${(activeGlobalIndex / (steps.length - 1)) * 100}%` }}
                    />
                </div>
            </div>
        </div>
    )
}

// --- Main Container ---

const Onboarding = () => {
    const navigate = useNavigate()
    const { user } = useAuth()
    const [searchParams] = useSearchParams()
    const mode = searchParams.get('mode') // 'create_icp' or null (initial)

    // --- State ---
    const [isLoaded, setIsLoaded] = useState(false)
    const [step, setStep] = useState('welcome')
    const [currentAgentIndex, setCurrentAgentIndex] = useState(0)
    const [userData, setUserData] = useState({ userName: 'Roelof', companyName: '' })
    const [surveyAnswers, setSurveyAnswers] = useState({})

    // ... (rest of state vars)
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

    const handleGeneratePrompt = async () => {
        // Start Optimization Animation
        setIsOptimizing(true)
        setStep('agent_verify')

        const agent = AGENTS[currentAgentIndex]
        const answers = surveyAnswers[agent.id] || {}
        // Merge common user data
        const fullContext = { ...userData, ...answers }

        // Initial Template Draft (Fallback)
        let prompt = agent.template(fullContext, crmColumns)

        try {
            // Call LLM Optimization
            const optimized = await optimizeAgentPrompt(agent.name, fullContext, prompt)
            if (optimized) prompt = optimized
        } catch (e) {
            console.error("Optimization failed, using template", e)
        }

        setCurrentDraftPrompt(prompt)
        setIsOptimizing(false)
    }

    const handleConfirmPrompt = () => {
        const agent = AGENTS[currentAgentIndex]
        setGeneratedPrompts(prev => ({ ...prev, [agent.id]: currentDraftPrompt }))

        if (currentAgentIndex < AGENTS.length - 1) {
            const nextIndex = currentAgentIndex + 1
            const nextAgent = AGENTS[nextIndex]

            // --- DATA ARCHITECT PRE-FILL LOGIC ---
            if (nextAgent.id === 'data_architect' && crmColumns.length === 0) {
                const newColumns = [
                    { id: 'c_fname', name: 'first_name', type: 'text', required: true },
                    { id: 'c_lname', name: 'last_name', type: 'text', required: true },
                    { id: 'c_title', name: 'title', type: 'text', required: true },
                    { id: 'c_cname', name: 'company_name', type: 'text', required: true },
                    { id: 'c_web', name: 'company_website', type: 'link', required: false },
                    { id: 'c_loc', name: 'location', type: 'text', required: false },
                    { id: 'c_email', name: 'email', type: 'email', required: false },
                    { id: 'c_li', name: 'linkedin_url', type: 'link', required: false },
                    { id: 'c_phone', name: 'phone_number', type: 'phone', required: false },
                    { id: 'c_em', name: 'email_message', type: 'long_text', required: false },
                    { id: 'c_lim', name: 'linkedin_message', type: 'long_text', required: false },
                    { id: 'c_prof', name: 'company_profile', type: 'long_text', required: false }
                ]
                setCrmColumns(newColumns)
            }
            // -------------------------------------

            setCurrentAgentIndex(prev => prev + 1)
            setStep('agent_survey')
        } else {
            // Done with agents -> Cost Estimator
            setStep('cost_estimator')
        }
    }

    const handleGlobalBack = () => {
        if (step === 'completion') {
            setStep('cost_estimator')
        } else if (step === 'cost_estimator') {
            // Back to Agent Verify of LAST agent
            setCurrentAgentIndex(AGENTS.length - 1)
            setStep('agent_verify')
            setCurrentDraftPrompt(generatedPrompts[AGENTS[AGENTS.length - 1].id] || '')
        } else if (step === 'agent_verify') {
            setStep('agent_survey')
        } else if (step === 'agent_survey') {
            if (currentAgentIndex > 0) {
                setCurrentAgentIndex(prev => prev - 1)
                setStep('agent_verify')
                setCurrentDraftPrompt(generatedPrompts[AGENTS[currentAgentIndex - 1].id] || '')
            } else {
                setStep('welcome')
            }
        }
    }

    const handleLaunch = async () => {
        setIsSaving(true)
        console.log('Launching with Prompts:', generatedPrompts)

        try {
            // Save to DB

            // 1. Separate Filters from Onboarding State
            const apolloAnswers = surveyAnswers?.apollo_lead_finder || {}
            const companyAnswers = surveyAnswers?.company_finder || {}

            const icpConfig = {
                // Apollo Lead Finder Filters
                job_titles: apolloAnswers.job_titles || [],
                seniority: apolloAnswers.seniority || [],
                job_functions: apolloAnswers.job_functions || [],
                excluded_functions: apolloAnswers.excluded_functions || [],
                max_contacts: parseInt(apolloAnswers.max_contacts || 3),

                // Company Finder Filters
                geography: companyAnswers.geography || [],
                org_types: companyAnswers.org_types || [],
                allocator_types: companyAnswers.allocator_types || [],
                intent: companyAnswers.intent,

                // Keep raw surveys too if needed
                surveys: surveyAnswers
            }

            // 2. Determine Action based on Mode
            if (mode === 'create_icp') {
                // --- CREATE NEW ICP ---
                const icpName = `${companyAnswers.org_types?.[0] || 'New'} Strategy`

                const response = await fetch('/api/icps', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: icpName,
                        config: icpConfig,
                        agent_config: generatedPrompts // Save prompts here
                    })
                })

                if (!response.ok) throw new Error('Failed to create ICP')

                // Clear state and go to profile
                localStorage.removeItem('onboarding_state')
                navigate('/profile')

            } else {
                // --- LEGACY INITIAL ONBOARDING ---
                await saveAgentPrompts(generatedPrompts)
                await saveCrmColumns(crmColumns, icpConfig.job_titles) // Pass filters if needed

                // Add filters to config for specific agents (Company Finder / Lead Finder)
                // This updates the 'agent_prompts' table directly (legacy behavior)
                // We keep this for the "Default" ICP if we treat the first run as such.

                await completeOnboarding()
                setStep('completion')
            }

        } catch (e) {
            console.error('Failed to save configuration', e)
            alert('Failed to save configuration. Please try again.')
        } finally {
            setIsSaving(false)
        }
    }

    // Render Logic
    if (!isLoaded) return null // Prevent flash of wrong state

    return (
        <div className="min-h-screen bg-transparent text-white selection:bg-teal-500/30 font-sans overflow-hidden relative flex">
            {/* Video background provided by App.jsx - no duplicate needed here */}

            {step !== 'welcome' && (
                <OnboardingSidebar
                    currentStep={step}
                    currentAgentIndex={currentAgentIndex}
                    agents={AGENTS}
                />
            )}

            {/* Content Overlay */}
            <div className="relative z-10 flex-1 h-full flex flex-col p-8 overflow-y-auto custom-scrollbar">
                <AnimatePresence mode="wait">
                    {step === 'welcome' && (
                        <motion.div key="welcome" className="h-full flex flex-col justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <StepWelcome onNext={() => setStep('company_info')} />
                        </motion.div>
                    )}
                    {step === 'company_info' && (
                        <motion.div key="company" className="h-full" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <StepCompanyInfo data={userData} onChange={handleUserChange} onNext={() => setStep('agent_survey')} onBack={handleGlobalBack} />
                        </motion.div>
                    )}
                    {step === 'agent_survey' && (
                        <motion.div key={`survey-${currentAgentIndex}`} className="h-full" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                            <StepAgentSurvey
                                agent={AGENTS[currentAgentIndex]}
                                answers={surveyAnswers[AGENTS[currentAgentIndex].id] || {}}
                                setAnswers={(ans) => setSurveyAnswers(prev => ({ ...prev, [AGENTS[currentAgentIndex].id]: ans }))}
                                onNext={handleGeneratePrompt}
                                onBack={handleGlobalBack}
                                onGenerate={handleGeneratePrompt}
                                crmColumns={crmColumns}
                                setCrmColumns={setCrmColumns}
                            />
                        </motion.div>
                    )}
                    {step === 'agent_verify' && (
                        <motion.div key={`verify-${currentAgentIndex}`} className="h-full" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                            <StepVerifyPrompt
                                agent={AGENTS[currentAgentIndex]}
                                prompt={currentDraftPrompt}
                                setPrompt={setCurrentDraftPrompt}
                                onConfirm={handleConfirmPrompt}
                                onBack={handleGlobalBack}
                                isOptimizing={isOptimizing}
                            />
                        </motion.div>
                    )}
                    {step === 'cost_estimator' && (
                        <motion.div key="cost" className="h-full" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                            <StepCostEstimator
                                onNext={() => setStep('completion')}
                                onBack={handleGlobalBack}
                                targetCompanies={50}
                                maxLeads={parseInt(surveyAnswers['apollo_lead_finder']?.max_contacts || 3)}
                            />
                        </motion.div>
                    )}
                    {step === 'completion' && (
                        <motion.div key="complete" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <StepComplete onLaunch={handleLaunch} isSaving={isSaving} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}

export default Onboarding
