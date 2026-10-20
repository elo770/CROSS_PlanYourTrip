import { searchAmapPois } from '../../server/services/amap.js'
import { publicPoi } from '../../server/services/publicPoi.js'

export async function GET(request) {
  const url = new URL(request.url)
  const query = (url.searchParams.get('query') || '').trim().slice(0, 80)
  const city = (url.searchParams.get('city') || '').trim().slice(0, 80)
  if (!query) return Response.json({ error: '请输入要查找的地点。' }, { status: 400 })

  try {
    const result = await searchAmapPois({ query, city, limit: 10, signal: request.signal })
    if (result.warning) return Response.json({ error: result.warning }, { status: 503 })
    return Response.json({ pois: result.pois.map(publicPoi) })
  } catch (error) {
    console.error('POI search failed:', error)
    return Response.json({ error: error instanceof Error ? error.message : '地点搜索暂时不可用。' }, { status: 502 })
  }
}
