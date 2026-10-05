# v1.1.0 交付说明（含可选 AI、AI 默认关闭）

> 交付日期：2026-09-27 ｜ 交付版本：**1.1.0**（`package.json` 的 `version`）
> 交付形态：**只读静态站点归档**（本机 zip，**未发布到任何平台**）
> 交付内容：由本文件、`site/`（构建产物）、源码文档与校验和组成；不含任何真实招聘数据与真实凭据。

## 1. 这一版是什么

- **纯前端静态站点**：无后端、无 CDN、无埋点；解析 / 清洗 / 统计 / 加密 / 导出全部在浏览器内完成。
- **含可选 AI、但 AI 默认关闭**：`AI_ENABLED_DEFAULT = false`（`src/ai/aiConfig.ts`）。
  构建模式为 `--mode ai`，因此生产 CSP 精确放行官方端点 `https://api.deepseek.com`；
  即便如此，**只有你在看板主动生成完整脱敏预览并两次点击确认之后**才可能发出一次请求。
- **本版本冻结的是步骤1–14 的全部成果**（本地主链路、AI 支路、PWA 与两套 CSP、最终测试与验收）。
  步骤15（清洗预览的异常行清单与逐格手动修正）与 `docs/KNOWN_ISSUES.md` §1.4 的渠道推断开关
  **不属于 v1.1**，它们是交付之后的工作。

## 2. 构建命令与产物

```bash
npm install                 # 依赖（含锁文件）
npm run build:ai            # = tsc -b && vite build --mode ai   ← v1.1 的交付构建
```

- 产物：`dist/` 共 **19 个文件**；入口 chunk `assets/index-Db9mPBt9.js` **760.09 kB（gzip 231.18 kB）**。
- 懒加载（不进首屏）：`echartsRegister-*.js` 542.96 kB、`xlsx-*.js` 492.37 kB、
  `parse.worker-*.js` 419.48 kB、`vault-*.js` 103.23 kB。
- 随产物一起交付的还有：`sw.js`（与 `public/sw.js` 逐字一致）、`manifest.webmanifest`、
  `icons/icon-192.png` / `icons/icon-512.png`、`favicon.svg`、`_headers`。
- **`dist/` 里没有任何真实 Key、没有第三方统计 / CDN 主机名、没有远程资源引用**（打包前已全量扫描，0 命中）。

## 3. 怎么在本机跑起来（不联网、不上线）

```bash
npx vite preview --host 127.0.0.1 --port 4173 --strictPort
# 然后打开 http://127.0.0.1:4173/
```

任何静态文件服务器都可以（例如把 `site/` 目录直接托管在本机）。两点必须知道：

1. `vite preview` **不会施加** `_headers` 里的安全响应头——本地预览真正生效的是
   `index.html` 里的 meta CSP。`_headers` 要等部署到支持响应头的平台（Cloudflare Pages / Netlify / Vercel）才起作用；
   GitHub Pages 只有 meta CSP（`deploy/github-pages.md` 写清了差别）。
2. 站点会注册 Service Worker（只在生产构建下注册）。若在同一地址先打开过别的构建，
   请硬刷新（Ctrl+Shift+R）或在 DevTools → Application → Service Workers 勾「Update on reload」；
   它只缓存同源静态资源，**不缓存 / 不排队 / 不重发 AI 请求**，也不读写招聘数据。

## 4. 本版本的实测证据（全部在本机同一份冻结状态上重跑）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 退出码 0，无诊断 |
| Lint | `npm run lint` | **0 warning 0 error**（320 文件、116 规则，无豁免） |
| 单元 / 集成 / jsdom 交互 | `npm test` | **1372 例通过 / 96 个文件** |
| 端到端（本地版） | `npm run test:e2e` | **9 例通过**（13.4 s，系统 Chrome，串行） |
| 端到端（含 AI 版） | `npm run test:e2e:ai` | **2 例通过**（9.2 s） |
| 构建 | `npm run build:ai` | 退出码 0，产物 19 个文件 |
| 性能基线 | Playwright 用例实测并落盘 | 首屏 `load` **130 ms**；首屏脚本 **4 个文件 832,572 B**；首屏请求 **7** 个且**全部同源**；「粘贴 50 行 → 映射 → 清洗提交 → 看板出 N=50」**1164 ms**；期间最长长任务 **72 ms** |

**真实浏览器里已经实测过的关键承诺**（系统 Chrome + 本机预览）：

- 整条本地链路可走通，看板 **N=50**，且恒等式 `N = J+P+A+R1+R2+U` 与 `D = J+P+R1+R2` 同时成立；
- 本地版构建**零出站**，且页面内主动 `fetch` 官方端点被 **CSP 拒绝**（`TypeError`）；
- 临时模式全程 **IndexedDB / localStorage / sessionStorage / Cookie 全空**；建仓并解锁时仓内**无明文哨兵**；
- Service Worker **真的装上并激活**；Cache Storage 里只有同源静态资源；**断网重载仍能打开**应用壳；
- 含 AI 版：开开关 / 存 Key / 导入 / 清洗 / 生成预览**全程 0 次请求**，两次点击确认后**恰好 1 次 POST**，
  发送正文**包含**页面上那份 `payloadJson`，且不含任何合成哨兵；Key **只出现在 `Authorization` 头**；
- AI 结果面板渲染后内部 `script` / `a` / `img` 节点数为 **0**。

逐条判定与证据见 `docs/ACCEPTANCE.md`（A01–A20 与 AI01–AI18）。

## 5. 本次交付**不包含**的承诺（未验证项，如实列出）

以下都**没有**验证过，因此 v1.1 不为它们做任何保证：

- **真实托管平台上的响应头是否生效**（`vite preview` 不施加 `_headers`；GitHub Pages 只有 meta CSP）；
- **AI16「真实部署来源的直连（CORS）」**：本轮所有 AI 断言用的都是本地合成的预检与响应，
  **没有用过真实 Key、没有真的连过官方端点**；`curl` 或 Node 成功**不等于**浏览器 CORS 通过；
- Edge / Firefox / WebKit 与移动端浏览器（仅测了系统 Chrome）；
- 图表真实渲染 / 点击下钻 / 键盘可达；跨标签页改密与清空的真实失效提示；
- PNG 真实像素、PDF 中文与分页、XLSX 在 Excel 中打开、浏览器下载行为；
- PWA 的「添加到主屏幕」安装体验、两个真实版本之间的更新提示与切换；
- 用 DevTools 逐个值人工复核存储；几万行真实数据量下的性能；低端设备上的 KDF 解锁耗时。

## 6. 数据与凭据红线（本交付物的自我声明）

- 归档里**没有**任何真实招聘名单、附件、截图、密码或 API Key；演示数据是**合成**的
  （`_demo/demo-intern-recruitment.tsv`，50 行，字段值形如「合成大学」「HR样例甲」）。
- 本版本**未部署到互联网**，也**没有**用真实 Key 发起过付费请求。
- 想体验 AI 支路时，请在你自己的浏览器里输入你自己的 Key（默认只存内存，可显式加密保存）；
  界面上「确认并调用」需要点两次：**第一次只是批准这一份预览**（不发请求），第二次才消费令牌并发出。

## 7. 交付后待办（不属于 v1.1）

| 项 | 位置 | 说明 |
|---|---|---|
| 发布前人工复核清单 | `docs/ACCEPTANCE.md` §4 | 真实平台响应头、真实 Key 的一次付费验证、跨浏览器、PWA 更新、导出文件在真实 Office 里的表现 |
| **步骤15** 异常行清单 + 逐格手动修正 | `docs/IMPLEMENTATION_PLAN.md`「步骤15」、`docs/DECISIONS.md` D-091 | 用户在验收中提出；含三条粒度与影响面，开工前需先定口径 |
| 渠道推断开关（PRD 5.2 已承诺未实现） | `docs/KNOWN_ISSUES.md` §1.4 | 与步骤15 一起做；涉及 AGENTS §6 红线与 PRD 431 的维度隔离，**必须先改 PRD + 追加决策** |
| `DECISIONS.md` 决策索引停在 D-016 | `docs/KNOWN_ISSUES.md` §2.9 | 可选文档清理 |

## 8. 归档内容与校验

归档目录结构（`site/` 即构建产物，可直接托管）：

```
intern-recruitment-v1.1.0/
  README.md                     使用、口径、隐私边界、部署与文档索引
  PRIVACY.md                    用户可见隐私说明
  AGENTS.md                     项目最高优先级约束（网络 / 隐私 / 测试红线）
  RELEASE_v1.1.md               本文件
  site/                         构建产物（19 个文件，含 sw.js / manifest / 图标 / _headers）
  docs/                         PRD、实施计划、决策记录、ACCEPTANCE、KNOWN_ISSUES、部署说明
  deploy/                       GitHub Pages / Cloudflare Pages / Vercel 三份说明 + vercel.json 模板
  _demo/demo-intern-recruitment.tsv   合成演示数据（50 行，非真实数据）
  SHA256SUMS.txt                上述全部文件的 SHA-256（逐行「哈希  相对路径」）
```

**归档自身的 SHA-256** 只记在**归档之外**的同目录文件 `_release/SHA256SUMS.txt` 里
（该文件同时收录归档内每个文件的哈希）。为什么不写进本文件或 README：它们本身就在归档内部，
写自己的哈希是自指、无法自洽。核验方式：

```bash
sha256sum intern-recruitment-v1.1.0-ai.zip        # 与 _release/SHA256SUMS.txt 第一行比对
# 归档内逐文件核验（解压后在该目录执行）
sha256sum -c SHA256SUMS.txt
```
