import express from 'express'
import { detectPaceByDay, fillMissingImportedDays, isItineraryImport, normalizeImportedItems, parseDaySections, parseImportedItemsFromSections, validateImportedItinerary } from '../services/importParser.js'
import { DEFAULT_PROMPT_VERSION, getPromptSet } from '../prompts/registry.js'
import { AgentRuntime } from '../services/agentRuntime.js'
import { executeAgentTool } from '../services/toolManager.js'
import { DeepSeekAdapter } from '../services/modelAdapter.js'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const modelAdapter = new DeepSeekAdapter()
const MAX_TRIP_DAYS = 14
const CHINESE_DAY_VALUES = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  十: 10, 十一: 11, 十二: 12, 十三: 13, 十四: 14
}
const PLAN_INTENT_PATTERN = /生成|安排|整理|规划|重排|重新规划|调整|修改|换掉|替换|删除|去掉|移到|移动|增加|添加|保留|锁定|解锁|轻松一点|紧凑一点|不要/
const QUESTION_PATTERN = /[？?]|吗$|几点|什么时候|开放|关门|门票|值得|怎么去|在哪里|要多久|是什么/
const ANALYSIS_QUESTION_PATTERN = /合理吗|合适吗|赶不赶|会不会太赶|怎么样|如何|为什么|有什么问题|需要调整吗/

const planningTools = [
  {
    type: 'function',
    function: {
      name: 'search_poi_candidates',
      description: 'Search verified POI candidates in one city.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, city: { type: 'string' } },
        required: ['query', 'city']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'build_trip_plan',
      description: 'Select POIs for a complete 1-14 day itinerary.',
      parameters: {
        type: 'object',
        properties: { selected_poi_ids: { type: 'array', items: { type: 'string' } } },
        required: ['selected_poi_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'modify_trip_plan',
      description: 'Apply minimal operations to the current itinerary. Do not change unrelated days or POIs.',
      parameters: {
        type: 'object',
        properties: {
          reply: { type: 'string', description: 'A concise Chinese explanation of the intended adjustment.' },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['add_poi', 'remove_poi', 'replace_poi', 'move_poi', 'reorder_poi', 'optimize_route_order', 'lock_poi', 'unlock_poi', 'change_day_pace', 'replan_day', 'replan_all']
                },
                poiId: { type: 'string' },
                targetDay: { type: 'integer' },
                targetIndex: { type: 'integer' },
                pace: { type: 'string', enum: ['轻松', '适中', '紧凑'] },
                query: { type: 'string', description: 'Required for add_poi or replace_poi.' }
              },
              required: ['type']
            }
          }
        },
        required: ['reply', 'operations']
      }
    }
  }
]

function asText(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export function parseDaysFromMessage(message) {
  const text = asText(message, 1200)
  const arabicMatch = text.match(/(?:^|[^第\d])(\d{1,2})\s*(?:天|日)(?:游|行程)?/)
  if (arabicMatch) return Number(arabicMatch[1])
  const chineseMatch = text.match(/(?:^|[^第])(十四|十三|十二|十一|十|九|八|七|六|五|四|三|两|二|一)\s*(?:天|日)(?:游|行程)?/)
  return chineseMatch ? CHINESE_DAY_VALUES[chineseMatch[1]] : 0
}

export function parseMaxDayHeading(message) {
  const matches = [...asText(message, 1200).matchAll(/第\s*(\d{1,2}|十四|十三|十二|十一|十|九|八|七|六|五|四|三|两|二|一)\s*天/g)]
  return matches.reduce((max, match) => {
    const value = Number(match[1]) || CHINESE_DAY_VALUES[match[1]] || 0
    return Math.max(max, value)
  }, 0)
}

function fallbackCityFromMessage(message) {
  const text = asText(message, 1200)
  const match = text.match(/(?:在|去|到|想去|前往)([\u4e00-\u9fff]{2,8})(?=(?:玩|游|旅游|旅行|待|住))/)
    || text.match(/([\u4e00-\u9fff]{2,8})(?=(?:玩|游|旅游|旅行|待|住)\s*(?:\d|[一二三四五六七八九十两]))/)
  return asText(match?.[1], 80)
}

function fallbackPoiNamesFromMessage(message) {
  const text = asText(message, 1200)
  const match = text.match(/(?:必去|一定要去|必打卡)\s*([^。！？!?\n]*?)(?=其余|其他|剩下|帮我|请|，|。|！|$)/)
  if (!match?.[1]) return []
  return match[1]
    .split(/[、，,和及与]/)
    .map((item) => asText(item.replace(/(?:的)?$/, ''), 50))
    .filter(Boolean)
    .slice(0, 8)
}

export function normalizeInput(body) {
  const constraints = body?.constraints || {}
  const message = asText(body?.message, 1200)
  const messageDays = parseDaysFromMessage(message)
  const existingDays = Number(constraints.days) || Number(body?.currentPlan?.route?.estimatedDays) || 0
  const days = messageDays || Math.max(existingDays, parseMaxDayHeading(message))
  return {
    message,
    promptVersion: getPromptSet(asText(body?.promptVersion, 40) || process.env.CROSS_PROMPT_VERSION || DEFAULT_PROMPT_VERSION).version,
    sessionId: asText(body?.sessionId, 100),
    city: asText(constraints.city, 80) || fallbackCityFromMessage(message),
    days: Number.isInteger(days) ? days : 0,
    pace: asText(constraints.pacePreference ?? constraints.pace, 20),
    startDate: asText(constraints.startDate, 20),
    endDate: asText(constraints.endDate, 20),
    datesFlexible: Boolean(constraints.datesFlexible),
    interests: Array.isArray(constraints.interests) ? constraints.interests.map((item) => asText(item, 30)).filter(Boolean).slice(0, 8) : [],
    dailyEndTime: asText(constraints.dailyEndTime, 10),
    poiNames: fallbackPoiNamesFromMessage(message),
    itineraryItems: [],
    sourceMode: isItineraryImport(message) ? 'import' : 'generate',
    destinations: Array.isArray(body?.destinations) ? body.destinations.slice(0, 40) : [],
    currentPlan: body?.currentPlan?.route && Array.isArray(body.currentPlan.route.destinations) ? body.currentPlan : null,
    recentMessages: Array.isArray(body?.recentMessages)
      ? body.recentMessages.slice(-12).map((item) => ({ role: item.role, content: asText(item.content, 800) })).filter((item) => ['user', 'assistant'].includes(item.role) && item.content)
      : []
  }
}

export function publicConstraints(input) {
  return {
    city: input.city,
    days: input.days,
    pacePreference: input.sourceMode === 'import' ? '' : input.pace,
    startDate: input.startDate,
    endDate: input.endDate,
    datesFlexible: input.datesFlexible
  }
}

export function hasUsablePlan(plan) {
  const destinations = plan?.route?.destinations
  if (!Array.isArray(destinations)) return false
  return destinations.some((place) =>
    place && Number(place.day) >= 1 && !['unscheduled', 'candidate', 'rejected'].includes(place.planningStatus)
  )
}

export function detectAgentDecision(input) {
  const hasPlan = hasUsablePlan(input.currentPlan)
  const hasPlanIntent = PLAN_INTENT_PATTERN.test(input.message)
  const isQuestion = QUESTION_PATTERN.test(input.message)
  if (ANALYSIS_QUESTION_PATTERN.test(input.message) || (isQuestion && !hasPlanIntent)) return 'answer_only'
  if (!input.city || input.days < 1 || input.days > MAX_TRIP_DAYS) return 'ask_clarification'
  if (input.sourceMode === 'import') return 'create_plan'
  if (!hasPlan) return 'create_plan'
  return 'modify_plan'
}

export function buildSuggestions(decision, input, plan) {
  const destinations = plan?.route?.destinations || input.currentPlan?.route?.destinations || []
  const firstPoi = destinations.find((place) => place?.name)?.name
  const lastDay = Math.max(1, ...destinations.map((place) => Number(place.day) || 1))
  if (decision === 'ask_clarification') {
    if (!input.city) return ['我想去南京', '帮我规划杭州', '目的地还没确定，先给我建议']
    return [`${input.city}玩 2 天`, `${input.city}玩 3 天，节奏轻松`, '日期还没确定，先按两天安排']
  }
  if (decision === 'create_plan') {
    return [
      lastDay > 1 ? `第 ${lastDay} 天轻松一点` : '把行程安排得轻松一点',
      firstPoi ? `保留${firstPoi}，其他地点可以调整` : '帮我标出最值得保留的地点',
      '看看有没有需要预约的地方'
    ]
  }
  if (decision === 'modify_plan') {
    return [
      '帮我检查哪一天最赶',
      firstPoi ? `锁定${firstPoi}` : '帮我锁定必去地点',
      '按地点距离再优化一下顺序'
    ]
  }
  return [
    firstPoi ? `把这个建议应用到${firstPoi}` : '把这个建议加入当前行程',
    '这会影响哪一天？',
    '再给我一个更轻松的选择'
  ]
}

async function callDeepSeek(messages, toolChoice, maxTokens = 800, signal, tools = planningTools) {
  const result = await modelAdapter.complete({ messages, tools, toolChoice, maxTokens, temperature: 0.15, signal })
  return result.message
}

function readToolArguments(message, toolName) {
  const call = (message.tool_calls || []).find((item) => item.function?.name === toolName)
  if (!call) return { call: null, args: {} }
  try {
    return { call, args: JSON.parse(call.function.arguments || '{}') }
  } catch {
    return { call, args: {} }
  }
}

async function requestConstraintExtraction(input, systemPrompt, userContent, maxTokens, signal, adapter = modelAdapter) {
  const result = await adapter.complete({
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
    responseFormat: { type: 'json_object' }, maxTokens, temperature: 0.1, signal
  })
  try { return JSON.parse(result.message.content || '{}') } catch { return {} }
}

export async function extractConstraints(input, signal, emit = () => {}, adapter = modelAdapter) {
  // A complete city/day pair does not mean the message contains no new constraints.
  // Always let the extractor see explicit must-go places and later supplements.
  const promptSet = getPromptSet(input.promptVersion)
  let extracted = {}
  let extractionError = null
  try {
    extracted = await requestConstraintExtraction(input, promptSet.extractionSystem, input.message, input.sourceMode === 'import' ? 1600 : 300, signal, adapter)
  } catch (error) {
    if (input.sourceMode !== 'import') throw error
    extractionError = error
  }
  const days = Number(extracted.days)
  const sections = parseDaySections(input.message)
  if (input.sourceMode === 'import') emit({ id: 'parse-day-sections', label: `📅 已分出 ${sections.length} 天行程`, detail: '正在保留每天的时段和原始顺序', toolName: 'parse_itinerary', status: 'complete' })
  let itineraryItems = normalizeImportedItems(extracted.itineraryItems, sections)
  let validation = input.sourceMode === 'import' ? validateImportedItinerary(sections, itineraryItems) : null
  const importWarnings = []
  if (validation?.errors.length) {
    emit({ id: 'repair-extraction', label: '🧩 正在补齐遗漏的活动', detail: '第一次结构化结果不完整，正在按日期重新整理一次', toolName: 'repair_itinerary', status: 'running' })
    let repaired = {}
    try {
      repaired = await requestConstraintExtraction(
        input,
        promptSet.extractionRepairSystem || promptSet.extractionSystem,
        JSON.stringify({ sourceText: input.message, failedExtraction: extracted }),
        1800,
        signal,
        adapter
      )
    } catch (error) {
      extractionError ||= error
    }
    extracted = { ...extracted, ...repaired }
    const repairedItems = normalizeImportedItems(repaired.itineraryItems, sections)
    const fallbackItems = parseImportedItemsFromSections(sections)
    const repairedDays = new Set(repairedItems.map((item) => item.day))
    const fallbackDays = sections.filter((section) => !repairedDays.has(section.day) && fallbackItems.some((item) => item.day === section.day))
    itineraryItems = fillMissingImportedDays(repairedItems, fallbackItems, sections)
    validation = validateImportedItinerary(sections, itineraryItems)
    if (fallbackDays.length) importWarnings.push(`我已经按你原文里的“第几天”整理了第 ${fallbackDays.map((section) => section.day).join('、')} 天，并保留原来的活动顺序。你可以快速看一眼，如果有放错的地点，直接告诉我移到哪一天。`)
    emit({ id: 'repair-extraction', label: '✅ 活动关系已经补齐', detail: `共保留 ${itineraryItems.length} 项活动`, toolName: 'repair_itinerary', status: 'complete' })
  }
  if (extractionError && itineraryItems.length) importWarnings.push('AI 结构化解析暂时不可用，已使用原文分段规则保留本次行程。')
  if (validation?.errors.length) {
    throw new Error(`已识别到 ${sections.length} 个日期段落，但仍无法提取其中的活动。原行程未修改，请保留“第几天”的标题后重试。`)
  }
  return {
    ...input,
    city: input.city || asText(extracted.city, 80),
    days: input.days || (Number.isInteger(days) ? days : 0),
    pace: input.sourceMode === 'import' ? '' : (['轻松', '适中', '紧凑'].includes(extracted.pace) ? extracted.pace : input.pace),
    interests: input.interests.length ? input.interests : Array.isArray(extracted.interests) ? extracted.interests.map((item) => asText(item, 30)).filter(Boolean).slice(0, 8) : [],
    poiNames: [...new Set([
      ...(input.poiNames || []),
      ...(Array.isArray(extracted.poiNames) ? extracted.poiNames.map((item) => asText(item, 50)).filter(Boolean) : [])
    ])].slice(0, 40),
    itineraryItems,
    importWarnings: [...(validation?.warnings || []), ...importWarnings],
    days: input.sourceMode === 'import' ? validation.durationDays : (input.days || (Number.isInteger(days) ? days : 0))
  }
}

export function poiSummary(destinations) {
  return destinations.map((place) => ({
    id: place.id,
    name: place.name,
    day: place.day,
    withinDayOrder: place.withinDayOrder,
    poiStatus: place.poiStatus || 'optional',
    locked: Boolean(place.locked),
    planningStatus: place.planningStatus || 'scheduled'
  }))
}

export function appendExecutedToolResults(messages, assistantMessage, results) {
  if (!results.length) return
  const executedCalls = results.map(({ call }) => call)
  messages.push({ role: 'assistant', content: assistantMessage.content || null, tool_calls: executedCalls })
  results.forEach(({ call, result }) => {
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
  })
}

function attachImportedSchedule(plan, input, unresolvedItems) {
  const diagnostics = detectPaceByDay(input.itineraryItems, input.days)
  const unresolvedNames = [...new Set(unresolvedItems.map((item) => item.name))]
  plan.sourceMode = 'import'
  plan.diagnostics = diagnostics
  plan.unresolvedActivities = unresolvedItems
  plan.schedule = diagnostics.byDay.map((diagnostic) => {
    const items = input.itineraryItems
      .filter((item) => item.day === diagnostic.day)
      .sort((a, b) => a.withinDayOrder - b.withinDayOrder)
    return {
      day: diagnostic.day,
      date: plan.schedule[diagnostic.day - 1]?.date || new Date().toISOString(),
      city: input.city,
      activities: items.map((item, index) => `${index + 1}. ${item.timeSlot ? `${item.timeSlot} · ` : ''}${item.name}`),
      accommodation: `${input.city}住宿待定`,
      notes: unresolvedItems.some((item) => item.day === diagnostic.day)
        ? `以下地点未能在地图中核实，但已保留在日程：${unresolvedItems.filter((item) => item.day === diagnostic.day).map((item) => item.name).join('、')}`
        : '已按导入原文保留分天和顺序。',
      detectedPace: diagnostic.detectedPace
    }
  })
  plan.warnings = [...new Set([...(plan.warnings || []), ...(input.importWarnings || []), ...(unresolvedNames.length ? [`未在地图中核实：${unresolvedNames.join('、')}。这些活动已保留在对应日期的日程中。`] : [])])]
  return plan
}

export async function generateInitialPlan(input, emit = () => {}, signal) {
  const promptSet = getPromptSet(input.promptVersion)
  const messages = [
    { role: 'system', content: promptSet.initialPlanningSystem },
    { role: 'user', content: JSON.stringify({ request: input.message, city: input.city, days: input.days, pace: input.pace, interests: input.interests, existingPois: poiSummary(input.destinations) }) }
  ]
  let candidates = []
  const importedIds = []
  const trace = []
  const unresolvedItems = []
  const explicitItems = input.itineraryItems.length
    ? input.itineraryItems
    : input.poiNames.map((name, index) => ({ name, day: 0, withinDayOrder: index + 1 }))
  if (explicitItems.length) {
    emit({ id: 'search-explicit-pois', label: '📍 正在核实你写下的地点', detail: `共 ${explicitItems.length} 项活动`, toolName: 'search_poi_candidates', status: 'running' })
    for (const item of explicitItems.filter((entry) => ['poi', 'food', 'shopping'].includes(entry.type) || !entry.type)) {
      const name = item.name
      const toolResult = await executeAgentTool('search_poi_candidates', { query: name, city: input.city, limit: 1 }, { signal })
      if (!toolResult.ok) {
        unresolvedItems.push({ name, day: item.day, reason: toolResult.error || '地图查询失败' })
        continue
      }
      const result = toolResult.data
      const poi = result.pois[0]
      if (poi && !candidates.some((item) => item.name === poi.name) && !input.destinations.some((item) => item.name === poi.name)) {
        poi.source = 'text_import'
        if (item.day) {
          poi.requestedDay = item.day
          poi.requestedWithinDayOrder = item.withinDayOrder
        }
        candidates.push(poi)
        importedIds.push(poi.id)
      } else if (!poi) unresolvedItems.push({ name, day: item.day, reason: result.warning || '未找到匹配地点' })
    }
    trace.push({ step: '整理已有行程', toolName: 'search_poi_candidates', input: { items: explicitItems }, output: { count: importedIds.length } })
    emit({ id: 'search-explicit-pois', label: '📍 地点核实完成', detail: `已匹配 ${importedIds.length} 个，${unresolvedItems.length} 个暂未核实`, toolName: 'search_poi_candidates', status: 'complete' })
  } else if (input.destinations.filter((place) => place.poiStatus !== 'avoid').length < input.days * 2) {
    emit({ id: 'choose-search-query', label: '整理搜索方向', detail: `${input.city} · ${input.interests.join('、') || '旅行地点'}`, toolName: 'search_poi_candidates', status: 'running' })
    const searchMessage = await callDeepSeek(messages, { type: 'function', function: { name: 'search_poi_candidates' } }, 800, signal)
    const calls = (searchMessage.tool_calls || []).filter((item) => item.function?.name === 'search_poi_candidates').slice(0, 3)
    const results = []
    for (const call of calls) {
      let args = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch { args = {} }
      const query = asText(args.query, 80) || `${input.city} ${input.interests.join(' ')}`.trim()
      emit({ id: 'choose-search-query', label: '整理搜索方向', detail: `准备查询“${query}”`, toolName: 'search_poi_candidates', status: 'complete' })
      emit({ id: `search-pois-${call.id}`, label: '调用高德搜索地点', detail: `${input.city} · ${query}`, toolName: 'search_poi_candidates', status: 'running' })
      const toolResult = await executeAgentTool('search_poi_candidates', { query, city: asText(args.city, 80) || input.city }, { signal })
      const result = toolResult.ok ? toolResult.data : { pois: [], warning: toolResult.error }
      candidates.push(...result.pois.filter((poi) => !candidates.some((existing) => existing.name === poi.name)))
      trace.push({ step: '搜索 POI', toolName: 'search_poi_candidates', input: { query, city: input.city }, output: { count: result.pois.length, warning: result.warning } })
      emit({ id: `search-pois-${call.id}`, label: '调用高德搜索地点', detail: result.warning || `找到 ${result.pois.length} 个候选地点`, toolName: 'search_poi_candidates', status: 'complete' })
      results.push({ call, result })
    }
    appendExecutedToolResults(messages, searchMessage, results)
    const supplementalQueries = [`${input.city} 历史文化景点`, `${input.city} 公园街区`, `${input.city} 博物馆`]
    for (const query of supplementalQueries) {
      if (candidates.length >= input.days * 2) break
      const activityId = `search-supplement-${supplementalQueries.indexOf(query)}`
      emit({ id: activityId, label: '📍 补充每天的可选地点', detail: query, toolName: 'search_poi_candidates', status: 'running' })
      const toolResult = await executeAgentTool('search_poi_candidates', { query, city: input.city }, { signal })
      if (toolResult.ok) candidates.push(...toolResult.data.pois.filter((poi) => !candidates.some((existing) => existing.name === poi.name)))
      emit({ id: activityId, label: '📍 补充地点完成', detail: toolResult.ok ? `当前共有 ${candidates.length} 个候选地点` : toolResult.error, toolName: 'search_poi_candidates', status: toolResult.ok ? 'complete' : 'failed' })
    }
  }
  emit({ id: 'build-plan', label: '🗺️ 正在整理每天的顺序', detail: `${input.days} 天 · ${input.pace || '保留原有节奏'}`, toolName: 'build_trip_plan', status: 'running' })
  if (input.sourceMode === 'import') {
    const buildResult = await executeAgentTool('build_trip_plan', { city: input.city, days: input.days, pace: '适中', destinations: input.destinations, candidates, selectedPoiIds: importedIds }, { signal })
    if (!buildResult.ok) throw new Error(buildResult.error)
    const plan = attachImportedSchedule(
      buildResult.data,
      input,
      unresolvedItems
    )
    trace.push({ step: '导入行程', toolName: 'build_trip_plan', input: { days: input.days }, output: { places: plan.route.destinations.length, activities: input.itineraryItems.length } })
    emit({ id: 'build-plan', label: '保留原始分天与顺序', detail: `已整理 ${input.days} 天、${input.itineraryItems.length} 项活动`, toolName: 'build_trip_plan', status: 'complete' })
    return { plan, trace }
  }
  const planMessage = await callDeepSeek(messages, { type: 'function', function: { name: 'build_trip_plan' } }, 800, signal)
  const { args } = readToolArguments(planMessage, 'build_trip_plan')
  const modelSelectedIds = Array.isArray(args.selected_poi_ids) ? args.selected_poi_ids.filter((id) => typeof id === 'string') : []
  const selectedPoiIds = [...new Set([...modelSelectedIds, ...importedIds])]
  const selectedForCoverage = selectedPoiIds.length >= input.days ? selectedPoiIds : candidates.map((poi) => poi.id)
  const buildResult = await executeAgentTool('build_trip_plan', { city: input.city, days: input.days, pace: input.pace, destinations: input.destinations, candidates, selectedPoiIds: selectedForCoverage }, { signal })
  if (!buildResult.ok) throw new Error(buildResult.error)
  const plan = buildResult.data
  trace.push({ step: '生成行程', toolName: 'build_trip_plan', input: { selectedPoiIds }, output: { count: plan.route.destinations.length } })
  emit({ id: 'build-plan', label: '编排每日游览顺序', detail: `已安排 ${plan.route.destinations.length} 个地点`, toolName: 'build_trip_plan', status: 'complete' })
  return { plan, trace }
}

export async function answerTripQuestion(input, emit, signal) {
  let poiContext = null
  const poiName = input.poiNames[0]
  if (poiName && input.city) {
    emit({ id: 'search-question-poi', label: '查询相关地点', detail: `${input.city} · ${poiName}`, toolName: 'search_poi_candidates', status: 'running' })
    const toolResult = await executeAgentTool('search_poi_candidates', { query: poiName, city: input.city, limit: 1 }, { signal })
    const result = toolResult.ok ? toolResult.data : { pois: [], warning: toolResult.error }
    poiContext = result.pois[0] || null
    emit({ id: 'search-question-poi', label: '查询相关地点', detail: poiContext ? `找到 ${poiContext.name}` : (result.warning || '没有找到可核实的地点信息'), toolName: 'search_poi_candidates', status: 'complete' })
  }
  const answerTools = [planningTools[0]]
  const messages = [
    { role: 'system', content: getPromptSet(input.promptVersion).answerSystem },
    ...input.recentMessages,
    { role: 'user', content: JSON.stringify({ question: input.message, city: input.city, verifiedPoi: poiContext, currentPlan: input.currentPlan ? poiSummary(input.currentPlan.route.destinations) : [] }) }
  ]
  let modelMessage
  if (!poiContext) {
    modelMessage = await callDeepSeek(messages, 'auto', 500, signal, answerTools)
    const calls = (modelMessage.tool_calls || []).filter((item) => item.function?.name === 'search_poi_candidates').slice(0, 2)
    if (calls.length) {
      const results = []
      for (const call of calls) {
        let args = {}; try { args = JSON.parse(call.function.arguments || '{}') } catch { args = {} }
        const query = asText(args.query, 80)
        const toolResult = await executeAgentTool('search_poi_candidates', { query, city: asText(args.city, 80) || input.city, limit: 1 }, { signal })
        const result = toolResult.ok ? toolResult.data : { pois: [], warning: toolResult.error }
        poiContext ||= result.pois?.[0] || null
        results.push({ call, result })
      }
      appendExecutedToolResults(messages, modelMessage, results)
      messages.push({ role: 'user', content: JSON.stringify({ instruction: '根据工具证据回答；工具没有提供的实时信息必须明确说无法核实。', verifiedPoi: poiContext }) })
      modelMessage = await callDeepSeek(messages, 'none', 800, signal, answerTools)
    }
  }
  if (!modelMessage?.content) modelMessage = await callDeepSeek(messages, 'none', 800, signal, answerTools)
  const answer = asText(modelMessage.content, 1600) || '这个信息目前还不能可靠确认。'
  const basis = poiContext
    ? `\n\n依据：高德 POI 已核实“${poiContext.name}”的地点身份与地址。营业时间、票价、预约和实时交通如未在上文明确给出，均尚未核实。`
    : '\n\n依据：一般旅行建议，未取得可核实的实时数据。'
  return `${answer}${basis}`
}

export async function enrichOperations(operations, city, emit = () => {}, signal) {
  const enriched = []
  for (const operation of operations.slice(0, 8)) {
    if (['add_poi', 'replace_poi'].includes(operation.type)) {
      const query = asText(operation.query, 80)
      if (!query) throw new Error('添加或替换地点前需要说明想找什么地点。')
      const activityId = `search-operation-${enriched.length}`
      emit({ id: activityId, label: '调用高德查找替代地点', detail: `${city} · ${query}`, toolName: 'search_poi_candidates', status: 'running' })
      const toolResult = await executeAgentTool('search_poi_candidates', { query, city, limit: 3 }, { signal })
      const result = toolResult.ok ? toolResult.data : { pois: [], warning: toolResult.error }
      const poi = result.pois[0]
      if (!poi) throw new Error(result.warning || `没有找到“${query}”的可用地点。`)
      emit({ id: activityId, label: '调用高德查找替代地点', detail: `选中 ${poi.name}`, toolName: 'search_poi_candidates', status: 'complete' })
      enriched.push(operation.type === 'replace_poi' ? { ...operation, replacement: poi } : { ...operation, poi })
    } else {
      enriched.push(operation)
    }
  }
  return enriched
}

export async function inferCityFromItinerary(input, emit = () => {}, signal) {
  if (input.city || input.sourceMode !== 'import' || !input.itineraryItems.length) return input
  const names = input.itineraryItems
    .filter((item) => ['poi', 'food', 'shopping'].includes(item.type))
    .map((item) => item.name)
    .slice(0, 3)
  if (!names.length) return input

  emit({ id: 'infer-city', label: '📍 正在确认这些地点属于哪里', detail: names.join('、'), toolName: 'search_poi_candidates', status: 'running' })
  const counts = new Map()
  for (const name of names) {
    const result = await executeAgentTool('search_poi_candidates', { query: name, city: '', limit: 1 }, { signal })
    const city = result.ok ? asText(result.data.pois[0]?.city, 30) : ''
    if (city) counts.set(city, (counts.get(city) || 0) + 1)
  }
  const [city, count = 0] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || []
  const confident = count >= 2 || (names.length === 1 && count === 1)
  emit({
    id: 'infer-city',
    label: confident ? '✅ 已确认目的地' : '📍 还需要确认目的地',
    detail: confident ? `${city} · ${count} 个地点相互印证` : '这些地点可能存在同名结果，请告诉我具体城市',
    toolName: 'search_poi_candidates',
    status: 'complete'
  })
  return confident ? { ...input, city } : input
}

export async function runAgentChat(body, emit = () => {}, signal) {
  emit({ id: 'understand-request', label: '🧭 正在读你的安排', detail: '先确认目的地、日期和你想保留的内容', status: 'running' })
  let input = normalizeInput(body)
  input = await extractConstraints(input, signal, emit)
  input = await inferCityFromItinerary(input, emit, signal)
  emit({
    id: 'understand-request',
    label: '✅ 已读懂这次要求',
    detail: [input.city, input.days ? `${input.days} 天` : '', input.pace].filter(Boolean).join(' · ') || '还需要补充旅行信息',
    status: 'complete'
  })

  const decision = detectAgentDecision(input)
  if (decision === 'answer_only') {
    const reply = await answerTripQuestion(input, emit, signal)
    return { decision, sourceMode: input.sourceMode, reply, operations: [], changes: [], warnings: [], constraints: publicConstraints(input), suggestions: buildSuggestions(decision, input) }
  }

  if (decision === 'ask_clarification') {
    const reply = !input.city && (!input.days || input.days > MAX_TRIP_DAYS)
      ? '我先把你写下的内容保存好了 🧭 还差两个信息：这次想去哪个城市、准备玩几天？'
      : !input.city
        ? `这份 ${input.days} 天安排我已经保留好了 🗺️ 还差一个信息：这次是在什么城市？你回答后我会接着整理，不需要重新粘贴。`
        : `目的地已经记下了 📍 这次准备玩几天？我可以安排 1–${MAX_TRIP_DAYS} 天。`
    return { decision, sourceMode: input.sourceMode, reply, operations: [], changes: [], warnings: [], constraints: publicConstraints(input), suggestions: buildSuggestions(decision, input) }
  }

  if (decision === 'create_plan') {
    input.destinations = input.destinations.length ? input.destinations : []
    const { plan } = await generateInitialPlan(input, emit, signal)
    emit({ id: 'validate-plan', label: '✅ 已确认没有打乱原计划', detail: plan.warnings.length ? `${plan.warnings.length} 条信息需要你留意` : '地点、天数和顺序都已对齐', toolName: 'validate_plan', status: 'complete' })
    return {
      decision,
      sourceMode: input.sourceMode,
      reply: input.sourceMode === 'import'
        ? `🗺️ 我已经把这份 ${input.city} ${input.days} 日安排整理好了，原来的分天、时段和活动顺序都保留着。整体看起来是${plan.diagnostics?.overall || '适中'}节奏，我只做了整理，没有擅自删改。`
        : `🗺️ ${input.city} ${input.days} 日行程已经整理好，地图和日程也同步了。你可以继续告诉我哪一天想放松一点，或者哪些地点一定要保留。`,
      operations: [{ type: 'create_plan' }],
      plan,
      changes: [{ type: 'create_plan', message: input.sourceMode === 'import' ? `已按原文导入 ${input.city} ${input.days} 日行程` : `已生成 ${input.city} ${input.days} 日行程` }],
      warnings: plan.warnings,
      constraints: publicConstraints(input),
      suggestions: buildSuggestions(decision, input, plan)
    }
  }

  emit({ id: 'choose-operations', label: '🧭 正在找到需要调整的部分', detail: '只动与你这次要求相关的地点和日期', toolName: 'modify_trip_plan', status: 'running' })
  const messages = [
    {
      role: 'system',
      content: getPromptSet(input.promptVersion).modifySystem
    },
    ...input.recentMessages,
    {
      role: 'user',
      content: JSON.stringify({ request: input.message, constraints: publicConstraints(input), currentPlan: poiSummary(input.currentPlan.route.destinations) })
    }
  ]
  let parsed
  let rawOperations
  {
    let modelMessage = await callDeepSeek(messages, { type: 'function', function: { name: 'modify_trip_plan' } }, 1000, signal)
    parsed = readToolArguments(modelMessage, 'modify_trip_plan')
    rawOperations = Array.isArray(parsed.args.operations) ? parsed.args.operations : []
    if (!parsed.call || !rawOperations.length) {
      messages.push({ role: 'system', content: getPromptSet(input.promptVersion).repairSystem })
      modelMessage = await callDeepSeek(messages, { type: 'function', function: { name: 'modify_trip_plan' } }, 1000, signal)
      parsed = readToolArguments(modelMessage, 'modify_trip_plan')
      rawOperations = Array.isArray(parsed.args.operations) ? parsed.args.operations : []
    }
  }
  if (!parsed.call || !rawOperations.length) throw new Error('没有生成可执行的行程调整，请换一种更具体的说法。')

  emit({ id: 'choose-operations', label: '判断需要修改的部分', detail: `准备执行 ${rawOperations.length} 项调整`, toolName: 'modify_trip_plan', status: 'complete' })
  if (rawOperations.some((operation) => operation.type === 'replan_all')) {
    input.destinations = input.currentPlan.route.destinations
    const { plan } = await generateInitialPlan(input, emit, signal)
    emit({ id: 'validate-plan', label: '检查行程结果', detail: plan.warnings.length ? `${plan.warnings.length} 条提醒` : '完整行程检查通过', toolName: 'validate_plan', status: 'complete' })
    return { decision, reply: asText(parsed.args.reply, 1000) || '已重新规划整份行程。', operations: rawOperations, plan, changes: [{ type: 'replan_all', message: '已重新规划整份行程' }], warnings: plan.warnings, constraints: publicConstraints(input), suggestions: buildSuggestions(decision, input, plan) }
  }

  const operations = await enrichOperations(rawOperations, input.city, emit, signal)
  emit({ id: 'apply-operations', label: '执行并校验行程修改', detail: `${operations.length} 项调整`, toolName: 'apply_plan_operations', status: 'running' })
  const applyResult = await executeAgentTool('apply_plan_operations', { plan: input.currentPlan, operations, context: { city: input.city, pace: input.pace } }, { signal })
  if (!applyResult.ok) throw new Error(applyResult.error)
  const result = applyResult.data
  emit({ id: 'apply-operations', label: '执行并校验行程修改', detail: result.changes.length ? `已完成 ${result.changes.length} 项修改` : '当前行程无需修改', toolName: 'apply_plan_operations', status: 'complete' })
  return {
    decision,
    reply: asText(parsed.args.reply, 1000) || (result.changes.length ? '已按你的要求调整行程。' : '当前行程无需调整。'),
    operations: rawOperations,
    plan: result.changes.length ? result.plan : undefined,
    changes: result.changes,
    warnings: result.warnings,
    constraints: publicConstraints(input),
    suggestions: buildSuggestions(decision, input, result.plan)
  }
}

const agentRuntime = new AgentRuntime(runAgentChat)

export default function agentRoutes() {
  const router = express.Router()

  router.post('/plan', async (req, res) => {
    if (!process.env.DEEPSEEK_API_KEY) return res.status(503).json({ error: '服务端未配置 DEEPSEEK_API_KEY。' })
    try {
      const input = await extractConstraints(normalizeInput(req.body))
      if (!input.city || input.days < 1 || input.days > MAX_TRIP_DAYS) return res.status(400).json({ error: `请补充单个目的地城市和 1-${MAX_TRIP_DAYS} 天旅行时长。` })
      const { plan, trace } = await generateInitialPlan(input)
      res.json({ message: `已生成 ${input.city} ${input.days} 日行程。`, constraints: { city: input.city, days: input.days, pace: input.pace }, plan, trace })
    } catch (error) {
      console.error('Agent planning failed:', error)
      res.status(502).json({ error: error instanceof Error ? error.message : 'Agent 规划失败。' })
    }
  })

  router.post('/chat', async (req, res) => {
    if (!process.env.DEEPSEEK_API_KEY) return res.status(503).json({ error: '服务端未配置 DEEPSEEK_API_KEY。' })
    try {
      const payload = await agentRuntime.run(req.body)
      res.json({ ...payload, promptVersion: getPromptSet(req.body?.promptVersion).version })
    } catch (error) {
      console.error('Agent chat failed:', error)
      res.status(502).json({ error: error instanceof Error ? error.message : 'Agent 调整失败。' })
    }
  })

  router.post('/chat/stream', async (req, res) => {
    if (!process.env.DEEPSEEK_API_KEY) return res.status(503).json({ error: '服务端未配置 DEEPSEEK_API_KEY。' })
    const controller = new AbortController()
    req.on('aborted', () => controller.abort())
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    res.status(200)
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    const send = (event) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`)
    }
    try {
      const payload = await agentRuntime.run(req.body, (activity) => send({ type: 'activity', activity }), controller.signal)
      send({ type: 'final', payload: { ...payload, promptVersion: getPromptSet(req.body?.promptVersion).version } })
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('Agent stream chat failed:', error)
        send({ type: 'error', error: error instanceof Error ? error.message : 'Agent 调整失败。' })
      }
    } finally {
      res.end()
    }
  })

  return router
}
