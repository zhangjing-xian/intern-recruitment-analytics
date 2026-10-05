# Vercel

## 配置

| 项 | 值 |
|---|---|
| Framework preset | Vite（或 Other） |
| Build command | `npm run build`（本地版）或 `npm run build:ai`（含 AI 版） |
| Output directory | `dist` |
| Install command | `npm install` |
| Serverless / Edge Functions | **不要创建** |
| Analytics / Speed Insights | **关闭**（不要注入任何脚本） |

子路径部署（例如挂在 `https://example.com/tools/review/`）加 `--base`：

```bash
npm run build -- --base=/tools/review/
```

## 响应头

Vercel 用仓库根目录的 `vercel.json` 设置响应头（**不读** Cloudflare 风格的 `_headers`）。
本目录提供了模板 `vercel.json`，它的 `Content-Security-Policy` 与
`src/lib/csp.ts` 里**含 AI 版**的策略一致；若你部署的是本地版，把 `connect-src` 改成 `'none'`
即可（`src/pwa/deployTemplates.test.ts` 会断言模板里的策略与代码里的字符串逐字一致，
改一边不改另一边会失败）。

模板同时带了两个部署必读项：

- `/sw.js` 与 `/index.html` 的 `Cache-Control: no-cache`：否则新版本可能长期拿不到；
- `/assets/*` 的长缓存 + `immutable`：这些文件名带内容哈希，可以放心缓存一年。

## 注意

- **不要**在 Vercel 上开启任何「边缘函数改写 HTML」的功能：本应用的 CSP 与固定资源清单是
  构建产物的一部分，运行时改写会让产物与策略不一致；
- Vercel 的 Preview 与 Production 用的是同一个 `vercel.json`，因此两边的 CSP 一致；
  如果想让预览环境更严格（例如 `connect-src 'none'`），请为预览单独设置构建命令，
  而不是放宽生产的策略；
- 部署后**实际验证**一次：打开站点 → 开发者工具「网络」面板 → 默认模式下不应有任何跨源请求；
  含 AI 版在确认后应只出现一次发往 `https://api.deepseek.com`（或你登记的代理）的请求。
