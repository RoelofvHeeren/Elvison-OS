import { useState, useEffect } from 'react'
import { Bot, Save, FileText, Check, AlertCircle, Wrench, Database, MessageSquare, Globe } from 'lucide-react'

const AGENTS = [
    { id: 'company_finder', name: 'Company Finder', description: 'Finds companies matching criteria.' },
    { id: 'company_profiler', name: 'Company Profiler', description: 'Filters and profiles companies.' },
    { id: 'apollo_lead_finder', name: 'Apollo Lead Finder', description: 'Finds contact info for decision makers.' },
    { id: 'outreach_creator', name: 'Outreach Creator', description: 'Drafts personalized outreach messages.' },
    { id: 'data_architect', name: 'Data Architect', description: 'Defines CRM structure and data types.' },
]

const AVAILABLE_TOOLS = [
    { id: 'file_search', name: 'File Search', description: 'Search knowledge base documents', icon: FileText },
    { id: 'web_search', name: 'Web Search', description: 'Search the internet for information', icon: Globe },
    { id: 'apollo_mcp', name: 'Apollo MCP', description: 'Enrich leads and find contacts', icon: Wrench },
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

            let serverConfigs = {}
            if (configRes.ok) {
                const data = await configRes.json()
                serverConfigs = data.configs || {}
            }

            // Merge with local storage (Local persistence overrides for simplicity in this dev tool)
            const savedConfigs = localStorage.getItem('elvison_agent_configs_prod')
            if (savedConfigs) {
                try {
                    const parsedLocal = JSON.parse(savedConfigs)
                    setConfigs({ ...serverConfigs, ...parsedLocal })
                } catch (e) {
                    setConfigs(serverConfigs)
                }
            } else {
                setConfigs(serverConfigs)
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

        // Persist locally first
        localStorage.setItem('elvison_agent_configs_diagnostic', JSON.stringify(configs))

        try {
            const res = await fetch('/api/agents/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentKey: selectedAgentId,
                    instructions: currentConfig.instructions || '',
                    linkedFileIds: currentConfig.linkedFileIds || [],
                    enabledToolIds: currentConfig.enabledToolIds || []
                })
            })

            if (res.ok) {
                setMessage({ type: 'success', text: 'Configuration saved (Local & Server)!' })
                setTimeout(() => setMessage(null), 3000)
            } else {
                setMessage({ type: 'error', text: 'Failed to save to server.' })
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

    const toggleTool = (toolId) => {
        const currentTools = configs[selectedAgentId]?.enabledToolIds || []
        const newTools = currentTools.includes(toolId)
            ? currentTools.filter(id => id !== toolId)
            : [...currentTools, toolId]

        updateConfig('enabledToolIds', newTools)
    }

    const currentAgent = AGENTS.find(a => a.id === selectedAgentId)
    const currentConfig = configs[selectedAgentId] || { instructions: '', linkedFileIds: [], enabledToolIds: [] }

    if (loading) return <div className="p-10 text-center text-muted">Loading agent configurations...</div>

    return (
        <div className="flex h-[calc(100vh-2rem)] gap-6 p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
            {/* Sidebar List */}
            <div className="w-72 flex-shrink-0 flex flex-col gap-2 border-r border-[#139187]/20 pr-4 overflow-y-auto">
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400 px-3">Available Agents</h2>
                <div className="space-y-1">
                    {AGENTS.map((agent) => (
                        <button
                            key={agent.id}
                            onClick={() => setSelectedAgentId(agent.id)}
                            className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition-all border-2 ${selectedAgentId === agent.id
                                ? 'bg-white text-black border-[#139187] shadow-[0_0_15px_rgba(19,145,135,0.3)]'
                                : 'text-gray-400 border-white/10 hover:border-white/30 hover:bg-white/5 hover:text-white'
                                }`}
                        >
                            <div className={`mt-0.5 p-1.5 rounded-md ${selectedAgentId === agent.id ? 'bg-[#139187]/10 text-[#139187]' : 'bg-white/5 text-gray-500'}`}>
                                <Bot className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="font-semibold text-sm">{agent.name}</div>
                                <div className={`text-xs mt-0.5 leading-snug ${selectedAgentId === agent.id ? 'text-gray-600' : 'text-gray-500'}`}>
                                    {agent.description}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Editor Area */}
            <div className="flex flex-1 flex-col gap-6 overflow-hidden">
                <header className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div>
                        <h1 className="font-serif text-2xl font-bold text-white">{currentAgent.name}</h1>
                        <p className="text-sm text-white">Configure instructions, tools, and knowledge access.</p>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 rounded-lg bg-[#139187] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#139187]/90 disabled:opacity-50 shadow-[0_0_15px_rgba(19,145,135,0.4)]"
                    >
                        {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save className="h-4 w-4" />}
                        Save Changes
                    </button>
                </header>

                {message && (
                    <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                        {message.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        {message.text}
                    </div>
                )}

                <div className="grid h-full grid-cols-12 gap-6 overflow-hidden">
                    {/* Instructions - 6 cols */}
                    <div className="col-span-6 flex flex-col gap-2 h-full overflow-hidden">
                        <label className="text-sm font-bold text-white flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-[#139187]" />
                            System Instructions
                        </label>
                        <textarea
                            className="flex-1 w-full resize-none rounded-xl border-2 border-[#139187] bg-white p-4 font-mono text-sm leading-relaxed text-black placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-[#139187]/20 overflow-y-auto shadow-sm"
                            placeholder="Enter detailed instructions for this agent..."
                            value={currentConfig.instructions}
                            onChange={(e) => updateConfig('instructions', e.target.value)}
                        />
                        <p className="text-xs text-gray-500">Define the agent's persona, constraints, and output format.</p>
                    </div>

                    {/* Right Options Column - 6 cols */}
                    <div className="col-span-6 flex flex-col gap-6 h-full overflow-y-auto pr-2">

                        {/* Tools Section */}
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-bold text-white flex items-center gap-2">
                                <Wrench className="h-4 w-4 text-[#139187]" />
                                Enabled Tools
                            </label>
                            <div className="grid grid-cols-1 gap-2 border-2 border-[#139187] rounded-xl p-3 bg-white">
                                {AVAILABLE_TOOLS.map((tool) => {
                                    const ToolIcon = tool.icon
                                    const isEnabled = (currentConfig.enabledToolIds || []).includes(tool.id)
                                    return (
                                        <button
                                            key={tool.id}
                                            onClick={() => toggleTool(tool.id)}
                                            className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${isEnabled
                                                ? 'bg-[#139187]/10 border-[#139187]/40 shadow-sm'
                                                : 'bg-gray-50 border-gray-100 hover:bg-gray-100'
                                                }`}
                                        >
                                            <div className={`p-2 rounded-md ${isEnabled ? 'bg-[#139187] text-white' : 'bg-white border border-gray-200 text-[#139187]'}`}>
                                                <ToolIcon className="h-4 w-4" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="text-sm font-bold text-gray-900">{tool.name}</div>
                                                <div className="text-xs text-gray-500">{tool.description}</div>
                                            </div>
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isEnabled ? 'bg-[#139187] border-[#139187]' : 'border-gray-300 bg-white'
                                                }`}>
                                                {isEnabled && <Check className="h-3.5 w-3.5 text-white" />}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Linked Knowledge Section */}
                        <div className="flex flex-col gap-2 flex-1">
                            <label className="text-sm font-bold text-white flex items-center gap-2">
                                <FileText className="h-4 w-4 text-[#139187]" />
                                Linked Knowledge Base
                            </label>
                            <div className="flex-1 min-h-[200px] border-2 border-[#139187] bg-white rounded-xl overflow-hidden flex flex-col shadow-sm">
                                {files.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-gray-400">
                                        <FileText className="mb-2 h-8 w-8 text-[#139187]/20" />
                                        <p className="text-gray-900 font-medium">No files available.</p>
                                        <p className="text-xs mt-1">Upload in Knowledge Base section first.</p>
                                    </div>
                                ) : (
                                    <div className="overflow-y-auto p-2 space-y-1">
                                        {files.map((file) => {
                                            const isSelected = (currentConfig.linkedFileIds || []).includes(file.id)
                                            return (
                                                <button
                                                    key={file.id}
                                                    onClick={() => toggleFile(file.id)}
                                                    className={`group flex w-full items-center justify-between rounded-lg p-2.5 text-left transition-all ${isSelected
                                                        ? 'bg-[#139187]/10 border border-[#139187]/40'
                                                        : 'hover:bg-gray-50 border border-transparent'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3 overflow-hidden">
                                                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-gray-100 text-[#139187]">
                                                            <FileText className="h-3 w-3" />
                                                        </div>
                                                        <div className="overflow-hidden">
                                                            <div className={`truncate text-sm font-bold ${isSelected ? 'text-[#139187]' : 'text-gray-700'}`}>
                                                                {file.name}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-[#139187] border-[#139187]' : 'border-gray-300 bg-white'
                                                        }`}>
                                                        {isSelected && <Check className="h-3.5 w-3.5 text-white" />}
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    )
}

export default AgentConfig
