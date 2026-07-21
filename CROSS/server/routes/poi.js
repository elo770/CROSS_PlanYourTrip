import express from 'express'
import { searchAmapPois } from '../services/amap.js'

export default function poiRoutes() {
  const router = express.Router()

  router.get('/search', async (req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 80) : ''
    const city = typeof req.query.city === 'string' ? req.query.city.trim().slice(0, 80) : ''
    if (!query) return res.status(400).json({ error: '请输入要查找的地点。' })

    try {
      const result = await searchAmapPois({ query, city, limit: 10 })
      if (result.warning) return res.status(503).json({ error: result.warning })
      res.json({
        pois: result.pois.map((poi) => ({
          name: poi.name,
          address: poi.description || '',
          coordinates: poi.coordinates,
          sourceLabel: '高德'
        }))
      })
    } catch (error) {
      console.error('POI search failed:', error)
      res.status(502).json({ error: error instanceof Error ? error.message : '地点搜索暂时不可用。' })
    }
  })

  return router
}
