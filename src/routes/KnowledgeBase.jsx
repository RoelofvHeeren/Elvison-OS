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
        <div className="space-y-8 animate-fade-in">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="font-serif text-3xl font-medium text-primary">Knowledge Base</h1>
                    <p className="text-gray-400 mt-2">Manage documents for your AI agents to reference.</p>
                </div>
                {syncing && (
                    <div className="flex items-center gap-2 text-sm text-[#139187] bg-[#139187]/10 px-3 py-1.5 rounded-full animate-pulse border border-[#139187]/20">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Restoring files from cache...
                    </div>
                )}
            </header>

            {/* Vector Store ID Input */}
            <div className="rounded-xl border border-[#139187]/30 bg-[#139187]/5 p-4 flex flex-col gap-2">
                <label className="text-sm font-bold text-[#139187]">Vector Store ID (OpenAI)</label>
                <input
                    type="text"
                    value={vectorStoreId}
                    onChange={handleVectorStoreIdChange}
                    placeholder="vs_..."
                    className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-white placeholder:text-gray-600 focus:border-[#139187] focus:outline-none"
                />
                <p className="text-xs text-gray-500">Enter your existing Vector Store ID here so agents can access files without re-uploading.</p>
            </div>

            {/* Upload Area */}
            <div className="rounded-2xl border-2 border-dashed border-outline/50 bg-surface/30 p-10 text-center transition-all hover:border-primary/50 hover:bg-surface/50">
                <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    onChange={handleUpload}
                    disabled={uploading}
                />
                <label
                    htmlFor="file-upload"
                    className="flex flex-col items-center gap-4 cursor-pointer"
                >
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Upload className="h-8 w-8" />
                    </div>
                    <div>
                        <span className="text-lg font-medium text-primary">Click to upload</span>
                        <span className="text-muted"> or drag and drop</span>
                    </div>
                    <p className="text-sm text-muted/70">PDF, TXT, DOCX (Max 10MB)</p>
                </label>
                {uploading && <p className="mt-4 text-sm text-primary animate-pulse">Uploading...</p>}
            </div>

            {/* Files List */}
            <div className="rounded-2xl border border-outline bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-medium text-secondary">Uploaded Documents ({files.length})</h2>

                {files.length === 0 ? (
                    <div className="text-center py-10 text-muted">No documents uploaded yet.</div>
                ) : (
                    <div className="space-y-3">
                        {files.map((file) => (
                            <div key={file.id} className="group flex items-center justify-between rounded-xl bg-surface p-4 transition-all hover:bg-surface/80 hover:shadow-sm">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
                                        <FileText className="h-5 w-5 text-secondary" />
                                    </div>
                                    <div>
                                        <h3 className="font-medium text-gray-800">{file.name}</h3>
                                        <p className="text-xs text-gray-500">
                                            {new Date(file.uploadedAt).toLocaleDateString()} • {new Date(file.uploadedAt).toLocaleTimeString()}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    <div className={`flex items-center gap-2 text-sm px-3 py-1 rounded-full ${file.status === 'ready' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                                        }`}>
                                        {file.status === 'ready' ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4 animate-spin-slow" />}
                                        <span className="capitalize">{file.status}</span>
                                    </div>

                                    <button
                                        onClick={() => handleDelete(file.id)}
                                        className="p-2 text-muted hover:text-rose-500 transition-colors"
                                        title="Delete file"
                                    >
                                        <Trash2 className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default KnowledgeBase
