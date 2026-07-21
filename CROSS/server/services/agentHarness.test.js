import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentHarness } from './agentHarness.js'
import { RunRepository } from './runRepository.js'

async function waitForTerminal(repository, id, owner) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const run = await repository.getRun(id, owner)
    if (['completed', 'proposal_ready', 'failed', 'waiting_input'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('run did not finish')
}

test('a plan result becomes a proposal and does not expose a plan before confirmation', async () => {
  const repository = new RunRepository()
  const execute = async () => ({
    decision: 'create_plan', reply: '草案完成', operations: [{ type: 'create_plan' }], changes: [{ type: 'create_plan', message: '生成南京两日' }], warnings: [], constraints: { city: '南京', days: 2 },
    plan: { route: { id: 'generated', name: '南京两日', estimatedDays: 2, totalDistance: 0, destinations: [] }, schedule: [], warnings: [] }
  })
  const harness = new AgentHarness({ repository, execute })
  const created = await harness.create({ ownerSession: 'owner-123456789012', body: { sessionId: 's1', tripId: 'trip-1', planRevision: 0, message: '规划南京两日' } })
  const run = await waitForTerminal(repository, created.id, 'owner-123456789012')
  assert.equal(run.status, 'proposal_ready')
  assert.equal(run.result.plan, undefined)
  assert.equal(run.result.proposal.status, 'pending')
  assert.deepEqual(run.result.suggestions.map((item) => item.action), ['focus_draft_map', 'send_message', 'confirm_proposal'])
  const proposal = await repository.getProposal(run.result.proposal.id, 'owner-123456789012')
  assert.equal(proposal.candidateTrip.id, 'trip-1')
})

test('answer results complete without creating a proposal', async () => {
  const repository = new RunRepository()
  const harness = new AgentHarness({ repository, execute: async () => ({ decision: 'answer_only', reply: '回答', operations: [], changes: [], warnings: [] }) })
  const created = await harness.create({ ownerSession: 'owner-123456789012', body: { sessionId: 's2', message: '值得去吗？' } })
  const run = await waitForTerminal(repository, created.id, 'owner-123456789012')
  assert.equal(run.status, 'completed')
  assert.equal(run.result.reply, '回答')
})
