import express from 'express'
import { AgentHarness } from '../services/agentHarness.js'
import { RunRepository } from '../services/runRepository.js'
import { runAgentChat } from './agent.js'
import { runTravelGraph } from '../services/travelGraph.js'

function writeEvent(res, event) {
  res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

function isTerminalEvent(event) {
  return ['proposal.ready', 'run.completed', 'run.failed', 'run.cancelled'].includes(event.type)
}

export default function agentV2Routes(pool = null) {
  const router = express.Router()
  const repository = new RunRepository(pool)
  const useLegacy = process.env.CROSS_AGENT_RUNTIME === 'legacy'
  const execute = useLegacy ? runAgentChat : runTravelGraph
  const harness = new AgentHarness({ repository, execute, useLegacy })

  router.post('/runs', async (req, res) => {
    if (!process.env.DEEPSEEK_API_KEY) return res.status(503).json({ error: '服务端未配置 AI 模型。', code: 'MODEL_NOT_CONFIGURED' })
    try {
      const run = await harness.create({ body: req.body || {}, ownerSession: req.ownerSession })
      res.status(202).json({ runId: run.id, status: run.status })
    } catch (error) {
      console.error('Failed to create agent run:', error)
      res.status(500).json({ error: '无法创建Agent任务。', code: 'RUN_CREATE_FAILED' })
    }
  })

  router.get('/runs/:id', async (req, res) => {
    const run = await repository.getRun(req.params.id, req.ownerSession)
    if (!run) return res.status(404).json({ error: '未找到本次Agent运行。' })
    res.json(run)
  })

  router.get('/runs/:id/events', async (req, res) => {
    const run = await repository.getRun(req.params.id, req.ownerSession)
    if (!run) return res.status(404).json({ error: '未找到本次Agent运行。' })
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
    const events = await repository.getEvents(run.id)
    let lastSeq = 0
    const writeNewEvent = (event) => {
      if (event.seq <= lastSeq) return
      lastSeq = event.seq
      writeEvent(res, event)
    }
    events.forEach(writeNewEvent)
    if (events.some(isTerminalEvent)) return res.end()
    let unsubscribe = () => {}
    const finish = () => { unsubscribe(); if (!res.writableEnded) res.end() }
    unsubscribe = harness.subscribe(run.id, (event) => {
      writeNewEvent(event)
      if (isTerminalEvent(event)) finish()
    })
    const eventsAfterSubscribe = await repository.getEvents(run.id)
    eventsAfterSubscribe.forEach(writeNewEvent)
    if (eventsAfterSubscribe.some(isTerminalEvent)) return finish()
    res.on('close', unsubscribe)
  })

  router.post('/proposals/:id/confirm', async (req, res) => {
    const proposal = await repository.getProposal(req.params.id, req.ownerSession)
    if (!proposal) return res.status(404).json({ error: '未找到修改提案。' })
    const expected = Number(req.body?.expectedRevision)
    if (Number.isInteger(expected) && expected !== proposal.baseRevision) {
      proposal.status = 'stale'; await repository.updateProposal(proposal)
      return res.status(409).json({ error: '当前行程已经变化，请重新生成提案。', status: 'stale' })
    }
    const applied = await harness.confirm(proposal, req.ownerSession)
    if (applied.status === 'stale') return res.status(409).json({ error: '当前行程已经变化，请重新生成提案。', status: 'stale' })
    res.json({ status: applied.status, proposalId: applied.id, plan: applied.candidatePlan, trip: applied.appliedTrip || applied.candidateTrip })
  })

  router.post('/proposals/:id/reject', async (req, res) => {
    const proposal = await repository.getProposal(req.params.id, req.ownerSession)
    if (!proposal) return res.status(404).json({ error: '未找到修改提案。' })
    const rejected = await harness.reject(proposal, req.ownerSession)
    res.json({ status: rejected.status, proposalId: rejected.id })
  })

  return router
}
