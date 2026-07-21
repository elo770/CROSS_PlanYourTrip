const scheduledPlan = {
  route: {
    id: 'eval-route', name: '南京四日', estimatedDays: 4, totalDistance: 0,
    destinations: [{ id: 'p1', name: '中山陵', day: 1, withinDayOrder: 1, coordinates: [118.85, 32.06], planningStatus: 'scheduled' }]
  },
  schedule: [{ day: 1 }], warnings: []
}

const safetyPlan = {
  route: {
    id: 'safety-route', name: '南京四日', estimatedDays: 4, totalDistance: 0,
    destinations: [
      { id: 'p1', name: '中山陵', day: 1, withinDayOrder: 1, coordinates: [118.85, 32.06], planningStatus: 'scheduled', locked: true },
      { id: 'p2', name: '明孝陵', day: 1, withinDayOrder: 2, coordinates: [118.84, 32.05], planningStatus: 'scheduled' },
      { id: 'p3', name: '总统府', day: 2, withinDayOrder: 1, coordinates: [118.79, 32.04], planningStatus: 'scheduled', poiStatus: 'must_go' },
      { id: 'p4', name: '夫子庙', day: 2, withinDayOrder: 2, coordinates: [118.79, 32.02], planningStatus: 'scheduled' },
      { id: 'p5', name: '秦淮河', day: 2, withinDayOrder: 3, coordinates: [118.80, 32.02], planningStatus: 'scheduled' },
      { id: 'p6', name: '老门东', day: 2, withinDayOrder: 4, coordinates: [118.79, 32.01], planningStatus: 'scheduled' },
      { id: 'p7', name: '瞻园', day: 2, withinDayOrder: 5, coordinates: [118.78, 32.02], planningStatus: 'scheduled' }
    ]
  },
  schedule: [], warnings: []
}

export const evalCases = [
  { id: 'intent-01', category: 'intent', input: { message: '帮我规划南京四天行程', city: '南京', days: 4, currentPlan: null }, expected: { decision: 'create_plan' } },
  { id: 'intent-02', category: 'intent', input: { message: '南京博物院几点关门？', city: '南京', days: 4, currentPlan: scheduledPlan }, expected: { decision: 'answer_only' } },
  { id: 'intent-03', category: 'intent', input: { message: '第二天轻松一点', city: '南京', days: 4, currentPlan: scheduledPlan }, expected: { decision: 'modify_plan' } },
  { id: 'intent-04', category: 'intent', input: { message: '删掉明孝陵', city: '南京', days: 4, currentPlan: scheduledPlan }, expected: { decision: 'modify_plan' } },
  { id: 'intent-05', category: 'intent', input: { message: '南京值得去吗？', city: '南京', days: 0, currentPlan: null }, expected: { decision: 'answer_only' } },
  { id: 'intent-06', category: 'intent', input: { message: '帮我安排两天', city: '', days: 2, currentPlan: null }, expected: { decision: 'ask_clarification' } },
  { id: 'intent-07', category: 'intent', input: { message: '我想去苏州', city: '苏州', days: 0, currentPlan: null }, expected: { decision: 'ask_clarification' } },
  { id: 'intent-08', category: 'intent', input: { message: '锁定中山陵', city: '南京', days: 4, currentPlan: scheduledPlan }, expected: { decision: 'modify_plan' } },
  { id: 'intent-09', category: 'intent', input: { message: '重新规划全部行程', city: '南京', days: 4, currentPlan: scheduledPlan }, expected: { decision: 'modify_plan' } },
  { id: 'intent-10', category: 'intent', input: { message: '第一天：中山陵\n第二天：总统府', city: '南京', days: 2, sourceMode: 'import', currentPlan: scheduledPlan }, expected: { decision: 'create_plan' } },

  { id: 'time-01', category: 'temporal', input: '南京玩3天', expected: { duration: 3, maxHeading: 0 } },
  { id: 'time-02', category: 'temporal', input: '四日游', expected: { duration: 4, maxHeading: 0 } },
  { id: 'time-03', category: 'temporal', input: '第二天轻松一点', expected: { duration: 0, maxHeading: 2 } },
  { id: 'time-04', category: 'temporal', input: '第一天西湖，第四天返程', expected: { duration: 0, maxHeading: 4 } },
  { id: 'time-05', category: 'temporal', input: '安排14天旅行', expected: { duration: 14, maxHeading: 0 } },
  { id: 'time-06', category: 'temporal', input: '安排十四日游', expected: { duration: 14, maxHeading: 0 } },
  { id: 'time-07', category: 'temporal', input: '第1天中山陵，第2天总统府', expected: { duration: 0, maxHeading: 2 } },
  { id: 'time-08', category: 'temporal', input: '两天一夜，去苏州', expected: { duration: 2, maxHeading: 0 } },
  { id: 'time-09', category: 'temporal', input: '第二天不要动物园，行程共4天', expected: { duration: 4, maxHeading: 2 } },
  { id: 'time-10', category: 'temporal', input: '预算1000元，2个人，玩5天', expected: { duration: 5, maxHeading: 0 } },

  { id: 'import-01', category: 'import', input: '第一天：西湖、雷峰塔\n第二天：灵隐寺', extractedItems: [{ name: '西湖', type: 'poi', day: 1, withinDayOrder: 1 }, { name: '雷峰塔', type: 'poi', day: 1, withinDayOrder: 2 }, { name: '灵隐寺', type: 'poi', day: 2, withinDayOrder: 1 }], expected: { days: [1, 2], relations: [['西湖', 1], ['雷峰塔', 1], ['灵隐寺', 2]], errors: 0 } },
  { id: 'import-02', category: 'import', input: '第一天：中山陵\n第二天：总统府\n第三天：瞻园\n第四天：购买伴手礼后返程', extractedItems: [{ name: '中山陵', type: 'poi', day: 1 }, { name: '总统府', type: 'poi', day: 2 }, { name: '瞻园', type: 'poi', day: 3 }, { name: '购买伴手礼', type: 'shopping', day: 4 }, { name: '返程', type: 'transport', day: 4 }], expected: { days: [1, 2, 3, 4], types: [['购买伴手礼', 'shopping'], ['返程', 'transport']], errors: 0 } },
  { id: 'import-03', category: 'import', input: '第一天：西湖\n第三天：灵隐寺', extractedItems: [{ name: '西湖', type: 'poi', day: 1 }, { name: '灵隐寺', type: 'poi', day: 3 }], expected: { days: [1, 3], warningIncludes: '没有第 2 天', errors: 0 } },
  { id: 'import-04', category: 'import', input: '第一天：西湖\n第一天：雷峰塔', extractedItems: [{ name: '西湖', type: 'poi', day: 1 }, { name: '雷峰塔', type: 'poi', day: 1 }], expected: { days: [1, 1], errorIncludes: '重复标题' } },
  { id: 'import-05', category: 'import', input: '第一天：西湖\n第二天：', extractedItems: [{ name: '西湖', type: 'poi', day: 1 }], expected: { days: [1, 2], errorIncludes: '第 2 天没有识别出任何活动' } },
  { id: 'import-06', category: 'import', input: '第一天：河坊街吃晚饭\n第二天：坐高铁返程', extractedItems: [{ name: '河坊街晚饭', type: 'food', day: 1 }, { name: '乘坐高铁返程', type: 'transport', day: 2 }], expected: { days: [1, 2], types: [['河坊街晚饭', 'food'], ['乘坐高铁返程', 'transport']], errors: 0 } },
  { id: 'import-07', category: 'import', input: '第一天：西湖，下午自由活动\n第二天：灵隐寺', extractedItems: [{ name: '西湖', type: 'poi', day: 1 }, { name: '下午自由活动', type: 'note', day: 1 }, { name: '灵隐寺', type: 'poi', day: 2 }], expected: { days: [1, 2], types: [['下午自由活动', 'note']], errors: 0 } },
  { id: 'import-08', category: 'import', input: '第1天：外滩\n第2天：武康路', extractedItems: [{ name: '外滩', type: 'poi', day: 1 }, { name: '武康路', type: 'poi', day: 2 }], expected: { days: [1, 2], relations: [['外滩', 1], ['武康路', 2]], errors: 0 } },
  { id: 'import-09', category: 'import', input: '第一天：西湖、雷峰塔、河坊街、博物馆、夜游\n第二天：灵隐寺', extractedItems: [{ name: '西湖', type: 'poi', day: 1 }, { name: '雷峰塔', type: 'poi', day: 1 }, { name: '河坊街', type: 'poi', day: 1 }, { name: '博物馆', type: 'poi', day: 1 }, { name: '夜游', type: 'note', day: 1 }, { name: '灵隐寺', type: 'poi', day: 2 }], expected: { days: [1, 2], detectedPaceDay: [1, '适中'], errors: 0 } },
  { id: 'import-10', category: 'import', input: '第一天：西湖\n第二天：灵隐寺', extractedItems: [{ name: '错误日期地点', type: 'poi', day: 3 }, { name: '西湖', type: 'poi', day: 1 }, { name: '灵隐寺', type: 'poi', day: 2 }], expected: { days: [1, 2], relations: [['西湖', 1], ['灵隐寺', 2]], errors: 0 } },

  { id: 'safety-01', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'lock_poi', poiId: 'p2' }], expected: { place: ['p2', 'locked', true] } },
  { id: 'safety-02', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'unlock_poi', poiId: 'p1' }], expected: { place: ['p1', 'locked', false] } },
  { id: 'safety-03', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'remove_poi', poiId: 'p2' }], expected: { absent: 'p2' } },
  { id: 'safety-04', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'remove_poi', poiId: 'p1' }], expected: { rejectIncludes: '不能直接删除' } },
  { id: 'safety-05', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'remove_poi', poiId: 'p3' }], expected: { rejectIncludes: '不能直接删除' } },
  { id: 'safety-06', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'move_poi', poiId: 'p2', targetDay: 3 }], expected: { place: ['p2', 'day', 3], unchanged: ['p3', 2] } },
  { id: 'safety-07', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'reorder_poi', poiId: 'p2', targetIndex: 1 }], expected: { place: ['p2', 'withinDayOrder', 1] } },
  { id: 'safety-08', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'change_day_pace', targetDay: 2, pace: '轻松' }], expected: { scheduledOnDay: [2, 3], present: 'p3' } },
  { id: 'safety-09', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'move_poi', poiId: 'p2', targetDay: 5 }], expected: { rejectIncludes: '目标日期超出' } },
  { id: 'safety-10', category: 'safety', initialPlan: safetyPlan, operations: [{ type: 'replace_poi', poiId: 'p2', replacement: { id: 'r1', name: '玄武湖', coordinates: [118.80, 32.07] } }], expected: { present: 'r1', absent: 'p2' } }
]
