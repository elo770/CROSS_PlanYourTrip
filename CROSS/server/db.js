import pg from 'pg'

const { Pool } = pg

function poolSslOption(connectionString) {
  if (!connectionString) return false
  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
    return false
  }
  if (/sslmode=disable/i.test(connectionString)) return false
  return { rejectUnauthorized: false }
}

export function createPool() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required (Render PostgreSQL or local connection string)')
  }
  const ssl = poolSslOption(connectionString)
  return new Pool({
    connectionString,
    ssl: ssl || undefined
  })
}

export async function initDb(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      body JSONB NOT NULL,
      owner_session TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS budget_items (
      id TEXT PRIMARY KEY,
      body JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      owner_session TEXT NOT NULL,
      trip_id TEXT,
      body JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      owner_session TEXT NOT NULL,
      trip_id TEXT,
      status TEXT NOT NULL,
      body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_events (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(run_id, seq)
    );
    CREATE TABLE IF NOT EXISTS agent_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      trip_id TEXT,
      owner_session TEXT NOT NULL,
      status TEXT NOT NULL,
      base_revision INTEGER NOT NULL DEFAULT 0,
      body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS trip_versions (
      id BIGSERIAL PRIMARY KEY,
      trip_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(trip_id, revision)
    );
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS owner_session TEXT;
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
  `)
}
