# 越陌 CROSS

旅行规划常常分散在攻略笔记、地图收藏、聊天记录和日程表里：地点能记住，却很难判断它们是否顺路、一天是否排得下，也需要在多个 App 之间反复切换。

**越陌 CROSS** 将地点收集、地图查看、路线编排、分日行程、预算管理和 AI 对话整合在同一个工作台。
用户可以通过AI助手整理行程，在地图上直观看到地点分布，再按区域、天数和游览节奏安排顺序，减少跨区折返，让“想去哪里”逐步变成一份清晰的旅行计划。

![CROSS 首页：新建与管理路线](CROSS/public/readme/home.png)

## CROSS 解决什么问题

| 原有规划方式 | CROSS 的做法 | 用户收益 |
| --- | --- | --- |
| 攻略、收藏、地图和日程分散在多个工具 | 地点、地图、日程和预算共享同一份行程 | 不必反复复制、切换和核对信息 |
| 只看文字列表，难判断地点是否集中 | 在地图上显示地点分布与连接顺序 | 更直观看出跨区安排和潜在折返 |
| 改一个地点后还要手动改地图和日程 | 地点、每日顺序和行程联动更新 | 减少重复整理，方便持续调整 |
| AI 一次生成后难以继续讨论 | Agent 保留草案与上下文，可继续分析和修改 | 先讨论、再确认，不必从头规划 |

![CROSS 路线规划工作台：地图、地点列表与 AI 助手联动](CROSS/public/readme/map-planner.png)

## 如何规划行程

```text
自行添加/与AI助手聊天添加景点 -> 在地图上安排顺序 -> 生成分日行程 -> 与 Agent 讨论调整 -> 确认保存
```

- **地图优先规划**：搜索 POI、地图点选、编辑地点、安排分天与每日顺序。
- **行程同步联动**：地点变化会同步反映到地图、地点列表和分日行程。
- **对话式规划**：可从一句旅行需求开始，也可直接导入已有文字攻略继续讨论。
- **草案确认机制**：Agent 先给出可预览草案，用户确认后再写入正式行程。
- **预算管理**：记录消费明细，按日期和类别查看汇总。

## Agent 对话体验

```text
用户消息
  -> 理解需求、已有行程与本轮补充
  -> 核实 POI / 分析地点距离与每日负载
  -> 给出回答、追问或旅行草案
  -> 用户继续讨论，或确认保存
  -> 地图、地点列表和日程同步更新
```

Agent 支持创建单城草案、多城市总路线草案、分析已有行程、优化地点顺序、纠正地点识别，以及围绕同一份草案连续沟通。它会区分用户输入、高德 POI 核实结果和规划建议，让每一次调整都有明确依据。

## 产品定位

CROSS 面向希望把零散攻略整理成清晰旅行计划的自由行用户，强调“对话、地图与日程共享同一份行程状态”。用户既可以从一个城市的几天行程开始，也可以先搭建多城市旅行骨架，再逐段细化每天的地点安排。

相比只提供列表录入的行程工具，这个项目更强调空间感和路线感：

- 用户可以直接围绕地图组织目的地
- 路线调整后，行程视图会同步更新
- 预算管理与路线规划放在同一个工作流中
- 路线和预算支持本地保存、Firebase Firestore 或服务端 PostgreSQL 持久化

## 产品体验

这个产品围绕一次完整的旅行规划过程设计，主要分为四个连续步骤：

1. 在首页查看已有路线，或者加载示例路线快速开始
2. 在地图页搜索 POI、手动点选地点、调整顺序并补充描述
3. 在行程页查看根据路线自动生成的每日安排
4. 在预算页录入花费并查看汇总统计

项目内置示例路线（欧洲轻松自由行 / 江浙沪旅游攻略），用于演示从路线加载、日程生成到预算管理的完整流程。

## 适用场景

- 旅行路线规划与展示
- 地图交互类课程设计或毕业设计
- 旅游类产品原型验证
- 带有多页面状态联动的前端项目示例
- Firebase 或前后端分离部署的练习项目

## 当前功能

- 首页管理已保存路线，并可一键加载示例路线
- 地图页支持 POI 搜索、地图点选、调整目的地顺序、编辑目的地信息
- 行程页根据当前路线生成每日行程安排
- 预算页支持新增、删除预算项，并显示统计图表
- Agent 支持连续问答、地点纠错、导入现有路线、生成草案、行程分析和局部调整
- 每条路线绑定独立会话；刷新页面后可恢复对话与待确认草案
- Agent 过程通过 SSE 展示地点核实、编排与校验等步骤；涉及行程变更时先生成提案，用户确认后才同步地图与日程
- 导入路线保留原始分天和顺序，便于围绕用户原有攻略继续优化
- 支持 Firebase Firestore 同步
- 支持可选 Express API 接口

## 核心能力

- 路线规划：围绕地图完成目的地录入、排序与编辑
- 行程联动：路线变化后自动重建每日行程
- 预算统计：按天数与类型汇总旅行预算
- 数据同步：Firebase Firestore 用于路线与预算同步；Express + PostgreSQL 用于 Agent 正式 Trip、Proposal 与运行记录
- 部署灵活：前端可部署到 Vercel，服务端可部署到 Render 等 Node 平台

## 技术栈

- Vue 3
- Vite 4
- TypeScript 5
- Vue Router 4
- Pinia
- Element Plus
- 高德地图 JS API、MapLibre GL
- ECharts + vue-echarts
- Firebase
- Express、PostgreSQL、SSE
- DeepSeek、LangGraph、高德 POI 服务

## 环境要求

- Node.js 18 或更高版本
- npm 9 或更高版本

## 安装

在 `CROSS` 目录安装前端依赖：

```bash
npm install
```

如需使用 AI 对话、服务端 POI 查询或 PostgreSQL 持久化，再安装后端依赖：

```bash
npm install --prefix server
```

## 本地开发

启动前端开发服务器：

```bash
npm run dev
```

前端默认运行在 `http://localhost:3000`。

Vite 已配置代理，访问 `/api` 时会转发到 `http://localhost:3001`。

如需启用本地后端，在第二个终端创建服务端配置并启动：

```bash
Copy-Item server/env.example server/.env
npm run server
```

后端默认运行在 `http://localhost:3001`。

在 `server/.env` 中填写使用者自己的服务端配置：

```env
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
AMAP_KEY=
CROSS_PROMPT_VERSION=v1-structured
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/globaltrip
```

前端配置从 `.env.example` 复制：

```bash
Copy-Item .env.example .env
```

`VITE_AMAP_KEY`、`VITE_API_BASE_URL` 和 `VITE_FIREBASE_*` 写在前端 `.env`。请勿把服务端密钥放入任何 `VITE_` 变量：这类变量会进入浏览器构建产物。

## 构建与预览

项目当前构建命令如下：

```bash
npm run build
```

它实际执行的是：

```bash
vite build
```

本地预览构建结果：

```bash
npm run preview
```

预览服务默认运行在 `http://localhost:4173`。

## 环境变量与密钥

| 文件与变量 | 用途 | 安全要求 |
| --- | --- | --- |
| `.env` 中的 `VITE_AMAP_KEY` | 浏览器地图组件 | 属于浏览器可见配置，应在高德控制台限制 Referer 域名。 |
| `.env` 中的 `VITE_API_BASE_URL` | 前后端分离部署时的 API 地址 | 以 `/api` 结尾，例如 `https://your-service.example.com/api`。 |
| `.env` 中的 `VITE_FIREBASE_*` | Firestore 路线与预算同步 | 使用 Firebase Web 配置，并配置 Firestore Rules。 |
| `server/.env` 中的 `DEEPSEEK_API_KEY` | Agent 模型调用 | 仅服务端可见，绝不提交。 |
| `server/.env` 中的 `AMAP_KEY` | 服务端 POI 核实 | 仅服务端可见，绝不提交。 |
| `server/.env` 中的 `DATABASE_URL` | PostgreSQL 持久化与 LangGraph checkpoint | 含密码时仅保存在本机或部署平台。 |

使用者需要申请并填写**自己的** DeepSeek、高德与数据库配置。无需也不应共享作者的模型密钥、额度或账户权限。


