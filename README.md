# Project Progress Platform

Case-Task 架构版项目进度与工时协作平台 MVP。

## 技术栈

- Backend: Node.js + TypeScript + Fastify + SQLite
- Frontend: React + Vite + Ant Design

## 本地运行

```bash
npm install
npm run dev
```

默认地址：

- Web: http://localhost:5173
- H5: http://localhost:5173/m
- API: http://localhost:4000

## 当前 MVP

- Case / CaseItem / Task / SubTask 样例数据
- 七阶段项目流程：设计 -> 材料入库 -> 下料 -> 装焊 -> 喷涂 -> 验收 -> 发货
- 阶段下配置子流程；设计为项目级，后续阶段为子项目级
- Web Excel 式进度矩阵
- Task / SubTask 进度更新
- WorkLog 日报录入
- Exception 异常情况
- H5 我的任务、日报录入、异常处理

## 生产部署

项目已提供 Docker Compose 生产配置，包含 Nginx、Node API 和 SQLite 持久卷。

详细步骤见 [deploy/README.md](deploy/README.md)。
