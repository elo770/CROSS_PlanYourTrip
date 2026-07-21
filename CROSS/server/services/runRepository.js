const memoryRuns = new Map()
const memoryEvents = new Map()
const memoryProposals = new Map()

export class RunRepository {
  constructor(pool = null) { this.pool = pool }

  async createRun(run) {
    memoryRuns.set(run.id, run)
    if (this.pool) {
      await this.pool.query('INSERT INTO agent_sessions (id,owner_session,trip_id,body,updated_at) VALUES ($1,$2,$3,$4::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET trip_id=EXCLUDED.trip_id,body=EXCLUDED.body,updated_at=NOW()', [run.sessionId, run.ownerSession, run.tripId || null, JSON.stringify({ workingMemory: run.workingMemory })])
      await this.pool.query('INSERT INTO agent_runs (id, session_id, owner_session, trip_id, status, body) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [run.id, run.sessionId, run.ownerSession, run.tripId || null, run.status, JSON.stringify(run)])
      await this.appendMessage(run.sessionId, `${run.id}-user`, 'user', run.workingMemory?.userGoal || '')
    }
    return run
  }

  async appendMessage(sessionId, id, role, content) {
    if (!this.pool || !content) return
    await this.pool.query('INSERT INTO agent_messages (id,session_id,role,content) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [id, sessionId, role, content])
  }

  async updateRun(run) {
    memoryRuns.set(run.id, run)
    if (this.pool) await this.pool.query('UPDATE agent_runs SET status=$2, body=$3::jsonb, updated_at=NOW() WHERE id=$1', [run.id, run.status, JSON.stringify(run)])
  }

  async getRun(id, ownerSession) {
    const cached = memoryRuns.get(id)
    if (cached) return cached.ownerSession === ownerSession ? cached : null
    if (!this.pool) return null
    const { rows } = await this.pool.query('SELECT body FROM agent_runs WHERE id=$1 AND owner_session=$2', [id, ownerSession])
    return rows[0]?.body || null
  }

  async addEvent(run, event) {
    const events = memoryEvents.get(run.id) || []
    const saved = { ...event, seq: events.length + 1, runId: run.id, createdAt: new Date().toISOString() }
    events.push(saved); memoryEvents.set(run.id, events)
    if (this.pool) await this.pool.query('INSERT INTO agent_events (run_id, seq, body) VALUES ($1,$2,$3::jsonb)', [run.id, saved.seq, JSON.stringify(saved)])
    return saved
  }

  async getEvents(runId) {
    const cached = memoryEvents.get(runId)
    if (cached) return cached
    if (!this.pool) return []
    const { rows } = await this.pool.query('SELECT body FROM agent_events WHERE run_id=$1 ORDER BY seq', [runId])
    return rows.map((row) => row.body)
  }

  async createProposal(proposal) {
    memoryProposals.set(proposal.id, proposal)
    if (this.pool) await this.pool.query('INSERT INTO agent_proposals (id,run_id,trip_id,owner_session,status,base_revision,body) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)', [proposal.id, proposal.runId, proposal.tripId || null, proposal.ownerSession, proposal.status, proposal.baseRevision, JSON.stringify(proposal)])
    return proposal
  }

  async getProposal(id, ownerSession) {
    const cached = memoryProposals.get(id)
    if (cached) return cached.ownerSession === ownerSession ? cached : null
    if (!this.pool) return null
    const { rows } = await this.pool.query('SELECT body FROM agent_proposals WHERE id=$1 AND owner_session=$2', [id, ownerSession])
    return rows[0]?.body || null
  }

  async updateProposal(proposal) {
    memoryProposals.set(proposal.id, proposal)
    if (this.pool) await this.pool.query('UPDATE agent_proposals SET status=$2,body=$3::jsonb,updated_at=NOW() WHERE id=$1', [proposal.id, proposal.status, JSON.stringify(proposal)])
  }

  async applyProposal(proposal) {
    if (!this.pool || !proposal.candidateTrip) return { ...proposal.candidateTrip, revision: proposal.baseRevision + 1 }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query('SELECT body, revision FROM trips WHERE id=$1 FOR UPDATE', [proposal.tripId])
      const revision = current.rows[0]?.revision || 0
      if (current.rowCount && revision !== proposal.baseRevision) {
        await client.query('ROLLBACK'); return null
      }
      if (current.rowCount) await client.query('INSERT INTO trip_versions (trip_id,revision,body) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING', [proposal.tripId, revision, JSON.stringify(current.rows[0].body)])
      const nextRevision = revision + 1
      const trip = { ...proposal.candidateTrip, revision: nextRevision }
      await client.query(`INSERT INTO trips (id,body,owner_session,schema_version,revision,updated_at) VALUES ($1,$2::jsonb,$3,2,$4,NOW())
        ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body, owner_session=EXCLUDED.owner_session, schema_version=2, revision=EXCLUDED.revision, updated_at=NOW()`, [proposal.tripId, JSON.stringify(trip), proposal.ownerSession, nextRevision])
      await client.query('COMMIT')
      return trip
    } catch (error) {
      await client.query('ROLLBACK'); throw error
    } finally { client.release() }
  }
}
