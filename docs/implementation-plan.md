# KDP Helper 实施计划

日期：2026-09-16。需求依据：`docs/requirements.md`。作者已批准开始实现，强调先核对官方规格、防止无效生成；没有授权提交 Git、付费生图或代为发布。

## 实现边界

Next.js 本机应用，Node 文件持久化，React 单人工具界面；纯 TypeScript 印刷规格模块为唯一计算入口，pdf-lib 用于精确版式和字体嵌入。先支持经核验的 8.5×8.5、8×10、8.5×11 英寸彩色平装预设，高级/标准彩色白纸，出血/不出血。默认推荐方形高级彩色，但必须由作者确认规格后才能调用模型。

## 模块与验证顺序

1. `src/domain/print-spec.ts`、`src/domain/book.ts`：官方规则、像素/封面尺寸、固定版式、检查报告；Vitest 先写尺寸、页数、色彩、旧素材与选图失效的断言。规格源附来源、核对日期与版本，不从模型生成规则。
2. `src/server/store.ts`、`src/server/security.ts`：本机 JSON 原子保存、素材存储、同源请求限制、凭据隔离；测试版本冲突、路径约束、重启后不重新发起请求。
3. `src/server/provider.ts`、`src/server/jobs.ts`：兼容 coderplan-ai 的图片/文字接口，串行任务保存结果，失败隔离，超时不自动重试；HTTP mock 验证实际响应、不重复请求和请求参数。
4. `src/server/pdf.ts`：字体嵌入、模板排版、300 DPI 检查、独立封面与固定版本导出；检查 PDF 页数/页面尺寸，实际渲染确认内容。
5. `src/app/api/**`：瘦路由，仅检查请求并调用 server facade；静态字体和样本只用明确允许再分发的资源。
6. `src/components/**`、`src/app/page.tsx`、`src/app/globals.css`：四阶段工作台，页面清单、候选和任务、内页/封面预览、设置与导出；不出现账户和商业化界面。
7. 完整验证：`npm test` → `npm run typecheck` → `npm run lint` → `npm run build`，浏览器测试无凭据导入/导出路径，受控 mock 检查生成路径。不使用真实付费 Key。

## 接口约定

项目结构由 `src/domain/book.ts` 导出，前后端共用。服务端生成 ID，图片通过 `/api/assets/{id}` 读取。所有项目写入带版本号，旧版本返回 409 而不是覆盖。生图任务对项目中的页面执行，不向客户端泄露 Key；图片请求必须在规格已确认后进行。

接口：`GET/POST /api/projects`，`GET/PUT /api/projects/{id}`，`GET/PUT /api/settings`，`POST /api/assets`，`GET /api/assets/{id}`，`POST /api/generate`，`POST /api/outline`，`GET/POST /api/jobs`，`POST /api/export`，`GET /api/exports/{projectId}/{version}/{filename}`。

所有写路由同源检查。无凭据时文字可手工输入、图片可本地导入；不展示假的生成成功状态。正式 PDF 的必要检查有错误则拒绝，允许另存明确标记的草稿。

## 完成标准与已知外部依赖

真实项目可在重启后恢复，候选图本地保存；导出内页和完整封面，验证实际文件而不是只看 HTML。官方预设与图片要求在第一步可见，规格改变不自动付费重画，但旧确认与导出失效。

真实 coderplan-ai 计费调用、KDP 账号上传与纸质样书由作者授权后完成；未完成的项目在交付中明确标为未验证。此轮不创建新 Git 分支或提交。
