import { useState, useEffect } from 'react'
import { Bot, Save, FileText, Check, AlertCircle } from 'lucide-react'

const AGENTS = [
    { id: 'company_finder', name: 'Company Finder', description: 'Finds companies matching criteria.' },
    { id: 'company_profiler', name: 'Company Profiler', description: 'Filters and profiles companies.' },
    { id: 'apollo_lead_finder', name: 'Apollo Lead Finder', description: 'Finds contact info for decision makers.' },
    { id: 'outreach_creator', name: 'Outreach Creator', description: 'Drafts personalized outreach messages.' },
    { id: 'sheet_builder', name: 'Sheet Builder', description: 'Exports data to Google Sheets.' },
]

const AgentConfig = () => {
    const [selectedAgentId, setSelectedAgentId] = useState(AGENTS[0].id)
    const [configs, setConfigs] = useState({})
    const [files, setFiles] = useState([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState(null)

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        try {
            const [configRes, filesRes] = await Promise.all([
                fetch('/api/agents/config'),
                fetch('/api/knowledge/files')
            ])

            if (configRes.ok) {
                const data = await configRes.json()
                setConfigs(data.configs || {})
            }
            if (filesRes.ok) {
                const data = await filesRes.json()
                setFiles(data.files || [])
            }
        } catch (err) {
            console.error('Failed to load data', err)
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        setMessage(null)
        const currentConfig = configs[selectedAgentId] || {}

        try {
            const res = await fetch('/api/agents/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentKey: selectedAgentId,
                    instructions: currentConfig.instructions || '',
                    linkedFileIds: currentConfig.linkedFileIds || []
                })
            })

            if (res.ok) {
                setMessage({ type: 'success', text: 'Configuration saved successfully!' })
                setTimeout(() => setMessage(null), 3000)
            } else {
                setMessage({ type: 'error', text: 'Failed to save configuration.' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Error saving: ' + err.message })
        } finally {
            setSaving(false)
        }
    }

    const updateConfig = (field, value) => {
        setConfigs(prev => ({
            ...prev,
            [selectedAgentId]: {
                ...prev[selectedAgentId],
                [field]: value
            }
        }))
    }

    const toggleFile = (fileId) => {
        const currentFiles = configs[selectedAgentId]?.linkedFileIds || []
        const newFiles = currentFiles.includes(fileId)
            ? currentFiles.filter(id => id !== fileId)
            : [...currentFiles, fileId]

        updateConfig('linkedFileIds', newFiles)
    }

    const currentAgent = AGENTS.find(a => a.id === selectedAgentId)
    const currentConfig = configs[selectedAgentId] || { instructions: '', linkedFileIds: [] }

    if (loading) return <div className="p-10 text-center text-muted">Loading agent configurations...</div>

    return (
        <div className="flex h-[calc(100vh-8rem)] gap-6">
            {/* Sidebar List */}
            <div className="w-64 flex-shrink-0 space-y-2 border-r border-outline pr-4 overflow-y-auto">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">Agents</h2>
                {AGENTS.map((agent) => (
                    <button
                        key={agent.id}
                        onClick={() => setSelectedAgentId(agent.id)}
                        className={`flex w - full items - center gap - 3 rounded - xl p - 3 text - left text - sm font - medium transition - all ${selectedAgentId === agent.id
                                ? 'bg-primary text-white shadow-md'
                                : 'text-secondary hover:bg-surface'
                            } `}
                    >
                        <Bot className={`h - 5 w - 5 ${selectedAgentId === agent.id ? 'text-white' : 'text-primary'} `} />
                        <div>
                            <div className="font-semibold">{agent.name}</div>
                            <div className={`text - xs ${selectedAgentId === agent.id ? 'text-white/80' : 'text-muted'} `}>
                                {agent.description}
                            </div>
                        </div>
                    </button>
                ))}
            </div>

            {/* Editor Area */}
            <div className="flex flex-1 flex-col gap-6 overflow-hidden">
                <header className="flex items-center justify-between border-b border-outline pb-4">
                    <div>
                        <h1 className="font-serif text-2xl font-bold text-primary">{currentAgent.name}</h1>
                        <p className="text-sm text-muted">Configure instructions and knowledge base access.</p>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 disabled:opacity-50"
                    >
                        {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save className="h-4 w-4" />}
                        Save Changes
                    </button>
                </header>

                {message && (
                    <div className={`rounded - lg p - 3 text - sm flex items - center gap - 2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'} `}>
                        {message.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        {message.text}
                    </div>
                )}

                <div className="grid h-full grid-cols-2 gap-6 overflow-hidden">
                    {/* Instructions Editor */}
                    <div className="flex flex-col gap-2 h-full overflow-hidden">
                        <label className="text-sm font-medium text-secondary">Instructions (System Prompt)</label>
                        <textarea
                            className="flex-1 w-full resize-none rounded-xl border border-outline bg-white p-4 font-mono text-sm leading-relaxed text-secondary placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary overflow-y-auto"
                            placeholder="Enter detailed instructions for this agent..."
                            value={currentConfig.instructions}
                            onChange={(e) => updateConfig('instructions', e.target.value)}
                        />
                        <p className="text-xs text-muted">Be specific about the agent's role, constraints, and output format.</p>
                    </div>

                    {/* Knowledge Base Linker */}
                    <div className="flex flex-col gap-2 h-full overflow-hidden">
                        <label className="text-sm font-medium text-secondary">Linked Knowledge</label>
                        <div className="flex-1 overflow-y-auto rounded-xl border border-outline bg-white p-2">
                            {files.length === 0 ? (
                                <div className="flex h-full flex-col items-center justify-center p-6 text-center text-muted">
                                    <FileText className="mb-2 h-8 w-8 opacity-20" />
                                    <p>No files in Knowledge Base.</p>
                                    <p className="text-xs">Upload documents in the Knowledge Base section first.</p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {files.map((file) => {
                                        const isSelected = (currentConfig.linkedFileIds || []).includes(file.id)
                                        return (
                                            <button
                                                key={file.id}
                                                onClick={() => toggleFile(file.id)}
                                                className={`group flex w - full items - center justify - between rounded - lg p - 3 text - left transition - all ${isSelected ? 'bg-primary/5 border border-primary/20' : 'hover:bg-surface border border-transparent'
                                                    } `}
                                            >
                                                <div className="flex items-center gap-3 overflow-hidden">
                                                    <div className={`flex h - 8 w - 8 shrink - 0 items - center justify - center rounded - md ${isSelected ? 'bg-primary text-white' : 'bg-surface text-muted group-hover:bg-white'
                                                        } `}>
                                                        <FileText className="h-4 w-4" />
                                                    </div>
                                                    <div className="overflow-hidden">
                                                        <div className={`truncate text - sm font - medium ${isSelected ? 'text-primary' : 'text-secondary'} `}>
                                                            {file.name}
                                                        </div>
                                                        <div className="text-xs text-muted">{new Date(file.uploadedAt).toLocaleDateString()}</div>
                                                    </div>
                                                </div>
                                                {isSelected && <Check className="h-4 w-4 text-primary" />}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-muted">Select documents this agent should have access to.</p>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default AgentConfig
