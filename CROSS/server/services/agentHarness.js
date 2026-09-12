import crypto from 'node:crypto'
import { buildAgentContext } from './contextBuilder.js'
import { normalizeTrip } from './tripModel.js'
import { parseLongTripDays, planTripOutline } from './outlinePlanner.js'

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'stale', 'proposal_ready', 'waiting_input'])

function draftSuggestions(proposalId) {
  return [
    { id: 'focus-draft-map', label: '查看草案地图', action: 'focus_draft_map' },
    { id: 'relax-draft', label: '把草案安排得轻松一点', action: 'send_message', message: '把这份草案安排得轻松一点' },
    { id: 'save-draft', label: '保存到我的行程', action: 'confirm_proposal', proposalId }
  ]
}

export class AgentHarness {
  constructor({ repository, execute, useLegacy = false }) {
    this.repository = repository
    this.execute = execute
    this.useLegacy = useLegacy
    this.listeners = new Map()
    this.controllers = new Map()
  }

  async emit(run, type, payload = {}) {
    const event = await this.repository.addEvent(run, { type, status: run.status, payload })
    for (const listener of this.listeners.get(run.id) || []) listener(event)
    return event
  }

  subscribe(runId, listener) {
    const listeners = this.listeners.get(runId) || new Set()
    listeners.add(listener); this.listeners.set(runId, listeners)
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(runId) }
  }

  async create({ body, ownerSession }) {
    const run = {
      id: crypto.randomUUID(), sessionId: String(body.sessionId || crypto.randomUUID()), ownerSession,
      tripId: body.tripId || body.trip?.id || body.currentPlan?.route?.id || null,
      baseRevision: Number(body.planRevision ?? body.trip?.revision) || 0,
      status: 'accepted', intent: null, workingMemory: buildAgentContext({ body }).workingMemory,
      usage: { modelCalls: 0, toolCalls: 0 }, result: null, createdAt: new Date().toISOString()
    }
    await this.repository.createRun(run)
    await this.emit(run, 'run.accepted', { runId: run.id })
    const controller = new AbortController()
    this.controllers.set(run.id, controller)
    void this.process(run, body, controller.signal)
    return run
  }

  async process(run, body, signal) {
    try {
      run.status = 'understanding'; await this.repository.updateRun(run); await this.emit(run, 'run.status', { label: '正在理解你的要求' })
      const detailSegment = Array.isArray(body.trip?.segments) && /详细规划|细化|详细安排/.test(body.message || '')
        ? body.trip.segments.find((segment) => String(body.message).includes(segment.city))
        : null
      if (detailSegment) {
        run.status = 'researching'; await this.repository.updateRun(run); await this.emit(run, 'run.status', { label: `正在细化${detailSegment.city}段` })
        const detailResult = await this.execute({
          ...body, currentPlan: null, destinations: detailSegment.destinations || [],
          constraints: { ...(body.constraints || {}), city: detailSegment.city, days: Math.min(Number(detailSegment.days) || 1, 14) },
          message: `请详细规划${detailSegment.city}${Math.min(Number(detailSegment.days) || 1, 14)}天行程。${body.message}`
        }, (activity) => { void this.emit(run, 'run.activity', activity) }, signal)
        if (!detailResult.plan) throw new Error('没有生成可确认的城市段详细计划。')
        const candidateTrip = structuredClone(body.trip)
        const target = candidateTrip.segments.find((segment) => segment.id === detailSegment.id)
        target.status = 'detailed'; target.destinations = detailResult.plan.route.destinations; target.schedule = detailResult.plan.schedule
        const proposal = {
          id: crypto.randomUUID(), runId: run.id, tripId: candidateTrip.id, ownerSession: run.ownerSession,
          baseRevision: Number(candidateTrip.revision) || 0, summary: `细化${detailSegment.city}${detailSegment.days}天行程`,
          affectedSegmentIds: [detailSegment.id], operations: [{ type: 'detail_segment', segmentId: detailSegment.id }], status: 'pending',
          candidatePlan: detailResult.plan, candidateTrip, createdAt: new Date().toISOString()
        }
        await this.repository.createProposal(proposal)
        run.tripId = candidateTrip.id; run.baseRevision = proposal.baseRevision; run.intent = 'detail_segment'; run.status = 'proposal_ready'
        run.result = {
          ...detailResult,
          plan: undefined,
          draftPlan: detailResult.plan,
          draftTrip: candidateTrip,
          reply: `${detailSegment.city}段的详细草案已经准备好，确认后才会写入正式旅程。`,
          proposal: { id: proposal.id, summary: proposal.summary, operations: proposal.operations, baseRevision: proposal.baseRevision, status: 'pending', kind: 'change' },
          suggestions: draftSuggestions(proposal.id)
        }
        await this.repository.updateRun(run); await this.repository.appendMessage(run.sessionId, `${run.id}-assistant`, 'assistant', run.result.reply); await this.emit(run, 'proposal.ready', run.result)
        return
      }
      if (this.useLegacy && parseLongTripDays(body.message)) {
        run.status = 'researching'; await this.repository.updateRun(run); await this.emit(run, 'run.status', { label: '正在整理多城市旅行骨架' })
        const trip = await planTripOutline(body, signal)
        const proposal = {
          id: crypto.randomUUID(), runId: run.id, tripId: trip.id, ownerSession: run.ownerSession,
          baseRevision: 0, summary: `${trip.totalDays}天 · ${trip.segments.map((segment) => `${segment.city}${segment.days}天`).join(' → ')}`,
          affectedSegmentIds: trip.segments.map((segment) => segment.id), operations: [{ type: 'create_trip_outline' }],
          status: 'pending', candidateTrip: trip, createdAt: new Date().toISOString()
        }
        await this.repository.createProposal(proposal)
        run.tripId = trip.id; run.intent = 'outline_trip'; run.status = 'proposal_ready'
        run.result = {
          decision: 'create_plan', reply: '我先整理了一份城市骨架。确认后会保存为正式旅程，再逐段细化每天的安排。',
          operations: proposal.operations, changes: [], warnings: ['当前只规划城市顺序和停留天数，不包含真实城际班次与票价。'],
          proposal: { id: proposal.id, summary: proposal.summary, operations: proposal.operations, baseRevision: 0, status: 'pending', segments: trip.segments.map(({ city, days, reason }) => ({ city, days, reason })) }
        }
        await this.repository.updateRun(run); await this.repository.appendMessage(run.sessionId, `${run.id}-assistant`, 'assistant', run.result.reply); await this.emit(run, 'proposal.ready', run.result)
        return
      }
      const session = await this.repository.getSession(run.sessionId, run.ownerSession)
      const recentMessages = await this.repository.getRecentMessages(run.sessionId, 10)
      const result = await this.execute({
        ...body,
        sessionId: run.sessionId,
        recentMessages: recentMessages.length ? recentMessages : body.recentMessages,
        conversationState: session?.body?.conversationState || body.conversationState
      }, (activity) => { void this.emit(run, 'run.activity', activity) }, signal)
      if (result.conversationState) {
        await this.repository.saveSession({
          id: run.sessionId,
          ownerSession: run.ownerSession,
          tripId: run.tripId || session?.tripId || null,
          body: {
            ...(session?.body || {}),
            workingMemory: run.workingMemory,
            conversationState: result.conversationState
          }
        })
      }
      run.intent = result.intent || (result.decision === 'answer_only' ? 'answer' : result.decision === 'ask_clarification' ? 'clarify' : ['create_plan', 'outline_trip'].includes(result.decision) ? 'outline_trip' : 'propose_change')
      if (result.decision === 'ask_clarification') {
        run.status = 'waiting_input'; run.result = result
      } else if (result.trip) {
        const candidateTrip = result.trip
        const proposal = {
          id: crypto.randomUUID(), runId: run.id, tripId: candidateTrip.id, ownerSession: run.ownerSession,
          baseRevision: run.baseRevision,
          summary: `${candidateTrip.totalDays}天 · ${candidateTrip.segments.map((segment) => `${segment.city}${segment.days}天`).join(' → ')}`,
          affectedSegmentIds: candidateTrip.segments.map((segment) => segment.id), operations: result.operations || [{ type: 'create_trip_outline' }],
          status: 'pending', candidateTrip, createdAt: new Date().toISOString()
        }
        await this.repository.createProposal(proposal)
        run.tripId = candidateTrip.id; run.baseRevision = proposal.baseRevision; run.status = 'proposal_ready'
        run.result = {
          ...result, trip: undefined, draftTrip: result.draftTrip || candidateTrip,
          proposal: {
            id: proposal.id, summary: proposal.summary, operations: proposal.operations, baseRevision: proposal.baseRevision, status: proposal.status,
            kind: result.decision === 'outline_trip' ? 'create' : 'change',
            segments: candidateTrip.segments.map(({ city, days, reason }) => ({ city, days, reason }))
          },
          suggestions: draftSuggestions(proposal.id)
        }
      } else if (result.plan) {
        const candidateTrip = normalizeTrip({ route: result.plan.route, schedule: result.plan.schedule }, result.constraints)
        if (run.tripId) candidateTrip.id = run.tripId
        const proposal = {
          id: crypto.randomUUID(), runId: run.id, tripId: run.tripId, ownerSession: run.ownerSession,
          baseRevision: run.baseRevision, summary: result.changes?.map((item) => item.message).join('；') || '应用新的旅行计划',
          affectedSegmentIds: [], operations: result.operations || [], status: 'pending',
          candidatePlan: result.plan, candidateTrip,
          createdAt: new Date().toISOString()
        }
        await this.repository.createProposal(proposal)
        run.status = 'proposal_ready'
        run.result = {
          ...result,
          plan: undefined,
          draftPlan: result.draftPlan || result.plan,
          proposal: {
            id: proposal.id, summary: proposal.summary, operations: proposal.operations, baseRevision: proposal.baseRevision, status: proposal.status,
            kind: result.decision === 'create_plan' ? 'create' : 'change'
          },
          suggestions: draftSuggestions(proposal.id)
        }
      } else {
        run.status = 'completed'; run.result = result
      }
      await this.repository.updateRun(run)
      await this.repository.appendMessage(run.sessionId, `${run.id}-assistant`, 'assistant', run.result?.reply || run.result?.error || '')
      await this.emit(run, run.status === 'proposal_ready' ? 'proposal.ready' : 'run.completed', run.result)
    } catch (error) {
      run.status = signal.aborted ? 'cancelled' : 'failed'
      run.errorCode = error?.code || 'AGENT_RUN_FAILED'
      run.result = { error: error instanceof Error ? error.message : '本次处理失败。' }
      await this.repository.updateRun(run)
      await this.repository.appendMessage(run.sessionId, `${run.id}-assistant`, 'assistant', run.result.error)
      await this.emit(run, `run.${run.status}`, run.result)
    } finally {
      this.controllers.delete(run.id)
    }
  }

  async confirm(proposal, ownerSession) {
    if (proposal.ownerSession !== ownerSession) return null
    if (proposal.status !== 'pending') return proposal
    const trip = await this.repository.applyProposal(proposal)
    if (!trip) { proposal.status = 'stale'; await this.repository.updateProposal(proposal); return proposal }
    proposal.appliedTrip = trip
    proposal.status = 'applied'; proposal.appliedAt = new Date().toISOString()
    await this.repository.updateProposal(proposal)
    return proposal
  }

  async reject(proposal, ownerSession) {
    if (proposal.ownerSession !== ownerSession) return null
    if (proposal.status === 'pending') { proposal.status = 'rejected'; await this.repository.updateProposal(proposal) }
    return proposal
  }

  isTerminal(status) { return TERMINAL.has(status) }
}
