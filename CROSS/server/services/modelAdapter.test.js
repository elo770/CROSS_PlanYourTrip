import test from 'node:test'
import assert from 'node:assert/strict'
import { DeepSeekAdapter } from './modelAdapter.js'

test('reads environment configuration when complete is called', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY
  const originalFetch = globalThis.fetch
  delete process.env.DEEPSEEK_API_KEY
  const adapter = new DeepSeekAdapter()

  try {
    process.env.DEEPSEEK_API_KEY = 'late-loaded-key'
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer late-loaded-key')
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const result = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(result.message.content, 'ok')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
})
