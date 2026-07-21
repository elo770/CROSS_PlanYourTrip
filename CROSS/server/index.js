import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import tripRoutes from './routes/trip.js'
import budgetRoutes from './routes/budget.js'
import agentRoutes from './routes/agent.js'
import agentV2Routes from './routes/agentV2.js'
import poiRoutes from './routes/poi.js'
import { anonymousSession } from './services/anonymousSession.js'
import { rateLimit } from './services/rateLimit.js'
import { createPool, initDb } from './db.js'

const serverDir = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(serverDir, '../.env') })
dotenv.config({ path: resolve(serverDir, '.env'), override: true })

const app = express()
const PORT = process.env.PORT || 3001

app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      const raw = process.env.CORS_ORIGIN
      if (!raw || raw === '*') {
        return cb(null, true)
      }
      const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
      if (!origin || list.includes(origin)) {
        return cb(null, true)
      }
      cb(null, false)
    }
  })
)
app.use(express.json({ limit: '512kb' }))
app.use('/api', anonymousSession)
app.use('/api/agent', rateLimit({ max: 30 }))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: Boolean(process.env.DATABASE_URL), model: Boolean(process.env.DEEPSEEK_API_KEY), amap: Boolean(process.env.AMAP_KEY) })
})

function databaseUnavailableRoutes() {
  const router = express.Router()
  router.all('*', (req, res) => {
    res.status(503).json({ error: '数据库尚未配置，当前只能使用 AI 规划功能。' })
  })
  return router
}

async function main() {
  let pool = null
  if (process.env.DATABASE_URL) {
    pool = createPool()
    await initDb(pool)
  } else {
    console.warn('DATABASE_URL 未配置：路线和预算保存暂不可用，AI 规划仍可使用。')
  }

  app.use('/api/trips', pool ? tripRoutes(pool) : databaseUnavailableRoutes())
  app.use('/api/budget', pool ? budgetRoutes(pool) : databaseUnavailableRoutes())
  app.use('/api/agent', agentV2Routes(pool))
  app.use('/api/agent', agentRoutes())
  app.use('/api/poi', poiRoutes())

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
