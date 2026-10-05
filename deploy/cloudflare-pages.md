# Cloudflare Pages

> **给同事用的公开部署（不需要买域名、不需要备案）**：本平台会给一个**公开**的免费子域名
> `https://<项目名>.pages.dev`，访客不用登录。五分钟流程见下面「不需要 Git 的快速路径」。

## 不需要 Git 的快速路径（直接上传）

1. 注册 / 登录 <https://dash.cloudflare.com/>（邮箱即可，免费）。
2. 左侧 **Workers & Pages** → **Create** → **Pages** → **Upload assets**（Direct Upload）。
3. 项目名填 `zhaopin-analysis`（决定网址前缀）。
4. 把**仓库里的 `_deploy/上传这个文件夹`**（或 `npm run build` 产出的 `dist/`）里的内容
   拖进上传区 —— **`index.html` 必须在最外层**，不要再套一层目录。
5. 点 **Deploy**，得到公开地址：`https://zhaopin-analysis.pages.dev`。
6. 用**无痕窗口**打开验证（无痕没有登录状态，等价于"别人第一次访问"）。
7. 两个开关**不要打开**：**Web Analytics**（会注入统计脚本，违反本项目「不加统计」的约定）
   与 **Rocket Loader**（会改写页面脚本，与严格 `script-src 'self'` 冲突）。

后续更新：重新 `npm run build`，在同一个项目里再上传一次新产物即可（网址不变）。

## 配置（走 Git 集成时）

| 项 | 值 |
|---|---|
| Build command | `npm run build`（本地版）或 `npm run build:ai`（含 AI 版） |
| Build output directory | `dist` |
| Node 版本 | ≥ 20.19（`package.json` 的 `engines` 已写） |
| Functions / Pages Functions | **不要创建**（本项目没有后端） |
| Web Analytics | **关闭**（不要注入任何统计脚本） |

子路径部署（例如挂在 `https://example.com/tools/review/`）加 `--base`：

```bash
npm run build -- --base=/tools/review/
```

## 响应头（本平台的优势）

Cloudflare Pages 会读取构建产物根目录的 `_headers` 文件，而**本项目的构建会生成它**
（`vite.config.ts` 的 `dsh:csp` 插件）：里面同时有 `Content-Security-Policy`
与 `X-Content-Type-Options` / `Referrer-Policy` / `X-Frame-Options` /
`Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` / `Permissions-Policy`，
以及 `/assets/*` 长缓存、`index.html` 与 `sw.js` 不缓存的规则。

因此在这个平台上：

- **两套 CSP 都是真响应头**，而不是 meta 兜底；`frame-ancestors 'none'` 之类只对响应头生效的
  指令在这里才真正起作用；
- 想用自建代理时按 `deploy/README.md` 的方式设置 `CSP_MODE=ai` 与 `CSP_CONNECT_SRC`，
  构建产出的 `_headers` 会自动带上那一个精确 origin。

## 注意

- `_headers` 是**构建产物**的一部分（每次构建重新生成），不要把它提交到仓库根；
  修改策略请改 `src/lib/csp.ts`。
- Cloudflare 的「Rocket Loader」等自动优化会改写页面脚本，**请关闭**：
  它与严格 `script-src 'self'` 冲突，也可能破坏模块加载顺序。
- 预览部署（Preview deployments）同样会带上 `_headers`，因此预览环境的 CSP 与生产一致——
  这正是我们想要的：策略只在构建时决定，不随环境漂移。
