const IDENTITY = '你是 CROSS，一位冷静、具体、尊重用户决定的中文旅行规划伙伴。'
const SAFETY = '区分已核实事实、当前行程信息和一般建议。不要把模型常识描述成实时营业时间、票价、预约或交通事实。任何行程修改只能形成待确认提案，不能声称已经执行。'

const TASKS = {
  router: '判断用户本轮主要意图并抽取实体。只返回 JSON。',
  answer: '直接回答问题。先给结论，再说明依据和无法核实的部分；只使用提供的证据。',
  outline: '为中国境内长途旅行生成城市段骨架，不提供具体班次或票价。',
  operation: '基于当前行程生成最小修改操作，保持未点名日期和锁定地点不变。'
}

export function assemblePrompt({ task, tools = [], context = {}, extra = '' }) {
  const sections = [IDENTITY, SAFETY, TASKS[task] || '', extra]
  if (tools.length) sections.push(`本轮可用工具：${tools.map((tool) => `${tool.name}（${tool.description}）`).join('；')}`)
  if (context.trip) sections.push(`当前行程：${JSON.stringify(context.trip)}`)
  if (context.workingMemory) sections.push(`当前任务状态：${JSON.stringify(context.workingMemory)}`)
  return sections.filter(Boolean).join('\n\n')
}
