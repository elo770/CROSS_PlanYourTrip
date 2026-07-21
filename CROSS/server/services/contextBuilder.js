export function buildAgentContext({ body, entities = [] }) {
  const messages = Array.isArray(body?.recentMessages) ? body.recentMessages.slice(-8) : []
  const trip = body?.currentPlan ? {
    revision: Number(body.planRevision) || 0,
    route: body.currentPlan.route,
    schedule: body.currentPlan.schedule
  } : null
  return {
    messages,
    trip,
    workingMemory: {
      userGoal: String(body?.message || '').slice(0, 1200),
      entities,
      confirmedConstraints: body?.constraints || {},
      missingFields: [],
      relatedSegmentIds: []
    }
  }
}
