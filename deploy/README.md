# 部署说明索引（只准备配置，不擅自上线）

本目录是**静态托管的配置说明与模板**，不含任何服务端代码。每份说明各自写清：
平台能不能设响应头、子路径怎么配、`connect-src` 用哪一套。

| 平台 | 能否设响应头 | 用哪个文件 | 子路径部署 |
|---|---|---|---|
| GitHub Pages | **不能**（只能靠 `index.html` 里的 meta CSP） | `github-pages.md` | 项目站点需要 `--base=/<repo>/` |
| Cloudflare Pages | 能（`_headers`，构建产物里已带） | `cloudflare-pages.md` | `--base=/<path>/` |
| Vercel | 能（`vercel.json`） | `vercel.md` + `vercel.json` 模板 | `--base=/<path>/` |
| **腾讯云（EdgeOne Pages / COS / 轻量服务器）** | EdgeOne 未验证；COS 拿不到响应头；轻量服务器能（Nginx） | **`tencent-edgeone.md`** | 直接传根目录即可 |

> **给同事用的公开部署，请用「本地版 + 腾讯云 EdgeOne Pages」**：
> 构建 `npm run build`，把 `_deploy/上传这个文件夹` 拖上去。完整步骤、备选路线、
> 上线自检清单与红线都写在 `tencent-edgeone.md` 里。
> 公开部署**不要**用含 AI 版——那会让每位访客在由部署者控制的页面上粘贴自己的 API Key，
> 而 DeepSeek 是否允许新域名跨域我们从未验证过。

## 两套 CSP（PRD 18.6）

| 构建命令 | 模式 | `connect-src` |
|---|---|---|
| `npm run build` | 本地版（默认） | `'none'`——产物**没有任何出站能力**，AI 功能会被浏览器直接拦下 |
| `npm run build:ai` | 含可选 AI 版 | 精确 `https://api.deepseek.com`（不是通配符、不是 `https:`） |

策略字符串的唯一来源是 `src/lib/csp.ts`；构建时由 `vite.config.ts` 的插件注入
`index.html` 的 meta 与产物里的 `_headers` 文件。**不要**在任何配置文件里另抄一份。

自建代理（`https://your-proxy.example.com`）只能这样用：

```bash
CSP_MODE=ai CSP_CONNECT_SRC=https://your-proxy.example.com npm run build
```

`CSP_CONNECT_SRC` **只接受一个精确的 https origin**（不接受通配符 / 路径 / `http:`），
非法值会让构建直接失败，而不是悄悄退回一个更宽的策略。代理会看到你的 Key 与摘要，
因此必须是你自己控制、自己运维的地址（见 `PRIVACY.md`）。

## 共同的三条硬约束

1. **不建 Functions / API 路由 / 云数据库 / 公共 CORS 代理**：本项目没有后端，任何「中转一下」
   的做法都会破坏「数据默认不出浏览器」的承诺；
2. **托管平台的 Analytics / 访问统计一律关闭**：产物里不要出现任何第三方脚本，页面因此不需要
   `script-src` 放宽到第三方域名；
3. **Service Worker 不得缓存、排队或重发 AI 请求**：`public/sw.js` 已经把这三条写成代码
   （非 GET 直接放行、跨源直接放行、带 `Authorization` 直接放行，且不使用 Background Sync）。
   部署时不要替换成带默认运行时缓存的 Workbox 配置——那会自动缓存未预缓存的同源响应。
