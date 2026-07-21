import crypto from 'node:crypto'

const COOKIE_NAME = 'cross_session'

function readCookie(header = '') {
  return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) || ''
}

export function anonymousSession(req, res, next) {
  const existing = readCookie(req.headers.cookie)
  const sessionId = /^[a-zA-Z0-9-]{16,100}$/.test(existing) ? existing : crypto.randomUUID()
  req.ownerSession = sessionId
  if (!existing) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    res.append('Set-Cookie', `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`)
  }
  next()
}
