const buckets = new Map()

export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  return (req, res, next) => {
    const key = req.ownerSession || req.ip || 'anonymous'
    const now = Date.now()
    const bucket = buckets.get(key)
    if (!bucket || now - bucket.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 }); return next()
    }
    bucket.count += 1
    if (bucket.count > max) return res.status(429).json({ error: '请求过于频繁，请稍后再试。', code: 'RATE_LIMITED' })
    next()
  }
}
