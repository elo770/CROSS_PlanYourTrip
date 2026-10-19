import express from 'express'
import { getAmapPoiDetails, searchAmapPois, searchAmapSuggestions } from '../services/amap.js'

function publicPoi(poi) {
  return {
    id: poi.id,
    name: poi.name,
    city: poi.city || '',
    district: poi.district || '',
    address: poi.address || '',
    coordinates: poi.coordinates,
    sourceLabel: '高德'
  }
}

export default function poiRoutes() {
  const router = express.Router()

  router.get('/search', async (req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 80) : ''
    const city = typeof req.query.city === 'string' ? req.query.city.trim().slice(0, 80) : ''
    if (!query) return res.status(400).json({ error: '请输入要查找的地点。' })

    try {
      const result = await searchAmapPois({ query, city, limit: 10 })
      if (result.warning) return res.status(503).json({ error: result.warning })
      res.json({ pois: result.pois.map(publicPoi) })
    } catch (error) {
      console.error('POI search failed:', error)
      res.status(502).json({ error: error instanceof Error ? error.message : '地点搜索暂时不可用。' })
    }
  })

  router.get('/suggest', async (req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 80) : ''
    const city = typeof req.query.city === 'string' ? req.query.city.trim().slice(0, 80) : ''
    if (!query) return res.status(400).json({ error: '请输入要查找的地点。' })

    try {
      const result = await searchAmapSuggestions({ query, city, limit: 8 })
      if (result.warning) return res.status(503).json({ error: result.warning })
      res.json({ pois: result.pois.map(publicPoi) })
    } catch (error) {
      console.error('POI suggestions failed:', error)
      res.status(502).json({ error: error instanceof Error ? error.message : '地点提示暂时不可用。' })
    }
  })

  router.get('/detail', async (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id.trim().slice(0, 80) : ''
    if (!id) return res.status(400).json({ error: '缺少地点 ID。' })

    try {
      const result = await getAmapPoiDetails({ id })
      if (result.warning) return res.status(503).json({ error: result.warning })
      if (!result.poi) return res.status(404).json({ error: '没有找到这个地点。' })
      res.json({ poi: publicPoi(result.poi) })
    } catch (error) {
      console.error('POI detail failed:', error)
      res.status(502).json({ error: error instanceof Error ? error.message : '地点详情暂时不可用。' })
    }
  })

  return router
}
