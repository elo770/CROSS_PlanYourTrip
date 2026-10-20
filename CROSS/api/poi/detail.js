import { getAmapPoiDetails } from '../../server/services/amap.js'
import { publicPoi } from '../../server/services/publicPoi.js'

export async function GET(request) {
  const id = (new URL(request.url).searchParams.get('id') || '').trim().slice(0, 80)
  if (!id) return Response.json({ error: '缺少地点 ID。' }, { status: 400 })

  try {
    const result = await getAmapPoiDetails({ id, signal: request.signal })
    if (result.warning) return Response.json({ error: result.warning }, { status: 503 })
    if (!result.poi) return Response.json({ error: '没有找到这个地点。' }, { status: 404 })
    return Response.json({ poi: publicPoi(result.poi) })
  } catch (error) {
    console.error('POI detail failed:', error)
    return Response.json({ error: error instanceof Error ? error.message : '地点详情暂时不可用。' }, { status: 502 })
  }
}
