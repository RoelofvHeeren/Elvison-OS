import { useState } from 'react'
import { Link2, Key, Zap, Database, Mail, MessageSquare, BarChart3, Webhook, Plus } from 'lucide-react'

const Connections = () => {
  const [selectedIntegration, setSelectedIntegration] = useState(null)

  // Define available integrations
  const softwareIntegrations = [
    { id: 'aimfox', name: 'Aimfox', icon: MessageSquare, description: 'LinkedIn automation & outreach', color: 'bg-blue-600' },
    { id: 'gohighlevel', name: 'GoHighLevel', icon: Zap, description: 'Marketing automation & CRM', color: 'bg-indigo-500' },
    { id: 'salesforce', name: 'Salesforce', icon: Database, description: 'Connect your CRM data', color: 'bg-blue-500' },
    { id: 'hubspot', name: 'HubSpot', icon: Mail, description: 'Marketing & CRM platform', color: 'bg-orange-500' },
    { id: 'slack', name: 'Slack', icon: MessageSquare, description: 'Team communication', color: 'bg-purple-500' },
    { id: 'analytics', name: 'Google Analytics', icon: BarChart3, description: 'Website analytics', color: 'bg-yellow-500' },
  ]

  const handleConnectIntegration = (integration) => {
    if (integration.id === 'aimfox' || integration.id === 'gohighlevel') {
      alert(`${integration.name} is integrated! \n\nPlease ensure AIMFOX_API_KEY and GHL_API_KEY are set in your .env file.\n\nYou can push leads to these tools directly from the CRM and Logbook pages.`)
      return
    }

    console.log(`Connecting to ${integration.name}...`)
    setSelectedIntegration(integration.id)
    // TODO: Implement OAuth flow or integration setup
    setTimeout(() => {
      alert(`${integration.name} integration coming soon!`)
      setSelectedIntegration(null)
    }, 500)
  }

  const handleConfigureAPI = (apiName) => {
    console.log(`Configuring ${apiName} API...`)
    // TODO: Implement API key configuration modal
    alert(`${apiName} API configuration coming soon!\n\nYou'll be able to bring your own API key for cost control and privacy.`)
  }

  return (
    <div className="space-y-6 p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
      {/* Header */}
      <div className="glass-panel p-6 bg-white/5 border border-white/10 backdrop-blur-md">
        <div className="flex items-center gap-3 mb-2">
          <Link2 className="h-8 w-8 text-teal-400" />
          <h1 className="font-serif text-3xl font-bold text-white">Connections</h1>
        </div>
        <p className="text-sm text-gray-400">Connect external tools, services, and APIs to extend your workflow.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Software Integrations */}
        <div className="glass-panel p-6 bg-white/5 border border-white/10 backdrop-blur-md">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-teal-400" />
            <h2 className="text-lg font-bold text-white">Software Integrations</h2>
          </div>
          <p className="text-sm text-gray-400 mb-6">Connect popular business tools to sync data and automate workflows.</p>

          <div className="space-y-3">
            {softwareIntegrations.map((integration) => {
              const Icon = integration.icon
              const isConnecting = selectedIntegration === integration.id

              return (
                <div
                  key={integration.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 hover:border-teal-500/30 hover:bg-white/10 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-lg ${integration.color}/20 flex items-center justify-center border border-white/10`}>
                      <Icon className={`h-5 w-5 ${integration.color.replace('bg-', 'text-')}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-sm">{integration.name}</h3>
                      <p className="text-xs text-gray-500">{integration.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleConnectIntegration(integration)}
                    disabled={isConnecting}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-teal-600/20 text-teal-400 border border-teal-500/30 hover:bg-teal-600/30 hover:border-teal-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              )
            })}
          </div>

          <button
            className="mt-4 w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-white/10 text-gray-400 hover:border-teal-500/30 hover:text-teal-400 hover:bg-white/5 transition-all group"
            onClick={() => alert('Custom integration builder coming soon!')}
          >
            <Plus className="h-4 w-4" />
            <span className="text-sm font-medium">Add Custom Integration</span>
          </button>
        </div>

        {/* API Connections */}
        <div className="space-y-6">
          {/* OpenAI API */}
          <div className="glass-panel p-6 bg-white/5 border border-white/10 backdrop-blur-md">
            <div className="flex items-center gap-2 mb-4">
              <Key className="h-5 w-5 text-teal-400" />
              <h2 className="text-lg font-bold text-white">API Connections</h2>
            </div>
            <p className="text-sm text-gray-400 mb-6">Bring your own API keys for cost control and privacy.</p>

            <div className="space-y-4">
              {/* OpenAI */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white mb-1">OpenAI API</h3>
                    <p className="text-xs text-gray-400">Use your own OpenAI API key for GPT-4 and embeddings</p>
                  </div>
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    Coming Soon
                  </div>
                </div>
                <button
                  onClick={() => handleConfigureAPI('OpenAI')}
                  className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-white/10 text-white border border-white/20 hover:bg-white/15 hover:border-white/30 transition-all"
                >
                  Configure API Key
                </button>
              </div>

              {/* Anthropic */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-orange-500/10 to-red-500/10 border border-orange-500/20">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white mb-1">Anthropic API</h3>
                    <p className="text-xs text-gray-400">Connect Claude models for advanced reasoning</p>
                  </div>
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    Coming Soon
                  </div>
                </div>
                <button
                  onClick={() => handleConfigureAPI('Anthropic')}
                  className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-white/10 text-white border border-white/20 hover:bg-white/15 hover:border-white/30 transition-all"
                >
                  Configure API Key
                </button>
              </div>

              {/* Custom API */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-teal-500/30 transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white mb-1">Custom API</h3>
                    <p className="text-xs text-gray-400">Connect your own API endpoint</p>
                  </div>
                </div>
                <button
                  onClick={() => handleConfigureAPI('Custom')}
                  className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-teal-600/20 text-teal-400 border border-teal-500/30 hover:bg-teal-600/30 hover:border-teal-500/50 transition-all"
                >
                  Set Up Endpoint
                </button>
              </div>
            </div>
          </div>

          {/* Info Card */}
          <div className="glass-panel p-6 bg-teal-500/5 border border-teal-500/20 backdrop-blur-md">
            <h3 className="font-semibold text-teal-400 mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Why Connect?
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-teal-400 mt-0.5">•</span>
                <span>Sync data automatically between tools</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-teal-400 mt-0.5">•</span>
                <span>Bring your own API keys for cost control</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-teal-400 mt-0.5">•</span>
                <span>Keep sensitive data in your infrastructure</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-teal-400 mt-0.5">•</span>
                <span>Extend workflows with custom integrations</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Connections
