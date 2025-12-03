import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCloud, Loader2 } from 'lucide-react'
import { startJob } from '../utils/api'

const CHATKIT_SRC = 'https://cdn.jsdelivr.net/npm/@openai/chatkit@1.1.0/dist/chatkit.js'
let chatkitLoadPromise = null

const ensureChatKit = () => {
  if (window.ChatKit) return Promise.resolve(true)
  if (chatkitLoadPromise) return chatkitLoadPromise
  chatkitLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHATKIT_SRC
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = (err) => reject(err)
    document.head.appendChild(script)
  })
  return chatkitLoadPromise
}

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

  useEffect(() => {
    const domainPublicKey = import.meta.env.VITE_CHATKIT_DOMAIN_PUBLIC_KEY
    const workflowId = import.meta.env.VITE_WORKFLOW_ID
    const workflowVersion = import.meta.env.VITE_WORKFLOW_VERSION

    if (!domainPublicKey || !workflowId || !workflowVersion) return

    // simple status helper so we know if the widget failed to mount
    const statusEl = document.getElementById('chatkit-status')
    const setStatus = (msg) => {
      if (statusEl) statusEl.textContent = msg || ''
    }
    setStatus('Loading chat widget...')

    let chatInstance

    ensureChatKit()
      .then(() => {
        try {
          chatInstance = new window.ChatKit({
            workflowId,
            workflowVersion,
            domainPublicKey,
          })
          chatInstance.mount('#chatkit')
          setStatus('')
        } catch (err) {
          console.error('ChatKit init error', err)
          setStatus('Unable to load ChatKit widget.')
        }
      })
      .catch((err) => {
        console.error('ChatKit script load error', err)
        setStatus('ChatKit script not available.')
      })

    return () => {
      chatInstance?.unmount?.()
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div className="glass-panel px-5 py-5">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">New Search</p>
        <h1 className="text-3xl font-semibold text-primary">Start a new lead job</h1>
        <p className="text-sm text-muted">Send a prompt to the Agent Flow pipeline.</p>
      </div>

      <form onSubmit={handleSubmit} className="glass-panel space-y-5 px-5 py-6">
        <div className="flex flex-col gap-2">
          <label htmlFor="prompt" className="text-sm font-semibold text-ink">
            Describe the search
          </label>
          <textarea
            id="prompt"
            rows={8}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Find 3 top decision makers at growth-stage US fintech firms..."
            className="w-full rounded-2xl border border-outline/80 bg-white/70 px-4 py-3 text-sm text-ink outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-mint"
          />
        </div>

        <div className="flex items-center justify-center rounded-2xl border border-dashed border-outline/90 bg-panel px-4 py-6 text-muted">
          <div className="flex items-center gap-3">
            <UploadCloud className="h-5 w-5" />
            <div className="text-left">
              <p className="text-sm font-semibold">Upload a list (coming soon)</p>
              <p className="text-xs">File upload is disabled in this build.</p>
            </div>
          </div>
        </div>

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
        <p id="chatkit-status" className="text-xs text-muted"></p>
        <div
          id="chatkit"
          className="mt-2 min-h-[320px] rounded-2xl border border-outline/80 bg-white/70"
        />
      </div>
    </div>
  )
}

export default NewJob
