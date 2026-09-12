import test from 'node:test'
import assert from 'node:assert/strict'
import { MemorySaver } from '@langchain/langgraph'
import { createTravelGraph } from './travelGraph.js'
import { extractConstraints, normalizeInput } from '../routes/agent.js'

const plan = {
  route: {
    id: 'route-1', name: '南京四日', estimatedDays: 4, destinations: [
      { id: 'a', name: 'A', day: 1, withinDayOrder: 1, coordinates: [118.0, 32.0], planningStatus: 'scheduled' },
      { id: 'c', name: 'C', day: 1, withinDayOrder: 2, coordinates: [118.2, 32.0], planningStatus: 'scheduled' },
      { id: 'b', name: 'B', day: 1, withinDayOrder: 3, coordinates: [118.1, 32.0], planningStatus: 'scheduled' }
    ]
  }, schedule: [], warnings: []
}

function fakeAdapter(responses) {
  return { complete: async () => ({ message: { content: responses.shift() || '{}' }, usage: {} }) }
}

async function invoke(responses, message, { currentPlan = plan, trip, constraints = { city: '南京', days: 4 } } = {}) {
  const graph = createTravelGraph({ adapter: fakeAdapter(responses), checkpointer: new MemorySaver() })
  return graph.invoke(
    { body: { sessionId: `test-${Math.random()}`, message, constraints, currentPlan, trip, destinations: [] } },
    { configurable: { thread_id: `thread-${Math.random()}` } }
  )
}

test('real failure: a complete request keeps city, days and must-go places when extraction is empty', async () => {
  const normalized = normalizeInput({ message: '我想在北京玩两天，必去地坛、故宫，其余你帮我安排', constraints: {} })
  const extracted = await extractConstraints(normalized, undefined, () => {}, fakeAdapter([JSON.stringify({})]))
  assert.equal(extracted.city, '北京')
  assert.equal(extracted.days, 2)
  assert.deepEqual(extracted.poiNames, ['地坛', '故宫'])
})

test('real failure: correcting the assistant never creates a plan change', async () => {
  const state = await invoke([
    JSON.stringify({ city: '南京', days: 4 }),
    JSON.stringify({ action: 'correction' })
  ], '你识别错了')
  assert.equal(state.result.decision, 'answer_only')
  assert.equal(state.result.plan, undefined)
  assert.equal(state.result.trip, undefined)
  assert.match(state.result.reply, /不会修改行程/)
})

test('real failure: “先别改” stays an answer and creates no proposal candidate', async () => {
  const state = await invoke([
    JSON.stringify({ city: '南京', days: 4 }),
    JSON.stringify({ action: 'question' }),
    '好的，我先只解释，不改行程。'
  ], '先别改，我只是问问')
  assert.equal(state.result.decision, 'answer_only')
  assert.equal(state.result.plan, undefined)
  assert.equal(state.result.trip, undefined)
})

test('real failure: “第二天这样赶吗” is analysis, not a modification', async () => {
  const state = await invoke([
    JSON.stringify({ city: '南京', days: 4 }),
    JSON.stringify({ action: 'analyze' }),
    '第二天的地点较多，建议保留一段休息时间。'
  ], '第二天这样赶吗？')
  assert.equal(state.result.decision, 'answer_only')
  assert.equal(state.result.plan, undefined)
})

test('a missing operation becomes a normal explanation instead of a failure', async () => {
  const state = await invoke([
    JSON.stringify({ city: '南京', days: 4 }),
    JSON.stringify({ action: 'modify', explicitChange: true }),
    JSON.stringify({ clarification: '你想改哪一天？', operations: [] })
  ], '调整一下')
  assert.equal(state.result.decision, 'answer_only')
  assert.equal(state.result.plan, undefined)
  assert.match(state.result.reply, /你想改哪一天/)
})

test('distance ordering is a model-selected operation, not a keyword route', async () => {
  const state = await invoke([
    JSON.stringify({ city: '南京', days: 4 }),
    JSON.stringify({ action: 'modify', explicitChange: true }),
    JSON.stringify({ reply: '我会按当天地点距离调整顺序。', operations: [{ type: 'optimize_route_order' }] })
  ], '按地点距离优化第二天')
  assert.equal(state.result.decision, 'modify_plan')
  assert.deepEqual(state.result.operations, [{ type: 'optimize_route_order' }])
  assert.ok(state.result.plan)
})

test('a city-stay change is a proposal candidate and shifts later dates', async () => {
  const trip = {
    id: 'trip-1', revision: 2, startDate: '2026-08-01', totalDays: 8,
    segments: [
      { id: 'beijing', city: '北京', order: 1, days: 3, startDate: '2026-08-01', endDate: '2026-08-03' },
      { id: 'chengdu', city: '成都', order: 2, days: 2, startDate: '2026-08-04', endDate: '2026-08-05' },
      { id: 'kunming', city: '昆明', order: 3, days: 3, startDate: '2026-08-06', endDate: '2026-08-08' }
    ]
  }
  const state = await invoke([
    JSON.stringify({ city: '成都', days: 2 }),
    JSON.stringify({ action: 'modify', explicitChange: true }),
    JSON.stringify({ reply: '已准备好草案。', operations: [{ type: 'change_segment_days', city: '成都', days: 4 }] })
  ], '成都多住两天', { currentPlan: null, trip, constraints: { city: '成都', days: 2 } })
  assert.equal(state.result.decision, 'modify_plan')
  assert.equal(state.result.trip.totalDays, 10)
  assert.equal(state.result.trip.segments[2].startDate, '2026-08-08')
})

test('candidate selection stays outside the map and itinerary until generation is confirmed', async () => {
  const candidate = { id: 'food-1', name: '扬州早茶店', address: '扬州市广陵区', city: '扬州', coordinates: [119.43, 32.39] }
  const mustGo = { id: 'spot-1', name: '个园', address: '扬州市广陵区', city: '扬州', coordinates: [119.44, 32.40], poiStatus: 'must_go', locked: true }
  const graph = createTravelGraph({ adapter: fakeAdapter([JSON.stringify({}), JSON.stringify({ action: 'supplement' }), JSON.stringify({}), JSON.stringify({ action: 'create' })]), checkpointer: new MemorySaver() })
  const thread = `thread-${Math.random()}`
  const selected = await graph.invoke({
    body: {
      message: '我想选这家',
      constraints: { city: '扬州', days: 2, pace: '适中', interests: ['美食', '经典景点'] },
      interaction: { type: 'select_candidates', candidateSetId: 'food-set', selectedIds: ['food-1'] },
      conversationState: {
        task: { state: 'awaiting_candidate_selection', mode: 'create' },
        draft: { constraints: { city: '扬州', days: 2, pace: '适中', interests: ['美食'] }, requestedPoiNames: ['个园'], verifiedPois: [mustGo], unresolvedPois: [], pendingCandidates: [], candidateSet: { id: 'food-set', status: 'awaiting_selection', candidates: [candidate], selectedIds: [] }, selectedCandidateIds: [], candidateQuery: '扬州早茶', generationConfirmed: false, plan: null, trip: null, evidence: [] }
      }
    }
  }, { configurable: { thread_id: thread } })
  assert.equal(selected.result.decision, 'ready_to_generate')
  assert.equal(selected.result.plan, undefined)
  assert.equal(selected.result.generationConfirmation.selectedPlaces.length, 2)

  const generated = await graph.invoke({
    body: {
      message: '开始生成草案',
      constraints: { city: '扬州', days: 2, pace: '适中' },
      interaction: { type: 'confirm_generation' }
    }
  }, { configurable: { thread_id: thread } })
  assert.equal(generated.result.decision, 'create_plan')
  assert.equal(generated.result.draftPlan.route.destinations.some((item) => item.id === 'food-1'), true)
  assert.equal(generated.result.draftPlan.route.destinations.some((item) => item.id === 'spot-1'), true)
})

test('real failure: a pending POI accepts its full name and resumes the original draft', async () => {
  const zoo = { id: 'zoo-1', name: '红山森林动物园', city: '南京', coordinates: [118.8, 32.1] }
  const graph = createTravelGraph({
    adapter: fakeAdapter([JSON.stringify({}), JSON.stringify({ action: 'correction' })]),
    checkpointer: new MemorySaver()
  })
  const state = await graph.invoke({
    body: {
      sessionId: `test-${Math.random()}`,
      message: '红山森林动物园',
      constraints: { city: '南京', days: 4 },
      conversationState: {
        task: { state: 'resolving_places', mode: 'create' },
        draft: {
          ...{
            constraints: { city: '南京', days: 4, pace: '适中' },
            requestedPoiNames: ['红山动物园'],
            verifiedPois: [], unresolvedPois: [], pendingCandidates: [zoo],
            pendingCandidateQuery: '红山动物园', candidateSet: null,
            selectedCandidateIds: [], selectedPois: [], candidateQuery: '', generationConfirmed: false,
            plan: null, trip: null, evidence: []
          }
        }
      }
    }
  }, { configurable: { thread_id: `thread-${Math.random()}` } })

  assert.equal(state.result.decision, 'ready_to_generate')
  assert.equal(state.draft.verifiedPois[0].name, '红山森林动物园')
  assert.deepEqual(state.draft.requestedPoiNames, ['红山森林动物园'])
  assert.equal(state.draft.pendingCandidates.length, 0)
})

test('real failure: a numbered pending POI choice accepts "1.地点名"', async () => {
  const zoo = { id: 'zoo-1', name: '红山森林动物园', city: '南京', coordinates: [118.8, 32.1] }
  const graph = createTravelGraph({
    adapter: fakeAdapter([JSON.stringify({}), JSON.stringify({ action: 'chat' })]),
    checkpointer: new MemorySaver()
  })
  const state = await graph.invoke({
    body: {
      sessionId: `test-${Math.random()}`,
      message: '1.红山森林动物园',
      constraints: { city: '南京', days: 4 },
      conversationState: {
        task: { state: 'resolving_places', mode: 'create' },
        draft: {
          constraints: { city: '南京', days: 4, pace: '适中' },
          requestedPoiNames: ['红山动物园'],
          verifiedPois: [], unresolvedPois: [], pendingCandidates: [zoo],
          pendingCandidateQuery: '红山动物园', candidateSet: null,
          selectedCandidateIds: [], selectedPois: [], candidateQuery: '', generationConfirmed: false,
          plan: null, trip: null, evidence: []
        }
      }
    }
  }, { configurable: { thread_id: `thread-${Math.random()}` } })

  assert.equal(state.result.decision, 'ready_to_generate')
  assert.equal(state.draft.verifiedPois[0].id, 'zoo-1')
})
