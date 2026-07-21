import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTripOperations, buildOutline, routeToTrip, validateTripOutline } from './tripModel.js'

test('legacy route becomes one detailed trip segment', () => {
  const trip = routeToTrip({ id: 'r1', name: '南京两日', estimatedDays: 2, destinations: [{ id: 'p1', name: '中山陵', day: 1 }] }, { city: '南京' }, [])
  assert.equal(trip.segments.length, 1)
  assert.equal(trip.segments[0].city, '南京')
  assert.equal(trip.segments[0].status, 'detailed')
})

test('multi-city outline allocates all days with continuous dates', () => {
  const trip = buildOutline({ totalDays: 30, startDate: '2026-08-01', cities: [{ city: '北京', days: 6 }, { city: '西安', days: 4 }, { city: '成都', days: 8 }, { city: '昆明', days: 12 }] })
  assert.deepEqual(validateTripOutline(trip), [])
  assert.equal(trip.segments.reduce((sum, item) => sum + item.days, 0), 30)
  assert.equal(trip.segments[1].startDate, '2026-08-07')
  assert.equal(trip.segments[0].endDate, '2026-08-06')
})

test('outline rejects totals above sixty days', () => {
  assert.throws(() => buildOutline({ totalDays: 61, cities: ['北京'] }), /1-60/)
})

test('changing one city stay shifts later segment dates deterministically', () => {
  const trip = buildOutline({ totalDays: 10, startDate: '2026-08-01', cities: [{ city: '北京', days: 3 }, { city: '成都', days: 3 }, { city: '昆明', days: 4 }] })
  const result = applyTripOperations(trip, [{ type: 'change_segment_days', city: '成都', days: 5 }])
  assert.equal(result.trip.totalDays, 12)
  assert.equal(result.trip.segments[2].startDate, '2026-08-09')
  assert.equal(result.trip.segments[2].endDate, '2026-08-12')
  assert.deepEqual(result.changes[0].affectedSegmentIds, [trip.segments[2].id])
})
