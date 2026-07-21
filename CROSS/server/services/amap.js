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
    citylimit: city ? 'true' : 'false',
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

  const pois = (data.pois || []).flatMap((poi, index) => {
    if (!poi.location) return []
    const [lng, lat] = poi.location.split(',').map(Number)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return []
    const address = [poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean).join(' ')
    return [{
      id: `amap-${Date.now()}-${index}`,
      name: poi.name,
      city: typeof poi.cityname === 'string' ? poi.cityname.replace(/市$/, '') : '',
      description: address,
      coordinates: [lng, lat],
      order: index + 1,
      poiStatus: 'optional',
      planningStatus: 'candidate',
      source: 'ai'
    }]
  })

  return { pois }
}
