import crypto from 'node:crypto'
import { Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { DeepSeekAdapter } from './modelAdapter.js'
import { executeAgentTool } from './toolManager.js'
import { planTripOutline } from './outlinePlanner.js'
import { applyTripOperations } from './tripModel.js'
import {
  enrichOperations,
  extractConstraints,
  inferCityFromItinerary,
  normalizeInput,
  poiSummary,
  publicConstraints
} from '../routes/agent.js'

const MAX_MODEL_CALLS = 6
const runtimeContexts = new Map()
let defaultGraphPromise

const TravelState = Annotation.Root({
  body: Annotation(),
  input: Annotation(),
  task: Annotation(),
  draft: Annotation(),
  interpretation: Annotation(),
  toolEvidence: Annotation(),
  result: Annotation(),
  usage: Annotation()
})

function text(value, max = 1200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function parseJson(content) {
  try { return JSON.parse(content || '{}') } catch { return {} }
}

function runtime(config) {
  return runtimeContexts.get(config?.configurable?.runId) || { emit: () => {}, signal: undefined }
}

function emptyTask() {
  return { state: 'idle', mode: null, paceAsked: false, next: 'chat' }
}

function emptyDraft() {
  return {
    constraints: {},
    requestedPoiNames: [],
    verifiedPois: [],
    unresolvedPois: [],
    pendingCandidates: [],
    pendingCandidateQuery: '',
    candidateSet: null,
    selectedCandidateIds: [],
    selectedPois: [],
    candidateQuery: '',
    generationConfirmed: false,
    plan: null,
    trip: null,
    evidence: []
  }
}

function smartSuggestions({ decision, input, task, draft, proposalId } = {}) {
  if (!input?.city) {
    return [
      { id: 'city-example', label: '例如：我想去南京', action: 'send_message', message: '我想去南京' },
      { id: 'city-idea', label: '目的地还没定，给我推荐', action: 'send_message', message: '目的地还没确定，先给我建议' }
    ]
  }
  if (!input.days) {
    return [
      { id: 'days-2', label: `先按 ${input.city} 2 天安排`, action: 'send_message', message: `${input.city}玩 2 天` },
      { id: 'days-3', label: `先按 ${input.city} 3 天安排`, action: 'send_message', message: `${input.city}玩 3 天` }
    ]
  }
  if (proposalId || draft?.plan || draft?.trip || task?.state === 'draft_ready') {
    const suggestions = [
      { id: 'focus-draft-map', label: '查看草案地图', action: 'focus_draft_map' },
      { id: 'relax-draft', label: '把草案安排得轻松一点', action: 'send_message', message: '把这份草案安排得轻松一点' }
    ]
    if (proposalId) suggestions.unshift({ id: 'save-draft', label: '保存到我的行程', action: 'confirm_proposal', proposalId })
    return suggestions
  }
  if (decision === 'answer_only') return []
  return [{ id: 'create-default', label: `按适中节奏生成 ${input.city} ${input.days} 天游草案`, action: 'send_message', message: `按适中节奏生成${input.city}${input.days}天草案` }]
}

function buildDraftExplanation(draft, plan) {
  const destinations = plan?.route?.destinations || []
  const byDay = new Map()
  for (const place of destinations) {
    const day = Number(place.day) || 1
    const names = byDay.get(day) || []
    names.push(place.name)
    byDay.set(day, names)
  }
  const mustGoNames = draft.verifiedPois.filter((place) => place.poiStatus === 'must_go').map((place) => place.name)
  return {
    basis: [
      mustGoNames.length ? `必去点：${mustGoNames.join('、')}` : '未指定必去点，按地点候选生成',
      `节奏：${draft.constraints.pace || '适中'}`,
      '排序依据：按已核实地点坐标与每日地点数量安排，尽量减少跨区往返；不是实时道路导航。'
    ],
    days: [...byDay.entries()].sort(([left], [right]) => left - right).map(([day, places]) => ({
      day,
      places,
      reason: mustGoNames.some((name) => places.includes(name))
        ? '本日优先保留了你的必去地点，其余地点作为同日游览建议。'
        : '本日地点按草案节奏和坐标顺序补充，后续可按兴趣替换。'
    })),
    evidence: [
      ...draft.verifiedPois.map((place) => ({ type: 'amap_poi', label: `高德 POI：${place.name}` })),
      ...(draft.requestedPoiNames.length ? [{ type: 'user_input', label: `你的要求：${draft.requestedPoiNames.join('、')}` }] : []),
      { type: 'planning_judgement', label: '草案判断：每日地点数量与坐标顺序' }
    ]
  }
}

function baseResult(decision, input, reply, extra = {}) {
  const { suggestionContext, ...resultExtra } = extra
  return {
    decision,
    sourceMode: input.sourceMode,
    reply,
    operations: [],
    changes: [],
    warnings: [],
    constraints: publicConstraints(input),
    suggestions: smartSuggestions({ decision, input, ...suggestionContext }),
    ...resultExtra
  }
}

function uniqueStrings(items = []) {
  return [...new Set(items.map((item) => text(item, 80)).filter(Boolean))]
}

function mergeInput(body, draft) {
  return normalizeInput({
    ...body,
    constraints: { ...(draft?.constraints || {}), ...(body?.constraints || {}) }
  })
}

function mergeDraft(previous, input, interpretation) {
  const draft = structuredClone(previous || emptyDraft())
  draft.constraints = {
    ...draft.constraints,
    city: interpretation.city || input.city || draft.constraints.city,
    days: interpretation.days || input.days || draft.constraints.days,
    pace: interpretation.pace || input.pace || draft.constraints.pace,
    interests: uniqueStrings([
      ...(draft.constraints.interests || []),
      ...(input.interests || []),
      ...(interpretation.interests || [])
    ])
  }
  draft.requestedPoiNames = uniqueStrings([
    ...draft.requestedPoiNames,
    ...(input.poiNames || []),
    ...(interpretation.poiNames || [])
  ])
  if (interpretation.candidateQuery) {
    if (draft.candidateQuery !== interpretation.candidateQuery && draft.candidateSet?.query !== interpretation.candidateQuery) draft.candidateSet = null
    draft.candidateQuery = interpretation.candidateQuery
  }
  return draft
}

function hasExistingTrip(body) {
  return Boolean(body?.trip?.segments?.length || body?.currentPlan?.route?.destinations?.length)
}

function isPace(value) {
  return ['轻松', '适中', '紧凑'].includes(text(value, 10))
}

function firstNumberChoice(message, count) {
  const choice = Number(String(message || '').match(/^\s*([1-9]\d*)\s*[.、]?\s*$/)?.[1])
  return Number.isInteger(choice) && choice >= 1 && choice <= count ? choice - 1 : -1
}

function normalizedPoiName(value) {
  return String(value || '').replace(/[\s()（）,.、．-]/g, '').toLowerCase()
}

function pendingCandidateChoice(message, candidates = []) {
  const numbered = String(message || '').match(/^\s*([1-9]\d*)(?:\s*[.、．]?\s*.*)?$/)
  const choice = Number(numbered?.[1])
  if (Number.isInteger(choice) && choice >= 1 && choice <= candidates.length) return choice - 1

  const messageName = normalizedPoiName(message)
  if (!messageName) return -1
  return candidates.findIndex((candidate) => {
    const candidateName = normalizedPoiName(candidate.name)
    return candidateName && (messageName === candidateName || messageName.includes(candidateName) || candidateName.includes(messageName))
  })
}

function confirmPendingCandidate(draft, index) {
  const poi = draft.pendingCandidates[index]
  if (!poi) return false
  const originalQuery = draft.pendingCandidateQuery
  draft.verifiedPois = [
    ...draft.verifiedPois.filter((item) => item.name !== poi.name),
    { ...poi, poiStatus: 'must_go', locked: true, source: 'user' }
  ]
  draft.requestedPoiNames = uniqueStrings([
    ...draft.requestedPoiNames.filter((name) => name !== originalQuery),
    poi.name
  ])
  draft.unresolvedPois = draft.unresolvedPois.filter((name) => name !== originalQuery)
  draft.pendingCandidates = []
  draft.pendingCandidateQuery = ''
  return true
}

function isConfidentPoi(query, city, pois) {
  const first = pois?.[0]
  if (!first) return false
  const normal = (value) => String(value || '').replace(/[·\s（）()]/g, '').toLowerCase()
  const queryName = normal(query)
  const poiName = normal(first.name)
  return Boolean(queryName && (poiName === queryName || poiName.includes(queryName)) && (!city || String(first.city || '').includes(city)))
}

function candidateList(candidates) {
  return candidates.map((item, index) => `${index + 1}. ${item.name}${item.address ? `（${item.address}）` : ''}`).join('\n')
}

async function understandMessage(adapter, input, task, draft, signal) {
  const system = [
    '你是旅行规划对话的理解器。只返回 JSON。',
    '分类只是辅助，不能因为已有行程就默认修改。',
    'action 只能是：create、supplement、question、analyze、correction、modify、save、new_task、chat。',
    'correction 表示用户在纠正地点或之前的理解，绝不修改行程。',
    'modify 仅在用户明确要求改变地点、顺序、天数或节奏时使用。',
    'question 或 analyze 只回答或分析，不创建修改。',
    '提取用户本句直接表达的 cities、poiNames、interests、pace 和 correctionName；没有就用空值。',
    'candidateQuery 只在用户明确说了兴趣、品类或区域而需要展示高德候选时填写，例如“扬州早茶”或“北京经典景点”。不能把泛泛的“其余你安排”写成候选查询。',
    '只返回 JSON，不要解释。'
  ].join(' ')
  const { message } = await adapter.complete({
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: JSON.stringify({
          message: input.message,
          extracted: { city: input.city, days: input.days, pace: input.pace, poiNames: input.poiNames },
          task: task?.state || 'idle',
          draft: { city: draft?.constraints?.city, days: draft?.constraints?.days, poiNames: draft?.requestedPoiNames || [] },
          recentMessages: input.recentMessages?.slice(-4) || [],
          hasExistingTrip: hasExistingTrip(input)
        })
      }
    ],
    responseFormat: { type: 'json_object' },
    maxTokens: 420,
    temperature: 0.05,
    signal
  })
  const parsed = parseJson(message.content)
  const allowed = new Set(['create', 'supplement', 'question', 'analyze', 'correction', 'modify', 'save', 'new_task', 'chat'])
  return {
    action: allowed.has(parsed.action) ? parsed.action : 'chat',
    city: text(parsed.city, 60),
    days: Number(parsed.days) || undefined,
    pace: isPace(parsed.pace) ? parsed.pace : '',
    cities: uniqueStrings(Array.isArray(parsed.cities) ? parsed.cities : []),
    poiNames: uniqueStrings(Array.isArray(parsed.poiNames) ? parsed.poiNames : []),
    interests: uniqueStrings(Array.isArray(parsed.interests) ? parsed.interests : []),
    candidateQuery: text(parsed.candidateQuery, 80),
    correctionName: text(parsed.correctionName, 80),
    explicitChange: Boolean(parsed.explicitChange)
  }
}

async function makeOperationDraft(adapter, input, signal) {
  const system = [
    '你创建最小旅行行程修改草案。只返回 JSON。',
    '只可使用 currentPlan 中的确切 POI id。允许 operations：add_poi、remove_poi、replace_poi、move_poi、reorder_poi、optimize_route_order、lock_poi、unlock_poi、change_day_pace、replan_day、replan_all。',
    '用户未明确要求修改或目标不清楚时，返回 operations:[] 和 clarification。不要虚构目标。'
  ].join(' ')
  const { message } = await adapter.complete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify({ request: input.message, city: input.city, days: input.days, currentPlan: poiSummary(input.currentPlan.route.destinations) }) }
    ],
    responseFormat: { type: 'json_object' }, maxTokens: 900, temperature: 0.1, signal
  })
  const parsed = parseJson(message.content)
  return {
    reply: text(parsed.reply, 1000),
    clarification: text(parsed.clarification, 500),
    operations: Array.isArray(parsed.operations) ? parsed.operations.slice(0, 8) : []
  }
}

async function makeTripOperationDraft(adapter, input, trip, signal) {
  const system = [
    '你创建最小多城市旅行修改草案。只返回 JSON。',
    '只允许 change_segment_days，必须包含 city 和 days。',
    '只有用户明确要求改变某个城市停留天数时才创建。若只是问影响，operations 必须为空。',
    '不要虚构日期、票价、班次或交通事实。'
  ].join(' ')
  const { message } = await adapter.complete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify({ request: input.message, trip: trip.segments.map(({ id, city, days, startDate, endDate }) => ({ id, city, days, startDate, endDate })) }) }
    ],
    responseFormat: { type: 'json_object' }, maxTokens: 600, temperature: 0.1, signal
  })
  const parsed = parseJson(message.content)
  return {
    reply: text(parsed.reply, 1000),
    clarification: text(parsed.clarification, 500),
    operations: Array.isArray(parsed.operations) ? parsed.operations.slice(0, 3) : []
  }
}

async function answerWithEvidence(adapter, input, emit, signal) {
  let poi = null
  const poiName = input.poiNames?.[0]
  if (poiName && input.city) {
    emit({ id: 'search-question-poi', label: '正在核实相关地点', detail: `${input.city} · ${poiName}`, toolName: 'search_poi_candidates', status: 'running' })
    const searched = await executeAgentTool('search_poi_candidates', { query: poiName, city: input.city, limit: 1 }, { signal })
    poi = searched.ok ? searched.data.pois?.[0] || null : null
    emit({ id: 'search-question-poi', label: '地点核实完成', detail: poi ? poi.name : '没有可靠的 POI 结果', toolName: 'search_poi_candidates', status: 'complete' })
  }
  const { message } = await adapter.complete({
    messages: [
      { role: 'system', content: '你是中文旅行规划伙伴。先直接回答。把当前行程、已核实 POI 与一般建议区分开；不要把没有证据的信息说成营业时间、票价、预约、真实班次或实时交通。' },
      { role: 'user', content: JSON.stringify({ question: input.message, city: input.city, recentMessages: input.recentMessages?.slice(-4) || [], currentPlan: input.currentPlan ? poiSummary(input.currentPlan.route.destinations) : [], verifiedPoi: poi }) }
    ],
    maxTokens: 800, temperature: 0.15, signal
  })
  const answer = text(message.content, 1600) || '这部分我目前无法可靠确认。'
  const basis = poi
    ? `\n\n依据：高德 POI 已核实“${poi.name}”的地点身份和地址；营业时间、票价、预约和实时交通信息未核实。`
    : '\n\n依据：当前行程信息或一般旅行建议；未取得可核实的实时数据。'
  return `${answer}${basis}`
}

function nextStep({ task, draft, interpretation, input, body }) {
  const interaction = body?.interaction || {}
  if (interaction.type === 'select_candidates') return 'select_candidates'
  if (interaction.type === 'confirm_generation') return 'build'
  if (draft.pendingCandidates?.length && pendingCandidateChoice(input.message, draft.pendingCandidates) >= 0) return 'resolve'
  if (interpretation.action === 'new_task') return 'new_task'
  if (interpretation.action === 'correction') return 'correction'
  if (interpretation.action === 'save') return 'save'

  const creating = task.mode === 'create' || interpretation.action === 'create' || interpretation.action === 'supplement'
  if (creating) {
    if (!draft.constraints.city || !draft.constraints.days) return 'collect'
    if (draft.pendingCandidates?.length) return 'resolve'
    if (draft.candidateSet?.status === 'awaiting_selection') return 'select_candidates'
    if (!draft.constraints.pace) draft.constraints.pace = '适中'
    return 'resolve'
  }

  if (interpretation.action === 'modify' && interpretation.explicitChange) return 'modify'
  if (interpretation.action === 'analyze') return 'analyze'
  if (interpretation.action === 'question' || hasExistingTrip(body)) return 'answer'
  return 'chat'
}

function routeFor(state) {
  return state.task?.next || 'chat'
}

export function createTravelGraph({ adapter = new DeepSeekAdapter(), checkpointer = new MemorySaver() } = {}) {
  const understand = async (state, config) => {
    const { emit, signal } = runtime(config)
    const savedConversation = state.body?.conversationState || {}
    const previousDraft = state.draft || savedConversation.draft || emptyDraft()
    const previousTask = state.task || savedConversation.task || emptyTask()
    let input = mergeInput(state.body, previousDraft)
    input = await extractConstraints(input, signal, emit, adapter)
    input = await inferCityFromItinerary(input, emit, signal)
    const interpretation = await understandMessage(adapter, input, previousTask, previousDraft, signal)
    const draft = mergeDraft(previousDraft, input, interpretation)
    const task = { ...previousTask }
    if (interpretation.action === 'create' || interpretation.action === 'supplement') task.mode = 'create'
    task.next = nextStep({ task, draft, interpretation, input, body: state.body })
    task.state = task.next === 'collect' || task.next === 'ask_pace' ? 'collecting_draft'
      : task.next === 'resolve' ? 'resolving_places'
        : task.next === 'select_candidates' ? 'awaiting_candidate_selection'
        : task.next === 'build' ? 'building_draft'
          : task.next === 'analyze' ? 'analyzing_trip'
            : task.next === 'modify' ? 'editing_draft'
              : task.state || 'idle'
    return { input, interpretation, draft, task, usage: { modelCalls: (state.usage?.modelCalls || 0) + 2, toolCalls: state.usage?.toolCalls || 0 } }
  }

  const collect = async (state) => ({
    task: { ...state.task, state: 'collecting_draft' },
    result: baseResult('ask_clarification', state.input, '想先去哪个城市、玩几天？这两项确定后，我就能先帮你做一份旅行草案。')
  })

  const askPace = async (state) => ({
    task: { ...state.task, paceAsked: true, state: 'collecting_draft' },
    result: baseResult('ask_clarification', state.input, `收到，${state.draft.constraints.city} ${state.draft.constraints.days} 天游。你希望这次安排得轻松、适中还是紧凑？如果你不特别选择，我会按“适中”安排。`, {
      draft: { constraints: state.draft.constraints, requestedPoiNames: state.draft.requestedPoiNames }
    })
  })

  const newTask = async (state) => ({
    task: emptyTask(), draft: emptyDraft(),
    result: baseResult('answer_only', state.input, '好，我们开始一份新的旅行草案，不会带入刚才那份行程。你想去哪里、玩几天？')
  })

  const correction = async (state, config) => {
    const { signal } = runtime(config)
    const query = state.interpretation.correctionName || state.interpretation.poiNames?.[0]
    const draft = structuredClone(state.draft)
    if (!query || !draft.constraints.city) {
      return { task: { ...state.task, state: 'collecting_draft' }, result: baseResult('answer_only', state.input, '明白，是我刚才理解错了；我不会修改行程。请把正确的地点名称再发我一次，或补充它所在的城市。') }
    }
    const searched = await executeAgentTool('search_poi_candidates', { query, city: draft.constraints.city, limit: 3 }, { signal })
    const candidates = searched.ok ? searched.data.pois || [] : []
    draft.requestedPoiNames = uniqueStrings([...draft.requestedPoiNames.filter((name) => name !== query), query])
    draft.pendingCandidates = candidates
    draft.pendingCandidateQuery = query
    draft.unresolvedPois = candidates.length ? [] : [query]
    draft.evidence.push({ source: 'amap_poi', query, queriedAt: new Date().toISOString(), count: candidates.length })
    return {
      draft,
      task: { ...state.task, mode: 'create', next: candidates.length ? 'resolve' : 'collect', state: candidates.length ? 'resolving_places' : 'collecting_draft' },
      result: baseResult('answer_only', state.input, candidates.length
        ? `明白，是我刚才识别错了，而且没有修改行程。你说的可能是：\n${candidateList(candidates)}\n\n回复序号，或继续补充正确名称；我会只更新这份草案。`
        : `明白，是我刚才识别错了，而且没有修改行程。我暂时没有查到“${query}”的可靠地点结果；请补充完整名称或附近地标。`)
    }
  }

  const resolve = async (state, config) => {
    const { emit, signal } = runtime(config)
    const draft = structuredClone(state.draft)
    const selected = pendingCandidateChoice(state.input.message, draft.pendingCandidates)
    if (selected >= 0) confirmPendingCandidate(draft, selected)

    const unresolved = draft.requestedPoiNames.filter((name) => !draft.verifiedPois.some((poi) => poi.name === name || String(poi.name || '').includes(name)))
    for (const query of unresolved) {
      emit({ id: `resolve-${query}`, label: '正在核实必去地点', detail: `${draft.constraints.city} · ${query}`, toolName: 'search_poi_candidates', status: 'running' })
      const searched = await executeAgentTool('search_poi_candidates', { query, city: draft.constraints.city, limit: 3 }, { signal })
      const candidates = searched.ok ? searched.data.pois || [] : []
      draft.evidence.push({ source: 'amap_poi', query, queriedAt: new Date().toISOString(), count: candidates.length })
      emit({ id: `resolve-${query}`, label: '地点核实完成', detail: candidates.length ? `找到 ${candidates.length} 个候选` : '没有可靠候选', toolName: 'search_poi_candidates', status: 'complete' })
      if (isConfidentPoi(query, draft.constraints.city, candidates)) {
        draft.verifiedPois.push({ ...candidates[0], poiStatus: 'must_go', locked: true })
      } else if (candidates.length) {
        draft.pendingCandidates = candidates
        draft.pendingCandidateQuery = query
        return {
          draft,
          task: { ...state.task, state: 'resolving_places' },
          result: baseResult('ask_clarification', state.input, `我查到多个可能的“${query}”。你说的是哪一个？\n${candidateList(candidates)}\n\n回复序号后，我再继续生成草案。`, { draft: { constraints: draft.constraints, requestedPoiNames: draft.requestedPoiNames } })
        }
      } else {
        draft.unresolvedPois.push(query)
      }
    }
    if (draft.candidateQuery && !draft.candidateSet) {
      emit({ id: 'search-candidate-options', label: '正在整理可选地点', detail: `${draft.constraints.city} · ${draft.candidateQuery}`, toolName: 'search_poi_candidates', status: 'running' })
      const searched = await executeAgentTool('search_poi_candidates', { query: draft.candidateQuery, city: draft.constraints.city, limit: 8 }, { signal })
      const candidates = searched.ok ? searched.data.pois || [] : []
      emit({ id: 'search-candidate-options', label: '可选地点已整理', detail: candidates.length ? `找到 ${candidates.length} 个可核实地点` : '暂时没有可靠候选', toolName: 'search_poi_candidates', status: candidates.length ? 'complete' : 'failed' })
      draft.candidateSet = {
        id: crypto.randomUUID(),
        query: draft.candidateQuery,
        city: draft.constraints.city,
        status: 'awaiting_selection',
        candidates,
        selectedIds: [],
        queriedAt: new Date().toISOString()
      }
      draft.evidence.push({ source: 'amap_poi', query: draft.candidateQuery, queriedAt: draft.candidateSet.queriedAt, count: candidates.length })
      return {
        draft,
        task: { ...state.task, next: 'select_candidates', state: 'awaiting_candidate_selection' },
        result: baseResult('awaiting_candidate_selection', state.input,
          candidates.length
            ? `我先找到了几处和“${draft.candidateQuery}”有关的地点。你挑想去的，我再和你前面说过的要求一起排；它们现在还没有加入地图或行程。`
            : `我暂时没有查到可靠的“${draft.candidateQuery}”地点。你可以换一个更具体的品类、区域或店名，我继续帮你找。`,
          { candidateSet: draft.candidateSet, draft: { constraints: draft.constraints, requestedPoiNames: draft.requestedPoiNames } }
        )
      }
    }

    const selectedCount = draft.verifiedPois.length
    if (!selectedCount) {
      return {
        draft,
        task: { ...state.task, state: 'collecting_draft' },
        result: baseResult('ask_clarification', state.input,
          '这趟旅行的城市和天数我记住了。为了不凭空替你塞地点，你更想补哪一类：经典景点、当地美食、亲子、拍照，还是先告诉我一个具体区域？'
        )
      }
    }
    return {
      draft,
      task: { ...state.task, state: 'awaiting_generation_confirmation' },
      result: baseResult('ready_to_generate', state.input,
        `目前我记下了 ${draft.constraints.city} ${draft.constraints.days} 天，以及 ${draft.verifiedPois.map((item) => item.name).join('、')}。如果这些方向没问题，我就先做一版${draft.constraints.pace || '适中'}节奏的草案给你看；保存之前都不会改正式行程。`,
        { generationConfirmation: { city: draft.constraints.city, days: draft.constraints.days, pace: draft.constraints.pace || '适中', selectedPlaces: draft.verifiedPois.map((item) => ({ id: item.id, name: item.name })), action: 'confirm_generation' } }
      )
    }
  }

  const selectCandidates = async (state) => {
    const draft = structuredClone(state.draft)
    const interaction = state.body?.interaction || {}
    if (interaction.type !== 'select_candidates' || interaction.candidateSetId !== draft.candidateSet?.id) {
      return {
        task: { ...state.task, state: 'awaiting_candidate_selection' },
        result: baseResult('awaiting_candidate_selection', state.input, '你可以在候选地点里勾选想去的几处；勾选只是告诉我你的偏好，还不会加入地图或行程。', { candidateSet: draft.candidateSet })
      }
    }
    const selectedIds = new Set(Array.isArray(interaction.selectedIds) ? interaction.selectedIds : [])
    const selected = draft.candidateSet.candidates.filter((item) => selectedIds.has(item.id))
    draft.candidateSet.selectedIds = selected.map((item) => item.id)
    draft.candidateSet.status = 'selected'
    draft.selectedCandidateIds = selected.map((item) => item.id)
    draft.selectedPois = [
      ...(draft.selectedPois || []),
      ...selected
    ].filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
    draft.generationConfirmed = false
    return {
      draft,
      task: { ...state.task, state: 'awaiting_generation_confirmation' },
      result: baseResult('ready_to_generate', state.input,
        selected.length
          ? `我把 ${selected.map((item) => item.name).join('、')} 记进这次草案的候选清单了。确认后我会把它们和你已指定的地点一起安排；在此之前地图和正式行程不会变化。`
          : '你这次还没有选择候选地点。我可以保留你已经明确指定的地点生成草案，也可以继续换一组候选给你挑。',
        { candidateSet: draft.candidateSet, generationConfirmation: { city: draft.constraints.city, days: draft.constraints.days, pace: draft.constraints.pace || '适中', selectedPlaces: [...draft.verifiedPois, ...draft.selectedPois].map((item) => ({ id: item.id, name: item.name })), action: 'confirm_generation' } }
      )
    }
  }

  const build = async (state, config) => {
    const { emit, signal } = runtime(config)
    const { draft, interpretation } = state
    if (state.body?.interaction?.type !== 'confirm_generation') {
      return {
        task: { ...state.task, state: 'awaiting_generation_confirmation' },
        result: baseResult('ready_to_generate', state.input, '我先把关键信息整理好了。你点“开始生成草案”后，我再开始排每天的地点。', {
          generationConfirmation: { city: draft.constraints.city, days: draft.constraints.days, pace: draft.constraints.pace || '适中', selectedPlaces: [...draft.verifiedPois, ...(draft.selectedPois || [])].map((item) => ({ id: item.id, name: item.name })), action: 'confirm_generation' }
        })
      }
    }
    const cities = uniqueStrings(interpretation.cities || [])
    if (cities.length > 1) {
      emit({ id: 'build-outline', label: '正在整理多城市总路线', detail: '先确定城市顺序和停留天数，不生成真实班次', status: 'running' })
      const trip = await planTripOutline({ ...state.body, message: state.input.message, constraints: { ...draft.constraints, cities } }, signal)
      emit({ id: 'build-outline', label: '多城市草案已准备', detail: `${trip.segments.length} 个城市段，等你继续细化`, status: 'complete' })
      return {
        draft: { ...draft, trip }, task: { ...state.task, state: 'draft_ready' },
        result: baseResult('outline_trip', state.input, '已生成一份多城市总路线草案，尚未保存到正式行程。你可以说“细化西安”，或继续调整城市顺序和停留天数。', {
          trip, draftTrip: trip, operations: [{ type: 'create_trip_outline' }],
          warnings: ['当前仅规划城市顺序、停留天数和日期范围，不包含真实城际班次与票价。']
        })
      }
    }
    const input = {
      ...state.input,
      city: draft.constraints.city,
      days: draft.constraints.days,
      pace: draft.constraints.pace || '适中',
      destinations: [...draft.verifiedPois, ...(draft.selectedPois || [])],
      poiNames: []
    }
    const planned = await executeAgentTool('build_trip_plan', {
      city: input.city,
      days: input.days,
      pace: input.pace,
      destinations: input.destinations,
      candidates: [],
      selectedPoiIds: input.destinations.map((item) => item.id)
    }, { signal })
    if (!planned.ok) return { result: baseResult('answer_only', input, `这次草案没有生成成功：${planned.error}`) }
    const plan = planned.data
    const unresolvedNote = draft.unresolvedPois.length ? `“${draft.unresolvedPois.join('、')}”暂未核实，已保留为待补充地点。` : ''
    const draftExplanation = buildDraftExplanation(draft, plan)
    return {
      draft: { ...draft, plan }, task: { ...state.task, state: 'draft_ready' },
      result: baseResult('create_plan', input, `已生成一份${input.city}${input.days} 天游草案，尚未保存到正式行程。你可以继续调整地点、节奏和每天顺序，确认后再保存。${unresolvedNote}`, {
        plan, draftPlan: plan, operations: [{ type: 'create_plan' }], changes: [{ type: 'create_plan', message: `生成 ${input.city} ${input.days} 天游草案` }], warnings: plan.warnings || [],
        draftExplanation,
        draft: { constraints: draft.constraints, unresolvedPois: draft.unresolvedPois, evidence: draft.evidence },
        suggestionContext: { task: { ...state.task, state: 'draft_ready' }, draft: { ...draft, plan } }
      })
    }
  }

  const answer = async (state, config) => {
    const { emit, signal } = runtime(config)
    const reply = await answerWithEvidence(adapter, state.input, emit, signal)
    return { result: baseResult('answer_only', state.input, reply) }
  }

  const analyze = async (state, config) => {
    const { emit, signal } = runtime(config)
    const reply = await answerWithEvidence(adapter, state.input, emit, signal)
    return { task: { ...state.task, state: 'completed' }, result: baseResult('answer_only', state.input, reply) }
  }

  const save = async (state) => {
    if (state.draft?.plan) {
      return {
        result: baseResult('create_plan', state.input, '这份草案已准备好保存；确认后才会写入正式行程。', {
          plan: state.draft.plan,
          draftPlan: state.draft.plan,
          operations: [{ type: 'create_plan' }],
          changes: [{ type: 'create_plan', message: `保存 ${state.draft.constraints.city || state.input.city} 草案` }],
          draftExplanation: buildDraftExplanation(state.draft, state.draft.plan),
          suggestionContext: { task: state.task, draft: state.draft }
        })
      }
    }
    if (state.draft?.trip) {
      return {
        result: baseResult('outline_trip', state.input, '这份多城市草案已准备好保存；确认后才会写入正式行程。', {
          trip: state.draft.trip,
          draftTrip: state.draft.trip,
          operations: [{ type: 'create_trip_outline' }],
          suggestionContext: { task: state.task, draft: state.draft }
        })
      }
    }
    return { result: baseResult('answer_only', state.input, '现在还没有可保存的草案。我可以先根据你的城市、天数和必去点生成一份。') }
  }

  const modify = async (state, config) => {
    const { emit, signal } = runtime(config)
    const { input } = state
    const currentTrip = state.body?.trip?.segments?.length ? state.body.trip : null
    if (!input.currentPlan && !currentTrip) return { result: baseResult('ask_clarification', input, '你可以先告诉我想去哪里、玩几天，我会先生成草案；正式行程不会被直接修改。') }
    const draft = currentTrip
      ? await makeTripOperationDraft(adapter, input, currentTrip, signal)
      : await makeOperationDraft(adapter, input, signal)
    if (!draft.operations.length) return { result: baseResult('answer_only', input, draft.reply || draft.clarification || '我先不改动行程。你希望我分析一下、还是明确调整某一天或某个地点？') }
    if (currentTrip) {
      const outcome = applyTripOperations(currentTrip, draft.operations)
      if (!outcome.changes.length) return { result: baseResult('answer_only', input, draft.reply || outcome.warnings[0] || '当前行程不需要修改。', { warnings: outcome.warnings }) }
      return { result: baseResult('modify_plan', input, draft.reply || '我已准备好修改草案，确认后才会更新正式行程。', { trip: outcome.trip, draftTrip: outcome.trip, operations: draft.operations, changes: outcome.changes, warnings: outcome.warnings }) }
    }
    const operations = await enrichOperations(draft.operations, input.city, emit, signal)
    const applied = await executeAgentTool('apply_plan_operations', { plan: input.currentPlan, operations, context: { city: input.city, pace: input.pace } }, { signal })
    if (!applied.ok) return { result: baseResult('answer_only', input, `我没有修改正式行程：${applied.error}`) }
    const outcome = applied.data
    if (!outcome.changes.length) return { result: baseResult('answer_only', input, draft.reply || outcome.warnings[0] || '当前行程不需要修改。', { warnings: outcome.warnings }) }
    return { result: baseResult('modify_plan', input, draft.reply || '我已准备好修改草案，确认后才会更新正式行程。', { plan: outcome.plan, draftPlan: outcome.plan, operations: draft.operations, changes: outcome.changes, warnings: outcome.warnings }) }
  }

  return new StateGraph(TravelState)
    .addNode('understand', understand)
    .addNode('collect', collect)
    .addNode('ask_pace', askPace)
    .addNode('new_task', newTask)
    .addNode('correction', correction)
    .addNode('resolve', resolve)
    .addNode('select_candidates', selectCandidates)
    .addNode('build', build)
    .addNode('answer', answer)
    .addNode('analyze', analyze)
    .addNode('save', save)
    .addNode('modify', modify)
    .addEdge(START, 'understand')
    .addConditionalEdges('understand', routeFor, { collect: 'collect', ask_pace: 'ask_pace', new_task: 'new_task', correction: 'correction', resolve: 'resolve', select_candidates: 'select_candidates', build: 'build', answer: 'answer', analyze: 'analyze', save: 'save', modify: 'modify', chat: 'answer' })
    .addConditionalEdges('resolve', routeFor, { build: 'build', resolve: END, select_candidates: END })
    .addEdge('collect', END).addEdge('ask_pace', END).addEdge('new_task', END).addEdge('correction', END).addEdge('select_candidates', END)
    .addEdge('build', END).addEdge('answer', END).addEdge('analyze', END).addEdge('save', END).addEdge('modify', END)
    .compile({ checkpointer })
}

async function defaultGraph() {
  if (!defaultGraphPromise) {
    defaultGraphPromise = (async () => {
      if (!process.env.DATABASE_URL) return createTravelGraph()
      const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL, { schema: 'langgraph' })
      await checkpointer.setup()
      return createTravelGraph({ checkpointer })
    })()
  }
  return defaultGraphPromise
}

export async function runTravelGraph(body, emit = () => {}, signal) {
  const graph = await defaultGraph()
  const runId = crypto.randomUUID()
  runtimeContexts.set(runId, { emit, signal })
  try {
    const saved = body?.conversationState || {}
    const state = await graph.invoke(
      {
        body,
        task: saved.task || undefined,
        draft: saved.draft || undefined,
        usage: { modelCalls: 0, toolCalls: 0 }
      },
      { configurable: { thread_id: text(body?.sessionId, 100) || crypto.randomUUID(), runId }, recursionLimit: MAX_MODEL_CALLS + 6 }
    )
    const result = state.result || baseResult('ask_clarification', state.input || normalizeInput(body), '我还没有得到可用结果，请再试一次。')
    return {
      ...result,
      conversationState: {
        version: 1,
        task: state.task || emptyTask(),
        draft: state.draft || emptyDraft(),
        updatedAt: new Date().toISOString()
      }
    }
  } finally {
    runtimeContexts.delete(runId)
  }
}

export function resetTravelGraphForTests() {
  defaultGraphPromise = undefined
}
