import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import agentRoutes from './routes/agent.js'
import agentV2Routes from './routes/agentV2.js'
import poiRoutes from './routes/poi.js'
import directionRoutes from './routes/directions.js'
import { anonymousSession } from './services/anonymousSession.js'
import { rateLimit } from './services/rateLimit.js'
import { createPool, initDb } from './db.js'

const serverDir = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(serverDir, '../.env') })
dotenv.config({ path: resolve(serverDir, '.env'), override: true })

const app = express()
const PORT = process.env.PORT || 3001
let databaseConnected = false

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
app.use('/api/directions', rateLimit({ max: 120 }))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: databaseConnected, model: Boolean(process.env.DEEPSEEK_API_KEY), amap: Boolean(process.env.AMAP_KEY) })
})

async function main() {
  let pool = null
  if (process.env.DATABASE_URL) {
    try {
      pool = createPool()
      await initDb(pool)
      databaseConnected = true
    } catch (error) {
      if (process.env.ALLOW_DATABASE_FALLBACK !== 'true') throw error
      console.warn('数据库连接失败：已按本地降级设置继续启动。')
      pool = null
      databaseConnected = false
    }
  } else {
    console.warn('DATABASE_URL 未配置：服务端数据库功能暂不可用。')
  }

  app.use('/api/agent', agentV2Routes(pool))
  app.use('/api/agent', agentRoutes())
  app.use('/api/poi', poiRoutes())
  app.use('/api/directions', directionRoutes())

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
