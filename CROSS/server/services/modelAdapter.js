const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

export class ModelError extends Error {
  constructor(code, message, retryable = false) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

function mapStatus(status) {
  if (status === 429) return new ModelError('MODEL_RATE_LIMITED', 'AI 服务当前较忙，请稍后重试。', true)
  if (status >= 500) return new ModelError('MODEL_UNAVAILABLE', 'AI 服务暂时不可用，请稍后重试。', true)
  if (status === 401 || status === 403) return new ModelError('MODEL_AUTH_FAILED', 'AI 服务配置无效。')
  return new ModelError('MODEL_REQUEST_FAILED', 'AI 服务未能处理本次请求。')
}

export class DeepSeekAdapter {
  constructor({ apiKey, model } = {}) {
    this.apiKey = apiKey
    this.model = model
  }

  async complete({ messages, tools, toolChoice = 'auto', maxTokens = 1000, temperature = 0.1, responseFormat, signal }) {
    const apiKey = this.apiKey ?? process.env.DEEPSEEK_API_KEY
    const model = this.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'
    if (!apiKey) throw new ModelError('MODEL_NOT_CONFIGURED', '服务端未配置 AI 模型。')
    let lastError
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(DEEPSEEK_URL, {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model, messages, tools, tool_choice: tools?.length ? toolChoice : undefined,
            response_format: responseFormat, thinking: { type: 'disabled' }, temperature, max_tokens: maxTokens
          })
        })
        if (!response.ok) throw mapStatus(response.status)
        const data = await response.json()
        return { message: data.choices?.[0]?.message || {}, usage: data.usage || {} }
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error instanceof ModelError ? error : new ModelError('MODEL_NETWORK_ERROR', '无法连接 AI 服务。', true)
        if (!lastError.retryable || attempt === 1) throw lastError
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
      }
    }
    throw lastError
  }
}
