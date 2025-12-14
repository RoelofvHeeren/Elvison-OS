import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ChevronRight, Check, Rocket, Bot, Edit3, Save } from 'lucide-react'
import Typewriter from '../components/Typewriter'
import { saveAgentPrompts } from '../utils/api'

// --- Configuration ---

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
            { id: 'job_titles', label: 'What job titles are you looking for?' },
            { id: 'seniority', label: 'What seniority levels (e.g., C-Suite, VP)?' },
            { id: 'max_contacts', label: 'Maximum contacts per company?' },
            { id: 'email_requirement', label: 'Are verified emails required?' },
        ],
        template: (a) => `You are a data enrichment specialist. Find contacts for the identified companies.
Job Titles: ${a.job_titles || 'Decision Makers'}
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
        id: 'sheet_input',
        name: 'Sheet Input Manager',
        description: 'Manages data flow into your Google Sheets.',
        questions: [
            { id: 'sheet_name', label: 'What is the name of your target Google Sheet?' },
            { id: 'columns', label: 'Which columns need to be populated?' },
            { id: 'update_frequency', label: 'How often should data be updated?' },
            { id: 'formatting', label: 'Any specific formatting rules?' },
        ],
        template: (a) => `You are a CRM manager. Manage data entry for sheet "${a.sheet_name}".
Columns: ${a.columns}
Update Frequency: ${a.update_frequency}
Formatting: ${a.formatting}
Ensure no duplicates and clean data entry.`
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

// --- Components ---

const StepWelcome = ({ onNext, userName }) => (
    <div className="flex flex-col items-center justify-center p-12 text-center h-full max-w-2xl mx-auto">
        <div className="mb-8 p-4 rounded-full bg-primary/10 animate-pulse">
            <Sparkles className="w-12 h-12 text-primary" />
        </div>
        <h1 className="text-4xl font-serif font-bold mb-6">
            <Typewriter text={`Hello, ${userName}. Time to set this up.`} delay={50} />
        </h1>
        <p className="text-xl text-gray-500 mb-8 max-w-lg">
            <Typewriter
                text="We'll configure your AI agents one by one to ensure they perform perfectly for your needs."
                delay={30}
                onComplete={() => { }}
            />
        </p>
        <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 3 }}
            onClick={onNext}
            className="px-8 py-4 bg-primary text-white rounded-full font-semibold hover:bg-primary/90 transition-all shadow-lg hover:shadow-xl flex items-center gap-2 group"
        >
            Initialize Onboarding <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </motion.button>
    </div>
)

const StepCompanyInfo = ({ onNext, data, onChange }) => (
    <div className="max-w-xl mx-auto pt-10">
        <h2 className="text-3xl font-serif font-bold mb-2">Company Information</h2>
        <p className="text-gray-500 mb-8">First, tell us a little about who you are.</p>

        <div className="space-y-6">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                <input
                    type="text"
                    value={data.userName}
                    onChange={(e) => onChange('userName', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    placeholder="e.g. Roelof"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                    type="text"
                    value={data.companyName}
                    onChange={(e) => onChange('companyName', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    placeholder="e.g. Elvison AI"
                />
            </div>
        </div>

        <div className="mt-10 flex justify-end">
            <button
                onClick={onNext}
                disabled={!data.userName || !data.companyName}
                className="px-6 py-3 bg-black text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
            >
                Next Step
            </button>
        </div>
    </div>
)

const StepAgentSurvey = ({ agent, answers, setAnswers, onNext, onGenerate }) => {
    const handleAnswer = (qid, val) => {
        setAnswers(prev => ({ ...prev, [agent.id]: { ...prev[agent.id], [qid]: val } }))
    }

    const currentAnswers = answers[agent.id] || {}

    return (
        <div className="max-w-4xl mx-auto pt-4 flex gap-8">
            {/* Left: Info */}
            <div className="w-1/3 pt-4">
                <div className="sticky top-8">
                    <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 text-primary">
                        <Bot className="w-8 h-8" />
                    </div>
                    <h2 className="text-2xl font-serif font-bold mb-2">{agent.name}</h2>
                    <p className="text-gray-600 mb-6">{agent.description}</p>
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm">
                        <h4 className="font-semibold mb-2 text-gray-900">Why we ask</h4>
                        <p className="text-gray-500">Your specific answers help us fine-tune the system prompt to behave exactly as you expect.</p>
                    </div>
                </div>
            </div>

            {/* Right: Questions */}
            <div className="w-2/3 space-y-8 pb-20">
                {agent.questions.map((q, idx) => (
                    <motion.div
                        key={q.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="group"
                    >
                        <label className="block text-lg font-medium text-gray-800 mb-3 flex items-center gap-2">
                            <span className="text-gray-300 font-mono text-sm">0{idx + 1}</span>
                            {q.label}
                        </label>
                        <textarea
                            className="w-full bg-white border border-gray-200 rounded-xl p-4 text-gray-700 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all shadow-sm hover:border-gray-300 min-h-[100px]"
                            placeholder="Type your answer here..."
                            value={currentAnswers[q.id] || ''}
                            onChange={(e) => handleAnswer(q.id, e.target.value)}
                        />
                    </motion.div>
                ))}

                <div className="flex justify-end pt-6">
                    <button
                        onClick={onGenerate}
                        className="px-6 py-3 bg-gradient-to-r from-primary to-emerald-600 text-white rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                    >
                        <Sparkles className="w-4 h-4" /> Generate Instructions
                    </button>
                </div>
            </div>
        </div>
    )
}

const StepVerifyPrompt = ({ agent, prompt, setPrompt, onConfirm, onBack }) => (
    <div className="max-w-3xl mx-auto pt-6 h-full flex flex-col">
        <div className="mb-6 flex items-center justify-between">
            <div>
                <h2 className="text-2xl font-serif font-bold">Verify Instructions</h2>
                <p className="text-gray-500 text-sm">Review the generated prompt for {agent.name}</p>
            </div>
            <div className="flex gap-2">
                <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Back to Survey</button>
                <button onClick={onConfirm} className="px-4 py-2 bg-black text-white rounded-lg text-sm flex items-center gap-2 hover:bg-gray-800">
                    <Check className="w-4 h-4" /> Confirm & Next
                </button>
            </div>
        </div>

        <div className="flex-1 bg-gray-900 rounded-xl p-6 overflow-hidden flex flex-col shadow-2xl border border-gray-800">
            <div className="flex items-center gap-2 mb-4 text-gray-400 text-xs uppercase tracking-wider font-semibold border-b border-gray-800 pb-2">
                <Edit3 className="w-3 h-3" /> System Prompt Editor
            </div>
            <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="flex-1 w-full bg-transparent text-gray-200 font-mono text-sm outline-none resize-none leading-relaxed"
                spellCheck="false"
            />
        </div>
    </div>
)

const StepComplete = ({ onLaunch, isSaving }) => (
    <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto text-center">
        <div className="mb-8 p-6 rounded-full bg-green-50 animate-bounce">
            <Rocket className="w-16 h-16 text-green-600" />
        </div>
        <h2 className="text-4xl font-serif font-bold mb-6">You're All Set!</h2>
        <p className="text-xl text-gray-500 mb-10">
            We have gathered all the necessary intelligence to power your agentic workforce.
            Click below to launch the system and save your configurations.
        </p>
        <button
            onClick={onLaunch}
            disabled={isSaving}
            className="px-10 py-5 bg-black text-white text-lg rounded-full font-bold hover:bg-gray-800 transition-all shadow-xl hover:scale-105 disabled:opacity-50 disabled:scale-100"
        >
            {isSaving ? 'Launching System...' : 'Launch System 🚀'}
        </button>
    </div>
)

// --- Main Container ---

const Onboarding = () => {
    const [step, setStep] = useState('welcome') // welcome, company, agent_survey, agent_verify, complete
    const [currentAgentIndex, setCurrentAgentIndex] = useState(0)

    const [userData, setUserData] = useState({ userName: 'Roelof', companyName: '' })
    const [surveyAnswers, setSurveyAnswers] = useState({})
    const [generatedPrompts, setGeneratedPrompts] = useState({}) // { agentId: "prompt text" }
    const [currentDraftPrompt, setCurrentDraftPrompt] = useState('')
    const [isSaving, setIsSaving] = useState(false)

    const handleUserChange = (field, val) => setUserData(prev => ({ ...prev, [field]: val }))

    const handleGeneratePrompt = () => {
        const agent = AGENTS[currentAgentIndex]
        const answers = surveyAnswers[agent.id] || {}
        // Merge common data
        const fullContext = { ...userData, ...answers }
        const prompt = agent.template(fullContext)
        setCurrentDraftPrompt(prompt)
        setStep('agent_verify')
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
            // Could navigate away or show success
            // For now just alert success
            alert('System Launched! Configurations saved.')
        } catch (err) {
            console.error(err)
            alert('Failed to save configurations.')
        } finally {
            setIsSaving(false)
        }
    }

    // Render Logic
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
            />
        )
    } else if (step === 'complete') {
        content = <StepComplete onLaunch={handleLaunch} isSaving={isSaving} />
    }

    return (
        <div className="min-h-screen bg-surface/50 text-foreground font-sans">
            <div className="h-full w-full p-6">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={step + currentAgentIndex}
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
                <div className="fixed bottom-0 left-0 right-0 h-1.5 bg-gray-200">
                    <div
                        className="h-full bg-primary transition-all duration-500 ease-out"
                        style={{ width: `${((currentAgentIndex + (step === 'agent_verify' ? 0.5 : 0)) / AGENTS.length) * 100}%` }}
                    />
                </div>
            )}
        </div>
    )
}

export default Onboarding
