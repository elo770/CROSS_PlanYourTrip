import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPlanOperations } from './planOperations.js'

function place(id, day, options = {}) {
  return {
    id,
    name: id,
    coordinates: [120 + day / 100, 30 + day / 100],
    order: Number(id.replace(/\D/g, '')) || 1,
    day,
    withinDayOrder: 1,
    planningStatus: 'scheduled',
    poiStatus: 'optional',
    ...options
  }
}

function plan(destinations) {
  return {
    route: { id: 'route-1', name: '杭州两日', destinations, totalDistance: 0, estimatedDays: 2 },
    schedule: [],
    warnings: []
  }
}

test('move_poi only changes the requested POI day', () => {
  const source = plan([place('p1', 1), place('p2', 1), place('p3', 2)])
  const result = applyPlanOperations(source, [{ type: 'move_poi', poiId: 'p2', targetDay: 2 }], { city: '杭州', pace: '适中' })
  assert.equal(result.plan.route.destinations.find((item) => item.id === 'p1').day, 1)
  assert.equal(result.plan.route.destinations.find((item) => item.id === 'p2').day, 2)
  assert.equal(result.plan.route.destinations.find((item) => item.id === 'p3').day, 2)
  assert.deepEqual(result.plan.schedule.map((day) => day.day), [1, 2])
})

test('locked and must-go POIs cannot be removed', () => {
  const locked = plan([place('p1', 1, { locked: true })])
  assert.throws(
    () => applyPlanOperations(locked, [{ type: 'remove_poi', poiId: 'p1' }], { city: '杭州', pace: '适中' }),
    /不能直接删除/
  )
  const mustGo = plan([place('p1', 1, { poiStatus: 'must_go' })])
  assert.throws(
    () => applyPlanOperations(mustGo, [{ type: 'remove_poi', poiId: 'p1' }], { city: '杭州', pace: '适中' }),
    /不能直接删除/
  )
})

test('relaxed day keeps three places and moves optional overflow to unscheduled', () => {
  const source = plan([place('p1', 1), place('p2', 1), place('p3', 1), place('p4', 1)])
  const result = applyPlanOperations(source, [{ type: 'change_day_pace', targetDay: 1, pace: '轻松' }], { city: '杭州', pace: '轻松' })
  const scheduled = result.plan.route.destinations.filter((item) => item.planningStatus === 'scheduled')
  const unscheduled = result.plan.route.destinations.filter((item) => item.planningStatus === 'unscheduled')
  assert.equal(scheduled.length, 3)
  assert.equal(unscheduled.length, 1)
  assert.equal(unscheduled[0].day, undefined)
})

test('replacing a locked POI is rejected', () => {
  const source = plan([place('p1', 1, { locked: true })])
  assert.throws(
    () => applyPlanOperations(source, [{ type: 'replace_poi', poiId: 'p1', replacement: place('new', 1) }], { city: '杭州', pace: '适中' }),
    /不能直接替换/
  )
})

test('reorder_poi persists the requested within-day position after normalization', () => {
  const source = plan([
    place('p1', 1, { name: '中山陵', withinDayOrder: 1 }),
    place('p2', 1, { name: '明孝陵', withinDayOrder: 2 })
  ])
  const result = applyPlanOperations(source, [{ type: 'reorder_poi', poiId: 'p2', targetIndex: 1 }], { city: '南京', pace: '适中' })
  assert.deepEqual(
    result.plan.route.destinations.filter((item) => item.day === 1).map((item) => item.id),
    ['p2', 'p1']
  )
})

test('optimize_route_order shortens each day without moving places between days', () => {
  const source = plan([
    place('p1', 1, { coordinates: [0, 0], withinDayOrder: 1 }),
    place('p2', 1, { coordinates: [10, 0], withinDayOrder: 2 }),
    place('p3', 1, { coordinates: [1, 0], withinDayOrder: 3 }),
    place('p4', 2, { coordinates: [20, 0], withinDayOrder: 1 })
  ])
  const result = applyPlanOperations(source, [{ type: 'optimize_route_order' }], { city: '南京', pace: '适中' })

  assert.deepEqual(result.plan.route.destinations.filter((item) => item.day === 1).map((item) => item.id), ['p1', 'p3', 'p2'])
  assert.equal(result.plan.route.destinations.find((item) => item.id === 'p4').day, 2)
  assert.equal(result.changes[0].type, 'optimize_route_order')
})
