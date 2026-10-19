import express from 'express'
import { getAmapDirection } from '../services/amap.js'

const MODES = new Set(['walk', 'cycle', 'drive', 'transit'])

function validCoordinate(value) {
  return Array.isArray(value) && value.length === 2 && value.every((item) => Number.isFinite(Number(item)))
}

export default function directionRoutes() {
  const router = express.Router()

  router.post('/segment', async (req, res) => {
    const { origin, destination, mode } = req.body || {}
    if (!validCoordinate(origin) || !validCoordinate(destination)) {
      return res.status(400).json({ error: '起点或终点坐标无效。' })
    }
    if (!MODES.has(mode)) return res.status(400).json({ error: '不支持的交通方式。' })

    try {
      const result = await getAmapDirection({
        origin: origin.map(Number),
        destination: destination.map(Number),
        mode,
        signal: req.signal
      })
      res.json({ mode, ...result })
    } catch (error) {
      console.error('Direction lookup failed:', error)
      res.status(502).json({ error: error instanceof Error ? error.message : '路线查询暂时不可用。' })
    }
  })

  return router
}
