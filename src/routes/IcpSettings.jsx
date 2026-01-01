import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, CheckCircle2, AlertCircle } from 'lucide-react'
import { useIcp } from '../context/IcpContext'
import { AGENTS } from '../config/icpConfig'
import TagInput from '../components/TagInput'

const IcpSettings = () => {
    const { icpId } = useParams()
    const navigate = useNavigate()
    const { icps, updateIcp } = useIcp()

    const [icpData, setIcpData] = useState(null)
    const [icpName, setIcpName] = useState('')
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [feedback, setFeedback] = useState(null) // { type: 'success' | 'error', message: string }

    useEffect(() => {
        if (icps && icps.length > 0) {
            const found = icps.find(i => i.id === icpId)
            if (found) {
                setIcpData(found)
                setIcpName(found.name)
            } else {
                // If loaded but not found, maybe redirect
                // navigate('/profile')
            }
            setIsLoading(false)
        }
    }, [icps, icpId])

    const handleConfigChange = (agentId, questionId, value) => {
        // We assume structure: icp.config.surveys[agentId][questionId]
        // But the previous onboarding save structure flattened some keys into config root (job_titles, etc.)
        // and kept raw surveys in `config.surveys`.
        // To be consistent with Onboarding.jsx `handleLaunch`, we should update both the specific config keys AND the surveys map if we want to be safe,
        // or just rely on `surveys` if the system uses that for re-population.
        // Looking at `Onboarding.jsx`:
        // It creates `icpConfig` with keys like `job_titles` populated from `surveyAnswers.apollo_lead_finder.job_titles`.
        // So we should probably update the `surveys` deep structure, and then re-derive the top-level config keys before saving.

        setIcpData(prev => {
            const newSurveys = {
                ...prev.config?.surveys,
                [agentId]: {
                    ...prev.config?.surveys?.[agentId],
                    [questionId]: value
                }
            }
            return {
                ...prev,
                config: {
                    ...prev.config,
                    surveys: newSurveys
                }
            }
        })
    }

    const saveChanges = async () => {
        setIsSaving(true)
        setFeedback(null)
        try {
            // Re-construct the flat config keys from the updated surveys
            // This mirrors `handleLaunch` logic in Onboarding.jsx
            const surveys = icpData.config.surveys
            const apolloAnswers = surveys.apollo_lead_finder || {}
            const companyAnswers = surveys.company_finder || {}

            const updatedConfig = {
                ...icpData.config,
                // Apollo Lead Finder
                job_titles: apolloAnswers.job_titles || [],
                seniority: apolloAnswers.seniority || [],
                job_functions: apolloAnswers.job_functions || [],
                excluded_functions: apolloAnswers.excluded_functions || [],
                max_contacts: parseInt(apolloAnswers.max_contacts || 3),

                // Company Finder
                geography: companyAnswers.geography || [],
                org_types: companyAnswers.org_types || [],
                intent: companyAnswers.intent,

                surveys: surveys
            }

            await updateIcp(icpId, {
                name: icpName,
                config: updatedConfig
            })

            setFeedback({ type: 'success', message: 'Changes saved successfully.' })
            setTimeout(() => setFeedback(null), 3000)
        } catch (e) {
            setFeedback({ type: 'error', message: 'Failed to save changes.' })
        } finally {
            setIsSaving(false)
        }
    }

    if (isLoading) return <div className="p-12 text-center text-gray-500">Loading settings...</div>
    if (!icpData) return <div className="p-12 text-center text-gray-500">Strategy not found.</div>

    return (
        <div className="min-h-screen bg-transparent p-6 lg:p-8 max-w-5xl mx-auto pb-32 animate-fade-in">

            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <button onClick={() => navigate('/profile')} className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white">
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <div className="flex-1">
                    <label className="text-xs text-teal-500 uppercase font-bold tracking-wider">Strategy Name</label>
                    <input
                        value={icpName}
                        onChange={(e) => setIcpName(e.target.value)}
                        className="w-full bg-transparent text-3xl font-serif font-bold text-white border-b border-transparent focus:border-teal-500 outline-none pb-1 transition-all"
                    />
                </div>
                <button
                    onClick={saveChanges}
                    disabled={isSaving}
                    className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 text-white px-6 py-3 rounded-lg font-bold shadow-lg transition-all disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : <><Save className="w-5 h-5" /> Save Changes</>}
                </button>
            </div>

            {feedback && (
                <div className={`mb-8 p-4 rounded-xl flex items-center gap-3 ${feedback.type === 'success' ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
                    {feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    {feedback.message}
                </div>
            )}

            {/* Form Sections */}
            <div className="space-y-12">
                {AGENTS.filter(a => !a.isVisualEditor && a.questions.length > 0).map(agent => (
                    <div key={agent.id} className="bg-white/5 border border-white/10 rounded-xl p-8 backdrop-blur-sm">
                        <div className="flex items-center gap-4 mb-6 border-b border-white/5 pb-4">
                            <div className="w-10 h-10 bg-teal-500/10 rounded-lg flex items-center justify-center border border-teal-500/20">
                                <span className="text-teal-400 font-bold text-lg">{agent.name[0]}</span>
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-white">{agent.name}</h3>
                                <p className="text-gray-400 text-sm">{agent.description}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-8">
                            {agent.questions.map(q => {
                                const val = icpData.config?.surveys?.[agent.id]?.[q.id]
                                return (
                                    <div key={q.id}>
                                        <label className="block text-gray-300 font-medium mb-2">{q.label}</label>
                                        {q.helper && <p className="text-xs text-gray-500 mb-2">{q.helper}</p>}

                                        {q.type === 'multi-select' ? (
                                            <TagInput
                                                value={val}
                                                onChange={(v) => handleConfigChange(agent.id, q.id, v)}
                                                suggestions={q.options || []}
                                            />
                                        ) : q.type === 'radio' ? (
                                            <div className="flex flex-wrap gap-2">
                                                {q.options.map(opt => (
                                                    <button
                                                        key={opt}
                                                        onClick={() => handleConfigChange(agent.id, q.id, opt)}
                                                        className={`px-4 py-2 rounded-lg border text-sm transition-all ${val === opt
                                                            ? 'bg-teal-500/20 border-teal-500 text-teal-300'
                                                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                                            }`}
                                                    >
                                                        {opt}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <textarea
                                                value={val || ''}
                                                onChange={(e) => handleConfigChange(agent.id, q.id, e.target.value)}
                                                className="w-full bg-black/20 border border-white/10 rounded-lg p-4 text-white placeholder-gray-500 outline-none focus:border-teal-500/50 min-h-[100px]"
                                                placeholder={q.placeholder}
                                            />
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </div>

        </div>
    )
}

export default IcpSettings
