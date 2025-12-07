import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCloud, Loader2 } from 'lucide-react'
import { startJob } from '../utils/api'
import ChatKitWidget from '../components/ChatKitWidget'

const NewJob = () => {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) {
      setError('Add a prompt to start a job.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await startJob(prompt)
      const jobId = data?.job_id || data?.jobId
      if (jobId) {
        navigate(`/status/${jobId}`)
      } else {
        setError('No jobId returned from the Agent Flow API.')
      }
    } catch (err) {
      console.error(err)
      const detail = err?.response?.data?.detail || err?.response?.data?.error
      setError(detail || 'Unable to start the job. Check the Agent Flow API.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="glass-panel px-5 py-5">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">New Search</p>
        <h1 className="text-3xl font-semibold text-primary">Start a new lead job</h1>
        <p className="text-sm text-muted">Send a prompt to the Agent Flow pipeline.</p>
      </div>

      <form onSubmit={handleSubmit} className="glass-panel space-y-5 px-5 py-6">
        <textarea
          id="prompt"
          rows={8}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Find 3 top decision makers at growth-stage US fintech firms..."
          className="w-full rounded-xl border border-glass-border bg-white px-4 py-4 text-sm font-medium text-black outline-none transition-all duration-300 placeholder:text-muted/50 focus:border-primary focus:ring-1 focus:ring-primary shadow-sharp"
        />

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Start Job
          </button>
        </div>
      </form>

      <div className="glass-panel space-y-2 px-5 py-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">ChatKit</p>
            <h2 className="text-xl font-semibold text-primary">Chat with the Agent Flow</h2>
            <p className="text-sm text-muted">Use the embedded widget to trigger the workflow.</p>
          </div>
        </div>
        <ChatKitWidget />
      </div>
    </div>
  )
}

export default NewJob
