import { searchAmapPois } from './amap.js'
import { buildTripPlan } from './planner.js'
import { applyPlanOperations, validatePlan } from './planOperations.js'

export class ToolRegistry {
  constructor() { this.tools = new Map() }
  register(definition, handler) { this.tools.set(definition.name, { ...definition, handler }); return this }
  definitions(access = 'read') { return [...this.tools.values()].filter((tool) => access === 'write' || tool.access === 'read').map(({ handler, ...definition }) => definition) }
  async execute(name, input, context = {}) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`未知工具：${name}`)
    if (tool.access === 'write' && !context.allowWrite) throw new Error('该操作需要用户确认。')
    return tool.handler(input, context)
  }
}

export function createTravelToolRegistry() {
  return new ToolRegistry()
    .register({ name: 'search_poi', access: 'read', description: '核实高德POI身份、地址和坐标', freshness: 'provider-current' }, (input, context) => searchAmapPois({ ...input, signal: context.signal }))
    .register({ name: 'inspect_trip', access: 'read', description: '读取当前正式行程' }, (_, context) => context.trip || null)
    .register({ name: 'analyze_day_load', access: 'read', description: '分析指定日期的地点数量和节奏' }, ({ day }, context) => {
      const places = context.trip?.route?.destinations?.filter((item) => Number(item.day) === Number(day) && !['unscheduled', 'candidate', 'rejected'].includes(item.planningStatus)) || []
      return { day: Number(day), count: places.length, pace: places.length <= 3 ? '轻松' : places.length === 4 ? '适中' : '紧凑', places: places.map((item) => item.name) }
    })
    .register({ name: 'build_single_city_plan', access: 'write', description: '生成单城市详细行程' }, buildTripPlan)
    .register({ name: 'validate_operations', access: 'read', description: '预演并校验行程修改' }, ({ plan, operations, context }) => applyPlanOperations(plan, operations, context))
    .register({ name: 'validate_plan', access: 'read', description: '校验行程结构' }, ({ plan }) => validatePlan(plan))
}
