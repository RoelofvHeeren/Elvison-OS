import { useState, useEffect } from 'react'
import { Upload, FileText, Trash2, CheckCircle, Clock, RefreshCw, Edit2, Check, X } from 'lucide-react'
import { saveFileToDB, getAllFilesFromDB, deleteFileFromDB } from '../utils/db'

const KnowledgeBase = () => {
    const [files, setFiles] = useState([])
    const [uploading, setUploading] = useState(false)
    const [syncing, setSyncing] = useState(false)
    // Vector Store ID Persistence
    const [vectorStoreId, setVectorStoreId] = useState('')
    // Inline editing state
    const [editingId, setEditingId] = useState(null)
    const [editingName, setEditingName] = useState('')
    // Drag & drop state
    const [isDragging, setIsDragging] = useState(false)

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

    const handleUpload = async (selectedFiles) => {
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
                body: formData,
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

    const handleFileInput = (e) => {
        handleUpload(e.target.files)
    }

    const handleDragOver = (e) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const handleDrop = (e) => {
        e.preventDefault()
        setIsDragging(false)
        handleUpload(e.dataTransfer.files)
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

    const handleStartEdit = (file) => {
        setEditingId(file.id)
        setEditingName(file.name)
    }

    const handleCancelEdit = () => {
        setEditingId(null)
        setEditingName('')
    }

    const handleSaveEdit = async (fileId) => {
        if (!editingName.trim()) {
            handleCancelEdit()
            return
        }

        try {
            // TODO: Add backend endpoint to update file name
            // await fetch(`/api/knowledge/files/${fileId}`, {
            //     method: 'PATCH',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify({ name: editingName })
            // })

            // Update local state optimistically
            setFiles(prev => prev.map(f =>
                f.id === fileId ? { ...f, name: editingName } : f
            ))
            handleCancelEdit()
        } catch (err) {
            console.error('Failed to update file name', err)
            // Revert on error
            handleCancelEdit()
        }
    }

    const handleKeyDown = (e, fileId) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            handleSaveEdit(fileId)
        } else if (e.key === 'Escape') {
            handleCancelEdit()
        }
    }

    // ... (Vector Store ID logic moved to top in previous edit) ...

    return (
        <div className="min-h-screen p-6 lg:p-8">
            <div className="max-w-[1400px] mx-auto space-y-6">
                {/* Header */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                    <h1 className="font-serif text-3xl font-bold text-white flex items-center gap-3">
                        <FileText className="w-8 h-8 text-[#139187]" />
                        Knowledge Base
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">
                        Upload documents for your AI agents to reference
                    </p>
                </div>

                {/* Upload Area */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Upload Documents</h2>

                    <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${isDragging
                            ? 'border-[#139187] bg-[#139187]/10'
                            : 'border-white/20 hover:border-[#139187]/50 hover:bg-white/5'
                            }`}
                        onClick={() => document.getElementById('file-upload').click()}
                    >
                        <input
                            id="file-upload"
                            type="file"
                            onChange={handleFileInput}
                            className="hidden"
                            accept=".pdf,.txt,.doc,.docx,.md"
                        />

                        {uploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <RefreshCw className="w-10 h-10 text-[#139187] animate-spin" />
                                <p className="text-sm text-gray-400">Uploading...</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-3">
                                <Upload className="w-10 h-10 text-gray-400" />
                                <div>
                                    <p className="text-white font-medium">Click to upload or drag and drop</p>
                                    <p className="text-xs text-gray-400 mt-1">PDF, TXT, DOC, DOCX, MD files supported</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Files List */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                    <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">Uploaded Documents ({files.length})</h2>

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
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/20 border border-white/10 text-primary">
                                            <FileText className="h-5 w-5" />
                                        </div>
                                        <div className="flex-1">
                                            {editingId === file.id ? (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={editingName}
                                                        onChange={(e) => setEditingName(e.target.value)}
                                                        onKeyDown={(e) => handleKeyDown(e, file.id)}
                                                        onBlur={() => handleSaveEdit(file.id)}
                                                        className="flex-1 bg-black/40 border border-primary/50 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={() => handleSaveEdit(file.id)}
                                                        className="p-1 text-teal-400 hover:bg-teal-500/20 rounded"
                                                        title="Save"
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={handleCancelEdit}
                                                        className="p-1 text-gray-400 hover:bg-gray-500/20 rounded"
                                                        title="Cancel"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <div>
                                                        <h3 className="font-medium text-white text-sm">{file.name}</h3>
                                                        <p className="text-[10px] text-gray-500 uppercase tracking-wide">
                                                            {new Date(file.uploadedAt).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleStartEdit(file)}
                                                        className="p-1.5 text-gray-500 hover:text-teal-400 hover:bg-teal-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                        title="Edit name"
                                                    >
                                                        <Edit2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            )}
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
            </div>
        </div>
    )
}

export default KnowledgeBase
