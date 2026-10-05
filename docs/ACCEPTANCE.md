# 验收记录（A01–A20 与 AI01–AI18）

> 判定只用三种写法：**已通过** / **部分通过** / **未验证**。
> **已通过** = 该条要求的每一半都有实测证据（含真实浏览器时按浏览器实测算）。
> **部分通过** = 纯函数 / 渲染冒烟 / 构建产物层面有实测证据，但还有明确没做的那一半（写在证据里）。
> **未验证** = 一次都没执行过。
> 任何一条都不允许把「建议测试」写成本条通过；未执行的一律写「未验证」。

## 0. 本次验证环境与实跑结果

| 项 | 值 |
|---|---|
| 平台 | Windows，Node.js **v24.19.0**，npm 11.17.0；本机**未安装 Git** |
| 浏览器实测 | **系统 Chrome（Playwright `channel: 'chrome'`，不下载浏览器二进制）** + jsdom；Playwright 版本 1.63.0 |
| 生产构建（本地版） | `npm run build` 退出码 **0**；首屏 `index-Dgxlr9pT.js` **786.11 kB**（v1.3.0 图表改动是主要增量，v1.3.1 的改动只加了不到 1 kB） |
| 生产构建（含 AI 版） | `npm run build:ai` 退出码 **0**；meta 与 `_headers` 都是精确 `connect-src https://api.deepseek.com` |
| 生产构建（子路径） | `npm run build:subpath` 退出码 **0**；产物前缀与 manifest 链接都带 `/intern-recruitment/` |
| 类型检查 | `npm run typecheck`（`tsc -b`，含 `tsconfig.e2e.json`）退出码 **0**，无诊断 |
| Lint | `npm run lint`（oxlint）**0 warning 0 error**（341 文件、116 规则，无豁免） |
| 单元 / 集成测试 | `npm test`（vitest run）**1443 例通过 / 106 个文件**，退出码 **0**（步骤14 的 1372 例 + 用户需求 ④②①③ 的 26 例 + v1.2.1 导出闸门 10 例 + v1.3.0 看图反馈 11 例 + v1.3.1 打印守卫与口径 6 例 + v1.3.2 AI 报错分类与空正文诊断 7 例 + v1.3.3 会话态 / 内联设置 / 数据集作废 5 例 + v1.3.4 AI 可用性判定 5 例 + 端到端新断言） |
| 端到端测试（本地版） | `npm run test:e2e`（构建本地版后 `playwright test --grep-invert @ai-build`）**10 例通过**（另有 **1 例截图脚本默认跳过**：`portfolio-shots.spec.ts` 只在 `PORTFOLIO_SHOTS=1` 时运行，用于生成 README 与作品集截图） |
| 端到端测试（含 AI 版） | `npm run test:e2e:ai`（构建含 AI 版后 `playwright test --grep @ai-build`）**2 例通过**（9.7 s） |
| 端到端测试的模式守卫 | 在本地版产物上跑 `@ai-build` 用例时**2 例 skipped**（不是通过）：本地版不可能发得出去，用它验证 AI 链路等于什么都没验证 |
| 性能基线（实测数字） | 首屏 `load` **133 ms**、首屏脚本 4 个文件共 **832,572 B**（浏览器报的压缩后主 chunk 229,862 B）、首屏资源请求 **7** 个且**全部同源**；「粘贴 50 行 → 映射 → 清洗提交 → 看板出 N=50」整条链路 **1232 ms**，期间最长长任务 **60 ms** |
| 版本管理 | 本机**未安装 Git**，因此没有提交历史可引用（`.gitignore` 已就位，本轮补上 `test-results` / `playwright-report`） |

### 步骤14 实跑修复的两处问题（都不是「测试写错」）

1. **meta CSP 里的 `frame-ancestors` 会被浏览器忽略并报错**。Playwright 在真实 Chrome 里抓到
   控制台错误 `The Content Security Policy directive 'frame-ancestors' is ignored when delivered
   via a <meta> element.`。这不是取舍而是浏览器规定，且留着它只有坏处（常驻一条红色报错、
   并给人「meta 也防住了点击劫持」的错觉）。因此 `src/lib/csp.ts` 新增 `buildMetaCsp`：
   与响应头版**逐字相同、只去掉 `frame-ancestors`**，由测试钉住「加回那一条必须还原成完整策略」；
   `_headers`（响应头形式）仍带 `frame-ancestors 'none'`，另有 `X-Frame-Options: DENY`。
   这也正是 PRD 18.6「meta CSP 不等价于响应头策略」的原话落地。
2. **仓库守卫会把 Playwright 的运行残留当仓库内容扫**。`acceptance.test.ts` 的仓库扫描跳过
   `node_modules` / `dist` / `_checks`，但没跳过 `test-results`——失败用例的 error context 里
   会抄一份整页文本与合成 Key，扫它等于「一次失败的运行把守卫弄红」。已把 `test-results` /
   `playwright-report` 加入跳过名单，并写进 `.gitignore`。

### 用户需求 ④②①③ 的实跑结果（2026-09-27，v1.2.0）

用户在 v1.1 人工验收期间提出 4 项改造，全部按确认口径实现并冻结为 **v1.2.0**
（交付说明见 `docs/RELEASE_v1.2.md`；口径理由见 `docs/DECISIONS.md` D-091 / D-092）。

| 需求 | 判定 | 证据（新增用例） |
|---|---|---|
| ④ 下钻后返回全部数据 | **已通过** | 三处下钻旁各一个「返回全部数据」，调用与筛选条「清空筛选」同一个纯函数；`ReturnToAll.interaction.test.tsx`(3) + 端到端断言「点后 N 回到 50」 |
| ② 渠道补内推（默认关闭、只补缺失、不覆盖已有值） | **已通过** | `channelInference.test.ts`(9)；`configVersion.test.ts` 新增 1 例断言它参与配置摘要；PRD 5.2 与 D-092 已同步 |
| ① 异常行清单与人工修正（原因必填、五栏可回溯、可撤销） | **已通过** | `manualCorrection.test.ts`(7) + `IssueWorklist.interaction.test.tsx`(2) + 端到端 1 例；修正作为清洗输入、问题码随重算更新、换表（表签名不符）一条都不应用 |
| ③ 图表补齐 + 导出带图 | **部分通过** | 六处图表 + 拒 offer 专项两张：`DimensionAnalysisPanel.test.tsx`(+1)、`RejectionWorkspace.test.tsx`(+1)、端到端断言看板画布 ≥ 6、拒 offer ≥ 2；导出侧 `print.test.ts`(+3) 覆盖内嵌本机 PNG 与非法 dataUrl 丢弃。**打印窗口里内嵌图在真实 PDF 里的表现、图表键盘可达性与读屏仍未验证** |

四个需求**共新增 26 例**（9+7+3+2+1+1+3），加上端到端新增 1 例与原有链路上的追加断言；
`npm test` 由 1372 例（96 文件）增至 **1409 例（102 文件）**，`npm run test:e2e` 由 9 例增至 **10 例**。
其中 10 例是 v1.2.1 为**报告导出闸门的两个 bug** 补的（3 例导出闸门交互 + 7 例哨兵收集）——
那两个 bug 完全落在自动化此前没覆盖到的那一半，是用户在人工验收时发现的，详见 `docs/KNOWN_ISSUES.md` §1.0.4。
`docs/ACCEPTANCE.md` 的 `§1 / §2` 逐项判定（A01–A20 与 AI01–AI18）在本版**未逐条重判**：
本版改的是清洗输入（修正 / 渠道推断）与图表展示，未改任何指标口径公式；
A02 / A05 / A06 / A12 / A15 的相关面已由上面这四条的新用例覆盖，但它们的原判定依据仍然成立，
因此保留原判定，新增证据记在本表与 `docs/IMPLEMENTATION_PLAN.md` 的「步骤15 / 15a–15c」与「步骤16」。

### 用户看图反馈 ①②③ 的实跑结果（2026-09-27，v1.3.0）

用户拿到 v1.2.1 后在真实名单（薪资只有 3500/4000/4500/5000/5500 五个值）上看了图，提出三条。
第 ③ 条他猜是「字号问题」，实测**不是**——是竖排时长的分组名被容器挤掉，如实说明并改了做法。

| 反馈 | 判定 | 证据与口径 |
|---|---|---|
| ① 薪资直方图出现大片空格子 | **已通过** | 分箱改为「不同取值 ≤ 12 → 每个实际取值一柱；> 12 → 等宽 8 档」，两种情况的图注都写明用的是哪一种（`compensation.test.ts` 两条分支 +2 例）；分箱只影响图形，P25/P50/P75 与均值不动 |
| ② 柱子应从高到低、从左到右 | **已通过** | `sortGroupsForChart` 默认按该图声明的指标降序，且**率线跟着柱子一起重排**（`dimensionViews.test.ts` +7 例）；下钻改用 `dataIndex` 回查原始分组键，修掉「排序后点 A 筛成 B」 |
| ③ 横轴文字显示不全 | **已通过（改法不同于用户猜测）** | 长名字的图（时间效率、学校）改成横向条形；确需竖排时截断为「前 8 字符 + …」，完整名字留在数据表。**未采用缩小字号**：小屏上只会更难读 |
| 导出侧（PNG / 打印 PDF）的图是否也这样排 | **未验证（已记录）** | 导出图走另一条离屏重绘路径（只消费 `SanitizedReport`），按报告分组顺序、只画 N 与 D 两条计数序列、始终竖排；**与屏幕上的图排列不同**，理由与成本见 D-094 与 `docs/KNOWN_ISSUES.md` §2.9 |

v1.3.0 共新增 **11 例**（`compensation.test.ts` +2、`dimensionViews.test.ts` +7、
`DimensionAnalysisPanel.test.tsx` +1、`RejectionWorkspace.test.tsx` +1），
`npm test` 由 1409 例增至 **1419 例（102 文件）**；`lint` 0 警告 0 错误（333 文件）、`typecheck` 退出码 0。
本轮**只动图表展示与分箱**，未改任何指标公式、脱敏口径与网络边界。

### 用户第二轮反馈 ①②③ 的实跑结果（2026-09-27 晚，v1.3.1）

用户在 v1.3.0 上又提了三条，其中第 ③ 条是一个**真 bug**（打印窗口空白页）。三条全部改完并验完。

| 反馈 | 判定 | 证据与口径 |
|---|---|---|
| ① 薪资计薪口径默认「人民币元/月」 | **已通过** | `settings.test.ts` 断言默认值为 `人民币元/月`（CNY / 元/月 / comparable，且 `confirmedAt === null`）；`normalize.test.ts` 断言默认下币种与周期被标注、不再产生 `SALARY_UNIT_UNCONFIRMED`，且显式选「暂不确定」时该问题码与模块禁用照旧；口径见 PRD 5.3 与 D-095（**不做任何换算**） |
| ② 每个模块都要有「返回全部数据」 | **已通过** | `DimensionAnalysisPanel.test.tsx` 断言 8 个模块各一个（无作用域时 0 个）；`RejectionWorkspace.test.tsx` 断言拒 offer 专项 4 个；端到端在真实 Chrome 里断言看板共 **11** 个，并真的点**最后一个**（时间效率模块）验证 N 回到全量；口径见 D-097 |
| ③ 导出 PDF 是空白页、没有下载 | **已通过（真 bug，已修）** | 端到端新增断言：点「打印 / 另存为 PDF」后新窗口里正文含「数据截至日」、长度 > 200、`print()` 被调用过。**修复前该用例先跑失败**，失败输出里正是那句误导性的「浏览器拦截了新窗口」（截图里的空白标签页由此得到解释）。根因是 `window.open(..., 'noopener')` 返回 null；仓库扫描 `printWindow.test.ts` 防止再犯。详见 `docs/KNOWN_ISSUES.md` §1.0.5 与 D-096 |

v1.3.1 共新增 **6 例**（`printWindow.test.ts` 2、`settings.test.ts` 净增 1、
`normalize.test.ts` 净增 1、`DimensionAnalysisPanel.test.tsx` +1、`RejectionWorkspace.test.tsx` +1），
`npm test` 由 1419 例增至 **1425 例（103 文件）**。
**仍未验证**：真实打印对话框里「另存为 PDF」之后的 PDF 像素 / 中文分页（自动化只验证到
「新窗口里确实有报告正文且调用了 print()」这一层，浏览器打印对话框本身无法自动化）。

### 用户实测暴露的 AI 报错问题（2026-09-27 深夜，v1.3.2，两条）

用户第一次用真实 Key 调用了两次，暴露两个问题：**第一次**把认证失败说成参数问题（见下表第一行），
**第二次** HTTP 成功但正文为空，界面只说「请检查模型与参数」。

| 检查 | 判定 | 证据 |
|---|---|---|
| AI 报错分类是否与事实一致 | **已通过（修前是错的）** | 判定顺序改为 `401/402/429` → `error.type` → `error.code` → 其余状态；`aiResult.test.ts`（新增 4 例）含本次真实组合 `401 + code=invalid_request_error + type=authentication_error` → `auth`，以及 `422 + insufficient_balance` 仍判余额的**反向**用例；`aiClient.test.ts` 新增 1 例用真实返回形状断言提示含「认证失败」、不再出现「参数被服务端拒绝」。口径见 D-098 |
| 「正文为空」的提示是否可操作 | **已通过（修前等于没说）** | 新增分情况诊断：`finish_reason=length` → 指出输出额度被用尽并建议关思考模式 / 调大 `max_tokens`；只产出推理内容 → 指出本应用不读推理内容。`aiClient.test.ts` +2 例（含「推理正文不得出现在错误对象里」）；`AiAnalysisWorkspace.test.tsx` +1 例断言参数区**提前**写明「该模型思考模式默认开启、推理与正文共用 max_tokens」。口径见 D-099 |
| 真实 Key 的浏览器直连（AI16 的一半） | **部分通过（首次拿到真实服务端响应）** | 那次 401 响应带 `request_id`，**证明请求真的离开了浏览器并到达 DeepSeek**——即浏览器直连没有被 CORS 拦下；第二次调用是 **HTTP 200**，进一步说明链路通。但**成功产出报告**仍未跑通（第二次正文为空），因此 AI16 整体仍是「未验证」 |

v1.3.2 新增 **7 例**（`aiResult.test.ts` 4 + `aiClient.test.ts` 3 + `AiAnalysisWorkspace.test.tsx` 1），
`npm test` 由 1425 例增至 **1433 例（104 文件）**；`lint` 0 警告 0 错误（337 文件）。

### 用户第三轮反馈（2026-09-27 深夜，v1.3.3，两处真 bug + 一处体验）

用户在真实使用中又提了三件事，其中两件是我们自己的 bug。

| 反馈 | 判定 | 证据与口径 |
|---|---|---|
| 「设置里明明开了 AI，看板还说已关闭、预览点不动」 | **已通过（真 bug，已修）** | 根因：读偏好只去仓里找，找不到就回落默认值，而临时模式下用户的选择从没进过仓——**提示语承诺「本次会话生效」，代码只做到「本页面生效」**。修法：偏好加本会话兜底（写仓成功即清掉，仓仍是唯一事实来源）。`aiSettings.test.ts` +2 例。口径见 D-100 |
| 「把设置里 AI 的信息放到看板来：看板 → AI → 填 API → 确认分析」 | **已通过** | AI 工作区内联**设置页同一个** `AiSettingsPanel`（槽位传入，默认在 AI 未启用时展开）；面板新增 `onSettingsChange` 在每次变更时回传，避免「面板里开关开着、旁边写着已关闭」的矛盾画面。`AiAnalysisWorkspace.test.tsx` +1 例（槽位渲染与默认展开；不传槽位时一个字都不多） |
| 「上传过数据，重新进看板又要重新确认清洗预览」 | **已通过（真 bug，已修）** | 根因：写回设置草稿的 `useEffect` **挂载时也会跑**，而写回草稿＝「设置变了 → 结论作废」→ **只是打开清洗页就扔掉数据集**。修法：首帧只记基线、只在真改设置时写回。新增 `CommittedDataset.interaction.test.tsx`（2 例，修前第一条会失败）。口径见 D-101。**仍未解决**：数据集只在内存，刷新 / 闲置锁定 / 关标签页后仍需重新导入（§2.3） |

v1.3.3 新增 **5 例**（`aiSettings.test.ts` 2、`AiAnalysisWorkspace.test.tsx` 1、
`CommittedDataset.interaction.test.tsx` 2），`npm test` 由 1433 例增至 **1438 例（105 文件）**；
`lint` 0 警告 0 错误（338 文件）。

### 用户第四轮反馈（2026-09-27 深夜，v1.3.4：整理 + 一键启动 + 上线准备）

用户要求：① 整理本地版目录、删掉没用的日志与垃圾文件、给一个「点开就进页面」的快捷入口；
② 上传腾讯云给同事用（需求 A、不含 AI）。

| 事项 | 判定 | 证据与口径 |
|---|---|---|
| 目录整理 | **已完成** | 删除 `_checks/`、`test-results/`、`_demo/dev*.log`、**过时的 `pnpm-lock.yaml`**（本项目用 npm，且它缺少后加的测试依赖）；6 份几乎相同的打包脚本合并为 `_release/pack-release.ps1`（版本从参数来）。`_deploy/` 与 `_release/` 已进 `.gitignore` |
| 一键启动（双击即用） | **已通过** | 新增 `启动本地版.bat`（GBK + CRLF，避免中文控制台乱码）+ `scripts/serve-dist.mjs`（**零依赖**静态服务器，只监听 127.0.0.1）。本机实测：`/` 200、`/sw.js` 200 且 MIME 正确、缺失资源 404、页面级路径回落 index.html、**编码后的目录穿越请求 403**。为什么必须 127.0.0.1：Web Crypto 只在安全上下文可用 |
| 不含 AI 的产物不给 AI 入口 | **已通过（诚实性修正）** | 新增 `src/lib/aiAvailability.ts`：**读页面自己的 meta CSP**，`connect-src 'none'` → 判定不可用 → 看板/设置页不给入口，改为一句说明。`lib/aiAvailability.test.ts` 5 例；端到端在真实浏览器里断言本地版**没有** AI 入口且显示了说明文字，含 AI 版的同一处由 `ai-one-shot.spec.ts` 断言按钮**存在**。口径见 D-102 |
| 腾讯云上线 | **已准备，未验证** | 新增 `deploy/tencent-edgeone.md`（三条路 + 上线 5 项自检 + 红线）与 `_deploy/上传这个文件夹`（19 个文件 2.39 MB，`index.html` 已是 `connect-src 'none'`）。**上传动作需要你自己做**（我不接触你的腾讯云凭据）；上传后的真实表现见 `KNOWN_ISSUES.md` §3 新增行 |

v1.3.4 新增 **5 例**（`aiAvailability.test.ts`）+ 端到端新增两处断言，
`npm test` 由 1438 例增至 **1443 例（106 文件）**；`lint` 0 警告 0 错误（341 文件）。

### 构建产物静态核查（`dist/`，19 个文件）

| 检查 | 方法 | 结果 |
|---|---|---|
| 真实 Key / 凭据 | 正则 `sk-[A-Za-z0-9_\-]{16,}` 全量扫描 | **0 命中** |
| CDN / 统计 SDK / 错误上报 | 扫描 `googletagmanager` / `google-analytics` / `jsdelivr` / `unpkg` / `cdnjs` / `sentry-cdn` / `hm.baidu` / `umami` | **0 命中**（早期用 `analytics` / `gtag` 这类词扫会出现假阳性：`src/domain/analytics` 是我们自己的目录名、`Symbol.toStringTag` 里含 `gtag`） |
| 远程资源引用 | HTML / CSS 里查 `src="http…"` / `href="http…"` / `url(http…)` / `@import url` | **0 命中** |
| 出站端点 | 全量提取 URL 字面量 | 只有官方端点 `https://api.deepseek.com`、目录来源 `https://api-docs.deepseek.com`、占位示例 `https://proxy.example.com`、回环示例 `127.0.0.1` / `localhost`，其余为 SheetJS 的 XML 命名空间与 React / Router 文档链接（均为**字符串**，不是资源加载） |
| CSP（本地版） | 读 `dist/index.html` 的 meta 与 `dist/_headers` | meta 是**meta 版**（不带 `frame-ancestors`），`_headers` 是完整版（带 `frame-ancestors 'none'`），两处都是 `connect-src 'none'`；meta 排在 `<script>` / `<link>` 之前（偏移 99 < 441）；`script-src 'self'`，无 `unsafe-inline` / `unsafe-eval` / 通配符 |
| CSP（含 AI 版） | 同上，`npm run build:ai` 后 | 两处都是精确 `connect-src https://api.deepseek.com`，无通配符 |
| Service Worker | 查 `dist/sw.js` 与 `public/sw.js` | **逐字一致**（构建不做转换）；不含 `backgroundSync` / `periodicsync` / `push` / `Notification` / `indexedDB` / `localStorage` / `cookie`；事件监听只有 install / activate / fetch / message 四个 |
| PWA 资源 | 查 `dist/manifest.webmanifest`、`dist/icons/icon-{192,512}.png` | 都在；PNG 按 IHDR 断言为 8 位 RGBA 且尺寸正确（192×192 / 512×512） |

### 出站边界（源码级）

| 检查 | 结果 |
|---|---|
| 全仓可发起网络调用的文件数 | **1**（`src/ai/client.ts`），由 `src/features/ai/aiNetworkGuard.test.ts` 逐行扫描并断言「有且只有一处」 |
| `src/features/ai/**` 内的网络调用 | **0**（同一守卫测试） |
| `dangerouslySetInnerHTML` | 非测试文件里只出现在注释中（说明「不用它」）；渲染一律走 React 文本节点 |
| 敏感字段是否只有一处判定 | HR 代号 / 学校层次 / 岗位类别 / 薪资区间 / 原因主题只在 `src/privacy/aiSummary.ts` 判定 |
| 明文存储写入点 | `localStorage` / `sessionStorage` / Cookie / Service Worker：**0 个写入点**；持久化只经加密仓（浏览器实测：临时模式全程四类存储**都为空**） |

## 1. A01–A20（功能与边界验收矩阵，PRD 12.3）

| 编号 | 验收场景 | 判定 | 证据 |
|---|---|---|---|
| A01 | XLSX / CSV / 粘贴三种同内容输入 | 部分通过 | `importers/pipeline.test.ts`(20)、`delimited`(8)、`xlsx`(14)、`text`(13)、`grid`(13)、`workerBridge`(7) 断言三种来源产生相同 `RawRow` 且保留 sheet / 行号 / 来源；**真实浏览器里粘贴 50 行并解析成功**（`tests/e2e/local-flow.spec.ts`）。**选文件与拖拽仍未在浏览器验证**（自动化只能走粘贴框） |
| A02 | 重复表头、缺状态列、空表 | **已通过** | `domain/mapping.test.ts`(27) 的缺 offer 状态列阻断与多列冲突；`features/mapping/MappingEditor.interaction.test.tsx`(5) 在真实 DOM 里断言「移除 `offer状态` 后提交被阻断」「别名建议未逐行确认前阻断」「标准 21 列可提交并写入会话」；浏览器里整条映射流程走通 |
| A03 | 标准 / 别名 / 模糊映射 | **已通过** | `mapping.test.ts`(27) 四级匹配 + `MappingEditor.interaction.test.tsx`(5) 的别名建议、逐行确认、确认后出现「下一步：清洗预览」；端到端在真实 Chrome 里用标准 21 列走通 |
| A04 | 1900 / 1904、歧义日期、闰年、负周期 | **已通过** | `cleaning/dates.test.ts`(21)：日期系统、歧义日月顺序、闰年、负周期只影响周期、日期不偏移一天 |
| A05 | 相同需求不同候选人不被错误去重 | **已通过** | `cleaning/duplicates.test.ts`(15)、`cleaning/normalize.test.ts`(34)；浏览器端到端断言演示数据 50 行提交后看板 **N=50**，且恒等式 `N = J+P+A+R1+R2+U` 与 `D = J+P+R1+R2` 在看板上同时成立 |
| A06 | 未知状态 / 空分母 / 缺日期 | **已通过** | `analytics/statusCounts`(12)、`rates`(13)、`analyze`(15)、`durations`(15)、`quantile`(10)：分母 0 → `null` → 显示「—」，绝不显示 0%；排除数是已知计数时会显示 |
| A07 | 多级筛选、图表下钻、导出 | 部分通过 | `dashboardFilters`(29) 共用同一筛选快照、`DimensionAnalysisPanel`(29)、`RejectionWorkspace`(24)、`ExportWorkspace`(14) 渲染冒烟；**新增浏览器证据**：`FilterInteraction.interaction.test.tsx`(6) 断言「页面上显示的 N 等于引擎算出的 N（不写死数字）」、城市 chip 切换生效、清空筛选还原；`ReturnToAll.interaction.test.tsx`(3) 断言下钻后可一键回到全量；**导出闸门也进了真实浏览器**（`ExportGate.interaction.test.tsx`(3) + 端到端断言「预览前禁用 → 生成预览后可用」），并在人工验收暴露的两个 bug 修好后由 `exportSentinels.test.ts`(7) 钉住「哪些取值算哨兵」；**用户需求 ③ 起图表真实渲染也进了真实 Chrome**：端到端断言看板画布 ≥ 6 块、拒 offer 专项画布 ≥ 2 块（懒加载的 ECharts 真的画出了 canvas），并断言「只看该组」点击后 N 变小、点「返回全部数据」回到 50。**仍未验证**：图表的键盘可达性（图形与下方同数数据表的键盘关联）与读屏实测、移动端窄屏下的图例换行 |
| A08 | 单 HR、原因全空、样本不足 | **已通过** | `rates`(13)、`quantile`(10)、`analytics/rejection`(43)、`insights/rejection`(26)、`RejectionWorkspace`(23)：样本不足只描述、不排名、不造原因 |
| A09 | 混合薪资单位、住宿、未知房补 | **已通过** | `analytics/compensation`(10)、`salary`(15)、`domain/valueMappings`(34)、`cleaning/normalize`(34)：不跨单位合算、住宿不折现、未知房补不变 0 |
| A10 | 拒 offer 组 vs 入职组 | **已通过** | `analytics/rejection`(43)、`insights/rejection`(26)：组内构成与特征内率两个分母分别说明；`privacy/aiSummary`(33) 断言两者不混 |
| A11 | 正确 / 错误密码、密文篡改、刷新 | 部分通过 | `storage/vault.test.ts`(18)（正确解锁、错密码与篡改失败、同明文两次密文不同、改密后旧密码失效）、`crypto/kdf`(9)、`crypto/envelope`(11)、`storage/idleLock`(12)；**新增浏览器证据**：`local-flow.spec.ts` 在真实 Chrome 里建仓，直接读原生 IDB 断言**仓里有记录但一个明文哨兵都搜不到**。**刷新即回到锁定态已实测（见下条与 KNOWN_ISSUES）**；真实回收存储与 `navigator.storage.persist()` 的实际效果仍未验证 |
| A12 | IndexedDB / 缓存检查 | **已通过** | 新增浏览器实测两半：①**临时模式**下走完整条链路后 `indexedDB.databases()`、`localStorage`、`sessionStorage`、`document.cookie` **全部为空**；②**仓已建并解锁时**业务数据仍不被顺手写盘，仓内原始记录里没有哨兵、没有原始文件名、没有 localStorage 键。加上 `storage/vault.test.ts` 用真实 `fake-indexeddb` 读原生 IDB、`ai/aiHistory.test.ts`(18) 的哨兵检索、`privacy/independentAudit.test.ts`(6) 的独立复核 |
| A13 | 两个独立浏览器配置文件 | 部分通过 | 本条原来记「未验证」，本轮**部分落实**：Playwright 每个用例一个独立 browser context（等价于互不可见的独立配置），PWA 用例里 SW 与 Cache 都是每 context 独立建立的；数据只在本源 IndexedDB 内的设计依据未变。**仍缺**：两个真实「浏览器配置文件」（Chrome profile / 另一浏览器）之间的互不可见实测 |
| A14 | 本地 / AI 两种模式网络观察 | **已通过** | 真实 Chrome 的网络监听（`page.on('request')` 记录全部 http(s) 请求）实测：①**本地版**整条链路 + 页面内主动 `fetch('https://api.deepseek.com/chat/completions')` **被 CSP 拒绝**（`TypeError`）且**零出站记录**；②**含 AI 版**在 `page.route` 拦下端点后，开开关 / 存 Key / 导入 / 清洗 / 映射 / 生成预览全程 **0 次调用**，两次点击确认后**恰好 1 次 POST**，且除该端点与它的预检外没有任何外站请求。Node 层另有 `aiNetworkGuard.test.ts`(5) 与 `aiClient.test.ts`(26) |
| A15 | 恶意 HTML、表格公式注入 | 部分通过 | `ai/aiMarkdown.test.ts`(18) 脚本按纯文本、图片不保留地址；`AiPreviewPanel.test.tsx`(21) 恶意正文不执行不联图；`exporters/xlsx.test.ts`(10) 强制安全单元格类型、不写 `f` 字段；`markdown`/`print` 转义断言。**新增浏览器证据**：AI 结果面板在真实 Chrome 里渲染后，面板内 `script` / `a` / `img` 节点数**都是 0**。**仍未验证**：真实 CSV / XLSX 用「以 `=` 开头的姓名」导入后在 Excel 里的表现 |
| A16 | PDF / XLSX / PNG 中文完整、无敏感元信息 | 部分通过 | `exporters/xlsx`(10)、`print`(16，含用户需求 ③ 新增的 3 例：内嵌本机 PNG / 非法 dataUrl 一律丢弃 / 不给图时与从前逐字节一致)、`markdown`(10)、`ExportWorkspace`(14)：文件名 / 页眉 / 图注 / 内容的哨兵检索。**v1.3.1 新增浏览器证据**：真实 Chrome 里点「打印 / 另存为 PDF」，新窗口内**确实有报告正文**（含「数据截至日」、正文长度 > 200）且 `print()` 被调用过——此前这一步是空白页（见 `KNOWN_ISSUES.md` §1.0.5）。**真实 PNG 像素、PDF 中文与分页、Excel 打开、浏览器下载仍未验证**；**「打印版内嵌图」在真实打印对话框里另存为 PDF 的效果仍需人工确认**（HTML 里带 data URL 已由单测与浏览器用例覆盖，那不等于 PDF 里的效果） |
| A17 | 清除 + 重开 + 其他标签页 | 部分通过 | `features/settings/clearScope.test.tsx`(11)（三层范围与「做不到」）、`storage/vault.test.ts` 清空用例、`storage/vaultSession.test.ts`(6)（`versionchange` 推送式失效）。**真实两个标签页、`blocked` 的真实提示未验证**；「清空后重开」只验证了 IndexedDB 层面的仓被删 |
| A18 | 锁定 / 改密 / 存储失败 / 迁移失败 | 部分通过 | `storage/vault.test.ts`(18)、`storage/backup.test.ts`(13)（错误密码备份不可恢复、恢复前整份校验、保存失败不破坏旧仓）。**新增浏览器证据**：整页重载后仓回到锁定态（内存密钥按设计丢弃）已被端到端用例实际踩到并核对。**迁移失败与写失败的真实浏览器表现仍未验证** |
| A19 | 生产构建、子路径、刷新、断网（PWA） | **已通过** | 三种构建退出码 0、产物 19 个文件、静态核查见 §0；**新增真实 Chrome 证据**：①SW 真的装上并 `activated`、作用域是 `http://127.0.0.1:4173/`；②Cache Storage 里**只有**同源静态资源（应用壳 `/index.html` + `/assets/*`），**没有任何 AI 端点或跨源地址**；③`context.setOffline(true)` 后整页 `reload()` 仍能打开应用壳与导入页，页面里没有可点击外链；④manifest 与图标都能取到（`content-type: image/png`）。**仍未验证**：「添加到主屏幕」的真实安装体验、版本更新提示的真实出现与切换、真实托管平台上响应头是否按策略生效 |
| A20 | 性能基准 | **已通过** | `tests/e2e/performance.spec.ts` 实测并落盘（`test-results/perf-baseline.json`，数字见 §0）：首屏 `load` 133 ms、首屏脚本 4 个文件 832,572 B、首屏资源 7 个且全部同源、整条本地链路 1232 ms、最长长任务 60 ms；上界只用于抓退化（首屏脚本 ≤ 1.6 MB、链路 ≤ 30 s、单次长任务 ≤ 5 s），并断言首屏入口脚本**不是** `echartsRegister` / `xlsx` / `parse.worker` / `vault-` |

## 2. AI01–AI18（PRD 19 章）

| 编号 | 验收项 | 判定 | 证据 |
|---|---|---|---|
| AI01 | 未确认零请求；确认恰好 1 次且正文与预览完全一致 | **已通过** | **新增真实浏览器证据**（含 AI 版构建 + `page.route` 拦下官方端点）：`@ai-build` 用例断言开开关 / 存 Key / 导入 / 清洗 / 映射 / 生成预览全程 **0 次调用**，第一次点击只批准（`已确认这一份预览，令牌还没有被消费`，仍是 0 次），第二次点击后**恰好 1 次 POST**，且发送正文的 `messages[1].content` **包含**页面上那段 `payloadJson`（预览标题写的就是「逐字节等于将要发送的文本」）。Node 层另有 `ai/aiClient.test.ts`(26)、`ai/aiRequest.test.ts`(17) |
| AI02 | 双击确认不产生第二次付费请求 | **已通过** | 浏览器实测：结果出现后再点同一个按钮，请求数**仍然是 1**；`privacy/aiPreview.test.ts`(19) 断言令牌消费第二次被拒；`aiClient.test.ts` 的在途互斥直接拒绝（不排队）；`AiAnalysisWorkspace.test.tsx`(16) 断言已消费后按钮不可点 |
| AI03 | 改筛选 / 模型 / 参数 / 隐私级别 → 旧确认失效 | **已通过** | `privacy/aiPreview.test.ts` 的 hash 覆盖项与 `isPreviewStale`；`AiAnalysisWorkspace.test.tsx`「换隐私级别 → hash 变化 → 旧确认被「已失效」拒绝」；`ai/aiConfig.test.ts`(16) 参数收敛；`AiConfirmFlow.interaction.test.tsx`(7) 在真实 DOM 里断言「参数一改，旧确认令牌失效、按钮回到未确认态」 |
| AI04 | 失败 / 超时 / 取消均不自动重试、不换模型 | **已通过** | `aiClient.test.ts` 逐条断言 401 / 402 / 429 / 5xx / `TypeError` / 非 JSON / 空 content **都只发一次**；代码里没有重试 / 退避 / 换端点路径；浏览器实测的两次点击语义与「结果出现后不再发」也印证没有隐藏重试 |
| AI05 | 摘要 JSON 无姓名、准确薪资、需求 ID、HR 真名、文件名 | **已通过** | `privacy/aiSummary.test.ts`(33) 用哨兵字符串检索载荷全文；`ai/summary.test.ts`(36) 断言摘要本身不含文件名等；`features/ai/aiSourceCells.test.ts`(18) 断言 HR 只出代号；**新增浏览器证据**：真实发出的请求正文里不含 `HR样例甲`、`REQ-0001`、`合成大学`，也不含原始文件名 `demo-intern-recruitment`（HR 只以 `HR-1` / `HR-2` 代号出现） |
| AI06 | 所有 n<5 单元被抑制，互补抑制可防反算 | **已通过** | `aiSummary.test.ts`(33)：`D < 5` 整格抑制且**不填 0**、跨表同维重复即整维省略；`privacy/sanitize.test.ts`(19) 与 `privacy/report.test.ts`(31)：互补抑制 |
| AI07 | 薪资 / 周期分桶边界正确 | **已通过** | `aiSummary.test.ts` 的 `salaryBandOf` / `cycleBandOf` 边界用例（含 2000.5 落桶、边界不重复计数）；`analytics/salary`(15)、`quantile`(10) |
| AI08 | 学校 / 岗位仅以层次或类别出现，未知不猜测 | **已通过** | `aiSummary.test.ts`：`schoolLevelOf` 三值；AI-6 起 `positionCategoryOf(key, rules)` 只查表不推断、未命中发中性标签「有岗位记录」、不合格类别被丢掉；浏览器实测载荷里岗位维度确实只出现中性标签 |
| AI09 | 改脱敏配置立即撤销旧预览 | **已通过** | 同 AI03；`aiSummary.test.ts`「隐私级别不同 → 载荷不同（因此 hash 必然不同）」 |
| AI10 | 明文 Key 不出现于 IndexedDB / localStorage / 日志 / URL / 报告 / 历史 / 导出 | **已通过** | `ai/keySession.test.ts`(31)：快照类型**没有** `value` 字段、掩码是唯一显示入口；`ai/aiHistory.test.ts`(18) 用真实仓 + 原生 IDB 检索断言无明文；`ai/aiExport.test.ts`(16) 断言导出文本无凭据。**新增浏览器证据**：设置页在保存合成 Key 之后，页面上**搜不到**该 Key 的明文文本节点（只有掩码）；`local-flow.spec.ts` 的建仓用例断言 localStorage 为空且仓内无明文哨兵 |
| AI11 | Key 不进正文与错误日志，仅以 `Authorization` 头发送 | **已通过** | **新增真实浏览器证据**：`@ai-build` 用例读真实请求对象——`authorization` 头等于 `Bearer <合成 Key>`，URL 与请求正文里**都不含**该 Key，除 `Authorization` 外没有任何请求头携带它。Node 层：`aiClient.test.ts` 断言请求头只含 `Content-Type` 与 `Authorization`、错误对象只带状态码与官方 `error.code` |
| AI12 | 恶意 Markdown 不执行、不发起网络请求 | **已通过** | `ai/aiMarkdown.test.ts`(18) 只产出白名单节点（无 html / image / link 节点类型）、图片不保留地址、链接降级为纯文本；`AiPreviewPanel.test.tsx` 的恶意正文断言；**新增真实浏览器证据**：AI 结果面板渲染后内部 `script` / `a` / `img` 节点数为 **0**，且整条链路零外站请求 |
| AI13 | 历史元数据齐全 | **已通过** | `ai/aiHistory.test.ts`(18)：模型（请求 / 返回分开）、时间、脱敏级别、范围、规则版本、提示词版本、已发送载荷、`finish_reason` 与用量 |
| AI14 | 清空历史不删源数据与 Key；迟到响应不写回 | **已通过** | `aiHistory.test.ts`：往仓里同时放 `dataset` 与 `aiHistory`，清空历史后源数据仍在、secrets 未动；`aiClient.test.ts` 世代号让迟到响应作废；`aiHistory.test.ts` 断言「清空后拿到迟到响应 → 历史仍为空」 |
| AI15 | AI 结果不覆盖本地统计；数值不一致时有提示 | 部分通过 | `features/ai/AiResultPanel.tsx` + `aiResultView.ts`：明确写出「以本地统计为准」「不覆盖看板数字」；结果与统计是两套独立数据（历史里保存的是**已发送的载荷**，不回写任何统计）。**`metricId` 与模型文本数字的逐项一致性比对未实现**（见 KNOWN_ISSUES） |
| AI16 | 截断响应明确标记「结果不完整」 | **已通过** | `ai/aiResult.ts` 的 `finishStatusOf` 是唯一判据（`stop` 之外全为 `incomplete`）；`aiClient.test.ts` 覆盖 `length` / 缺失 / 其他原因 |
| AI17 | 关闭 AI 后本地功能正常，且无任何出站请求 | **已通过** | 默认关闭（`AI_ENABLED_DEFAULT = false` + 界面「已关闭（默认）」）；**新增真实浏览器证据**：本地版构建下走完导入 → 映射 → 清洗 → 看板 → 拒 offer 专项 → 报告导出，全程**零出站请求**、零控制台错误；且页面内主动发往官方端点的 `fetch` 被 CSP 拒绝（`TypeError`）。Node 层：`aiNetworkGuard.test.ts` 断言只有适配器能发请求 |
| AI18 | 生产构建：默认零外部请求、仅白名单端点、无 CDN / 统计 SDK / 真实 Key | **已通过** | `dist/` 静态核查见 §0（0 Key、0 CDN / 统计、0 远程资源）；**新增真实浏览器证据**：①本地版首屏只加载同源资源（7 个请求全部同源）且零出站；②含 AI 版只有官方端点被放行，除那一次调用与预检外零外站；③SW 缓存里没有任何跨源或 AI 端点记录；④meta CSP 与 `_headers` 两种形态都经测试钉住。**仍未验证**的真实部署那一半：真实托管平台上响应头是否真的按策略生效（见 §4） |

**AI16 的「真实部署来源的直连（CORS）」仍然完全未验证**：本轮的 AI 请求由 Playwright
`page.route` 拦下并本地合成应答（含 CORS 预检响应），**没有用过真实 Key、没有真的连过
`api.deepseek.com`**。`curl` 或 Node 请求成功**不等于**浏览器 CORS 通过（PRD 18.5 原文）。

## 3. Mock 覆盖矩阵（AI-7 要求逐项对号）

| 覆盖方向 | 主要测试 | 例数 |
|---|---|---|
| 错误与失败分类 | `ai/aiClient.test.ts`（401 / 402 / 429 / 5xx / `TypeError` / 非 JSON / 空 content / 响应超限 / 取消 / 超时） | 26 |
| 预览一致性 | `ai/aiRequest.test.ts`（正文逐字段投影、与预览逐字节一致）、`privacy/aiPreview.test.ts`（hash 覆盖项、令牌一次性） | 17 + 19 |
| 敏感哨兵 | `ai/summary.test.ts`、`privacy/aiSummary.test.ts`、`privacy/sanitize.test.ts`、`privacy/report.test.ts`、`privacy/independentAudit.test.ts`、`ai/aiHistory.test.ts`、`storage/vault.test.ts`、`storage/backup.test.ts` | 36 + 33 + 19 + 31 + 6 + 18 + 18 + 13 |
| 反算（互补抑制） | `privacy/sanitize.test.ts`、`privacy/report.test.ts`、`privacy/aiSummary.test.ts`（同维双表 / 跨表交叉一律省略） | 19 + 31 + 33 |
| 导出 | `ai/aiExport.test.ts`（命中即阻断、回显纪律、无凭据、无思维链）、`exporters/xlsx` / `print` / `markdown`、`features/export/ExportWorkspace.test.tsx` | 16 + 10 + 13 + 10 + 14 |
| 迟到响应 | `ai/aiClient.test.ts`（世代号作废）、`features/ai/aiSubmitFlow.test.ts`（顺序不变量）、`ai/aiHistory.test.ts`（不写回已清空历史） | 26 + 8 + 18 |
| 结果安全渲染 | `ai/aiMarkdown.test.ts`、`features/ai/AiPreviewPanel.test.tsx`、`features/ai/AiAnalysisWorkspace.test.tsx` | 18 + 21 + 16 |
| 界面文案纪律 | `features/privacy/uiTextGuard.test.ts`（全仓扫描会被逐字渲染的字符串）、`features/settings/AiSettingsPanel.test.tsx` | 2 + 12 |
| 出站守卫 | `features/ai/aiNetworkGuard.test.ts` | 5 |
| 生产 CSP / 部署模板 | `lib/csp.test.ts`（两套策略的承诺、meta 版与响应头版的唯一差别、覆盖入口只收精确 https origin、`_headers` 规则）、`pwa/deployTemplates.test.ts`（`deploy/vercel.json` 与代码逐字一致、三份平台说明的差别） | 13 + 8 |
| Service Worker 与 PWA 资源 | `pwa/pwaAssets.test.ts`（SW 源码级否定式断言、manifest 字段、PNG IHDR、dist 产物）、`pwa/registerServiceWorker.test.tsx`（注册路径与作用域、更新提示只在真更新时出现、只有点击才接管） | 16 + 12 |
| **真实 DOM 交互（步骤14 新增）** | `features/mapping/MappingEditor.interaction.test.tsx`(5)、`features/dashboard/FilterInteraction.interaction.test.tsx`(6)、`features/ai/AiConfirmFlow.interaction.test.tsx`(7) | 18 |
| **真实浏览器端到端（步骤14 新增）** | `tests/e2e/local-flow.spec.ts`(5)、`tests/e2e/performance.spec.ts`(1)、`tests/e2e/pwa-offline.spec.ts`(3)、`tests/e2e/ai-one-shot.spec.ts`(2，`@ai-build`) | 11 |

**全部 AI 测试都不发真实请求**：Node 侧的 `fetch` 被替换成记录调用并返回合成响应的假实现；
浏览器侧的请求由 `page.route` 拦下并本地应答（含 CORS 预检）。
Key 一律用形状像 Key 的合成串（`sk-synthetic-not-a-real-credential-0001`），仓库里没有真实凭据。

## 4. 真实部署与浏览器手工测试状态

**部分执行：本机真实浏览器已跑，真实部署与真实凭据仍未执行。**

### 已经做了的（真实 Chrome，`vite preview` 提供产物，串行 1 worker）

| 做了什么 | 用例 |
|---|---|
| 粘贴 50 行演示数据 → 字段映射 → 清洗提交 → 看板出 N=50 且恒等式成立 | `local-flow.spec.ts` |
| 全程零出站；页面内主动 `fetch` 官方端点被 CSP 拒绝（`TypeError`） | `local-flow.spec.ts` |
| 临时模式下 IndexedDB / localStorage / sessionStorage / Cookie 全空 | `local-flow.spec.ts` |
| 建仓并解锁时业务数据仍不落明文；仓内无哨兵、无文件名 | `local-flow.spec.ts` |
| AI 结果页 / 历史页空态可打开，页面无可点击外链与远程图片 | `local-flow.spec.ts` |
| 首屏 `load` 耗时、首屏脚本字节、请求数与同源性、整条链路耗时、最长长任务 | `performance.spec.ts` |
| SW 真的装上并 `activated`、作用域正确；Cache Storage 只有同源静态资源 | `pwa-offline.spec.ts` |
| 断网后整页重载仍能打开应用壳与导入页 | `pwa-offline.spec.ts` |
| manifest 与 192 图标可被取到且不含远程地址 | `pwa-offline.spec.ts` |
| 开开关 / 存 Key / 导入 / 清洗 / 生成预览零请求；两次点击确认后恰好 1 次 POST 且正文等于预览 | `ai-one-shot.spec.ts`（`@ai-build`） |
| Key 只出现在 `Authorization` 头；正文与 URL 都没有它；正文无哨兵 | `ai-one-shot.spec.ts`（`@ai-build`） |
| AI 结果面板渲染后内部 `script` / `a` / `img` 节点数为 0 | `ai-one-shot.spec.ts`（`@ai-build`） |

未在真实浏览器里跑到的浏览器有：**Edge / Firefox / WebKit（Safari）**。
本机有 Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`），
把 `playwright.config.ts` 的 `channel` 改成 `'msedge'` 即可复跑，但本轮**没有跑**，因此
任何「跨浏览器」的说法都不成立。

### 仍然**未执行**的（一律记为「未验证」）

- 没有把站点部署到任何真实来源（GitHub Pages / Cloudflare Pages / Vercel）。
  全部浏览器证据都来自本机 `vite preview`——**那不等于托管平台上的真实行为**
  （尤其响应头是否生效、GitHub Pages 只有 meta CSP 这条边界）。
- 没有用**真实 API Key** 发起过任何付费请求；**AI16「真实部署来源的直连（CORS）」完全未验证**。
- 没有手工点过：加密备份的导出 / 恢复、四点确认短语逐字输入、改密、跨标签页失效、
  「添加到主屏幕」的真实安装体验、版本更新提示的真实出现与切换。
- 没有在真实浏览器里核对：图表真实渲染 / 点击下钻 / 键盘可达、真实 PNG 像素、
  PDF 中文与分页、XLSX 在 Excel 中打开、浏览器下载行为。
- 没有用 DevTools 人工检查过 IndexedDB / Cache 的明文情况（自动化只检查了键与哨兵字符串，
  没有逐一查看每个值）与浏览器控制台全量输出（只断言了「零 console error」）。
- 没有验证「两个真实浏览器配置文件之间互不可见」（A13）。
- 没有在真实浏览器里验证 Service Worker **版本更新**路径（新版等待 → 用户点击 → 切换）。

### 人工验收清单（建议顺序，全部使用合成数据）

1. `npm run dev` → 打开页面，确认网络面板在**导入 / 清洗 / 看板 / 导出**全程为空（dev 下没有 CSP，
   这条只看「有没有请求」，不看策略）。
2. `npm run build && npx vite preview` → 用 `_demo/demo-intern-recruitment.tsv` 走完
   导入 → 映射 → 清洗 → 看板 → 拒 offer → 导出，核对看板 N=50 与恒等式。
3. 创建加密仓 → 刷新 → 确认必须重新解锁（**已在自动化里实测到这条行为**）；
   导出加密备份 → 清空整仓 → 用备份恢复。
4. 设置页打开 AI 开关、保存合成 Key、确认本地规则 → 看板生成预览 → 逐字核对预览
   → 第一次点击只批准 → 第二次点击提交，观察网络面板中**只出现一次**请求
   （若 CORS 被拒，如实记录为「浏览器直连不可用」）。
5. 用真实浏览器验证：四点确认短语、跨标签页改密 / 清空的提示、打印另存为 PDF 的中文与分页、
   PNG 下载、XLSX 在 Excel 中打开。
6. **PWA / 部署相关**：`npm run build` 后用任意静态服务器打开 → 确认 DevTools 的 Application
   面板里 Service Worker 已激活、Cache Storage 里只有同名静态资源（**不应**出现任何数据集 /
   报告 / AI 请求的记录）→ 断网刷新，确认看板与已提交数据集仍可打开 → 改一次代码重新构建并部署，
   确认出现「有新版本可用」提示，点「立即更新」后版本切换且**加密仓数据仍在**（不需要重新导入）；
   再用 `npm run build:ai` 部署一次，确认控制台没有 CSP 拦截官方端点的报错
   （**本地版下这条报错已经不会再出现**：meta 版已去掉浏览器会忽略的 `frame-ancestors`）。

## 5. 发布阻断条件

下列任一情况存在时，**不得**把本版本标记为「可处理生产招聘数据」。当前验证范围内均**未发现**：

- 未经确认的 AI 出站请求，或请求发往白名单以外的端点 —— **浏览器实测：本地版零出站、
  含 AI 版恰好一次且只指向官方端点**；
- 明文 Key 出现在存储 / 日志 / URL / 报告 / 历史 / 导出中 —— **浏览器实测：只出现在
  `Authorization` 头**；
- 原始行或候选人级明细进入载荷、报告或导出 —— **浏览器实测：出站正文无哨兵**；
- 小组抑制或互补抑制可被绕过（含跨表交叉反算）；
- 敏感业务数据明文落盘 —— **浏览器实测：临时模式四类存储全空，建仓后仓内无明文哨兵**；
- 指标口径错误（分母 / 率 / 分位 / 日期）—— **浏览器实测：看板上恒等式与核心分母同时成立**。

**仍然不能标记为可发布的原因不是上面任何一条，而是「真实部署 + 真实凭据 + 真实托管平台的
响应头」这三件事一次都没做过**（§4）。任何要拿它处理真实招聘数据的人，必须先把 §4 的人工清单
跑完，或者明确接受这些未验证项。
