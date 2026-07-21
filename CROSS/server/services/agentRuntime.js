import { finishAgentTask, startAgentTask } from './taskManager.js'

function intentForDecision(decision, sourceMode) {
  if (decision === 'answer_only') return 'answer'
  if (decision === 'modify_plan') return 'modify_plan'
  return sourceMode === 'import' ? 'import_plan' : 'create_plan'
}

function missingFields(constraints = {}) {
  const missing = []
  if (!constraints.city) missing.push('city')
  if (!Number(constraints.days)) missing.push('days')
  return missing.length ? missing : ['clarification']
}

export class AgentRuntime {
  constructor(execute) {
    this.execute = execute
  }

  async run(body, emit = () => {}, externalSignal) {
    const pendingTask = body?.pendingTask
    const originalMessage = pendingTask?.originalMessage || body?.message || ''
    const mergedMessage = pendingTask
      ? `${pendingTask.originalMessage}\n补充信息：${body?.message || ''}`
      : body?.message || ''
    const { key, task, signal } = startAgentTask({
      sessionId: body?.sessionId,
      requestId: body?.requestId,
      basePlanRevision: body?.planRevision,
      externalSignal
    })

    try {
      const result = await this.execute({ ...body, message: mergedMessage }, emit, signal)
      const waiting = result.decision === 'ask_clarification'
      const taskState = finishAgentTask(key, task, waiting ? 'waiting_for_input' : 'completed')
      return {
        ...result,
        task: taskState,
        pendingTask: waiting ? {
          taskId: task.taskId,
          originalMessage,
          intent: intentForDecision(result.decision, result.sourceMode),
          missingFields: missingFields(result.constraints),
          basePlanRevision: task.basePlanRevision,
          createdAt: pendingTask?.createdAt || new Date().toISOString()
        } : null
      }
    } catch (error) {
      finishAgentTask(key, task, signal.aborted ? 'cancelled' : 'failed')
      throw error
    }
  }
}
