# GitHub Pages

## 它做不到什么（先读这一条）

GitHub Pages **不能**自定义响应头，因此**没有** `Content-Security-Policy` 响应头可用。
唯一的策略载体是 `index.html` 里的 **meta CSP**（构建时自动注入）。
PRD 18.6 的原话：*GitHub Pages 的 meta CSP 不等于完整的响应头策略*。具体差别：

- meta CSP 只能覆盖**文档自身**发起的请求与资源；对 `frame-ancestors`、`report-uri`、
  `sandbox` 等指令**无效**（浏览器会忽略 meta 里的它们）；
- 响应头 CSP 能在文档开始解析前就生效，meta 要等解析到那一行——中间有一个极短的窗口；
- 因此本平台适合**本地版**（`connect-src 'none'`）这种「不依赖任何出站」的部署。
  含 AI 版建议放在能设响应头的平台上（见 `cloudflare-pages.md` / `vercel.md`）。

`X-Content-Type-Options` / `Referrer-Policy` / `Permissions-Policy` 等同样无法设置——
`index.html` 里已有的 `<meta name="referrer">`? 现在**没有**加，因为 meta 形式的 referrer 策略
只能收紧到文档级，而本应用默认就不发跨源请求。若你在页面里放外部链接，请自行评估。

## 项目站点（子路径）部署

仓库 `https://github.com/<user>/<repo>` 的站点地址是
`https://<user>.github.io/<repo>/`，因此**必须**用子路径构建：

```bash
npm run build:subpath          # 等价于 vite build --base=/intern-recruitment/
# 若仓库名不是 intern-recruitment，直接指定：
# npm run build -- --base=/<repo>/
```

然后把 `dist/` 发布到 Pages（任选其一）：

- **分支方式**：把 `dist/` 内容推到 `gh-pages` 分支，在仓库设置里把 Pages 源指向它；
- **Actions 方式**：用 `actions/upload-pages-artifact` + `actions/deploy-pages`，构建命令同上。

## 刷新与 404

本应用用 **HashRouter**，路由信息在 `#` 之后，因此**刷新子路由不会 404**，
不需要 `404.html` 兜底，也不需要服务端重写规则。

## 缓存

GitHub Pages 会对静态资源做自己的缓存策略，`/assets/*` 带内容哈希，因此不会有「旧 JS 配新
`index.html`」的问题；但 `index.html` 与 `sw.js` 的更新时机不由我们控制。若发现「部署了新版本
但浏览器仍是旧的」，用一次硬刷新确认；Service Worker 侧已把 `sw.js` 标为不缓存（见
`deploy/README.md` 的说明与 `src/lib/csp.ts` 里的缓存规则）。
