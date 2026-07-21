# CROSS Prompt 工程与 Eval 说明

## 为什么做版本化

Prompt 工程不是持续增加指令，而是固定输入、模型和采样参数，对比不同 Prompt 对明确指标的影响。CROSS 保留 `v0-baseline` 和 `v1-structured`，避免用修改后的版本覆盖基线、失去对照证据。

## Prompt 任务拆分

- Persona：语气、角色边界和一次只问一个必要问题。
- Extraction：城市、天数、偏好、Day-Activity 关系与活动类型。
- Initial planning：选择高德返回的候选地点，不虚构坐标。
- Answer only：回答咨询，不声称修改路线。
- Modify：只生成当前 Plan 可执行的局部操作。
- Repair：模型承诺修改但未返回操作时，纠正一次。

`v0-baseline` 使用扁平 `poiNames`；`v1-structured` 要求保留日期块、原顺序、活动类型、`sourceText` 和置信度。日期块切分由确定性 Parser 负责，Prompt 不重复承担可由代码可靠完成的任务。

## 评测集

`server/evals/cases.js` 包含 40 条离线案例：

| 类别 | 数量 | 核心指标 |
|---|---:|---|
| 意图 | 10 | `answer/create/modify/clarify` 判断 |
| 时间 | 10 | 总时长与日期序号消歧 |
| 导入 | 10 | Day-Activity 关系、活动类型、遗漏与日期缺口 |
| 安全 | 10 | 锁定保护、单日修改、重排和拒绝非法操作 |

离线评测运行 Parser、Validator、Planner 和操作执行器，不调用 LLM。真实评测包含 6 条结构抽取和 4 条完整 Agent 案例，可分别对 `v0`、`v1` 运行。

## 当前基线

- Node 回归测试：以 `npm test` 的当前输出为准；2026-07-17 本次改造后为 33 项通过。
- Offline Eval：80/80 通过，新增问答意图、长途时长和多城市骨架守恒案例。
- Offline Eval 曾首次得到 39/40，并发现 `reorder_poi` 只产生修改文案、归一化后顺序未变化；修复并增加回归测试后达到 40/40。
- 以上只证明确定性 Harness 行为，不代表 LLM 回答准确率或线上用户满意度；20 条真实模型案例仍需在确认额度后运行和人工评分。
- Prompt v0/v1 真实对比尚未运行，不能声称 v1 已带来定量提升。

报告输出：

- `server/evals/reports/offline-latest.json`
- `server/evals/reports/offline-latest.md`
- `server/evals/reports/live-<version>.json|md`

## 人工评分检查点

真实模型结果需要用户对 10 条案例进行 1–5 分评分：

| 案例 | 回复自然度 | 路线合理性 | 解释清晰度 | 备注 |
|---|---:|---:|---:|---|
| 1–10 | 待标注 | 待标注 | 待标注 | 待用户确认 |

不能由自动脚本代替人工评分，也不能把未完成标注写成项目结果。

## 如何运行

```bash
cd CROSS/server
npm run eval:offline
npm run eval:live -- --version=v0-baseline
npm run eval:live -- --version=v1-structured
```

真实运行会消耗 DeepSeek 和高德额度，执行前应确认密钥、案例数量和用途。
