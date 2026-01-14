import { useState, useEffect } from 'react'
import { X, Send, Loader2, Plus, Tag, Linkedin, Mail, ChevronDown, Check } from 'lucide-react'
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
    const [selectedGhlTags, setSelectedGhlTags] = useState([]) // Array for multi-select
    const [loadingGhl, setLoadingGhl] = useState(false)
    const [ghlDropdownOpen, setGhlDropdownOpen] = useState(false)
    const [ghlSearchQuery, setGhlSearchQuery] = useState('')

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
            setSelectedGhlTags([])
            setResult(null)
            setError('')
            setShowCreateTag(false)
            setNewTagName('')
            setGhlDropdownOpen(false)
        }
    }, [isOpen])

    // Load Aimfox campaigns when selected
    useEffect(() => {
        if (!selectedTools.aimfox) return

        const load = async () => {
            setLoadingAimfox(true)
            setError('')
            try {
                const data = await fetchAimfoxCampaigns()
                console.log('🔍 Aimfox API Response:', data)
                console.log('🔍 Response type:', typeof data)

                // Check if we got HTML instead of JSON (auth redirect)
                if (typeof data === 'string' || !data.campaigns) {
                    console.error('❌ Invalid response - got HTML or missing campaigns array')
                    setError('Authentication error. Please refresh the page and try again.')
                    setAimfoxCampaigns([])
                    return
                }

                console.log('🔍 Campaigns array:', data.campaigns)
                console.log('🔍 Campaigns length:', data.campaigns?.length)
                setAimfoxCampaigns(data.campaigns || [])
            } catch (err) {
                console.error('Failed to load Aimfox campaigns:', err)
                setError('Failed to load campaigns. Please try again.')
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
            setError('')
            try {
                const data = await fetchGhlTags()
                console.log('GHL tags loaded:', data)
                setGhlTags(data.tags || [])
            } catch (err) {
                console.error('Failed to load GHL tags:', err)
                setError('Failed to load GoHighLevel tags')
            } finally {
                setLoadingGhl(false)
            }
        }
        load()
    }, [selectedTools.gohighlevel])

    const toggleTool = (tool) => {
        setSelectedTools(prev => ({ ...prev, [tool]: !prev[tool] }))
    }

    const toggleGhlTag = (tagName) => {
        setSelectedGhlTags(prev => {
            if (prev.includes(tagName)) {
                return prev.filter(t => t !== tagName)
            } else {
                return [...prev, tagName]
            }
        })
    }

    const removeGhlTag = (tagName) => {
        setSelectedGhlTags(prev => prev.filter(t => t !== tagName))
    }

    const handleCreateTag = async () => {
        if (!newTagName.trim()) return

        setCreatingTag(true)
        setError('')
        try {
            const response = await fetch('/api/integrations/ghl/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name: newTagName.trim() })
            })

            if (response.ok) {
                const data = await response.json()
                const newTag = { id: newTagName.trim(), name: newTagName.trim() }
                setGhlTags(prev => [...prev, newTag])
                setSelectedGhlTags(prev => [...prev, newTag.name])
                setShowCreateTag(false)
                setNewTagName('')
            } else {
                const errData = await response.json()
                setError(errData.error || 'Failed to create tag')
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
        setResult(null)

        const leadIdsArray = Array.from(selectedLeadIds)
        let successCount = 0
        let lockedCount = 0
        let failedDetails = []

        try {
            // Push to Aimfox if selected
            if (selectedTools.aimfox && selectedAimfoxCampaign) {
                const response = await pushLeadsToOutreach('aimfox', selectedAimfoxCampaign, leadIdsArray)

                // Handle Aimfox specific response structure
                if (response.status === 'ok') {
                    successCount += response.profiles?.length || 0

                    if (response.failed && response.failed.length > 0) {
                        const reasons = response.failedReason || {}
                        response.failed.forEach(failedLead => {
                            // Extract ID from the failed object if available, though Aimfox failed array structure varies.
                            // Based on observation: failed contains lead objects. failedReason keys are lead IDs.
                            // We'll count "locked" specifically.
                            let isLocked = false
                            // Check if any reason is "locked"
                            Object.values(reasons).forEach(r => {
                                if (r === 'locked') isLocked = true
                            })

                            if (isLocked) {
                                lockedCount++
                            } else {
                                failedDetails.push(`Lead failed: ${JSON.stringify(failedLead)}`)
                            }
                        })
                    }
                } else if (response.success) {
                    successCount++
                }
            }

            // Push to GHL for each selected tag
            if (selectedTools.gohighlevel && selectedGhlTags.length > 0) {
                for (const tag of selectedGhlTags) {
                    const response = await pushLeadsToOutreach('gohighlevel', tag, leadIdsArray)
                    if (response.success) successCount++
                }
            }

            // Construct Result Message
            let message = `Successfully pushed ${successCount} lead(s).`
            if (lockedCount > 0) {
                message += ` ${lockedCount} lead(s) were ignored because they are "Locked" (already in a campaign).`
            }
            if (failedDetails.length > 0) {
                message += ` ${failedDetails.length} lead(s) failed for other reasons.`
            }

            setResult({
                message: message,
                type: lockedCount > 0 || failedDetails.length > 0 ? 'warning' : 'success'
            })

            if (onComplete && lockedCount === 0 && failedDetails.length === 0) onComplete()
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
        if (selectedTools.gohighlevel && selectedGhlTags.length === 0) return false
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
                            <div className="w-16 h-16 bg-teal-500/10 rounded-full flex items-center justify-center mx-auto ring-1 ring-teal-500/30">
                                <Check className="w-8 h-8 text-teal-400" />
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
                                Push <strong className="text-white">{selectedLeadsCount}</strong> lead{selectedLeadsCount !== 1 ? 's' : ''} to outreach tools.
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
                                        <select
                                            value={selectedAimfoxCampaign}
                                            onChange={(e) => setSelectedAimfoxCampaign(e.target.value)}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500/50"
                                        >
                                            <option value="">Select a campaign...</option>
                                            {aimfoxCampaigns.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            )}

                            {/* GHL Tag Selection */}
                            {selectedTools.gohighlevel && (
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
                                        <Tag className="w-3 h-3" />
                                        GoHighLevel Tags
                                    </label>

                                    {/* Selected Tags as Pills */}
                                    {selectedGhlTags.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-2">
                                            {selectedGhlTags.map(tag => (
                                                <span
                                                    key={tag}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-500/20 text-indigo-400 text-sm font-medium rounded-full border border-indigo-500/30"
                                                >
                                                    {tag}
                                                    <button
                                                        onClick={() => removeGhlTag(tag)}
                                                        className="ml-1 hover:text-white transition-colors"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {loadingGhl ? (
                                        <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Loading tags from GoHighLevel...
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            {/* Dropdown Button */}
                                            <button
                                                onClick={() => setGhlDropdownOpen(!ghlDropdownOpen)}
                                                className="w-full flex items-center justify-between bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white hover:border-white/20 transition-colors"
                                            >
                                                <span className="text-gray-400">
                                                    {selectedGhlTags.length > 0
                                                        ? `${selectedGhlTags.length} tag(s) selected`
                                                        : 'Select tags...'}
                                                </span>
                                                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${ghlDropdownOpen ? 'rotate-180' : ''}`} />
                                            </button>

                                            {/* Dropdown Menu */}
                                            {ghlDropdownOpen && (
                                                <div className="absolute z-10 w-full mt-2 bg-[#1a1d21] border border-white/10 rounded-xl shadow-xl max-h-60 overflow-y-auto">

                                                    {/* Search Input */}
                                                    <div className="sticky top-0 p-2 bg-[#1a1d21] border-b border-white/10 z-20">
                                                        <input
                                                            type="text"
                                                            value={ghlSearchQuery}
                                                            onChange={(e) => setGhlSearchQuery(e.target.value)}
                                                            placeholder="Search tags..."
                                                            className="w-full px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/50"
                                                            autoFocus
                                                        />
                                                    </div>

                                                    {ghlTags.length === 0 ? (
                                                        <div className="px-4 py-3 text-sm text-gray-500">
                                                            No tags found in GoHighLevel
                                                        </div>
                                                    ) : (
                                                        ghlTags
                                                            .filter(tag => tag.name.toLowerCase().includes(ghlSearchQuery.toLowerCase()))
                                                            .map(tag => (
                                                                <button
                                                                    key={tag.id}
                                                                    onClick={() => toggleGhlTag(tag.name)}
                                                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 transition-colors ${selectedGhlTags.includes(tag.name) ? 'bg-indigo-500/10 text-indigo-400' : 'text-gray-300'
                                                                        }`}
                                                                >
                                                                    <span>{tag.name}</span>
                                                                    {selectedGhlTags.includes(tag.name) && (
                                                                        <Check className="w-4 h-4 text-indigo-400" />
                                                                    )}
                                                                </button>
                                                            ))
                                                    )}

                                                    {/* Show "No results" if query yields nothing */}
                                                    {ghlTags.length > 0 && ghlTags.filter(tag => tag.name.toLowerCase().includes(ghlSearchQuery.toLowerCase())).length === 0 && (
                                                        <div className="px-4 py-3 text-sm text-gray-500 text-center">
                                                            No tags match your search
                                                        </div>
                                                    )}

                                                    {/* Create New Tag Option */}
                                                    <div className="border-t border-white/10">
                                                        {!showCreateTag ? (
                                                            <button
                                                                onClick={() => setShowCreateTag(true)}
                                                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-teal-400 hover:bg-teal-500/10 transition-colors"
                                                            >
                                                                <Plus className="w-4 h-4" />
                                                                Create new tag
                                                            </button>
                                                        ) : (
                                                            <div className="p-3 space-y-2">
                                                                <input
                                                                    type="text"
                                                                    value={newTagName}
                                                                    onChange={(e) => setNewTagName(e.target.value)}
                                                                    placeholder="Enter tag name..."
                                                                    className="w-full px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/50"
                                                                    autoFocus
                                                                />
                                                                <div className="flex gap-2">
                                                                    <button
                                                                        onClick={handleCreateTag}
                                                                        disabled={creatingTag || !newTagName.trim()}
                                                                        className="flex-1 px-3 py-1.5 text-sm font-medium bg-teal-500 text-black rounded-lg hover:bg-teal-400 disabled:opacity-50 transition-all"
                                                                    >
                                                                        {creatingTag ? 'Creating...' : 'Create'}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => { setShowCreateTag(false); setNewTagName('') }}
                                                                        className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
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
