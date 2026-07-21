import express from 'express'

export default function tripRoutes(pool) {
  const router = express.Router()

  router.get('/:id', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT id, body, revision, schema_version FROM trips WHERE id=$1 AND (owner_session=$2 OR owner_session IS NULL)', [req.params.id, req.ownerSession])
      if (!rows[0]) return res.status(404).json({ error: 'Trip not found' })
      res.json({ ...rows[0].body, id: rows[0].id, revision: rows[0].revision, schemaVersion: rows[0].schema_version })
    } catch (e) {
      console.error(e); res.status(500).json({ error: 'Failed to load trip' })
    }
  })

  router.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, body FROM trips WHERE owner_session=$1 OR owner_session IS NULL ORDER BY updated_at DESC',
        [req.ownerSession]
      )
      const trips = rows.map((r) => ({
        ...r.body,
        id: r.id
      }))
      res.json({ trips, schedules: [] })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Failed to list trips' })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const id = req.body?.id || Date.now().toString()
      const body = { ...req.body, id }
      await pool.query(
        `INSERT INTO trips (id, body, owner_session, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body, owner_session=COALESCE(trips.owner_session,EXCLUDED.owner_session), updated_at=NOW()`,
        [id, JSON.stringify(body), req.ownerSession]
      )
      res.json({ success: true, trip: { ...body, revision: 0, schemaVersion: 2 } })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Failed to save trip' })
    }
  })

  router.put('/:id', async (req, res) => {
    const id = req.params.id
    try {
      const expectedRevision = Number(req.body?.expectedRevision)
      const merged = { ...req.body, id }
      delete merged.expectedRevision
      const { rowCount, rows } = await pool.query(
        `UPDATE trips SET body=$3::jsonb, revision=revision+1, schema_version=2, owner_session=COALESCE(owner_session,$2), updated_at=NOW()
         WHERE id=$1 AND (owner_session=$2 OR owner_session IS NULL) AND ($4::int IS NULL OR revision=$4)
         RETURNING revision`,
        [id, req.ownerSession, JSON.stringify(merged), Number.isInteger(expectedRevision) ? expectedRevision : null]
      )
      if (rowCount === 0) {
        const existing = await pool.query('SELECT revision FROM trips WHERE id=$1', [id])
        if (existing.rowCount) return res.status(409).json({ error: 'Trip revision conflict', status: 'stale', revision: existing.rows[0].revision })
        await pool.query('INSERT INTO trips (id, body, owner_session, schema_version, revision, updated_at) VALUES ($1,$2::jsonb,$3,2,0,NOW())', [id, JSON.stringify(merged), req.ownerSession])
      }
      res.json({ success: true, trip: { ...merged, revision: rows[0]?.revision || 0 } })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Failed to update trip' })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM trips WHERE id=$1 AND (owner_session=$2 OR owner_session IS NULL)', [req.params.id, req.ownerSession])
      res.json({ success: true })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Failed to delete trip' })
    }
  })

  router.post('/:id/schedule', async (req, res) => {
    res.status(501).json({ success: false, message: 'Schedule is stored inside trip body on client' })
  })

  router.get('/:id/schedule', async (req, res) => {
    res.json({ schedules: [] })
  })

  return router
}
