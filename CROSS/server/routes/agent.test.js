import test from 'node:test'
import assert from 'node:assert/strict'
import { appendExecutedToolResults, detectAgentDecision, hasUsablePlan, parseDaysFromMessage, parseMaxDayHeading } from './agent.js'

const scheduledPlan = {
  route: {
    destinations: [{ id: 'x', name: '西湖', day: 1, planningStatus: 'scheduled' }]
  },
  schedule: [{ day: 1 }]
}

test('candidate POIs are not treated as an existing itinerary', () => {
  assert.equal(hasUsablePlan({ route: { destinations: [{ id: 'x', day: 1, planningStatus: 'candidate' }] } }), false)
})

test('a complete itinerary is detected from scheduled POIs', () => {
  assert.equal(hasUsablePlan(scheduledPlan), true)
})

test('explicit planning creates a plan when no usable plan exists', () => {
  assert.equal(detectAgentDecision({ message: '帮我整理南京三日行程', city: '南京', days: 3, currentPlan: null }), 'create_plan')
})

test('travel questions do not modify an existing plan', () => {
  assert.equal(detectAgentDecision({ message: '南京博物院几点关门？', city: '南京', days: 3, currentPlan: scheduledPlan }), 'answer_only')
})

test('evaluative questions about the itinerary do not modify it', () => {
  assert.equal(detectAgentDecision({ message: '你觉得第二天这样安排合理吗？', city: '南京', days: 3, currentPlan: scheduledPlan }), 'answer_only')
  assert.equal(detectAgentDecision({ message: '第二天会不会太赶？', city: '南京', days: 3, currentPlan: scheduledPlan }), 'answer_only')
})

test('day-specific requests modify the existing plan', () => {
  assert.equal(detectAgentDecision({ message: '第二天轻松一点', city: '南京', days: 3, currentPlan: scheduledPlan }), 'modify_plan')
})

test('explicit Arabic and Chinese trip durations are parsed without relying on the model', () => {
  assert.equal(parseDaysFromMessage('南京玩 3 天，节奏轻松'), 3)
  assert.equal(parseDaysFromMessage('四天'), 4)
  assert.equal(parseDaysFromMessage('安排十四日游'), 14)
})

test('ordinal day references do not overwrite total trip duration', () => {
  assert.equal(parseDaysFromMessage('第二天轻松一点'), 0)
  assert.equal(parseMaxDayHeading('第一天：中山陵\n第二天：总统府\n第四天：买伴手礼'), 4)
})

test('four-day trip requests can create a plan', () => {
  assert.equal(detectAgentDecision({ message: '四天', city: '南京', days: 4, currentPlan: null }), 'create_plan')
})

test('every forwarded tool call has one matching tool result', () => {
  const messages = []
  const calls = [
    { id: 'call-1', function: { name: 'search_poi_candidates', arguments: '{}' } },
    { id: 'call-2', function: { name: 'search_poi_candidates', arguments: '{}' } }
  ]
  appendExecutedToolResults(messages, { content: null, tool_calls: calls }, [
    { call: calls[0], result: { pois: ['A'] } },
    { call: calls[1], result: { pois: ['B'] } }
  ])
  assert.deepEqual(messages[0].tool_calls.map((call) => call.id), ['call-1', 'call-2'])
  assert.deepEqual(messages.slice(1).map((message) => message.tool_call_id), ['call-1', 'call-2'])
})
