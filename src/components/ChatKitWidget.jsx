import { useEffect, useMemo, useState } from 'react'
import { ChatKit, useChatKit } from '@openai/chatkit-react'
import { safeUUID } from '../utils/security'

const CHATKIT_SRC = 'https://cdn.platform.openai.com/deployments/chatkit/chatkit.js'

const loadChatKitScript = () =>
  new Promise((resolve, reject) => {
    if (window.ChatKit) return resolve(true)
    const existing = document.querySelector(`script[src="${CHATKIT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true })
      existing.addEventListener('error', reject, { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = CHATKIT_SRC
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = (err) => reject(err)
    document.head.appendChild(script)
  })

const getDeviceId = () => {
  try {
    const key = 'chatkit_device_id'
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const next = safeUUID();
    localStorage.setItem(key, next)
    return next
  } catch {
    return `device-${Math.random().toString(36).slice(2, 10)}`
  }
}

const ChatKitWidget = () => {
  const [scriptStatus, setScriptStatus] = useState('Loading chat...')
  const [scriptError, setScriptError] = useState('')
  const deviceId = useMemo(() => getDeviceId(), [])

  useEffect(() => {
    loadChatKitScript()
      .then(() => setScriptStatus(''))
      .catch((err) => {
        console.error('ChatKit script load error', err)
        setScriptError('ChatKit script failed to load.')
        setScriptStatus('')
      })
  }, [])

  const { control, status } = useChatKit({
    api: {
      async getClientSecret(existing) {
        const res = await fetch('/api/chatkit/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, existing }),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(detail || 'Session request failed')
        }
        const data = await res.json()
        return data?.client_secret
      },
    },
  })

  if (scriptError) {
    return <div className="text-sm text-rose-700">{scriptError}</div>
  }

  if (scriptStatus) {
    return <div className="text-sm text-muted">{scriptStatus}</div>
  }

  return (
    <div className="space-y-2">
      {status && (
        <div className="text-xs text-muted">
          {status === 'loading' ? 'Connecting...' : status === 'ready' ? '' : status}
        </div>
      )}
      <div className="rounded-2xl border border-outline/80 bg-white/70 p-2">
        <ChatKit control={control} className="h-[380px]" />
      </div>
    </div>
  )
}

export default ChatKitWidget
