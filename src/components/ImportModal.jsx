import { useState, useRef } from 'react'
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import PropTypes from 'prop-types'

const ImportModal = ({ isOpen, onClose, onImportSuccess }) => {
    const [file, setFile] = useState(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState('')
    const [successCount, setSuccessCount] = useState(null)
    const fileInputRef = useRef(null)

    if (!isOpen) return null

    const handleFileChange = (e) => {
        const selected = e.target.files[0]
        if (selected) {
            if (selected.type !== 'text/csv' && !selected.name.endsWith('.csv')) {
                setError('Please upload a valid CSV file.')
                setFile(null)
            } else {
                setError('')
                setFile(selected)
                setSuccessCount(null)
            }
        }
    }

    const handleDrop = (e) => {
        e.preventDefault()
        e.stopPropagation()
        const selected = e.dataTransfer.files[0]
        if (selected) {
            if (selected.type !== 'text/csv' && !selected.name.endsWith('.csv')) {
                setError('Please upload a valid CSV file.')
                setFile(null)
            } else {
                setError('')
                setFile(selected)
                setSuccessCount(null)
            }
        }
    }

    const handleUpload = async () => {
        if (!file) return

        setUploading(true)
        setError('')

        const formData = new FormData()
        formData.append('file', file)

        try {
            // Dynamic import to avoid bundling issues if backend isn't ready
            // But here we just fetch
            const res = await fetch('/api/leads/import', {
                method: 'POST',
                body: formData,
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Upload failed')
            }

            setSuccessCount(data.count)
            setFile(null)
            if (onImportSuccess) onImportSuccess()
        } catch (err) {
            console.error(err)
            setError(err.message || 'Failed to upload CSV')
        } finally {
            setUploading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <h3 className="font-serif text-xl font-bold text-gray-800">Import Leads</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {successCount !== null ? (
                        <div className="text-center py-6 space-y-3">
                            <div className="mx-auto w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                                <CheckCircle className="w-6 h-6" />
                            </div>
                            <h4 className="text-lg font-bold text-gray-800">Import Successful!</h4>
                            <p className="text-sm text-gray-600">Successfully imported <span className="font-bold text-green-600">{successCount}</span> leads.</p>
                            <button
                                onClick={() => { setSuccessCount(null); onClose(); }}
                                className="mt-4 px-6 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    ) : (
                        <>
                            <div
                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${file ? 'border-primary/50 bg-primary/5' : 'border-gray-200 hover:border-primary/30 hover:bg-gray-50'
                                    }`}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    accept=".csv"
                                    className="hidden"
                                />
                                {file ? (
                                    <>
                                        <FileText className="w-10 h-10 text-primary mb-3" />
                                        <p className="text-sm font-semibold text-gray-700">{file.name}</p>
                                        <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-10 h-10 text-gray-300 mb-3" />
                                        <p className="text-sm font-semibold text-gray-700">Click to upload or drag & drop</p>
                                        <p className="text-xs text-gray-400 mt-1">CSV files only (Apollo exports supported)</p>
                                    </>
                                )}
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 text-rose-500 text-sm bg-rose-50 p-3 rounded-lg">
                                    <AlertCircle className="w-4 h-4" />
                                    {error}
                                </div>
                            )}

                            <div className="flex gap-3 mt-4">
                                <button
                                    onClick={onClose}
                                    className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                                    disabled={uploading}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleUpload}
                                    disabled={!file || uploading}
                                    className="flex-1 px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primaryDark transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {uploading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Importing...
                                        </>
                                    ) : (
                                        'Import Leads'
                                    )}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

ImportModal.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    onImportSuccess: PropTypes.func,
}

export default ImportModal
