import { useState, useEffect } from 'react'
import { X, Send, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { fetchAimfoxCampaigns, fetchGhlWorkflows, pushLeadsToOutreach } from '../utils/api'

export default function OutreachModal({ isOpen, onClose, selectedLeadsCount, selectedLeadIds, onComplete }) {
    const [tool, setTool] = useState('') // 'aimfox' | 'gohighlevel'
    const [campaigns, setCampaigns] = useState([])
    const [selectedCampaign, setSelectedCampaign] = useState('')
    const [loading, setLoading] = useState(false)
    const [pushing, setPushing] = useState(false)
    const [result, setResult] = useState(null) // { success: [], failed: [] }
    const [error, setError] = useState('')

    useEffect(() => {
        if (isOpen) {
            setTool('')
            setSelectedCampaign('')
            setCampaigns([])
            setResult(null)
            setError('')
        }
    }, [isOpen])

    useEffect(() => {
        if (!tool) return

        const loadOptions = async () => {
            setLoading(true)
            setError('')
            setCampaigns([])
            try {
                let data
                if (tool === 'aimfox') {
                    data = await fetchAimfoxCampaigns()
                    if (data.campaigns) setCampaigns(data.campaigns)
                } else if (tool === 'gohighlevel') {
                    data = await fetchGhlWorkflows()
                    if (data.workflows) setCampaigns(data.workflows)
                }
            } catch (err) {
                console.error(err)
                setError(`Failed to load ${tool === 'aimfox' ? 'Aimfox campaigns' : 'GoHighLevel workflows'}`)
            } finally {
                setLoading(false)
            }
        }

        loadOptions()
    }, [tool])

    const handlePush = async () => {
        if (!selectedCampaign || !tool) return

        setPushing(true)
        setError('')
        try {
            const leadIdsArray = Array.from(selectedLeadIds)
            const response = await pushLeadsToOutreach(tool, selectedCampaign, leadIdsArray)

            if (response.success) {
                setResult({
                    status: response.status,
                    count: response.count,
                    message: response.message
                })
                if (onComplete) onComplete()
            } else {
                setError('Operation failed')
            }
        } catch (err) {
            console.error(err)
            setError('Failed to push leads. Please allow popups or check console.')
        } finally {
            setPushing(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md bg-[#0F1115] border border-white/10 rounded-2xl shadow-xl overflow-hidden">
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
                <div className="p-6 space-y-6">
                    {result ? (
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto ring-1 ring-blue-500/30">
                                <Loader2 className="w-8 h-8 text-blue-400 animate-spin-slow" />
                            </div>
                            <div>
                                <h4 className="text-xl font-bold text-white">Transfer Started</h4>
                                <p className="text-sm text-gray-400 mt-1">
                                    {result.message}
                                </p>
                                <p className="text-xs text-gray-500 mt-2">
                                    You can close this window. We'll update you if anything goes wrong.
                                </p>
                            </div>

                            <button
                                onClick={onClose}
                                className="w-full py-2.5 bg-teal-500 hover:bg-teal-400 text-black font-semibold rounded-xl transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <p className="text-sm text-gray-400">
                                You are about to push <strong className="text-white">{selectedLeadsCount}</strong> selected lead{selectedLeadsCount !== 1 ? 's' : ''} to an external tool.
                            </p>

                            {/* Tool Selection */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Destination Tool</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => setTool('aimfox')}
                                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${tool === 'aimfox'
                                            ? 'bg-teal-500/10 border-teal-500/50 text-teal-400'
                                            : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5'
                                            }`}
                                    >
                                        <span className="font-semibold text-sm">Aimfox</span>
                                        <span className="text-[10px] opacity-60">LinkedIn Outreach</span>
                                    </button>
                                    <button
                                        onClick={() => setTool('gohighlevel')}
                                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${tool === 'gohighlevel'
                                            ? 'bg-teal-500/10 border-teal-500/50 text-teal-400'
                                            : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5'
                                            }`}
                                    >
                                        <span className="font-semibold text-sm">GoHighLevel</span>
                                        <span className="text-[10px] opacity-60">Email / SMS</span>
                                    </button>
                                </div>
                            </div>

                            {/* Campaign Selection */}
                            {tool && (
                                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                                        Select {tool === 'aimfox' ? 'Campaign' : 'Workflow'}
                                    </label>
                                    {loading ? (
                                        <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Loading options...
                                        </div>
                                    ) : (
                                        <select
                                            value={selectedCampaign}
                                            onChange={(e) => setSelectedCampaign(e.target.value)}
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/50"
                                        >
                                            <option value="">-- Choose Target --</option>
                                            {campaigns.map(c => (
                                                <option key={c.id} value={c.id}>
                                                    {c.name} {c.status ? `(${c.status})` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="pt-4">
                                <button
                                    onClick={handlePush}
                                    disabled={!tool || !selectedCampaign || pushing || loading || selectedLeadsCount === 0}
                                    className="w-full flex items-center justify-center gap-2 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-xl transition-all shadow-lg shadow-teal-500/20"
                                >
                                    {pushing ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Pushing Leads...
                                        </>
                                    ) : (
                                        <>
                                            Push {selectedLeadsCount} Leads
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
