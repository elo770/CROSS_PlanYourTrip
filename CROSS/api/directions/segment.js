import { getAmapDirection } from '../../server/services/amap.js'

const MODES = new Set(['walk', 'cycle', 'drive', 'transit'])

function validCoordinate(value) {
  return Array.isArray(value) && value.length === 2 && value.every((item) => Number.isFinite(Number(item)))
}

export async function POST(request) {
  const { origin, destination, mode } = await request.json().catch(() => ({}))
  if (!validCoordinate(origin) || !validCoordinate(destination)) {
    return Response.json({ error: '起点或终点坐标无效。' }, { status: 400 })
  }
  if (!MODES.has(mode)) return Response.json({ error: '不支持的交通方式。' }, { status: 400 })

  try {
    const result = await getAmapDirection({ origin: origin.map(Number), destination: destination.map(Number), mode, signal: request.signal })
    return Response.json({ mode, ...result })
  } catch (error) {
    console.error('Direction lookup failed:', error)
    return Response.json({ error: error instanceof Error ? error.message : '路线查询暂时不可用。' }, { status: 502 })
  }
}
