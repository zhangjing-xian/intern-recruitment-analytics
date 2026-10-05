# AGENTS.md — 项目契约与开发约束（实习生招聘数据复盘网站）

> 本文件是本项目**最高优先级的开发约束**。任何一步开发都必须先读本文件与 `docs/PRD.md`。
> 与 `docs/PRD.md` 冲突时以 PRD 的业务口径为准；与本文件的网络 / 隐私 / 测试约束冲突时以本文件为准。
> 文档版本：V3.2 ｜ 建立日期：2026-09-26 ｜ 当前进度：**步骤14（最终测试、隐私核验与最终验收）已交付**：
> 测试栈补齐两层——`jsdom@30` + `@testing-library/react` 的**真实 DOM 交互用例**（映射阻断与确认、
> 筛选读数等于引擎读数、AI 一次性令牌与载荷一致性，18 例）与 **Playwright 驱动系统 Chrome** 的
> 端到端用例（11 例：主链路、零出站与 CSP 真的拦下、临时模式不落盘、建仓后无明文、SW 安装与断网、
> 性能基准、含 AI 版的一次性调用）。命令分两条：`npm run test:e2e`（本地版）与
> `npm run test:e2e:ai`（含 AI 版，`@ai-build` 标签，在本地版产物上**主动 skip** 而不是假装通过）。
> 本步在真实浏览器里抓出并修掉两个真问题：① meta CSP 里的 `frame-ancestors` 会被浏览器忽略并
> 报错（新增 `buildMetaCsp`：与响应头版逐字相同、只去掉那一条）；② 仓库守卫会扫到 Playwright 的
> 运行残留（`test-results` 已跳过并 gitignore）。A01–A20 与 AI01–AI18 的逐项判定连同实测数字
> 已写进 `docs/ACCEPTANCE.md`。
> 前序：步骤1–12、AI-1 至 AI-7、步骤13 已交付。
> **已知技术债**：首屏 `index-*.js` 760.09 kB（`App.tsx` 全静态 import 所有页面），
> 路由级 `lazy()` 是独立一步，见 `docs/DECISIONS.md` D-051；**真实托管平台、真实 Key（CORS）
> 与 Edge / Firefox / WebKit 仍未验证**，见 `docs/KNOWN_ISSUES.md`）

## 1. 项目定位

- 纯前端静态网站：React + Vite + TypeScript（strict）+ Tailwind CSS，**没有网站后端**。
- 输入是 offer 名单，不是完整招聘链路；**不能**宣称全链路漏斗、渠道 ROI 或完整人效分析。
- 所有统计、清洗、加密、导出都在**用户浏览器内**完成。

## 2. 硬约束（违反即阻断发布）

1. **默认本地处理**：默认模式下招聘数据、清洗结果、统计结果、报告数据一律不出浏览器。
   不加载第三方运行时脚本 / 字体 / 图片 / 地图 / 埋点 / 广告 / 遥测 / 错误上报，不接 CDN。
2. **可选 DeepSeek 是唯一外发例外**，且必须同时满足：
   - AI 默认关闭；打开开关、保存 Key、导入文件、切换筛选、打开历史**都不得**触发任何请求；
   - 只有用户在看板**主动点击「AI 深度分析」**，看到**完整脱敏预览**（完整 JSON、system 与 messages、
     模型与参数、目的域名与路径、脱敏级别、移除 / 合并项、内容大小、可能产生费用）后**逐次确认**，
     才允许发起**这一次**调用；
   - 发送内容**只能是聚合摘要**。任何情况下不得发送：原始行、候选人姓名、候选人 / 需求 ID 列表、
     原始学校名、HR 姓名、准确薪资、完整日期、文件名、逐条拒绝原因原文；
     「把姓名换成代号」**不算**聚合，仍禁止；
   - 每次发送都要单独确认；**不做**「记住本次同意，下次自动发送」；取消 / 失败 / 超时不自动重试、
     不自动切换模型或端点、不后台排队；
   - Key 只存在本地（默认仅内存，可显式加密保存），仅在 `Authorization` 请求头中发往已确认端点；
     **不得**把 Key 写进 URL、请求正文、源码、`VITE_*` 变量、控制台、日志、普通备份或 AI 历史。
3. **统一指标引擎**：N/J/P/A/R1/R2/U/D、各率、周期、分位等口径只实现一次（`domain/analytics` 纯函数），
   组件内**禁止**重复写公式。派生指标不分散到组件。
4. **加密持久化**：任何敏感业务数据不得明文落盘。使用 Web Crypto（PBKDF2-HMAC-SHA-256 → AES-GCM-256，
   salt ≥16 字节，每次加密独立 12 字节 IV，128 位认证标签）写入 IndexedDB（Dexie）。
   密码与密钥只在内存；默认闲置 15 分钟锁定；不提供密码找回。
5. **导出先脱敏**：先构造唯一 `SanitizedReport` 模型，所有格式（XLSX / PNG / 打印 PDF / Markdown）
   都从该模型生成；默认导出聚合报告，不导出逐条明细；小组抑制与互补抑制必须先做。
   AI 返回内容视为**不可信文本**，导出前再做一次本地敏感字段检查。
6. **测试只用合成数据**：不得把真实招聘附件、密码、真实截图、真实 Key 提交到仓库、
   测试夹具、演示数据、构建产物或 CI。
7. **不新增网站后端**：不引入服务器、云数据库、登录系统、上传接口、API Routes、Functions、
   Worker 业务后端、公共 CORS 代理或云同步；**托管平台上不开启任何访问统计 / Analytics**。
8. **生产 CSP 与 Service Worker**（步骤13 起）：`src/lib/csp.ts` 是策略的唯一来源
   （本地版 `connect-src 'none'` / 含 AI 版精确官方 origin，**没有**通配符与 `unsafe-*`），
   构建时注入 `index.html` 的 meta 与产物里的 `_headers`；**不得**为自定义地址放宽任意域
   （只能通过 `CSP_CONNECT_SRC` 显式给出一个精确 https origin）。`public/sw.js` 只缓存同源
   静态资源，**不得**缓存 / 排队 / 重发 AI 请求（非 GET、跨源、带 `Authorization`、非 http(s)
   四条直接放行），**不得**使用 Background Sync / Periodic Sync / Push，
   也**不得**读写 IndexedDB / localStorage / Cookie。

## 3. 环境现状与工具链要求

本地环境检查结果（2026-09-26，Windows / PowerShell）：

| 工具 | 检查结果 | 结论 |
|---|---|---|
| Node.js | `v24.19.0`（`C:\Program Files\nodejs\node.exe`） | ✅ 满足要求 |
| npm | `11.17.0`（`C:\Program Files\nodejs\npm.cmd`） | ✅ 满足要求 |
| npx | 存在（`C:\Program Files\nodejs\npx.cmd`） | ✅ 可用 |
| Git | **未安装**（不在 PATH，`C:\Program Files\Git` 与用户目录均不存在） | ❌ 需用户自行安装 |
| npm registry | `https://registry.npmjs.org/`（官方源） | ✅ 正常 |

版本要求依据（官方文档核实，2026-09-26）：

- Vite 官方要求 **Node.js 20.19+ 或 22.12+**；当前 Vite 主版本为 8.x。
  Node 24.19.0 **满足** Vite 8 的 Node 要求。
- Tailwind CSS 当前主版本为 **v4.x**，官方 Vite 集成方式是安装 `tailwindcss` 与 `@tailwindcss/vite`，
  在 `vite.config.ts` 中注册插件，并在 CSS 中 `@import "tailwindcss";`。
  **不要**混用 Tailwind v3 的 `tailwind.config.js` + PostCSS 旧配置。
- 依赖版本必须在步骤1安装时按官方文档核实并写入锁文件；本文件**不硬编码「最新版本」**。
- 骨架生成方式（步骤1 实测，2026-09-26）：在**临时目录**执行
  `npx create-vite@latest <目录> --template react-ts --no-interactive --no-immediate`，
  再把文件合并进项目根目录，避免 `create-vite` 在非空目录提示「是否清空」而覆盖 `docs/` 与 `AGENTS.md`。
  非交互环境必须显式传 `--no-interactive --no-immediate`，否则会在「install and start dev」提问处
  报 `Operation cancelled`。官方模板默认使用 **oxlint**，本项目保留该默认，未额外引入 ESLint。
- Vite dev server 默认只绑定 `localhost`（本机解析为 IPv6 `::1`），所以用 `http://127.0.0.1:<port>`
  探测会报「无法连接到远程服务器」；需要 IPv4 探测时显式加 `--host 127.0.0.1`（本机实测，2026-09-26）。
- `vite.config.ts` 已关闭 Vite 的 module preload polyfill（`build.modulePreload.polyfill: false`）：
  该 polyfill 会用 `fetch` 预取本地资源，与步骤13 的 CSP `connect-src 'none'` 冲突，且现代浏览器不需要它。
- 解析依赖按官方来源安装并锁定（步骤3 实测，2026-09-26，见 `docs/DECISIONS.md` D-020）：
  SheetJS 用官方包 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`（公共 npm registry 上的 `xlsx`
  停留在 0.18.5，官方明确其为已知问题），CSV / TSV 用 `papaparse@^5.7.0` + 开发依赖 `@types/papaparse`。
  运行时**零 CDN、零远程脚本**。
- 解析在**同源 Worker** 中执行：`new Worker(new URL('../workers/parse.worker.ts', import.meta.url), { type: 'module' })`
  （Vite 会打包成独立 chunk）；无 Worker 环境回退到进程内实现，解析依赖用**动态 `import()`** 加载。
  因此 `src/importers/index.ts` **刻意不导出** `pipeline` / `delimited` / `xlsx` / `workerBridge`：
  它们会牵入 SheetJS（约 400 kB）与 PapaParse，把首屏包从 320 kB 撑到 712 kB，并触发 Vite 的
  `INVALID_DYNAMIC_IMPORT` 警告。新增解析代码必须放在 Worker 入口或动态 import 路径里。
- 加密仓依赖（步骤6 实测，2026-09-26）：`dexie@^4.4.6`（运行时，只由加密仓使用）+ `fake-indexeddb@^6.2.5`
  （仅开发依赖，给 Node 测试环境提供同 API 的内存实现）。Dexie 只允许出现在**动态 import 的另一侧**：
  `src/storage/index.ts` 不导出 `vault.ts` / `backup.ts` / `db.ts`，界面一律经 `storage/vaultFacade.ts`
  的 `encryptedVault`（方法内 `await import(...)`，类型用 `import type`），因此首屏包不含 Dexie
  （实测首屏 421.09 kB，`vault` chunk 102.80 kB 按需加载；口径见 D-027）。
- 图表依赖（步骤8 建立，步骤9 实测，2026-09-26）：`echarts@^6.1.0`（本地打包，**零 CDN**）。它同样只允许出现在
  **动态 import 的另一侧**：`features/dashboard/charts/echartsRegister.ts` 用官方文档的具名导入只注册
  用到的模块，且只被 `charts/echartsLoader.ts` 动态 `import()`（静态只 `import type`）。步骤9 为该模块增加
  `ScatterChart`（岗位/序列/部门的量率散点，见 D-041）后实测：首屏 `index-*.js` **494.12 kB（ECharts 不在其中）**、
  `echartsRegister-*.js` **542.67 kB 懒加载**（散点只让懒 chunk +6.24 kB）。
  两条禁令：组件不得静态 `import 'echarts'`；也不得在 loader 里 `await import('echarts/charts')`
  再访问 `charts.BarChart`（rollup 会保守保留整个 barrel，多出约 400 kB 的懒 chunk），
  注册代码必须写在被动态导入的**具名导入**模块里。以后新增图表类型走同一条路：
  在注册模块具名导入 + 在 loader 的类型联合里加对应的 `XxxSeriesOption`。口径见 `docs/DECISIONS.md` D-037 / D-041。

- 生产构建与 PWA（步骤13 实测，2026-09-26）：
  - 三条构建命令：`npm run build`（**本地版**，`connect-src 'none'`）、`npm run build:ai`
    （`vite build --mode ai`，精确放行 `https://api.deepseek.com`）、
    `npm run build:subpath`（`--base=/intern-recruitment/`）。**不用 shell 语法设环境变量**
    （Windows 下 npm script 里 `VAR=x cmd` 不可用），一律走 Vite 自己的 `--mode` / `--base`。
  - CSP 由 `vite.config.ts` 的 `dsh:csp` 插件注入两处：`index.html` 的 meta
    （位置在 `<meta charset>` 之后、任何 `<script>` / `<link>` **之前**——meta CSP 只对它之后的
    资源生效）与产物里的 `_headers`（Cloudflare Pages / Netlify 消费）。**`apply: 'build'`**：
    dev server 不注入，否则热更新会因为缺 inline/eval 直接坏掉。
  - `npm run icons` 用 `scripts/make-icons.mjs`（Node `zlib` 手写 PNG）重新生成 192/512 图标；
    产物里 `sw.js` / `manifest.webmanifest` 与 `public/` 下**逐字一致**（构建不做转换），
    有测试断言这一点。
  - 本机实测：三种构建退出码 0；`vite preview` 下 `/`、`/sw.js`、`/manifest.webmanifest` 都 200；
    子路径构建的 `preview` 在 `/intern-recruitment/` 下 200 且资源前缀正确；
    `npm run dev -- --host 127.0.0.1` 可启动且 **dev 下没有 CSP**。

- 测试与端到端（步骤14 实测，2026-09-26）：
  - **两档分工**：jsdom + Testing Library 写**组件契约**（走 `npm test`，秒级，文件头用
    `// @vitest-environment jsdom` 单独切换环境；`vite.config.ts` 的 vitest 默认仍是 `node`）；
    Playwright 写**只有浏览器能回答的事**（真实请求与 CSP、真实 IndexedDB / Cache、
    Service Worker 生命周期与断网、性能数字），放 `tests/e2e/`，由 `npm run test:e2e` 与
    `npm run test:e2e:ai` 两条命令跑。**不要**把「零出站」「SW 装上」这类断言降级成 jsdom 用例。
  - Playwright 用 **`channel: 'chrome'` 驱动系统已安装的 Chrome**，**不执行 `npx playwright install`**
    （不下载浏览器二进制、不往仓库塞大文件）。本机另有 Edge
    （`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`），改 `channel: 'msedge'` 即可复跑。
  - **构建模式与用例标签必须配对**：`@ai-build` 用例只在 `npm run build:ai` 的产物上成立
    （本地版 `connect-src 'none'` 下它们**发不出去**），因此本地版命令用 `--grep-invert @ai-build`，
    而用例自己也会先读 meta CSP，模式不对就 `test.skip` 并写明该用哪条命令——**skip 是诚实的第三种状态**。
  - `tests/e2e/helpers.ts` 里写着三条纪律：选择器只按用户看得见的文案、每个用例都记录全部请求
    并断言「零出站」、只用合成数据。另外两条实测踩到的坑写在那里：`HashRouter` 的会话只在内存里
    （跨页必须点界面链接，`page.goto('/#/x')` 会整页重载丢数据），以及**整页重载会让加密仓回到锁定态**
    （解锁状态只在内存），所以「导入提交」必须排在「建仓」之前。
  - 运行产物 `test-results/` 与 `playwright-report/` 已进 `.gitignore`，并被
    `features/privacy/acceptance.test.ts` 的仓库扫描跳过（守卫扫的是仓库内容，不是运行残留）。
  - 实测（本机）：`npm run test:e2e` **9 例通过**、`npm run test:e2e:ai` **2 例通过**，
    另有 18 例 jsdom 交互用例随 `npm test` 一起跑（合计 **1372 例 / 96 文件**）。

- Windows 文件系统**不区分大小写**（v1.3.1 实测踩到）：两个只差大小写的文件
  （`ReturnToAllScope.tsx` 与 `returnToAllScope.ts`）会被解析成**同一个文件**，
  于是 `import { ReturnToAllScope } from './ReturnToAllScope'` 会去那个小写文件里找组件、
  以「模块没有该导出」失败。同一目录下新增文件时，文件名必须**不只差大小写**。

注意：本机 PowerShell 执行策略当前禁止运行 `npm.ps1` / `npx.ps1`
（`无法加载文件 ...\npm.ps1，因为在此系统上禁止运行脚本`）。这不影响 `npm.cmd` 在
`cmd.exe` 中使用，也不影响 VS Code 内置终端里以 `npm.cmd ...` 调用。若希望在 PowerShell 中
直接使用 `npm`，需由用户自行执行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
（**本步骤不代用户修改任何系统安全设置**）。

## 4. 目录与职责约定（只规划职责，不做过度抽象）

```
src/
  domain/      字段、枚举、类型、口径、指标引擎（纯函数，不依赖 React / 网络 / 存储）；
               `domain/analytics/` 子目录承载统一指标引擎：筛选、分组聚合、时间趋势、分位、基准范围
  importers/   导入适配层：XLSX / CSV / TSV / 粘贴 → RawSheet（在 Worker 内执行，输出 RawRow）
  cleaning/    规范化、校验、质量报告、重复判定
  insights/    本地确定性结论与规则化行动建议
  storage/     加密仓接口（Dexie + Web Crypto 信封、版本迁移、备份）与内存会话
  crypto/      KDF、AES-GCM、Key 槽位
  privacy/     脱敏：SanitizedReport（可含本地明细）与 SanitizedAiPayload（只聚合）
  exporters/   XLSX / PNG / 打印 PDF / Markdown
  workers/     同源 Web Worker（解析、聚合、加密），消息带任务 ID，支持取消与过时结果丢弃
  ai/          summary（唯一 AnalysisSummary 构造点）/ catalog（模型能力表）/ aiConfig（实发参数唯一判定点）
               / keySession（Key 只在内存，许可按端点绑定）/ aiSettings（非敏感偏好）/
               aiRequest（正文由预览投影）
               / client（**唯一 network adapter**）/ aiResult（结果与错误契约）/ aiClient（互斥 / 取消 / 世代号）
               / aiMarkdown（**自己写的安全 Markdown 解析器**）/ aiResponseCheck（回复侧检查）
               / aiExport（AI 结果的 Markdown / 打印版导出）/ aiHistory（只在显式保存后写入）
               / subjectRules（**本地规则视图 + 指纹**）/ aiProxy（**代理的显式配置边界**）
               / consent / history
  pages/       路由级页面壳（9 个业务路由 + 未匹配兜底页）
  features/    各页面业务组件
  components/  通用 UI（布局、空态、错误边界、页面外壳）
  pwa/         Service Worker 注册与**用户可控的更新提示**（registerServiceWorker / UpdateNotice / pwaText）
  lib/         通用纯工具（路由登记表、中文格式化、**生产 CSP 唯一来源 csp.ts**），**不含业务口径**
public/        sw.js（**手写白名单式 Service Worker**）/ manifest.webmanifest / icons/ / favicon.svg
scripts/       make-icons.mjs（用 Node zlib 生成 PWA 图标的可重跑脚本）
deploy/        GitHub Pages / Cloudflare Pages / Vercel 三份说明 + vercel.json 模板（只准备配置，不上线）
tests/         单元 / 集成 / 端到端（仅合成数据）；`tests/e2e/` 放 Playwright 用例与 `helpers.ts`，
               运行产物 `test-results/` 与 `playwright-report/` 不进仓库
docs/          PRD、实施计划、决策记录、**ACCEPTANCE**（验收状态）、**KNOWN_ISSUES**（已知问题与未验证项）
README.md      启动 / 构建 / 口径 / 隐私边界 / 部署与文档索引（面向使用者与审查者）
PRIVACY.md     用户可见隐私说明（与站内「隐私说明」页**同一结论**，由测试钉住）
_demo/         合成演示数据（不参与构建）
```

- `src/domain` 是领域层的**唯一入口**（桶文件 `index.ts`）：数据层与界面只 `import ... from '../domain'`，
  不直接 import 具体文件，以便替换实现（例如模板改用 xlsx）时影响面可控。
- `src/importers` 的桶文件只导出轻量契约与客户端；**会牵入 SheetJS / PapaParse 的模块
  （`pipeline` / `delimited` / `xlsx` / `workerBridge`）不进桶文件**，只能由 Worker 入口或动态 import 使用。
- 解析结果一律是 `domain` 里的 `RawSheet`：只读值、不改枚举、不静默去重、不排除隐藏行 / 列；
  空单元格一律 `null`（缺失 ≠ 0）；读取阶段的问题只记「问题码 + 行号」，禁止带整行内容。
- 字段映射口径只在 `domain/mapping.ts` 实现：四级匹配、冲突判定与两类处置、缺列 → 禁用模块、
  映射模板结构与版本。**组件内不得自己判断「哪列是姓名 / 状态」**，也不得自行合并冲突。
- `src/storage/sessionStore.ts` 是**内存会话**（临时模式）：持有 `RawSheet`、映射草稿、已确认的
  `ImportMapping`、本会话映射模板，以及清洗会话（清洗设置草稿 + 用户确认提交的 `NormalizedDataset`）；
  不落任何明文盘（无 IndexedDB / localStorage / Cache / Cookie，无日志）。改清洗设置会作废已提交数据集，
  换表 / 放弃数据集也会作废结论但保留设置草稿；加密持久化已由步骤6 的加密仓接入
  （`src/storage/vault.ts` 是唯一接触 Dexie / IndexedDB 的业务模块，外加 `storage/vaultFacade.ts`
  的 `encryptedVault` 懒门面）；**组件不得直接调用 IndexedDB，也不得静态 import `vault.ts` /
  `backup.ts` / `db.ts`**；步骤2–5 的会话本身仍只在内存，是否把数据集加密写入仓由后续步骤按需决定。
- 清洗、校验、去重与质量报告口径只在 `src/cleaning` 实现（`index.ts` 是唯一入口的纯函数层，
  桶文件用 `export *`，外部只 `import ... from '../cleaning'`）：`cleanSheet` 是唯一流水线入口，
  未确认映射或缺 offer 状态列一律拒绝清洗；该层**只**产出记录、计数与模块可用性，
  率 / 分位 / 基准等公式一律留给步骤7 的统一指标引擎（§2.3）。
- 领域层是**纯函数**：不依赖 React / 网络 / 存储 / 浏览器 API；缺失值统一 `null`（**绝不**用 0 代替），
  取值口径只在 `domain/valueMappings.ts` 实现，其他层不得重复判断。
- `src/crypto` 是加密原语层（纯函数，只依赖 Web Crypto，不依赖 React / Dexie / 网络）：编码、随机 ID、
  KDF（PBKDF2-HMAC-SHA-256）、AES-GCM 信封、内存密钥槽位。密码与 `CryptoKey` **只在内存**：
  不得缓存密码、打印密钥、把密钥写进任何存储，也不得把 KDF 参数「将就着用」（非法值一律拒绝）。
- `src/features/settings/` 是设置页的本地仓界面（创建 / 解锁 / 管理 / 改密 / 清空与二次确认）：
  入口只有 `pages/SettingsPage.tsx`；闲置倒计时统一读 `readVaultIdleRemainingMs()`，页面**不得**自建
  计时器；错误一律经 `vaultErrorMessage` 收敛成固定文案，不得回显底层异常 message 或堆栈。
  AI 侧（AI-3 / AI-6）另有 `AiSettingsPanel`（开关 / Key / 许可 / 目的地 / 模型参数 / 费用）与四个子面板
  `AiPrivacyLevelPanel` / `AiSubjectRulesPanel` / `AiProxyPanel` / `AiRetentionPanel`；
  三条纪律：**界面不做口径判断**（参数收敛归 `resolveAiParams`、脱敏归 `privacy/`、
  规则指纹归 `subjectRules.ts`、地址校验归 `aiProxy.ts`）；**每个删除动作各自一句短语**
  （清空业务数据 / 删除 AI Key / 清空本地仓 / 清空 AI 历史，四者两两不同、互不代替）；
  **提示语必须与事实一致**（写不进本地仓时不说「已保存」，仓未解锁时不说「本来就没有」）。
- `src/features/dashboard/` 是总览看板（步骤8）：`DashboardWorkspace` 是**唯一数据装配点**
  （`analyzeRecords` / `applyFilters` / `aggregateByMonth` / `decorateRecords` / `cycleTooLongCount`），
  筛选选择状态与转换只在 `dashboardFilters.ts`（纯函数 + 单测），状态文案与配色只在 `dashboardText.ts` /
  `statusPalette.ts`；图表经 `charts/EChart.tsx`（渲染 / 事件）→ `charts/echartsLoader.ts`（动态 import）
  → `charts/echartsRegister.ts`（按需注册）接入，ECharts **不得**进入首屏包；每个图表下方都必须有
  同数数据表（图表可键盘关联到数据表）。下钻只允许改筛选快照，不得在组件里另算数字。
- `src/features/dimensions/` 是分维度分析（步骤9）：`DimensionAnalysisPanel` 是**唯一装配点**
  （各维度的 `aggregateByDimension` / `crossTabulate` / `compensation` / `durations` 结果全部 `useMemo` 冻结），
  「取哪些分组、怎么标记、点了要筛什么」只在 `dimensionViews.ts`（纯函数 + 单测），界面措辞只在
  `analysisText.ts`，业务口径文案与判定由引擎的 `domain/analytics/dimensionNotes.ts` / `compensation.ts` /
  `crossTab.ts` 提供。三条硬规则：**合并行**（`其他（N 个分组合并）`）既不下钻也不进散点（但仍留在数据表里）；
  分母 0 的分组不进散点且率一律显示 `—`（**绝不显示 0%**）；样本门槛统一取 `sampleSufficiencyOf`，
  组件不得自己比 10。每个 section 的下钻维度必须由该表自己声明（学校表 `'school'`、
  GPT 表 `'isGptSchool'`、房补表 `'housingType'`），不得复用别的表的维度参数。
  分维度分析随看板同页渲染并复用同一份筛选快照（口径见 `docs/DECISIONS.md` D-041 / D-042 / D-043 / D-044），
  不得自建筛选状态或另读会话。被质量层禁用的模块**不得照旧出金额**：金额类分位（薪资分布与
  现金房补）统一由看板传入的 `comparable` 闸住，只有房补的**类型分布与各率**不受影响。

分层调用方向：导入适配器 → 原始数据 → 映射 / 清洗 / 质量报告 → 确认后的领域记录 →
统一筛选 / 聚合 / 统计 → 图表与本地结论 → 脱敏报告 → 本地文件。
持久化通过加密仓接口单独接入，**组件不得直接调用 IndexedDB**。

- `src/insights/` 是**本地确定性结论层**（步骤10 建立）：`domain/analytics` 只出计数与率，
  本目录把指标按业务规则组合成「可解释的运营关注标签 + 规则化行动建议」，
  入口是 `insights/rejection.ts` 的 `buildRejectionInsight`。三条铁律：**全部确定性**
  （同一数据 + 同一配置得到同一段文案，不调用 AI、不生成概率）；**可回溯**（每条结论带规则 ID、
  规则版本、命中条件、未知条件、比较基准与适用范围）；**不越界**（不输出个人拒 offer 概率、
  不说「高薪一定提升入职」、不把学校 / 学历标签转成录用或淘汰建议）。
  阈值是**运营配置**而不是行业标准，必须由调用方传入并随报告记录；组件不得自定阈值。
- 拒 offer 专项的三条口径（步骤10，详见 `docs/DECISIONS.md` D-045～D-047）：
  **原因只查表不推断**（精确字典命中，落不到就是「未分类」，与「未填写」分开计数；
  禁止在组件里用 `includes` / 正则猜原因）；**未知条件 ≠ 不满足**（`boolean | null` 三值，
  未知的记录不进命中数，并在「未知条件」里如实列出；拒 offer 记录的等待时长恒为未知）；
  **结论分级**（D < 10 或 R < 3 → 样本不足；率差 < 10 个百分点 → 仅供描述；
  三条同时满足才可写「观察到…关联」）。核心率分母 D 含待入职，
  但**组间比较人群 = 拒 offer 组 + 入职组**，待入职与审批中一律不进比较——两个人群必须同时说清。

AI 支路：聚合引擎 → AnalysisSummary → AI 脱敏引擎 → SanitizedAiPayload → 完整预览 / 一次性确认 →
固定 network adapter → DeepSeek → 响应校验 / Markdown 净化 → 本地展示 / 加密历史 / 脱敏导出。
**只有 network adapter 能发 AI 请求，且它不能接收原始记录类型。**

- `src/ai/` 是 **AI 摘要与配置层**（AI-2 / AI-3 建立，纯函数，不依赖 React / DOM / 网络 / 存储）：
  - `summary.ts` 的 `buildAnalysisSummary` 是 `AnalysisSummary`（冻结快照）的**唯一构造点**。
    四条硬规则：**只用 `PREDEFINED_TABLES` 预定义表**（输出类型里没有能装下原始行的字段）；
    **不写任何公式**（`counts` / `groupComposition` / `cycles` 全部取引擎的 `GroupSummary`）；
    **禁用模块整维不发**（`DIMENSION_MODULE` 是 `Record<GroupDimension, AnalysisModule | null>`，
    新增维度忘了登记模块会**编译失败**）；**128 KiB 预算在构造阶段检查**，超限按登记顺序**整表丢弃**
    并逐条记进 `adjustments`，不静默截断、不降低 k（口径见 D-062 / D-065）。
    `dimensions[].summaries` 按 `GroupSummary` 契约带着 `records`，是**本机专用**字段，
    **不得**写进载荷 / 历史 / 日志——外发边界只由 `privacy/aiSummary.ts` 的白名单重建负责。
  - `catalog.ts` 是**模型目录与能力表**（AI-3）：人工核实后写死的常量，带核查日期与官方来源链接。
    **不做探活、不查模型列表、不查余额**（那会破坏「只有确认后才发请求」的承诺）。
    旧模型**照原样保留**并标兼容风险与建议改用的 ID——**不静默替换**（换模型会改计费与结果）。
    目录里没有的 ID 按**最保守**能力处理，不假装认识它（口径见 D-069）。
  - `aiConfig.ts` 的 `resolveAiParams` 是「**实际会发送哪些参数**」的唯一判定点：
    **不支持的参数在参数对象里根本不存在**（而不是填一个会被服务端忽略的值——
    官方明确「传了不报错也不生效」，那比报错更容易骗到用户）；范围收敛与每一次本地调整
    都通过 `notices` 显示给用户（口径见 D-066）。
  - `keySession.ts` 持有内存 Key 的**唯一一份**；对外快照类型里**没有 `value` 字段**，
    掩码是界面唯一的显示入口；锁仓清内存但**不动**加密仓里的那一份（口径见 D-067）。
  - `aiSettings.ts` 经加密仓持久化**非敏感偏好**（开关 / 保存方式 / 参数 / 默认脱敏级别 /
    custom 维度 / 岗位类别映射 / 本地规则确认指纹 / 代理登记），
    它的接口里**没有接受 Key 的参数**，因此「顺手把 Key 存进偏好」在类型层写不出来。
    `aiDestinationOf(settings)` 是「当前请求目的地」的**唯一判定点**
    （没登记代理、或登记了却没确认时间 → 官方端点；只存地址不存确认一律按未登记处理）。
  - `subjectRules.ts`（AI-6）是**本地规则的视图与二次确认**（纯函数）：岗位类别 / 学校层次 /
    拒 offer 原因主题三套规则，每套都给出「会发出什么」与「永远不会发出什么」；
    确认绑定的是一份**指纹**（覆盖配置摘要、映射、名单模式与完整性、别名条数、原因字典类别），
    判据只有「保存的指纹 == 当前规则算出的指纹」。**不得**用布尔量代替——
    布尔量无法表达「同意的是哪一份规则」（与预览 hash 同一套理由，见 D-077）。
    岗位类别映射的**取值口径**在脱敏层（`privacy/aiSummary.ts` 的 `positionCategoryOf`），
    本模块只负责呈现与指纹，不另写一套匹配规则。
  - `aiProxy.ts`（AI-6）是自有 / 本地代理的**显式配置边界**（纯函数）：地址严格校验并**规范化**
    origin（只接受 `https:`，唯一例外是回环地址的 `http:`；拒绝凭据 / 路径 / 查询串 / 片段；
    路径固定 `/chat/completions`）。**本仓库不提供任何代理程序**，也不由网站运营方托管；
    登记必须逐条确认「代理可见 Key 与摘要」；改地址时**先撤销旧许可再保存**
    （`keySession.revokeAiKeyPermissionIfOriginChanged`，只清许可、不动 Key，见 D-078）。
    这一层**不放宽任何 CSP**：自定义地址要真正可用，需要用户自己构建并调整 `connect-src`
    （本地版 / 含 AI 版两套策略在步骤13 落实）。
  - `client.ts` 是**唯一 network adapter**（AI-4）：全仓只有这一个文件可以发起网络请求，
    `features/ai/**` 一个都不许有（守卫测试逐行扫描并检查「只有这一个」）。它只接受
    `AiSendRequest`（已脱敏的正文文本 + 预览 hash + 端点），类型里**没有任何位置**能装下
    `NormalizedRecord[]` / `RawRow` / `SanitizedReport`。四条浏览器侧约束固定：
    `credentials: 'omit'`、`referrerPolicy: 'no-referrer'`、`redirect: 'error'`、`cache: 'no-store'`；
    响应在流式读取时计数（>1 MiB 拒绝），且**不读 `reasoning_content`**。
    `aiRequest.ts` 的 `buildAiRequestBody` 把正文**逐字段从预览投影**（正文必须逐字节等于预览）。
  - `aiResult.ts` 定义结果与**16 种**错误分类（`auth` / `balance` / `rate-limit` / `network` /
    `timeout` / `cancelled` / …）与 `finish_reason` 的完整性判定；分类**以官方 `error.code` 优先、
    HTTP 状态兜底**，且必须**透传**、不能被外层 catch 压平（口径见 D-072）。
    `TypeError` **只报「可能」**，绝不硬判 CORS。
  - `aiClient.ts` 是界面的发送入口：**同一时刻只允许一次在途请求**（第二次直接拒绝，**不排队**）、
    支持取消与超时、并用**世代号**作废迟到响应（锁仓 / 清空 / 会话过期即中止并 +1，口径见 D-073）。
    **没有重试路径**：不自动重试、不换端点、不换模型，界面也不提供重试按钮。
  - `aiMarkdown.ts` 是**安全 Markdown 解析器**（AI-5，纯函数）：产出**只含白名单节点**的树
    （块级 heading / paragraph / bulletList / orderedList / codeBlock / blockquote / divider，
    行内 text / strong / em / code）。**没有** html / image / iframe / link 节点类型——
    因此「渲染出脚本」「图片发请求」在类型层就不成立。链接降级为 `文字（地址）` 纯文本、
    图片降级为 `[图片：alt]` **且不保留地址**、原始 HTML 按纯文本显示；三者都记进 `downgrades`
    并由界面**如实告知**（静默改写模型输出是不允许的）。渲染只由 `features/ai/AiMarkdownView.tsx`
    负责（树 → React 元素），因此**不存在「忘记转义」这条失败路径**（口径见 D-076）。
  - `aiResponseCheck.ts`（AI-5）对**模型回复文本**再查一遍敏感内容，
    与 `aiExport.ts` 的导出闸门共用同一结论；**只报字段名、绝不回显命中值**。
    注意 `privacy/sanitize.ts` 的 `scanSensitiveFields` 是给**对象**用的（只查键名），
    自由文本必须另外走 `forbiddenNamesIn` / `containsForbiddenField`（口径见 D-074）。
  - `aiHistory.ts`（AI-5）是历史的唯一读写点：**只有用户显式保存才写盘**，
    走 `encryptedVault.appendObject('aiHistory', …)`（**追加**，不是覆盖）。
    `AiHistoryPayload` **刻意不含 `id`**：身份就是仓里那一行的主键（口径见 D-075）。
    结构校验遇到未知键**整条拒绝**；清空历史只删 `aiHistory`，**不动**招聘数据与 Key。
  - `aiExport.ts`（AI-5）是 AI 结果的导出：Markdown 与打印版都先过**唯一闸门**
    （解析 → 净化 → 敏感检查），命中即**阻断**；不复用 `exportMarkdown`，
    因为那个消费 `SanitizedReport`（每行都由指标引擎算出），而 AI 结果不是统计结果。
  - 本层**刻意不反向依赖 `features/`**（方向倒置会让界面删一个文件就把引擎编译坏），
    因此周期分桶与缺失薪资各有一份同口径的小实现。
- `src/features/ai/` 是 AI 预览界面与摘要到载荷的**适配层**（AI-1 建立，AI-2 改接摘要）：
  `AiAnalysisWorkspace` 是工作区入口，`aiSourceCells.ts` 只做「取值 → 候选格」的换算
  （**不重算指标、不决定能不能发**：白名单 / 隐私级别 / k 抑制 / TopN / 预算全归引擎），
  `summaryAdapter.ts` 把 `AnalysisSummary` 接到候选格上。三条硬规则：HR **只出代号**
  （`buildRecruiterOrdinals` 先定映射、两次遍历共用——各自编号会让组内构成**静默消失**，见 D-064）；
  学校只出层次、薪资只出区间（换不出来就整格不发）；`AiPreviewPanel` 逐字展示将要发送的内容。

- `src/privacy/` 是**脱敏层**（步骤11 建立，AI-1 扩展，纯函数，不依赖 React / DOM / 网络 / 存储）：
  `sanitize.ts` 出规则与判定（`salaryBandOf`、`applyComplementarySuppression`、
  `findSensitiveFields` / `scanSensitiveFields`、`FORBIDDEN_FIELD_NAMES`），
  `report.ts` 的 `buildSanitizedReport` 是**唯一**构造点，`aiSummary.ts` 的
  `buildSanitizedAiPayload` 是 AI 载荷的**唯一**构造点（`aiPayload.ts` 只剩历史 v1 结构）。
  铁律：任何导出格式只能消费 `SanitizedReport`，不得绕过它去读原始记录或中间聚合结果；
  HR 只出代号（同一文件内稳定、跨报告重建、对照表不导出）、金额只出区间、
  小组合并与互补抑制必须先做（口径见 `docs/DECISIONS.md` D-048～D-050）。
- AI 载荷四条硬规则（AI-1，详见 `docs/DECISIONS.md` D-057～D-061）：
  **白名单重建**（不是「复制后删字段」；新增字段默认进不去，`checkSanitizedAiPayload`
  对未知键直接判失败）；`schemaVersion` 必须是**字面量类型**，否则 `SanitizedReport`
  会结构上可赋值给载荷、让「把报告当载荷发」在类型层通过；
  **来源维度名必须经 `canonicalDimensionOf` 归一化**（`school`→`schoolLevel`、
  `position`→`positionCategory`），否则这三个维度会**静默消失**（看起来像更安全，实则功能坏了）；
  **取值形状也要过闸门**（`looksLikeIdentifier`：含 `-`/`_` 或长度 ≥ 12 的 ASCII 起首取值整格不发）。
- AI 预览与确认（AI-1）：`privacy/aiPreview.ts` 的 `buildAiPreview` 产出完整预览与稳定 hash；
  hash 覆盖 schema 版本 + 提示词版本 + 载荷全文 + messages 全文 + 模型参数 + 端点，**不含**
  `generatedAt`；确认令牌**只能消费一次**且绑定 hash，因此「改了参数 → 旧确认失效」是结构成立的，
  **不得**用 `useState<boolean>` 之类的布尔量代替。预览的 `payloadJson` 序列化一次后
  **预览展示与发送共用**；提示词与界面文案一样**不许出现 Markdown 强调标记**（会逐字渲染）。
  **只有 AI-4 的网络适配器能发请求，且它不能接收原始记录类型**；在 AI-4 交付前本网站无出站路径。
- `src/exporters/` 是**导出层**（步骤11 建立）：`sections.ts` 的 `reportToSections` 是三种文本格式
  **共同**的取值层——XLSX / Markdown / 打印 HTML **不得**各自遍历报告对象，否则同一数字会在三种
  文件里不一致。四种格式都必须本地生成：`xlsx` 与 `echarts` 只在 `await import()` 的另一侧
  （`exporters/index.ts` 刻意不导出 `png.ts`）；XLSX 强制安全单元格类型（`= + - @ \t \r` 中和）、
  绝不写 `f` 字段、不得有隐藏 sheet；文件名 / 页眉页脚 / 图注不得含敏感字段。
  导出前必须跑一次字段名闸门（`findSensitiveFields`），命中即阻断且**只列字段名与位置、不回显值**。

## 5. 工作方式（每一步都按此流程）

1. 先读 `AGENTS.md` 和 `docs/PRD.md`（相关章节），再读本步在 `docs/IMPLEMENTATION_PLAN.md` 中的条目。
2. 检查现有目录，**保留已有内容**，增量修改，不覆盖用户工作。
3. 只做当前这一步的范围，不提前实现后续步骤。
4. 实际运行验证（类型检查 / 测试 / 构建 / 手动启动），如实报告「已运行 / 未运行 / 被阻塞」。
5. 结束汇报：改了哪些文件、跑了什么验证、遗留什么未验证、下一步是什么。
6. 不伪造测试结果；未执行的浏览器或平台明确写「未验证」。

## 6. 明确禁止清单

- ❌ 新增网站后端、登录、数据库、云函数、API 路由、上传接口、公共 CORS 代理。
- ❌ 引入 CDN 脚本 / 在线字体 / 在线图片 / 地图 / 分析 SDK / 错误上报。
- ❌ 为「方便」把原始数据发到任何第三方（包括把姓名换成代号后的逐行数据）。
- ❌ 在 `VITE_*` 变量、源码、URL、请求正文、控制台、日志、普通备份、AI 历史、Service Worker 缓存中存放 API Key。
- ❌ 提交真实招聘附件、真实姓名 / 薪资 / HR 信息、真实密码、真实截图、真实 Key 到仓库或 CI。
- ❌ 用 `dangerouslySetInnerHTML` 渲染用户或模型输入；执行表格公式或激活原始单元格链接。
- ❌ 明文持久化敏感数据；用保存密码哈希代替数据加密。
- ❌ 在组件里重复实现指标公式；把缺失当 0；把「抑制」当 0 发送或展示。
- ❌ 自动去重、自动拆「替补/替换」、自动把 `-` 渠道判为内推、把「已送审批」当待入职。
- ❌ 把字段自动识别结果当**结论**：模糊 / 别名建议未确认就提交、多个源列指向同一目标时静默取一个、
  缺 offer 状态列还继续导入、未确认「部分分析导入」就按全量分析出结论。
- ❌ 把解析结果、映射草稿或映射模板**明文**写入浏览器存储（localStorage / sessionStorage / IndexedDB / Cache）
  或导出为文件：临时模式只允许存在于内存；确实要持久化时只能经加密仓（AES-GCM 信封）写入，不得绕过它。
- ❌ 组件 / 页面静态 import `storage/vault.ts` / `storage/backup.ts` / `storage/db.ts`（会把 Dexie 拉进首屏包，
  等于让「重实现只出现在懒边另一侧」失效）；一律经 `encryptedVault` 门面。
- ❌ 输出个人拒 offer 概率、「高薪一定提升入职」等未经校准的因果或预测结论。
- ❌ 未确认就发送 AI 请求；自动重试 / 续写 / 切换模型或端点 / 后台排队。
- ❌ 把「本机规则已确认」写成布尔量或「记住本次同意」（确认必须绑定到一份**指纹**，
  规则一改即失效）；把 AI 开关当成永久授权。
- ❌ 提供代理程序、托管代理、使用公共 CORS 代理，或为自定义地址**放宽任意域 CSP**
  （自有代理只是可选的显式配置边界：改地址先撤销旧许可、旧 Key 不转发、不探活）。
- ❌ 在界面文案里写会**逐字渲染**的 Markdown 强调标记（`**` / `__`）——
  由 `features/privacy/uiTextGuard.test.ts` 全仓扫描守卫；注释与 Markdown 导出器的输出不受此限。
- ❌ 把「路由还没交付」当成可以写进界面的文案例外：文案必须与实现同步改，
  否则用户会为一件已经能发生的事以为不会发生（AI-6 修掉的三处正是这样来的）。

## 7. 术语与口径速查（详见 PRD 第 6 章）

| 符号 | 含义 |
|---|---|
| N | 所有保留记录数（含审批中），卡片命名「总 offer 记录数（含审批中）」 |
| J / P / A | 已入职 / 待入职 / offer 审批中 |
| R1 / R2 / R | 拒绝 offer / 拒绝口头 offer / R1+R2 |
| U | 其他 / 未知 |
| D | 核心分母 = J + P + R（**排除审批中、其他、未知**） |
| 拒 offer 率 | R / D |
| 入职率 | J / D（**不得**用 J/N 冒充） |
| 审批中占比 | A / N（分母与核心率不同，必须明示） |
| 名单覆盖需求数 | countDistinct(非空需求 ID)：HR 内去重，跨 HR 相加可能超过全局 |
| 招聘周期 | 入职日期 − 启动日期，日历日，非工作日；只对合法且非负日期计算 |

恒等式：`N = J + P + A + R1 + R2 + U`。汇总率必须**合计分子分母后再相除**，不能平均各分组百分比。

## 8. 文档维护

- 业务口径变化 → 更新 `docs/PRD.md` 并在 `docs/DECISIONS.md` 追加决策。
- 计划或步骤拆分变化 → 更新 `docs/IMPLEMENTATION_PLAN.md`。
- 本文件只写「长期有效的约束」，不写临时进度；进度写入实施计划。
- **对外文档契约**（AI-7 起，由 `src/features/privacy/acceptance.test.ts` 机器检查）：
  - `docs/ACCEPTANCE.md` 必须给 A01–A20 与 AI01–AI18 **每一项**一行判定，
    判定词只有「已通过 / 部分通过 / 未验证」，并附证据；**未执行的一律写「未验证」**；
  - 实跑命令与结果（`npm run build` / `typecheck` / `lint` / `test`、产物体积、`dist/` 静态核查）
    必须记录在该文件里；
  - `README.md` 必须写清启动 / 构建 / 口径 / 隐私边界 / 两套 CSP / 部署 / 文档索引，
    且四个删除短语与 `features/settings/vaultText.ts` 的常量为同一份；
  - `PRIVACY.md` 与站内隐私页必须同时出现同一组关键结论（不承诺所有模式绝不出站、
    不声称供应商零保留、无法保证对方是否保留等）；
  - `docs/KNOWN_ISSUES.md` 必须分级（P0/P1/P2）并列出「只能在真实环境确认」的检查项；
  - 仓库与 `dist/` 里**不得**出现真实 Key（`sk-` 形状的长串只允许测试合成值白名单里的那几个）
    或第三方统计 / CDN 主机名。
- 当前进度：**步骤1 至步骤12、AI-1 至 AI-7、步骤13、步骤14 已交付**（各步证据见
  `docs/IMPLEMENTATION_PLAN.md` 的「步骤N 交付状态」与「AI-N 交付状态」）。
  步骤14 补上了两层测试：**jsdom + Testing Library 的真实 DOM 交互用例 18 例**（映射阻断与确认、
  筛选读数等于引擎读数、AI 一次性令牌与载荷一致性）与 **Playwright 驱动系统 Chrome 的端到端用例 11 例**，
  合计 `npm test` **1372 例通过 / 96 个文件** + `npm run test:e2e` **9 例通过** +
  `npm run test:e2e:ai` **2 例通过**。真实浏览器里**已经实测**的事：整条本地链路（N=50 且恒等式成立）、
  默认零出站与 CSP 真的拦下页面内请求、临时模式四类存储全空、建仓并解锁时仓内无明文哨兵、
  SW 真的装上并能断网打开、AI 开关 / 存 Key / 导入 / 清洗 / 生成预览全程零请求且两次点击确认后
  恰好一次调用、Key 只出现在 `Authorization` 头、AI 结果面板内无 `script` / `a` / `img` 节点、
  以及首屏与整条链路的性能数字（见 `docs/ACCEPTANCE.md` §0）。
  **仍未验证**：真实托管平台上响应头是否生效、**真实 Key 的直连（AI16 CORS，本轮请求由 `page.route`
  本地合成）**、Edge / Firefox / WebKit 与移动端、图表真实渲染与下钻 / 键盘可达、跨标签页失效、
  PNG 真实像素 / PDF 中文与分页 / XLSX 在 Excel 中打开、PWA 的「添加到主屏幕」与两个版本之间的
  更新切换、DevTools 逐个值的人工复核、几万行真实数据量下的性能 —— 这些均已如实标注为「未验证」，
  逐条判定与人工验收清单见 `docs/ACCEPTANCE.md`（§4 / §5）与 `docs/KNOWN_ISSUES.md`。
  **AI16「真实部署来源的直连」完全未验证**：没有用真实 Key、也没有在真实部署来源与目标浏览器上
  验证过 CORS——`curl` 或 Node 请求成功**不等于**浏览器 CORS 通过（PRD 18.5 原文）。
  下一步是**发布前的人工复核与用户决定是否发布**（清单见 `docs/ACCEPTANCE.md` §4）。
- **用户验收期的追加交付（2026-09-27）**：v1.1.0 归档冻结之后，用户先提出 4 项改造
  （④ 下钻后返回全部数据、② 渠道补内推开关、① 清洗异常行清单与逐格人工修正、③ 图表补齐 + PDF 带图），
  以 **v1.2.0** 交付，并按人工验收发现的**导出闸门死锁**与**哨兵误拦**修正为 **v1.2.1**；
  随后按用户看图的三条反馈做成 **v1.3.0**（薪资按取值分箱、柱状图按数值降序、
  长名字的图改横向并截断超长标签）。口径见 `docs/DECISIONS.md` D-091…D-094，
  交付说明见 `docs/RELEASE_v1.2.md` 与 `docs/RELEASE_v1.3.md`。
  当前实测：`npm test` **1419 例 / 102 文件**、`npm run test:e2e` **10 例**、`npm run test:e2e:ai` **2 例**、
  `typecheck` / `lint` 全 0；首屏 `index-*.js` **785.22 kB**（gzip 238.55 kB）。
  仍未验证的项与 v1.1 相同，其中「导出图（PNG / PDF）与界面图的排序 / 方向不一致」是 v1.3.0
  新记录的限制（`docs/KNOWN_ISSUES.md` §2.9）。
- **用户第二轮反馈与真实调用（2026-09-27 晚）**：随后又交付 **v1.3.1**（薪资计薪口径默认
  「人民币元/月」、每个模块标题栏都有「返回全部数据」、**修掉打印窗口空白页**
  `window.open(..., 'noopener')` 返回 null 的真 bug）与 **v1.3.2**（用户在真实调用中暴露的两处
  AI 提示问题：`HTTP 401 + code=invalid_request_error` 被误诊成「参数问题」、
  以及「HTTP 成功但正文为空」只说「检查模型与参数」——真正原因是所选模型思考模式默认开启、
  推理与正文共用 `max_tokens`）。口径见 `docs/DECISIONS.md` D-095…D-099。
  当前实测：`npm test` **1433 例 / 104 文件**、`npm run test:e2e` **10 例**、`npm run test:e2e:ai` **2 例**、
  `typecheck` / `lint` 全 0（337 文件）；首屏 `index-*.js` **786.11 kB**。
  **AI 链路的新证据**：用户那次真实调用收到 **HTTP 401**（带 `request_id`）与 **HTTP 200**，
  说明浏览器直连**没有被 CORS 拦下**；但**成功产出报告**仍未跑通，AI16 仍记「未验证」。
- **反复出现的教训（三条同类）**：导出闸门死锁与哨兵误拦（§1.0.4）、打印窗口空白页（§1.0.5）、
  AI 报错误诊与空正文干提示（§1.0.6 / §1.0.7）——**全都是自动化没覆盖到的那一半**，
  而且都是**用户先用出来**的。凡是「新增一条用户可见路径」，必须同时补真实浏览器用例或仓库扫描。

## 9. 规则版本与配置摘要（步骤12 起）

- 规则版本 = **语义基线**（`RULES_VERSION`，规则实现变了才动）+ **配置摘要**
  （`configRevision`，由影响清洗结果的设置压成），形如 `1.0.0+3F2A19C4`。
- **改名单 / 别名 / 去重策略必须换版本**：`domain/configVersion.ts` 的 `CONFIG_REVISION_FIELDS`
  是唯一清单，新增影响结果的设置项必须显式加入并补测试，不得靠默认。
- 摘要先**规范化**（名单去空白去重排序、别名排序），因此同一集合的录入顺序差异不产生新版本。
- **旧报告不变**：旧数据集与旧报告保存的是它们当时那份摘要。数据集同时保存**完整设置快照**
  （`metadata.cleaningSettings`），变更影响预览必须从这里取基准，
  **不得**由某个组件的 `useState` 记住一份（离开页面即丢）。

