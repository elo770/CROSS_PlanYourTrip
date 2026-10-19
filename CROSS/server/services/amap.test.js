import test from 'node:test'
import assert from 'node:assert/strict'
import { getAmapDirection, getAmapPoiDetails, parseDirectionPayload, searchAmapPois, searchAmapSuggestions } from './amap.js'

test('uses city as a preference and ranks exact POI names first', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.AMAP_KEY
  let requestedUrl = ''
  process.env.AMAP_KEY = 'test-key'
  globalThis.fetch = async (input) => {
    requestedUrl = String(input)
    return { ok: true, json: async () => ({
      status: '1',
      pois: [
        { id: 'shop', name: '雍和宫艺盛堂用具', cityname: '德州市', adname: '德城区', address: '某街道', location: '116.3,37.4' },
        { id: 'temple', name: '雍和宫', cityname: '北京市', adname: '东城区', address: '雍和宫大街28号', location: '116.4,39.9' }
      ]
    }) }
  }

  try {
    const result = await searchAmapPois({ query: '雍和宫', city: '北京', limit: 10 })
    assert.equal(result.pois[0].id, 'temple')
    assert.equal(result.pois[0].district, '东城区')
    assert.match(requestedUrl, /city=%E5%8C%97%E4%BA%AC/)
    assert.match(requestedUrl, /citylimit=false/)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.AMAP_KEY
    else process.env.AMAP_KEY = originalKey
  }
})

test('returns input tips and POI details with stable provider IDs', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.AMAP_KEY
  process.env.AMAP_KEY = 'test-key'
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/assistant/inputtips')) {
      return { ok: true, json: async () => ({ status: '1', tips: [{ id: 'tip-1', name: '雍和宫', district: '北京市东城区', address: '雍和宫大街28号', location: '116.4,39.9' }] }) }
    }
    return { ok: true, json: async () => ({ status: '1', pois: [{ id: 'tip-1', name: '雍和宫', cityname: '北京市', adname: '东城区', address: '雍和宫大街28号', location: '116.4,39.9' }] }) }
  }

  try {
    const suggestions = await searchAmapSuggestions({ query: '雍和宫' })
    const details = await getAmapPoiDetails({ id: 'tip-1' })
    assert.equal(suggestions.pois[0].id, 'tip-1')
    assert.equal(details.poi.id, 'tip-1')
    assert.equal(details.poi.city, '北京')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.AMAP_KEY
    else process.env.AMAP_KEY = originalKey
  }
})

for (const mode of ['walk', 'cycle', 'drive']) {
  test(`parses ${mode} route distance, duration and geometry`, () => {
    const result = parseDirectionPayload({
      route: {
        paths: [{
          distance: '1999',
          cost: { duration: '720' },
          steps: [
            { polyline: '118.700000,32.000000;118.710000,32.010000' },
            { polyline: '118.710000,32.010000;118.720000,32.020000' }
          ]
        }]
      }
    }, mode)

    assert.equal(result.distanceMeters, 1999)
    assert.equal(result.durationSeconds, 720)
    assert.deepEqual(result.path, [
      [118.7, 32],
      [118.71, 32.01],
      [118.72, 32.02]
    ])
  })
}

test('parses transit geometry from nested segments', () => {
  const result = parseDirectionPayload({
    route: {
      transits: [{
        distance: '8500',
        cost: { duration: '2400' },
        segments: [{
          walking: { steps: [{ polyline: { polyline: '118.700000,32.000000;118.705000,32.005000' } }] },
          bus: { buslines: [{ polyline: { polyline: '118.705000,32.005000;118.750000,32.050000' } }] }
        }]
      }]
    }
  }, 'transit')

  assert.equal(result.distanceMeters, 8500)
  assert.equal(result.durationSeconds, 2400)
  assert.equal(result.path.length, 3)
})

test('rejects a route without drawable geometry', () => {
  assert.throws(() => parseDirectionPayload({
    route: { paths: [{ distance: '2001', cost: { duration: '300' }, steps: [] }] }
  }, 'walk'), /缺少可绘制/)
})

test('maps all four modes and supplies transit city codes', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.AMAP_KEY
  const requestedUrls = []
  process.env.AMAP_KEY = 'test-key'
  globalThis.fetch = async (input) => {
    const url = String(input)
    requestedUrls.push(url)
    if (url.includes('/v3/geocode/regeo')) {
      return { ok: true, json: async () => ({ status: '1', regeocode: { addressComponent: { citycode: '021' } } }) }
    }
    if (url.includes('/transit/integrated')) {
      return { ok: true, json: async () => ({
        status: '1',
        route: { transits: [{ distance: '3000', cost: { duration: '900' }, segments: [{ walking: { steps: [{ polyline: { polyline: '121.1,31.1;121.2,31.2' } }] } }] }] }
      }) }
    }
    return { ok: true, json: async () => ({
      status: '1',
      route: { paths: [{ distance: '1000', cost: { duration: '600' }, steps: [{ polyline: '121.1,31.1;121.2,31.2' }] }] }
    }) }
  }

  try {
    const modes = ['walk', 'cycle', 'drive', 'transit']
    for (const [index, mode] of modes.entries()) {
      await getAmapDirection({
        origin: [121.1 + index * 0.01, 31.1],
        destination: [121.2 + index * 0.01, 31.2],
        mode
      })
    }
    assert.ok(requestedUrls.some((url) => url.includes('/direction/walking')))
    assert.ok(requestedUrls.some((url) => url.includes('/direction/bicycling')))
    assert.ok(requestedUrls.some((url) => url.includes('/direction/driving')))
    const transitUrl = requestedUrls.find((url) => url.includes('/direction/transit/integrated'))
    assert.match(transitUrl, /city1=021/)
    assert.match(transitUrl, /city2=021/)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.AMAP_KEY
    else process.env.AMAP_KEY = originalKey
  }
})

test('reuses a direction result within the 24-hour cache window', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.AMAP_KEY
  let calls = 0
  process.env.AMAP_KEY = 'test-key'
  globalThis.fetch = async () => {
    calls += 1
    return { ok: true, json: async () => ({
      status: '1',
      route: { paths: [{ distance: '800', cost: { duration: '500' }, steps: [{ polyline: '120.1,30.1;120.2,30.2' }] }] }
    }) }
  }

  try {
    const request = { origin: [120.111111, 30.1], destination: [120.222222, 30.2], mode: 'walk' }
    const first = await getAmapDirection(request)
    const second = await getAmapDirection(request)
    assert.equal(calls, 1)
    assert.equal(first.cached, false)
    assert.equal(second.cached, true)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.AMAP_KEY
    else process.env.AMAP_KEY = originalKey
  }
})

test('surfaces the daily quota error instead of returning a fake route', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.AMAP_KEY
  process.env.AMAP_KEY = 'test-key'
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: '0', info: 'DAILY_QUERY_OVER_LIMIT' }) })

  try {
    await assert.rejects(
      getAmapDirection({ origin: [119.111111, 29.1], destination: [119.222222, 29.2], mode: 'walk' }),
      /今日额度已用完/
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.AMAP_KEY
    else process.env.AMAP_KEY = originalKey
  }
})
