const AMAP_MIN_INTERVAL_MS = 450
const AMAP_QPS_LIMIT_CODES = new Set(['CUQPS_HAS_EXCEEDED_THE_LIMIT', 'USER_QPS_HAS_EXCEEDED_THE_LIMIT'])
let amapQueue = Promise.resolve()
let lastAmapRequestAt = 0

function wait(ms, signal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

function enqueueAmapRequest(task) {
  const run = amapQueue.then(task, task)
  amapQueue = run.then(() => undefined, () => undefined)
  return run
}

export async function searchAmapPois({ query, city, limit = 5, signal }) {
  const key = process.env.AMAP_KEY
  if (!key) {
    return { pois: [], warning: '服务端未配置 AMAP_KEY，无法自动补充 POI。' }
  }

  const url = new URL('https://restapi.amap.com/v3/place/text')
  url.search = new URLSearchParams({
    keywords: query,
    city,
    citylimit: 'false',
    offset: String(Math.min(Math.max(limit, 1), 10)),
    page: '1',
    extensions: 'all',
    key
  }).toString()

  const data = await enqueueAmapRequest(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const interval = Math.max(0, AMAP_MIN_INTERVAL_MS - (Date.now() - lastAmapRequestAt))
      await wait(interval, signal)
      lastAmapRequestAt = Date.now()
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`高德 POI 请求失败：${response.status}`)
      const payload = await response.json()
      if (payload.status === '1') return payload
      if (AMAP_QPS_LIMIT_CODES.has(payload.info) && attempt < 2) {
        await wait(700 * (attempt + 1), signal)
        continue
      }
      if (AMAP_QPS_LIMIT_CODES.has(payload.info)) {
        throw new Error('高德地点查询当前较忙，请稍后重试；你的行程和消息都已保留。')
      }
      if (String(payload.info || '').includes('DAILY_QUERY_OVER_LIMIT')) {
        throw new Error('高德地点查询今日额度已用完，暂时无法核实这些地点。')
      }
      throw new Error(payload.info || '高德 POI 接口返回异常')
    }
    throw new Error('高德地点查询暂时不可用。')
  })

  const pois = rankPois((data.pois || []).flatMap((poi, index) => {
    if (!poi.location) return []
    const [lng, lat] = poi.location.split(',').map(Number)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return []
    const address = [poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean).join(' ')
    return [{
      id: poi.id || `amap-${Date.now()}-${index}`,
      name: poi.name,
      city: typeof poi.cityname === 'string' ? poi.cityname.replace(/市$/, '') : '',
      district: typeof poi.adname === 'string' ? poi.adname : '',
      address: typeof poi.address === 'string' ? poi.address : '',
      description: address,
      coordinates: [lng, lat],
      order: index + 1,
      poiStatus: 'optional',
      planningStatus: 'candidate',
      source: 'ai'
    }]
  }), query)

  return { pois }
}

function rankPois(pois, query) {
  const normalizedQuery = String(query || '').replace(/\s+/g, '').toLowerCase()
  const rank = (name) => {
    const normalizedName = String(name || '').replace(/\s+/g, '').toLowerCase()
    if (normalizedName === normalizedQuery) return 0
    if (normalizedName.startsWith(normalizedQuery)) return 1
    if (normalizedName.includes(normalizedQuery)) return 2
    return 3
  }
  return pois
    .map((poi, index) => ({ poi, index, rank: rank(poi.name) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ poi }) => poi)
}

export async function searchAmapSuggestions({ query, city, limit = 8, signal }) {
  const key = process.env.AMAP_KEY
  if (!key) return { pois: [], warning: '服务端未配置 AMAP_KEY，无法搜索地点。' }

  const url = new URL('https://restapi.amap.com/v3/assistant/inputtips')
  url.search = new URLSearchParams({
    keywords: query,
    city,
    citylimit: 'false',
    datatype: 'all',
    key
  }).toString()
  const data = await requestAmapPayload(url, signal, '高德地点提示')
  const pois = rankPois((data.tips || []).flatMap((tip, index) => {
    if (typeof tip.location !== 'string') return []
    const [lng, lat] = tip.location.split(',').map(Number)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return []
    const district = typeof tip.district === 'string' ? tip.district : ''
    const address = typeof tip.address === 'string' ? tip.address : ''
    return [{
      id: tip.id || `amap-tip-${Date.now()}-${index}`,
      name: tip.name,
      city: '',
      district,
      address,
      description: [district, address].filter(Boolean).join(' '),
      coordinates: [lng, lat],
      order: index + 1,
      poiStatus: 'optional',
      planningStatus: 'candidate',
      source: 'ai'
    }]
  }), query).slice(0, Math.min(Math.max(limit, 1), 10))
  return { pois }
}

export async function getAmapPoiDetails({ id, signal }) {
  const key = process.env.AMAP_KEY
  if (!key) return { poi: null, warning: '服务端未配置 AMAP_KEY，无法读取地点信息。' }

  const url = new URL('https://restapi.amap.com/v3/place/detail')
  url.search = new URLSearchParams({ id, extensions: 'all', key }).toString()
  const data = await requestAmapPayload(url, signal, '高德地点详情')
  const poi = (data.pois || []).flatMap((item) => {
    if (!item.location) return []
    const [lng, lat] = item.location.split(',').map(Number)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return []
    return [{
      id: item.id || id,
      name: item.name,
      city: typeof item.cityname === 'string' ? item.cityname.replace(/市$/, '') : '',
      district: typeof item.adname === 'string' ? item.adname : '',
      address: typeof item.address === 'string' ? item.address : '',
      description: [item.pname, item.cityname, item.adname, item.address].filter(Boolean).join(' '),
      coordinates: [lng, lat],
      order: 1,
      poiStatus: 'optional',
      planningStatus: 'candidate',
      source: 'ai'
    }]
  })[0] || null
  return { poi }
}

const DIRECTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const directionCache = new Map()

function coordinateText([lng, lat]) {
  return `${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`
}

async function requestAmapPayload(url, signal, label) {
  return enqueueAmapRequest(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const interval = Math.max(0, AMAP_MIN_INTERVAL_MS - (Date.now() - lastAmapRequestAt))
      await wait(interval, signal)
      lastAmapRequestAt = Date.now()
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`${label}请求失败：${response.status}`)
      const payload = await response.json()
      if (payload.status === '1') return payload
      if (AMAP_QPS_LIMIT_CODES.has(payload.info) && attempt < 2) {
        await wait(700 * (attempt + 1), signal)
        continue
      }
      if (AMAP_QPS_LIMIT_CODES.has(payload.info)) throw new Error(`${label}当前较忙，请稍后重试。`)
      if (String(payload.info || '').includes('DAILY_QUERY_OVER_LIMIT')) throw new Error(`${label}今日额度已用完。`)
      throw new Error(payload.info || `${label}返回异常`)
    }
    throw new Error(`${label}暂时不可用。`)
  })
}

function parsePolyline(value) {
  if (typeof value !== 'string') return []
  return value.split(';').flatMap((point) => {
    const [lng, lat] = point.split(',').map(Number)
    return Number.isFinite(lng) && Number.isFinite(lat) ? [[lng, lat]] : []
  })
}

function collectPolylines(value, result = []) {
  if (!value || typeof value !== 'object') return result
  for (const [key, child] of Object.entries(value)) {
    if (key === 'polyline' && typeof child === 'string') result.push(child)
    else collectPolylines(child, result)
  }
  return result
}

function joinPath(polylines) {
  const path = polylines.flatMap(parsePolyline)
  return path.filter((point, index) => index === 0 || point[0] !== path[index - 1][0] || point[1] !== path[index - 1][1])
}

export function parseDirectionPayload(payload, mode) {
  const route = payload?.route
  if (mode === 'transit') {
    const transit = route?.transits?.[0]
    if (!transit) throw new Error('未获取到公共交通路线。')
    const path = joinPath(collectPolylines(transit))
    if (path.length < 2) throw new Error('公共交通路线缺少可绘制的道路信息。')
    return {
      distanceMeters: Number(transit.distance),
      durationSeconds: Number(transit.cost?.duration ?? transit.duration),
      path
    }
  }

  const selectedPath = route?.paths?.[0]
  if (!selectedPath) throw new Error('未获取到可用路线。')
  const path = joinPath(collectPolylines(selectedPath.steps || []))
  if (path.length < 2) throw new Error('路线缺少可绘制的道路信息。')
  return {
    distanceMeters: Number(selectedPath.distance),
    durationSeconds: Number(selectedPath.cost?.duration ?? selectedPath.duration),
    path
  }
}

async function resolveCityCode(coordinates, key, signal) {
  const url = new URL('https://restapi.amap.com/v3/geocode/regeo')
  url.search = new URLSearchParams({
    location: coordinateText(coordinates),
    extensions: 'base',
    key
  }).toString()
  const payload = await requestAmapPayload(url, signal, '高德城市查询')
  const code = payload?.regeocode?.addressComponent?.citycode
  if (!code) throw new Error('未获取到地点所属城市，无法查询公共交通。')
  return String(code)
}

export async function getAmapDirection({ origin, destination, mode, signal }) {
  const key = process.env.AMAP_KEY
  if (!key) throw new Error('服务端未配置 AMAP_KEY，无法查询真实路线。')

  const cacheKey = `${coordinateText(origin)}|${coordinateText(destination)}|${mode}`
  const cached = directionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true }

  const endpoint = {
    walk: 'walking',
    cycle: 'bicycling',
    drive: 'driving',
    transit: 'transit/integrated'
  }[mode]
  if (!endpoint) throw new Error('不支持的交通方式。')

  const params = new URLSearchParams({
    origin: coordinateText(origin),
    destination: coordinateText(destination),
    show_fields: 'cost,navi,polyline',
    output: 'json',
    key
  })
  if (mode === 'drive') params.set('strategy', '32')
  if (mode === 'walk' || mode === 'cycle') params.set('alternative_route', '1')
  if (mode === 'transit') {
    const [city1, city2] = await Promise.all([
      resolveCityCode(origin, key, signal),
      resolveCityCode(destination, key, signal)
    ])
    params.set('city1', city1)
    params.set('city2', city2)
    params.set('AlternativeRoute', '1')
    params.set('strategy', '0')
  }

  const url = new URL(`https://restapi.amap.com/v5/direction/${endpoint}`)
  url.search = params.toString()
  const payload = await requestAmapPayload(url, signal, '高德路线查询')
  const parsed = parseDirectionPayload(payload, mode)
  if (!Number.isFinite(parsed.distanceMeters) || !Number.isFinite(parsed.durationSeconds)) {
    throw new Error('路线距离或耗时数据无效。')
  }
  const result = { ...parsed, provider: 'amap', fetchedAt: new Date().toISOString() }
  directionCache.set(cacheKey, { result, expiresAt: Date.now() + DIRECTION_CACHE_TTL_MS })
  return { ...result, cached: false }
}
