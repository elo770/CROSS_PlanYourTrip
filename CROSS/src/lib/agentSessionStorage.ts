const ACTIVE_TRIP_KEY = 'cross:active-trip-id'
const STORAGE_VERSION_KEY = 'cross:agent-storage-version'
const STORAGE_VERSION = '2'

function uniqueId(prefix: 'draft-trip' | 'trip') {
  const value = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${value}`
}

export function createDraftTripId() {
  return uniqueId('draft-trip')
}

export function createSavedTripId() {
  return uniqueId('trip')
}

export function agentSessionKey(tripId: string) {
  return `cross:agent-session:${tripId}`
}

export function agentUndoKey(tripId: string) {
  return `cross:agent-undo:${tripId}`
}

export function setActiveTripId(tripId: string) {
  localStorage.setItem(ACTIVE_TRIP_KEY, tripId)
}

export function getActiveTripId() {
  return localStorage.getItem(ACTIVE_TRIP_KEY)
}

export function clearLegacyAgentStorageOnce() {
  if (localStorage.getItem(STORAGE_VERSION_KEY) === STORAGE_VERSION) return
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
  keys.forEach((key) => {
    if (key?.startsWith('cross:agent-session:') || key?.startsWith('cross:agent-undo:')) {
      localStorage.removeItem(key)
    }
  })
  localStorage.removeItem(ACTIVE_TRIP_KEY)
  localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION)
}

export function migrateAgentStorage(fromTripId: string, toTripId: string) {
  const fromSessionKey = agentSessionKey(fromTripId)
  const toSessionKey = agentSessionKey(toTripId)
  const savedSession = localStorage.getItem(fromSessionKey)
  if (savedSession) {
    try {
      const session = JSON.parse(savedSession)
      session.tripId = toTripId
      localStorage.setItem(toSessionKey, JSON.stringify(session))
    } catch {
      localStorage.setItem(toSessionKey, savedSession)
    }
    localStorage.removeItem(fromSessionKey)
  }

  const fromUndoKey = agentUndoKey(fromTripId)
  const savedUndo = localStorage.getItem(fromUndoKey)
  if (savedUndo) {
    localStorage.setItem(agentUndoKey(toTripId), savedUndo)
    localStorage.removeItem(fromUndoKey)
  }
  setActiveTripId(toTripId)
}
