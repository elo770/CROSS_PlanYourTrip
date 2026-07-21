export const liveCases = [
  { id: 'live-extract-01', mode: 'extraction', message: '南京玩4天，节奏轻松', expected: { days: 4, city: '南京' } },
  { id: 'live-extract-02', mode: 'extraction', message: '第一天：中山陵、明孝陵\n第二天：总统府', expected: { relations: [['中山陵', 1], ['明孝陵', 1], ['总统府', 2]] } },
  { id: 'live-extract-03', mode: 'extraction', message: '第一天：西湖\n第二天：河坊街吃晚饭\n第三天：买伴手礼后返程', expected: { types: [['河坊街吃晚饭', 'food'], ['买伴手礼', 'shopping'], ['返程', 'transport']] } },
  { id: 'live-extract-04', mode: 'extraction', message: '第二天轻松一点', expected: { days: 0 } },
  { id: 'live-extract-05', mode: 'extraction', message: '杭州两日游，喜欢历史文化和拍照', expected: { days: 2, city: '杭州' } },
  { id: 'live-extract-06', mode: 'extraction', message: '第一天：外滩\n第二天：武康路\n第四天：返程', expected: { relations: [['外滩', 1], ['武康路', 2], ['返程', 4]] } },
  { id: 'live-agent-01', mode: 'agent', message: '南京博物院是什么？', constraints: { city: '南京', days: 2 }, expected: { decision: 'answer_only' } },
  { id: 'live-agent-02', mode: 'agent', message: '帮我规划苏州两天行程', constraints: { city: '苏州', days: 2 }, expected: { decision: 'create_plan', planDays: 2 } },
  { id: 'live-agent-03', mode: 'agent', message: '第一天：中山陵\n第二天：总统府\n第三天：瞻园\n第四天：购买伴手礼后返程', constraints: { city: '南京', days: 0 }, expected: { decision: 'create_plan', planDays: 4 } },
  { id: 'live-agent-04', mode: 'agent', message: '我想去杭州', constraints: { city: '杭州', days: 0 }, expected: { decision: 'ask_clarification' } }
  ,{ id: 'live-agent-05', mode: 'agent', message: '你觉得第二天这样安排合理吗？', constraints: { city: '南京', days: 2 }, expected: { decision: 'answer_only' } }
  ,{ id: 'live-agent-06', mode: 'agent', message: '南京博物院几点关门？', constraints: { city: '南京', days: 2 }, expected: { decision: 'answer_only' } }
  ,{ id: 'live-agent-07', mode: 'agent', message: '第二天会不会太赶？', constraints: { city: '南京', days: 2 }, expected: { decision: 'answer_only' } }
  ,{ id: 'live-agent-08', mode: 'agent', message: '帮我规划成都三天行程', constraints: { city: '成都', days: 3 }, expected: { decision: 'create_plan', planDays: 3 } }
  ,{ id: 'live-agent-09', mode: 'agent', message: '我想去苏州，但还没想好玩几天', constraints: { city: '苏州', days: 0 }, expected: { decision: 'ask_clarification' } }
  ,{ id: 'live-agent-10', mode: 'agent', message: '杭州值得去吗？', constraints: { city: '杭州', days: 0 }, expected: { decision: 'answer_only' } }
  ,{ id: 'live-extract-07', mode: 'extraction', message: '成都玩5天，喜欢美食和历史', expected: { days: 5, city: '成都' } }
  ,{ id: 'live-extract-08', mode: 'extraction', message: '第三天轻松一点', expected: { days: 0 } }
  ,{ id: 'live-extract-09', mode: 'extraction', message: '苏州三日游，节奏适中', expected: { days: 3, city: '苏州' } }
  ,{ id: 'live-extract-10', mode: 'extraction', message: '第一天：拙政园\n第二天：虎丘\n第三天：平江路', expected: { relations: [['拙政园', 1], ['虎丘', 2], ['平江路', 3]] } }
]
