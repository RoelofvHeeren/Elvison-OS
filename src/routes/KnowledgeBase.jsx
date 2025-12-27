import { useState, useEffect } from 'react'
import { Upload, FileText, Trash2, CheckCircle, Clock, RefreshCw } from 'lucide-react'
import { saveFileToDB, getAllFilesFromDB, deleteFileFromDB } from '../utils/db'

const KnowledgeBase = () => {
    const [files, setFiles] = useState([])
    const [uploading, setUploading] = useState(false)
    const [syncing, setSyncing] = useState(false)
    // Vector Store ID Persistence
    const [vectorStoreId, setVectorStoreId] = useState('')

    useEffect(() => {
        const savedId = localStorage.getItem('elvison_vector_store_id')
        if (savedId) setVectorStoreId(savedId)
        fetchFiles()
    }, [])

    const handleVectorStoreIdChange = (e) => {
        const newVal = e.target.value
        setVectorStoreId(newVal)
        localStorage.setItem('elvison_vector_store_id', newVal)
    }

    const fetchFiles = async () => {
        try {
            // 1. Fetch server files
            const res = await fetch('/api/knowledge/files')
            let serverFiles = []
            if (res.ok) {
                const data = await res.json()
                serverFiles = data.files || []
            }
            setFiles(serverFiles)

            // 2. Fetch local DB files and Sync
            const localFiles = await getAllFilesFromDB()

            // Find files that are in DB but NOT on server
            const missingOnServer = localFiles.filter(lf =>
                !serverFiles.some(sf => sf.name === lf.name)
            )

            if (missingOnServer.length > 0) {
                setSyncing(true)
                console.log(`Syncing ${missingOnServer.length} files from local cache...`)

                for (const fileRec of missingOnServer) {
                    const formData = new FormData()
                    formData.append('file', fileRec.blob)

                    try {
                        await fetch(`/api/knowledge/upload?filename=${encodeURIComponent(fileRec.name)}`, {
                            method: 'POST',
                            body: formData,
                        })
                    } catch (e) {
                        console.error('Auto-sync failed for', fileRec.name, e)
                    }
                }

                // Refresh list after sync
                const postSyncRes = await fetch('/api/knowledge/files')
                if (postSyncRes.ok) {
                    const data = await postSyncRes.json()
                    setFiles(data.files || [])
                }
                setSyncing(false)
            }

        } catch (err) {
            console.error('Failed to fetch files', err)
            setSyncing(false)
        }
    }

    const handleUpload = async (e) => {
        const selectedFiles = e.target.files
        if (!selectedFiles || selectedFiles.length === 0) return

        setUploading(true)
        const file = selectedFiles[0]
        const formData = new FormData()
        formData.append('file', file)

        try {
            // Save to Local DB first
            await saveFileToDB(file)

            // Upload to Server
            const res = await fetch(`/api/knowledge/upload?filename=${encodeURIComponent(file.name)}`, {
                method: 'POST',
                body: formData, // Browser automatically sets Content-Type to multipart/form-data
            })
            if (res.ok) {
                await fetchFiles()
            }
        } catch (err) {
            console.error('Upload failed', err)
        } finally {
            setUploading(false)
        }
    }

    const handleDelete = async (id) => {
        try {
            // Find file name to delete from DB (hacky since we only have ID here, but in this mock ID often == name or we find by ID)
            // For robustness in this specific dev mock setup:
            const fileToDelete = files.find(f => f.id === id)
            if (fileToDelete) {
                await deleteFileFromDB(fileToDelete.name)
            }

            await fetch('/api/knowledge/files/' + id, { method: 'DELETE' })
            setFiles(prev => prev.filter(f => f.id !== id))
        } catch (err) {
            console.error('Delete failed', err)
        }
    }

    // ... (Vector Store ID logic moved to top in previous edit) ...

    return (
        <div className="space-y-8 p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
            <header className="glass-panel px-6 py-5 flex items-center justify-between">
                <div>
                    <h1 className="font-serif text-3xl font-bold text-white mb-1">Knowledge Base</h1>
                    <p className="text-sm text-muted">Manage documents for your AI agents to reference.</p>
                </div>
                {syncing && (
                    <div className="flex items-center gap-2 text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-full animate-pulse border border-primary/20">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Restoring files from cache...
                    </div>
                )}
            </header>

            <div className="grid gap-6 lg:grid-cols-[1fr,350px]">
                {/* Files List */}
                <div className="glass-panel p-6">
                    <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted">Uploaded Documents ({files.length})</h2>

                    {files.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-white/5 rounded-2xl bg-white/5">
                            <FileText className="h-10 w-10 text-gray-600 mb-3" />
                            <p className="text-gray-400 font-medium">No documents uploaded</p>
                            <p className="text-xs text-gray-600 mt-1 max-w-xs">Upload files to let your agents use them as context.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {files.map((file) => (
                                <div key={file.id} className="group flex items-center justify-between rounded-xl bg-white/5 p-3 hover:bg-white/10 transition-all border border-transparent hover:border-white/10">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/20 border border-white/10 text-primary">
                                            <FileText className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-white text-sm">{file.name}</h3>
                                            <p className="text-[10px] text-gray-500 uppercase tracking-wide">
                                                {new Date(file.uploadedAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full ${file.status === 'ready' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                            }`}>
                                            {file.status === 'ready' ? <CheckCircle className="h-3 w-3" /> : <Clock className="h-3 w-3 animate-spin-slow" />}
                                            <span className="uppercase">{file.status}</span>
                                        </div>

                                        <button
                                            onClick={() => handleDelete(file.id)}
                                            className="p-2 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                            title="Delete file"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Sidebar: Upload & Settings */}
                <div className="space-y-6">
                    {/* Upload Area */}
                    <div className="glass-panel p-6">
                        <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted">Upload New</h3>
                        <div className="rounded-2xl border-2 border-dashed border-white/10 bg-white/5 p-8 text-center transition-all hover:border-primary/50 hover:bg-primary/5 group relative overflow-hidden">
                            <input
                                type="file"
                                id="file-upload"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={handleUpload}
                                disabled={uploading}
                            />
                            <div className="flex flex-col items-center gap-3 pointer-events-none">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                                    <Upload className="h-6 w-6" />
                                </div>
                                <div>
                                    <span className="text-sm font-bold text-white block">Click or Drag File</span>
                                    <span className="text-xs text-muted">PDF, TXT, DOCX</span>
                                </div>
                            </div>
                            {uploading && (
                                <div className="absolute inset-0 bg-black/80 flex items-center justify-center backdrop-blur-sm">
                                    <p className="text-sm font-bold text-primary animate-pulse">Uploading...</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Vector Store ID Input */}
                    <div className="glass-panel p-6">
                        <label className="text-xs font-bold uppercase tracking-wider text-primary mb-2 block">OpenAI Vector Store ID</label>
                        <input
                            type="text"
                            value={vectorStoreId}
                            onChange={handleVectorStoreIdChange}
                            placeholder="vs_..."
                            className="w-full rounded-lg border-2 border-white/10 bg-black/20 p-2.5 text-sm text-white placeholder:text-gray-700 focus:border-primary focus:outline-none transition-all"
                        />
                        <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
                            Connect an existing vector store to skip manual uploads. Agents will use this ID for knowledge retrieval.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default KnowledgeBase
