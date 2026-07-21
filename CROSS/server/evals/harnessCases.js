const plan = {
  route: { id: 'r', estimatedDays: 4, destinations: [{ id: 'p1', name: '中山陵', day: 1, coordinates: [118.85, 32.06], planningStatus: 'scheduled' }] },
  schedule: [], warnings: []
}

const answerMessages = [
  '第二天这样安排合理吗？', '第一天会不会太赶？', '这个路线怎么样？', '为什么先去中山陵？', '当前行程有什么问题？',
  '南京博物院值得去吗？', '中山陵几点关门？', '从酒店怎么去总统府？', '这一天需要调整吗？', '这样的节奏合适吗？'
]
const modifyMessages = [
  '删除明孝陵', '把总统府移到第三天', '锁定中山陵', '第二天轻松一点', '重新规划全部行程',
  '增加一个博物馆', '把夫子庙换掉', '解锁中山陵', '第三天重排', '不要动物园'
]
const longDurations = [15, 16, 18, 20, 21, 25, 30, 35, 45, 60]

export const harnessCases = [
  ...answerMessages.map((message, index) => ({ id: `harness-answer-${index + 1}`, category: 'intent', input: { message, city: '南京', days: 4, currentPlan: plan, sourceMode: 'generate' }, expected: { decision: 'answer_only' } })),
  ...modifyMessages.map((message, index) => ({ id: `harness-modify-${index + 1}`, category: 'intent', input: { message, city: '南京', days: 4, currentPlan: plan, sourceMode: 'generate' }, expected: { decision: 'modify_plan' } })),
  ...longDurations.map((days, index) => ({ id: `harness-long-${index + 1}`, category: 'long_trip', input: `帮我规划${days}天中国旅行`, expected: { days } })),
  ...longDurations.map((days, index) => ({ id: `harness-outline-${index + 1}`, category: 'outline', input: { totalDays: days, cities: [{ city: '北京' }, { city: '西安' }, { city: '成都' }] }, expected: { totalDays: days, segmentCount: 3 } }))
]
