import test from 'node:test'
import assert from 'node:assert/strict'
import { GET as search } from '../../api/poi/search.js'
import { GET as suggest } from '../../api/poi/suggest.js'
import { GET as detail } from '../../api/poi/detail.js'
import { POST as segment } from '../../api/directions/segment.js'

test('Vercel endpoints return JSON errors for missing input or server key', async () => {
  const originalKey = process.env.AMAP_KEY
  delete process.env.AMAP_KEY
  try {
    assert.equal((await search(new Request('http://localhost/api/poi/search'))).status, 400)
    assert.equal((await suggest(new Request('http://localhost/api/poi/suggest'))).status, 400)
    assert.equal((await detail(new Request('http://localhost/api/poi/detail'))).status, 400)
    assert.equal((await search(new Request('http://localhost/api/poi/search?query=雍和宫'))).status, 503)
    const response = await segment(new Request('http://localhost/api/directions/segment', {
      method: 'POST', body: JSON.stringify({ origin: [116.4, 39.9], destination: [116.5, 39.9], mode: 'walk' })
    }))
    assert.equal(response.status, 502)
    assert.match((await response.json()).error, /AMAP_KEY/)
  } finally {
    if (originalKey === undefined) delete process.env.AMAP_KEY
    else process.env.AMAP_KEY = originalKey
  }
})

test('Vercel endpoints use the existing AMap service and return the frontend contract', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.AMAP_KEY
  process.env.AMAP_KEY = 'test-key'
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/assistant/inputtips')) {
      return { ok: true, json: async () => ({ status: '1', tips: [{ id: 'poi-1', name: '雍和宫', district: '东城区', location: '116.4,39.9' }] }) }
    }
    if (url.includes('/place/')) {
      return { ok: true, json: async () => ({ status: '1', pois: [{ id: 'poi-1', name: '雍和宫', cityname: '北京市', adname: '东城区', address: '雍和宫大街28号', location: '116.4,39.9' }] }) }
    }
    return { ok: true, json: async () => ({ status: '1', route: { paths: [{ distance: '800', cost: { duration: '500' }, steps: [{ polyline: '116.4,39.9;116.5,39.9' }] }] } }) }
  }

  try {
    const poi = await search(new Request('http://localhost/api/poi/search?query=雍和宫'))
    assert.equal(poi.status, 200)
    assert.deepEqual((await poi.json()).pois[0].coordinates, [116.4, 39.9])
    assert.equal((await suggest(new Request('http://localhost/api/poi/suggest?query=雍和宫'))).status, 200)
    assert.equal((await detail(new Request('http://localhost/api/poi/detail?id=poi-1'))).status, 200)
    const route = await segment(new Request('http://localhost/api/directions/segment', {
      method: 'POST', body: JSON.stringify({ origin: [116.4, 39.9], destination: [116.5, 39.9], mode: 'walk' })
    }))
    assert.equal(route.status, 200)
    assert.equal((await route.json()).distanceMeters, 800)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.AMAP_KEY
    else process.env.AMAP_KEY = originalKey
  }
})
