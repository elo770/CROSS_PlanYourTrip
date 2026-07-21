import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentRuntime } from './agentRuntime.js'
import { clearAgentTasksForTests } from './taskManager.js'

test.afterEach(() => clearAgentTasksForTests())

test('clarification preserves the original task and resumes it with the next answer', async () => {
  const received = []
  const runtime = new AgentRuntime(async (body) => {
    received.push(body.message)
    if (received.length === 1) {
      return { decision: 'ask_clarification', sourceMode: 'import', constraints: { city: '', days: 4 }, reply: '还需要城市。' }
    }
    return { decision: 'create_plan', sourceMode: 'import', constraints: { city: '南京', days: 4 }, reply: '已继续导入。' }
  })

  const first = await runtime.run({ sessionId: 's1', requestId: 'r1', message: '第一天：中山陵\n第四天：返程', planRevision: 2 })
  assert.equal(first.task.status, 'waiting_for_input')
  assert.equal(first.pendingTask.originalMessage, '第一天：中山陵\n第四天：返程')
  assert.deepEqual(first.pendingTask.missingFields, ['city'])

  const second = await runtime.run({ sessionId: 's1', requestId: 'r2', message: '我想去南京', pendingTask: first.pendingTask, planRevision: 2 })
  assert.match(received[1], /第一天：中山陵/)
  assert.match(received[1], /补充信息：我想去南京/)
  assert.equal(second.pendingTask, null)
  assert.equal(second.task.status, 'completed')
})

test('a newer request cancels the active task for the same session', async () => {
  let firstSignal
  const runtime = new AgentRuntime((body, emit, signal) => {
    if (body.requestId === 'old') {
      firstSignal = signal
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    }
    return Promise.resolve({ decision: 'answer_only', sourceMode: 'generate', constraints: { city: '南京', days: 2 }, reply: '新的任务' })
  })

  const oldTask = runtime.run({ sessionId: 's1', requestId: 'old', message: '旧任务' })
  const newTask = await runtime.run({ sessionId: 's1', requestId: 'new', message: '新任务' })
  await assert.rejects(oldTask, { name: 'AbortError' })
  assert.equal(firstSignal.aborted, true)
  assert.equal(newTask.task.status, 'completed')
})
