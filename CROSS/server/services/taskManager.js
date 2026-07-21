const activeTasks = new Map()

function abortError() {
  return new DOMException('Aborted', 'AbortError')
}

export function startAgentTask({ sessionId, requestId, basePlanRevision = 0, externalSignal }) {
  const key = sessionId || 'anonymous'
  const previous = activeTasks.get(key)
  if (previous && previous.requestId !== requestId) previous.controller.abort()

  const controller = new AbortController()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', () => controller.abort(), { once: true })

  const task = {
    taskId: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    requestId: requestId || `request-${Date.now()}`,
    status: 'running',
    basePlanRevision: Number(basePlanRevision) || 0,
    controller
  }
  activeTasks.set(key, task)
  return { key, task, signal: controller.signal }
}

export function finishAgentTask(key, task, status) {
  if (task.controller.signal.aborted && status !== 'cancelled') throw abortError()
  task.status = status
  if (activeTasks.get(key) === task) activeTasks.delete(key)
  return {
    taskId: task.taskId,
    requestId: task.requestId,
    status: task.status,
    basePlanRevision: task.basePlanRevision
  }
}

export function clearAgentTasksForTests() {
  for (const task of activeTasks.values()) task.controller.abort()
  activeTasks.clear()
}
