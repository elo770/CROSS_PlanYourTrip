# 越陌CROSS

越陌 CROSS 是一个地图驱动的对话式旅行规划工作区。用户既可以手动搜索和编辑地点，也可以通过连续对话导入、生成和局部修改行程；成功的 Agent 操作会同步更新地图与日程，并支持撤销。前端使用 Vue 3，Agent 服务使用 Express、DeepSeek 与高德 POI 接口。

## 产品定位

CROSS 面向需要整理和反复调整自由行路线的旅行者，强调“对话、地图与日程共享同一份行程状态”。当前 Agent 聚焦单城市 1–14 天规划，不覆盖预订和实时票价。

相比只提供列表录入的行程工具，这个项目更强调空间感和路线感：

- 用户可以直接围绕地图组织目的地
- 路线调整后，行程视图会同步更新
- 预算管理与路线规划放在同一个工作流中
- 数据既可以先保存在本地，也可以进一步同步到 Firebase

## 产品体验

这个产品围绕一次完整的旅行规划过程设计，主要分为四个连续步骤：

1. 在首页查看已有路线，或者加载示例路线快速开始
2. 在地图页搜索 POI、手动点选地点、调整顺序并补充描述
3. 在行程页查看根据路线自动生成的每日安排
4. 在预算页录入花费并查看汇总统计

当前项目内置了两条示例路线（欧洲轻松自由行 / 江浙沪旅游攻略），用于演示从路线加载、日程生成到预算管理的整套流程。

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
- Agent 支持连续问答、导入现有路线、生成行程和局部修改
- 每条路线绑定独立本地会话，刷新后恢复历史
- Agent 过程展示真实工具阶段；涉及行程变更时先生成提案，用户确认后才同步地图与日程
- 导入路线保留原始分天和顺序，并区分节奏偏好与检测强度
- 支持 Firebase Firestore 同步
- 支持可选 Express API 接口

## 核心能力

- 路线规划：围绕地图完成目的地录入、排序与编辑
- 行程联动：路线变化后自动重建每日行程
- 预算统计：按天数与类型汇总旅行预算
- 数据同步：优先走 Firebase，未配置时可回退到本地或自建 API
- 部署灵活：前端可部署到 Vercel，后端可选部署到 Render

## 技术栈

- Vue 3
- Vite 4
- TypeScript 5
- Vue Router 4
- Pinia
- Element Plus
- MapLibre GL
- ECharts + vue-echarts
- Firebase
- Express

## 目录结构

```text
CROSS/
|- src/
|  |- components/
|  |- lib/
|  |- router/
|  |- store/
|  |- types/
|  |- views/
|  |- App.vue
|  |- main.ts
|  `- style.css
|- public/
|- server/
|  |- routes/
|  |- db.js
|  `- index.js
|- docs/
|- .env.example
|- package.json
|- render.yaml
`- vercel.json
```

## 环境要求

- Node.js 18 或更高版本
- npm 9 或更高版本

## 安装

在 `CROSS` 目录安装前端依赖：

```bash
npm install
```

如果你需要启用本地 Express API，再安装后端依赖：

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

如果需要同时启用本地后端，再开一个终端执行：

```bash
npm run server
```

后端默认运行在 `http://localhost:3001`。

Agent 密钥只放在 `CROSS/server/.env` 或 `CROSS/.env`：

```env
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
AMAP_KEY=
CROSS_PROMPT_VERSION=v1-structured
```

不要把服务端密钥移动到 `VITE_` 环境变量。

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

## 环境变量

项目优先使用 Firebase。可参考 `.env.example` 配置以下变量：

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`（可选）

如果暂时不用 Firebase，也可以改为连接自建 API：

- `VITE_API_BASE_URL`

注意：该值需要以 `/api` 结尾，例如 `https://your-service.onrender.com/api`。

## 路由页面

当前前端路由如下：

- `/home` 首页
- `/map` 路线规划
- `/schedule` 日程安排
- `/budget` 预算管理

访问根路径 `/` 时会自动跳转到 `/home`。

## 部署说明

### Vercel 部署前端

- Root Directory 设为 `CROSS`
- Build Command 使用 `npm run build`
- Output Directory 使用 `dist`

当前 `npm run build` 已不再执行 `vue-tsc`，避免在 Vercel 上因 `vue-tsc` 与 Node 版本兼容性导致构建失败。

### Firebase

- 在 Firebase 控制台创建 Web 应用
- 将配置写入 `.env` 或 Vercel 环境变量
- 根据需要发布 `firestore.rules`

### Render 部署后端

`render.yaml` 当前用于部署可选的 Node 服务：

- `buildCommand`: `npm install --prefix server`
- `startCommand`: `node server/index.js`

## 常用脚本

- `npm run dev` 启动前端开发环境
- `npm run build` 构建前端
- `npm run preview` 预览构建产物
- `npm run server` 启动本地 Express API
- `npm run deploy:firebase` 构建并执行 Firebase 部署

后端测试与评测：

- `npm test --prefix server`：运行确定性回归测试
- `npm run eval:offline --prefix server`：运行 40 条离线 Harness 评测并生成报告
- `npm run eval:live --prefix server -- --version=v1-structured`：调用真实 DeepSeek/高德；仅在密钥已配置时运行
