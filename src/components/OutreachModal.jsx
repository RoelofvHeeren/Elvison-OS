import { useState, useEffect } from 'react'
import { X, Send, Loader2, Plus, Tag, Linkedin, Mail } from 'lucide-react'
import { fetchAimfoxCampaigns, fetchGhlTags, pushLeadsToOutreach } from '../utils/api'

export default function OutreachModal({ isOpen, onClose, selectedLeadsCount, selectedLeadIds, onComplete }) {
    // Multi-select tools
    const [selectedTools, setSelectedTools] = useState({ aimfox: false, gohighlevel: false })

    // Aimfox campaigns
    const [aimfoxCampaigns, setAimfoxCampaigns] = useState([])
    const [selectedAimfoxCampaign, setSelectedAimfoxCampaign] = useState('')
    const [loadingAimfox, setLoadingAimfox] = useState(false)

    // GHL tags
    const [ghlTags, setGhlTags] = useState([])
    const [selectedGhlTag, setSelectedGhlTag] = useState('')
    const [loadingGhl, setLoadingGhl] = useState(false)

    // Create tag
    const [showCreateTag, setShowCreateTag] = useState(false)
    const [newTagName, setNewTagName] = useState('')
    const [creatingTag, setCreatingTag] = useState(false)

    // Push state
    const [pushing, setPushing] = useState(false)
    const [result, setResult] = useState(null)
    const [error, setError] = useState('')

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setSelectedTools({ aimfox: false, gohighlevel: false })
            setSelectedAimfoxCampaign('')
            setSelectedGhlTag('')
            setResult(null)
            setError('')
            setShowCreateTag(false)
            setNewTagName('')
        }
    }, [isOpen])

    // Load Aimfox campaigns when selected
    useEffect(() => {
        if (!selectedTools.aimfox) return

        const load = async () => {
            setLoadingAimfox(true)
            try {
                const data = await fetchAimfoxCampaigns()
                setAimfoxCampaigns(data.campaigns || [])
            } catch (err) {
                console.error('Failed to load Aimfox campaigns:', err)
            } finally {
                setLoadingAimfox(false)
            }
        }
        load()
    }, [selectedTools.aimfox])

    // Load GHL tags when selected
    useEffect(() => {
        if (!selectedTools.gohighlevel) return

        const load = async () => {
            setLoadingGhl(true)
            try {
                const data = await fetchGhlTags()
                console.log('GHL tags response:', data)
                setGhlTags(data.tags || [])
            } catch (err) {
                console.error('Failed to load GHL tags:', err)
            } finally {
                setLoadingGhl(false)
            }
        }
        load()
    }, [selectedTools.gohighlevel])

    const toggleTool = (tool) => {
        setSelectedTools(prev => ({ ...prev, [tool]: !prev[tool] }))
    }

    const handleCreateTag = async () => {
        if (!newTagName.trim()) return

        setCreatingTag(true)
        try {
            const response = await fetch('/api/integrations/ghl/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newTagName.trim() })
            })

            if (response.ok) {
                const data = await response.json()
                // Add to local list and select it
                const newTag = { id: data.tag?.name || newTagName.trim(), name: data.tag?.name || newTagName.trim() }
                setGhlTags(prev => [...prev, newTag])
                setSelectedGhlTag(newTag.id)
                setShowCreateTag(false)
                setNewTagName('')
            } else {
                setError('Failed to create tag')
            }
        } catch (err) {
            console.error('Create tag error:', err)
            setError('Failed to create tag')
        } finally {
            setCreatingTag(false)
        }
    }

    const handlePush = async () => {
        setPushing(true)
        setError('')

        const leadIdsArray = Array.from(selectedLeadIds)
        let successCount = 0

        try {
            // Push to Aimfox if selected
            if (selectedTools.aimfox && selectedAimfoxCampaign) {
                const response = await pushLeadsToOutreach('aimfox', selectedAimfoxCampaign, leadIdsArray)
                if (response.success) successCount++
            }

            // Push to GHL if selected
            if (selectedTools.gohighlevel && selectedGhlTag) {
                const response = await pushLeadsToOutreach('gohighlevel', selectedGhlTag, leadIdsArray)
                if (response.success) successCount++
            }

            setResult({
                message: `Started pushing ${leadIdsArray.length} leads to ${successCount} tool(s) in the background.`
            })

            if (onComplete) onComplete()
        } catch (err) {
            console.error(err)
            setError('Failed to push leads. Please try again.')
        } finally {
            setPushing(false)
        }
    }

    const canPush = () => {
        if (selectedLeadsCount === 0) return false
        if (selectedTools.aimfox && !selectedAimfoxCampaign) return false
        if (selectedTools.gohighlevel && !selectedGhlTag) return false
        if (!selectedTools.aimfox && !selectedTools.gohighlevel) return false
        return true
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-[#0F1115] border border-white/10 rounded-2xl shadow-xl overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Send className="w-5 h-5 text-teal-400" />
                        Push to Outreach
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/10 rounded-lg text-gray-400 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {result ? (
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto ring-1 ring-blue-500/30">
                                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                            </div>
                            <div>
                                <h4 className="text-xl font-bold text-white">Transfer Started</h4>
                                <p className="text-sm text-gray-400 mt-1">{result.message}</p>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-full py-2.5 bg-teal-500 hover:bg-teal-400 text-black font-semibold rounded-xl transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <p className="text-sm text-gray-400">
                                Push <strong className="text-white">{selectedLeadsCount}</strong> lead{selectedLeadsCount !== 1 ? 's' : ''} to outreach tools. Select one or both destinations.
                            </p>

                            {/* Tool Selection - Multi-select */}
                            <div className="space-y-3">
                                <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Destination Tools</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => toggleTool('aimfox')}
                                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${selectedTools.aimfox
                                            ? 'bg-teal-500/10 border-teal-500/50 text-teal-400 ring-2 ring-teal-500/30'
                                            : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5'
                                            }`}
                                    >
                                        <Linkedin className="w-6 h-6" />
                                        <span className="font-semibold text-sm">Aimfox</span>
                                        <span className="text-[10px] opacity-60">LinkedIn Outreach</span>
                                    </button>
                                    <button
                                        onClick={() => toggleTool('gohighlevel')}
                                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${selectedTools.gohighlevel
                                            ? 'bg-teal-500/10 border-teal-500/50 text-teal-400 ring-2 ring-teal-500/30'
                                            : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5'
                                            }`}
                                    >
                                        <Mail className="w-6 h-6" />
                                        <span className="font-semibold text-sm">GoHighLevel</span>
                                        <span className="text-[10px] opacity-60">Email Outreach</span>
                                    </button>
                                </div>
                            </div>

                            {/* Aimfox Campaign Selection */}
                            {selectedTools.aimfox && (
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                                        Aimfox Campaign
                                    </label>
                                    {loadingAimfox ? (
                                        <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Loading campaigns...
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {aimfoxCampaigns.length === 0 ? (
                                                <p className="text-xs text-gray-500">No campaigns found. Create one in Aimfox first.</p>
                                            ) : (
                                                aimfoxCampaigns.map(c => (
                                                    <button
                                                        key={c.id}
                                                        onClick={() => setSelectedAimfoxCampaign(c.id)}
                                                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${selectedAimfoxCampaign === c.id
                                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                                                            : 'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10'
                                                            }`}
                                                    >
                                                        {c.name}
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* GHL Tag Selection */}
                            {selectedTools.gohighlevel && (
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                                        <Tag className="w-3 h-3" />
                                        GoHighLevel Tag
                                    </label>
                                    {loadingGhl ? (
                                        <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Loading tags...
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {ghlTags.map(t => (
                                                <button
                                                    key={t.id}
                                                    onClick={() => setSelectedGhlTag(t.id)}
                                                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${selectedGhlTag === t.id
                                                        ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/50'
                                                        : 'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10'
                                                        }`}
                                                >
                                                    {t.name}
                                                </button>
                                            ))}

                                            {/* Create New Tag Button */}
                                            {!showCreateTag ? (
                                                <button
                                                    onClick={() => setShowCreateTag(true)}
                                                    className="px-3 py-2 rounded-lg text-sm font-medium bg-teal-500/10 text-teal-400 border border-dashed border-teal-500/30 hover:bg-teal-500/20 transition-all flex items-center gap-1"
                                                >
                                                    <Plus className="w-3 h-3" />
                                                    Create Tag
                                                </button>
                                            ) : (
                                                <div className="flex items-center gap-2 w-full mt-2">
                                                    <input
                                                        type="text"
                                                        value={newTagName}
                                                        onChange={(e) => setNewTagName(e.target.value)}
                                                        placeholder="Enter tag name..."
                                                        className="flex-1 px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/50"
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={handleCreateTag}
                                                        disabled={creatingTag || !newTagName.trim()}
                                                        className="px-3 py-2 text-sm font-medium bg-teal-500 text-black rounded-lg hover:bg-teal-400 disabled:opacity-50 transition-all"
                                                    >
                                                        {creatingTag ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
                                                    </button>
                                                    <button
                                                        onClick={() => { setShowCreateTag(false); setNewTagName('') }}
                                                        className="px-2 py-2 text-gray-400 hover:text-white transition-colors"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {error && <p className="text-xs text-red-400">{error}</p>}

                            {/* Push Button */}
                            <div className="pt-2">
                                <button
                                    onClick={handlePush}
                                    disabled={!canPush() || pushing}
                                    className="w-full flex items-center justify-center gap-2 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-xl transition-all shadow-lg shadow-teal-500/20"
                                >
                                    {pushing ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Pushing Leads...
                                        </>
                                    ) : (
                                        <>
                                            Push {selectedLeadsCount} Lead{selectedLeadsCount !== 1 ? 's' : ''}
                                            <Send className="w-4 h-4 ml-1" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
