import { searchAmapPois } from './amap.js'
import { buildTripPlan } from './planner.js'
import { applyPlanOperations } from './planOperations.js'

const toolHandlers = {
  search_poi_candidates: (input, context) => searchAmapPois({ ...input, signal: context.signal }),
  build_trip_plan: (input) => buildTripPlan(input),
  apply_plan_operations: (input) => applyPlanOperations(input.plan, input.operations, input.context)
}

export async function executeAgentTool(name, input, context = {}) {
  const handler = toolHandlers[name]
  if (!handler) return { ok: false, error: `未知工具：${name}`, retriable: false }
  try {
    const data = await handler(input, context)
    return {
      ok: true,
      data,
      warning: data?.warning,
      retriable: false,
      meta: name === 'search_poi_candidates' ? { count: data?.pois?.length || 0 } : undefined
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return {
      ok: false,
      error: error instanceof Error ? error.message : `${name} 执行失败`,
      retriable: false
    }
  }
}
