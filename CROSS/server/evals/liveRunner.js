import dotenv from 'dotenv'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROMPT_VERSION, getPromptSet } from '../prompts/registry.js'
import { liveCases } from './liveCases.js'

const evalDir = dirname(fileURLToPath(import.meta.url))
const serverDir = resolve(evalDir, '..')
dotenv.config({ path: resolve(serverDir, '../.env') })
dotenv.config({ path: resolve(serverDir, '.env'), override: true })

const versionArg = process.argv.find((item) => item.startsWith('--version='))?.split('=')[1]
const promptVersion = getPromptSet(versionArg || DEFAULT_PROMPT_VERSION).version
const limitArg = Number(process.argv.find((item) => item.startsWith('--limit='))?.split('=')[1])
const cases = Number.isInteger(limitArg) && limitArg > 0 ? liveCases.slice(0, limitArg) : liveCases
const apiBase = process.env.EVAL_API_BASE_URL || 'http://127.0.0.1:3001/api'

function matchesExpected(payload, expected) {
  const checks = []
  if (expected.city !== undefined) checks.push(payload.city === expected.city)
  if (expected.days !== undefined) checks.push(Number(payload.days) === expected.days)
  if (expected.decision !== undefined) checks.push(payload.decision === expected.decision)
  if (expected.planDays !== undefined) checks.push(Number(payload.plan?.route?.estimatedDays) === expected.planDays)
  if (expected.relations) {
    const items = Array.isArray(payload.itineraryItems) ? payload.itineraryItems : []
    checks.push(expected.relations.every(([name, day]) => items.some((item) => item.name.includes(name) && Number(item.day) === day)))
  }
  if (expected.types) {
    const items = Array.isArray(payload.itineraryItems) ? payload.itineraryItems : []
    checks.push(expected.types.every(([name, type]) => items.some((item) => item.name.includes(name) && item.type === type)))
  }
  return checks.length > 0 && checks.every(Boolean)
}

async function runExtraction(testCase) {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is not configured')
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      messages: [{ role: 'system', content: getPromptSet(promptVersion).extractionSystem }, { role: 'user', content: testCase.message }],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      temperature: 0.1,
      max_tokens: 1200
    })
  })
  if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${(await response.text()).slice(0, 160)}`)
  const data = await response.json()
  return { payload: JSON.parse(data.choices?.[0]?.message?.content || '{}'), usage: data.usage || null }
}

async function runAgent(testCase) {
  const response = await fetch(`${apiBase}/agent/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: `eval-${testCase.id}`, promptVersion, message: testCase.message, recentMessages: [], constraints: { pacePreference: '', ...testCase.constraints }, currentPlan: null, destinations: [] })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Agent ${response.status}`)
  return { payload, usage: null }
}

const results = []
for (const testCase of cases) {
  const startedAt = Date.now()
  try {
    const { payload, usage } = testCase.mode === 'extraction' ? await runExtraction(testCase) : await runAgent(testCase)
    results.push({ id: testCase.id, mode: testCase.mode, passed: matchesExpected(payload, testCase.expected), latencyMs: Date.now() - startedAt, expected: testCase.expected, payload, usage })
  } catch (error) {
    results.push({ id: testCase.id, mode: testCase.mode, passed: false, latencyMs: Date.now() - startedAt, expected: testCase.expected, error: error instanceof Error ? error.message : String(error) })
  }
}

const report = {
  generatedAt: new Date().toISOString(), mode: 'live', promptVersion,
  total: results.length, passed: results.filter((item) => item.passed).length,
  rate: results.filter((item) => item.passed).length / results.length,
  latencyMs: { average: Math.round(results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length), maximum: Math.max(...results.map((item) => item.latencyMs)) },
  results
}
const reportDir = resolve(evalDir, 'reports')
await mkdir(reportDir, { recursive: true })
await writeFile(resolve(reportDir, `live-${promptVersion}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(resolve(reportDir, `live-${promptVersion}.md`), [
  `# CROSS Live Eval: ${promptVersion}`, '',
  `- Generated: ${report.generatedAt}`,
  `- Result: ${report.passed}/${report.total} (${(report.rate * 100).toFixed(1)}%)`,
  `- Average latency: ${report.latencyMs.average} ms`,
  `- Maximum latency: ${report.latencyMs.maximum} ms`, '',
  '## Cases', '',
  ...results.map((item) => `- ${item.passed ? 'PASS' : 'FAIL'} ${item.id}: ${item.latencyMs} ms${item.error ? ` — ${item.error}` : ''}`), '',
  '> Live results depend on the configured model, external services and execution date. They are not production user metrics.', ''
].join('\n'), 'utf8')
console.log(`Live eval ${promptVersion}: ${report.passed}/${report.total} passed`)
if (report.passed !== report.total) process.exitCode = 1
