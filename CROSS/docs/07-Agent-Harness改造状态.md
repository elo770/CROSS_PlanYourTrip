# CROSS Agent Harness 改造状态

## 本轮已落地

- DeepSeek 调用已抽到 `ModelAdapter`，错误映射不再向前端返回供应商响应正文。
- 新增 Run API 与可恢复 SSE 事件：`POST /api/agent/runs`、`GET /api/agent/runs/:id/events`、`GET /api/agent/runs/:id`。
- 生成或修改结果不会直接进入正式地图；确认 Proposal 后才返回可应用 Plan，拒绝不会改变行程。
- Postgres 增加 Agent Session、Message、Run、Event、Proposal 和 Trip Version 表，并为 Trip 增加 owner、schema version 与 revision。
- 新增匿名 HttpOnly 会话隔离、Agent 请求限流、512KB 请求体上限和分项健康状态。
- 问答短句不再跳过实体抽取；路线评价类问题优先回答，不误判为修改。
- 问答允许模型选择只读 POI 查询，并区分高德已核实信息和未核实实时信息。
- 新增 `Trip -> Segment` 模型、旧 Route 单 Segment 适配和 15-60 天中国境内城市骨架 Proposal。
- Offline Eval 从 40 条扩展到 80 条。

## 仍需后续验证或继续实现

- 尚未运行会消耗 DeepSeek/高德额度的 20 条 Live Eval，也未完成人工 1-5 分质量标注。
- 现有单城执行逻辑仍保留在旧 `agent.js` 内，后续应继续迁移到独立的 Router、Answer Composer 和 Operation Planner。
- 多城市首版只保存城市顺序、停留天数与日期范围；Segment 逐段细化界面和跨城交通工具尚未实现。
- 旧路线/预算页面仍保留 localStorage、Firestore 和自建 API 回退；新 Agent 数据以 Postgres 为目标事实源，但整个产品的数据迁移尚未完成。
- 完整账号、跨设备身份合并、真实营业时间、票价、天气和城际班次不在本轮范围。

## 验证命令

```bash
cd CROSS/server
npm test
npm run eval:offline

cd ..
npm run build
```
