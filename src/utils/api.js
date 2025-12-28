import client from '../api/client'

// --- AUTHENTICATION ---

export const signup = async (email, password, name) => {
  const { data } = await client.post('/api/auth/signup', { email, password, name })
  return data
}

export const login = async (email, password) => {
  const { data } = await client.post('/api/auth/login', { email, password })
  return data
}

export const logout = async () => {
  const { data } = await client.post('/api/auth/logout')
  return data
}

export const getCurrentUser = async () => {
  const { data } = await client.get('/api/auth/me')
  return data
}

export const completeOnboarding = async () => {
  const { data } = await client.post('/api/auth/complete-onboarding')
  return data
}


// --- LEADS & CRM ---

export const fetchLeads = async (params = {}) => {
  const query = new URLSearchParams(params).toString()
  const { data } = await client.get(`/api/leads?${query}`)
  return data
}

export const approveLead = async (id, reason) => {
  const { data } = await client.post(`/api/leads/${id}/approve`, { reason })
  return data
}

export const createLeads = async (leads) => {
  const { data } = await client.post('/api/leads', { leads })
  return data
}

export const deleteLead = async (id) => {
  const { data } = await client.delete(`/api/leads/${id}`)
  return data
}

export const clearLeads = async () => {
  const { data } = await client.post('/api/leads/clear')
  return data
}

export const enrichLead = async (id) => {
  const { data } = await client.post(`/api/leads/${id}/enrich-phone`)
  return data
}

// --- WORKFLOWS ---

export const startWorkflow = async (prompt, agentConfigs) => {
  const { data } = await client.post('/api/runs/start-workflow', { prompt, agentConfigs })
  return data
}

export const fetchRuns = async () => {
  const { data } = await client.get('/api/runs')
  return data
}

export const startRun = async (agentId, metadata) => {
  const { data } = await client.post('/api/runs/start', { agent_id: agentId, metadata })
  return data.run_id
}

export const completeRun = async (runId, outputData) => {
  const { data } = await client.post('/api/runs/complete', { run_id: runId, output_data: outputData })
  return data
}

export const failRun = async (runId, error) => {
  const { data } = await client.post('/api/runs/fail', { run_id: runId, error })
  return data
}

// --- CONFIGURATION ---

export const fetchCrmColumns = async () => {
  const { data } = await client.get('/api/crm-columns')
  return data
}

export const saveCrmColumns = async (columns) => {
  const { data } = await client.post('/api/crm-columns', { columns })
  return data
}

// --- Prompts ---
export const fetchAgentPrompts = async () => {
  const { data } = await client.get('/api/agent-prompts')
  return data
}

export const saveAgentPrompts = async (prompts) => {
  const { data } = await client.post('/api/agent-prompts', { prompts })
  return data
}

export const optimizeAgentPrompt = async (agentName, inputs, baseTemplate) => {
  const { data } = await client.post('/api/optimize-prompt', { agentName, inputs, baseTemplate })
  return data.prompt
}

export const createInternalKnowledgeBase = async (answers) => {
  const { data } = await client.post('/api/knowledge/create-internal', { answers })
  return data
}

// --- LEGACY / UTILS ---

export const fetchHealth = async () => {
  const { data } = await client.get('/api/health')
  return data
}

