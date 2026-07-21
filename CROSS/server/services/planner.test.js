import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTripPlan } from './planner.js'

function place(id, name, lng, lat) {
  return { id, name, coordinates: [lng, lat] }
}

test('pasted itinerary keeps explicit days and within-day order', () => {
  const candidates = [
    { id: 'a', name: '中山陵', coordinates: [118.85, 32.06], requestedDay: 1, requestedWithinDayOrder: 1 },
    { id: 'b', name: '玄武湖', coordinates: [118.80, 32.07], requestedDay: 1, requestedWithinDayOrder: 2 },
    { id: 'c', name: '总统府', coordinates: [118.79, 32.04], requestedDay: 2, requestedWithinDayOrder: 1 },
    { id: 'd', name: '十朝酥', coordinates: [118.78, 32.03], requestedDay: 4, requestedWithinDayOrder: 1 }
  ]
  const plan = buildTripPlan({ city: '南京', days: 4, pace: '轻松', destinations: [], candidates })
  assert.deepEqual(
    plan.route.destinations.map((place) => [place.name, place.day, place.withinDayOrder]),
    [['中山陵', 1, 1], ['玄武湖', 1, 2], ['总统府', 2, 1], ['十朝酥', 4, 1]]
  )
  assert.equal(plan.schedule.length, 4)
})

test('explicit itinerary is preserved even when a day exceeds the selected pace', () => {
  const candidates = Array.from({ length: 4 }, (_, index) => ({
    id: String(index),
    name: `地点${index + 1}`,
    coordinates: [118.78 + index * 0.01, 32.03],
    requestedDay: 1,
    requestedWithinDayOrder: index + 1
  }))
  const plan = buildTripPlan({ city: '南京', days: 2, pace: '轻松', destinations: [], candidates })
  assert.equal(plan.route.destinations.length, 4)
  assert.match(plan.warnings.join('\n'), /第 1 天有 4 个地点/)
})

test('generated places cover the final day when enough candidates exist', () => {
  const candidates = Array.from({ length: 5 }, (_, index) => place(`p${index}`, `地点${index}`, 118.7 + index * 0.01, 32 + index * 0.01))
  const plan = buildTripPlan({ city: '南京', days: 4, pace: '适中', destinations: [], candidates })
  assert.deepEqual([...new Set(plan.route.destinations.map((item) => item.day))], [1, 2, 3, 4])
})

test('nearby candidates with overlapping normalized names are deduplicated', () => {
  const plan = buildTripPlan({
    city: '南京',
    days: 2,
    pace: '适中',
    destinations: [],
    candidates: [
      place('a', '夫子庙秦淮风光带', 118.788, 32.021),
      place('b', '南京夫子庙', 118.789, 32.022),
      place('c', '玄武湖景区', 118.796, 32.071)
    ]
  })
  assert.deepEqual(plan.route.destinations.map((item) => item.name), ['夫子庙秦淮风光带', '玄武湖景区'])
})
